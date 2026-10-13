import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { functionAdapter, processAdapter } from '@agent-nexus/driftbench-adapters';
import { defaultReaders } from '@agent-nexus/driftbench-artifacts';
import { classifyTool, defaultChecks } from '@agent-nexus/driftbench-checks';
import {
  type AgentAdapter,
  type ArtifactReaderRegistry,
  type Campaign,
  type CampaignPlan,
  type CellOutcome,
  type CheckSet,
  type CompoundingIndex,
  type CostLine,
  type CostUnit,
  canonicalJson,
  compoundingIndex,
  contentHash,
  type DriftClass,
  type LoadedSpec,
  loadSpecs,
  type MinimumDetectableEffect,
  mdeLine,
  outcomeOf,
  type PlannedCell,
  type PlanOptions,
  parseCriterionRef,
  planCampaign,
  type RegistrySource,
  type RetryOptions,
  RunMode,
  type RunResult,
  runCampaign,
  runsByCell,
  type Spec,
  type Store,
  type TargetPrompt,
  TargetRef,
  type UserDriver,
} from '@agent-nexus/driftbench-core';
import { portFromEnv } from '@agent-nexus/driftbench-generate';
import { textTable as table } from '@agent-nexus/driftbench-report';
import { localProvider } from '@agent-nexus/driftbench-sandbox';
import { bootstrapCI } from '@agent-nexus/driftbench-stats';
import {
  openMemoryStore,
  openStore,
  parseVersionRef,
  readCampaignBundle,
  restoreFiles,
  type SqliteStore,
  StoreError,
} from '@agent-nexus/driftbench-store';
import {
  createPerturbingDriver,
  createScriptedDriver,
  type UserModelPort,
} from '@agent-nexus/driftbench-users';
import type { Command } from 'commander';
import type { Io } from '../io';
import { optionNumber } from '../number';
import { noStoreAt } from '../store-path';
import { agentFamilyOf, describeSource, loadPersonas, portFor, userFactory, userSource } from './personas';

/** What lives as long as one campaign: a temporary folder for its sandboxes, made on first use. */
export type CampaignScope = {
  /** The campaign's temporary folder. The CLI removes it, and all it holds, when the campaign closes. */
  tempDir(): Promise<string>;
};

/** What the campaign and smoke commands run with. Tests pass their own. */
export type CampaignDeps = {
  /**
   * The adapter for a target, or undefined when this build has none for it. An adapter that makes
   * sandboxes puts them in `scope.tempDir()` when a scope is given.
   */
  adapterFor(target: TargetRef, scope?: CampaignScope): Promise<AgentAdapter | undefined>;
  /** The machine checks applied to every block. */
  checks: CheckSet;
  /** The readers the artifact checks open produced files with. */
  artifacts?: ArtifactReaderRegistry;
  /**
   * A fresh driver for one run: in mode P, one that injects the cell's perturbation into the spec it runs.
   * Without a cell, the scripted driver.
   */
  driver(cell?: PlannedCell, spec?: Spec): UserDriver;
  /** Tools whose call is a consequential act, for the recovery metrics of mode P. */
  consequential?: (label: string) => boolean;
  /**
   * The model port a simulated user speaks through with --model. Default: the port the environment
   * configures (portFromEnv of @agent-nexus/driftbench-generate). Tests pass a fake one.
   */
  modelPort?(): UserModelPort;
  /** The store at a path, or one held in memory without a path. A failure to open is reported, exit 2. */
  openStore(path: string | undefined): Promise<Store>;
  now(): Date;
};

const MODE_HELP =
  'the run mode: T teacher-forced, F free-running, P perturbed; several separated by commas, such as T,F';

const TARGET_HELP =
  'run every spec on this target (but the specs a --route marks); repeat for several. Without it, each spec runs on its own target';

const ROUTE_HELP =
  'with --target: run the specs a tag marks on this target instead, such as flow:price-sheet=process:acme-ops; repeat for several';

const PROCESS_COMMAND_HELP =
  'the agent command for a process target other than process:acme-ops: a JSON list such as ["python3","agent.py"], or words split on spaces';

/**
 * `--process-command`: a JSON list of strings, or a command line split on spaces (no quoting). Undefined
 * when the text is neither.
 */
export function parseProcessCommand(text: string): string[] | undefined {
  const trimmed = text.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (
        Array.isArray(parsed) &&
        parsed.length > 0 &&
        parsed.every((part) => typeof part === 'string' && part !== '')
      ) {
        return parsed as string[];
      }
    } catch {
      return undefined;
    }
    return undefined;
  }
  const words = trimmed.split(/\s+/).filter((word) => word !== '');
  return words.length > 0 ? words : undefined;
}

/**
 * The deps with every process target other than process:acme-ops reaching `command` through the process
 * adapter, in a local sandbox. Any agent name works: `process:<name>` names the agent, the command runs it.
 */
export function withProcessCommand(deps: CampaignDeps, command: readonly string[]): CampaignDeps {
  const [binary, ...args] = command;
  return {
    ...deps,
    adapterFor: async (target, scope) => {
      if (target.adapter !== 'process' || target.agent === 'acme-ops' || binary === undefined) {
        return deps.adapterFor(target, scope);
      }
      return processAdapter({
        command: binary,
        args,
        provider: localProvider(scope === undefined ? {} : { dir: await scope.tempDir() }),
      });
    },
  };
}

/** Applies `--process-command` to the deps; undefined, with the reason printed, when it is malformed. */
function processDeps(deps: CampaignDeps, text: string | undefined, io: Io): CampaignDeps | undefined {
  if (text === undefined) return deps;
  const command = parseProcessCommand(text);
  if (command === undefined) {
    io.err(
      `--process-command takes a JSON list of strings or a command line, not ${JSON.stringify(text)}.\n`,
    );
    return undefined;
  }
  return withProcessCommand(deps, command);
}

/** The targets this build reaches, for the message of a target it does not. */
const KNOWN_TARGETS =
  'The CLI reaches function:acme-sales (or function:acme), the Acme sales assistant, and process:acme-ops, the Acme ops agent.';

/**
 * What the commands run with. `function:acme-sales`, the target the Acme conversation specs name, and its
 * short form `function:acme` are the Acme sales assistant behind the function adapter of
 * @agent-nexus/driftbench-adapters. `process:acme-ops`, the target of the Acme task spec, is the Acme ops agent behind
 * the process adapter. The checks are `defaultChecks()` of @agent-nexus/driftbench-checks with the readers of
 * @agent-nexus/driftbench-artifacts, and the store is @agent-nexus/driftbench-store, a SQLite file with `--store` and in memory
 * without it.
 */
export const defaultDeps: CampaignDeps = {
  adapterFor: async (target, scope) => {
    if (target.adapter === 'function' && (target.agent === 'acme' || target.agent === 'acme-sales')) {
      return acmeFunctionAdapter();
    }
    if (target.adapter === 'process' && target.agent === 'acme-ops') return acmeOpsAdapter(scope);
    return undefined;
  },
  checks: defaultChecks(),
  artifacts: defaultReaders(),
  driver: (cell, spec) => {
    if (cell?.perturbationId === undefined) return createScriptedDriver();
    if (spec === undefined) {
      throw new Error(`campaign: the perturbed cell ${cell.cellId} needs its spec for the perturbing driver`);
    }
    return createPerturbingDriver({ spec, perturbation: cell.perturbationId });
  },
  consequential: (label) => classifyTool(label) !== undefined,
  openStore: async (path) => (path === undefined ? openMemoryStore() : openStore(path)),
  now: () => new Date(),
};

type PlanCommandOptions = {
  target: string[];
  route?: string[];
  mode: string;
  repeats: string;
  budgetUsd?: string;
  baselineRate: string;
  rho?: string;
  store?: string;
  json?: boolean;
};

type RunCommandOptions = {
  dataset?: string;
  cacheSuite?: string;
  prompt?: string[];
  target: string[];
  route?: string[];
  mode: string;
  repeats: string;
  campaign?: string;
  store?: string;
  cache: boolean;
  concurrency: string;
  budgetUsd?: string;
  processCommand?: string;
  json?: boolean;
  driver?: string;
  persona?: string[];
  recording?: string[];
  model?: boolean;
  agentFamily?: string;
  judgeFamily?: string[];
} & RetryFlags;

/** The retry flags of `campaign run` and `campaign resume`: the run's settings over the spec target's. */
type RetryFlags = { retryAttempts?: string; retryBaseMs?: string; retryMaxMs?: string };

type StoredCommandOptions = RetryFlags & {
  store: string;
  cache?: boolean;
  cacheSuite?: string;
  concurrency?: string;
  budgetUsd?: string;
  processCommand?: string;
  json?: boolean;
  detail?: boolean;
};

export function registerCampaignCommands(
  program: Command,
  io: Io,
  setExit: (code: number) => void,
  deps: CampaignDeps = defaultDeps,
): void {
  const campaign = program
    .command('campaign')
    .description('Plan and run campaigns: specs x targets x modes x repeats.');

  campaign
    .command('plan')
    .description('Expand the cells, project their cost and print the minimum detectable effect.')
    .argument('<paths...>', 'spec files or folders')
    .option('--target <adapter[:agent]>', TARGET_HELP, collect, [])
    .option('--route <tag=target>', ROUTE_HELP, collect, [])
    .option('--mode <modes>', MODE_HELP, 'F')
    .option('--repeats <n>', 'runs per spec, target and mode', '1')
    .option('--budget-usd <usd>', 'compare the projected cost with this budget')
    .option('--baseline-rate <rate>', 'the pass rate the minimum detectable effect assumes', '0.5')
    .option('--rho <rho>', 'the correlation of repeats of one spec, as icc measures it, from 0 to 1', '0')
    .option('--store <file>', 'read the measured unit costs from this store')
    .option('--json', 'print one JSON document')
    .action(async (paths: string[], options: PlanCommandOptions) => {
      setExit(await campaignPlanCommand(paths, options, io, deps));
    });

  campaign
    .command('run')
    .description('Run every cell and print pass or fail per cell. Exit 1 on any failed or failing cell.')
    .argument('[paths...]', 'spec files or folders; none when --dataset gives the specs')
    .option('--dataset <name[@version]>', 'run the specs of this dataset version of the store, and record it')
    .option(
      '--prompt <name[@version]>',
      'record this prompt version of the store; repeat for several',
      collect,
      [],
    )
    .option('--target <adapter[:agent]>', TARGET_HELP, collect, [])
    .option('--route <tag=target>', ROUTE_HELP, collect, [])
    .option('--mode <modes>', MODE_HELP, 'F')
    .option('--repeats <n>', 'runs per spec, target and mode', '1')
    .option('--campaign <id>', 'the campaign id; one is made from the content and the clock without it')
    .option('--store <file>', 'keep the campaign, its runs and the cache in this store')
    .option('--no-cache', 'neither replay runs from the cache nor write to it')
    .option(
      '--cache-suite <name>',
      'the cache suite of this campaign: a new name starts from an empty cache, the old entries stay',
    )
    .option('--concurrency <n>', 'cells run at the same time', '4')
    .option('--budget-usd <usd>', 'a hard stop: no cell starts once the campaign has spent this much')
    .option('--process-command <command>', PROCESS_COMMAND_HELP)
    .option(
      '--driver <driver>',
      "who writes the user turns: scripted (the spec's own) or simulated (a persona)",
      'scripted',
    )
    .option(
      '--persona <file>',
      'with --driver simulated: a persona, which plays the spec its file names; repeat it',
      collect,
      [],
    )
    .option(
      '--recording <file>',
      'with --driver simulated: replay the answers of a recording; repeat it',
      collect,
      [],
    )
    .option(
      '--model',
      'with --driver simulated: speak through the model port the environment configures (paid)',
    )
    .option(
      '--agent-family <family>',
      'the model family of the agent under test; none for an agent that is not a model',
    )
    .option('--judge-family <family>', 'a model family of the judges; repeat it', collect, [])
    .option(
      '--retry-attempts <n>',
      'attempts per model call, the first included; over the spec target retry (default 4)',
    )
    .option(
      '--retry-base-ms <ms>',
      'the wait before the first retry, doubled for each later one (default 500)',
    )
    .option('--retry-max-ms <ms>', 'the longest wait between two attempts (default 30000)')
    .option('--json', 'print one JSON document')
    .action(async (paths: string[], options: RunCommandOptions) => {
      setExit(await campaignRunCommand(paths, options, io, deps));
    });

  campaign
    .command('resume')
    .description(
      'Run the cells of a stored campaign that have no completed run; reuse the others. Each cell runs on the target the campaign pinned for it.',
    )
    .argument('[campaignId]', 'the campaign id; the latest campaign of the store without it')
    .requiredOption('--store <file>', 'the store that holds the campaign')
    .option('--no-cache', 'neither replay runs from the cache nor write to it')
    .option('--concurrency <n>', 'cells run at the same time', '4')
    .option('--budget-usd <usd>', "a hard stop on the campaign's spend; default: the budget it was run with")
    .option('--process-command <command>', PROCESS_COMMAND_HELP)
    .option(
      '--retry-attempts <n>',
      'attempts per model call, the first included; over the spec target retry (default 4)',
    )
    .option(
      '--retry-base-ms <ms>',
      'the wait before the first retry, doubled for each later one (default 500)',
    )
    .option('--retry-max-ms <ms>', 'the longest wait between two attempts (default 30000)')
    .option('--json', 'print one JSON document')
    .action(async (campaignId: string | undefined, options: StoredCommandOptions) => {
      setExit(await campaignResumeCommand(campaignId, options, io, deps));
    });

  campaign
    .command('status')
    .description('Print the state of every cell of a stored campaign. Exit 0 when every cell passes.')
    .argument('[campaignId]', 'the campaign id; the latest campaign of the store without it')
    .requiredOption('--store <file>', 'the store that holds the campaign')
    .option(
      '--detail',
      'also print the compounding index (T minus F), the succession of every run and the recovery of every perturbed run',
    )
    .option('--json', 'print one JSON document')
    .action(async (campaignId: string | undefined, options: StoredCommandOptions) => {
      setExit(await campaignStatusCommand(campaignId, options, io, deps));
    });

  campaign
    .command('export')
    .description(
      'Write a stored campaign as a folder: its runs, the specs it ran and the exact files of its dataset and prompt versions.',
    )
    .argument('<campaignId>', 'the campaign id')
    .requiredOption('--store <file>', 'the store that holds the campaign')
    .requiredOption('--out <dir>', 'the folder the bundle goes in, as <dir>/<campaignId>')
    .action(async (campaignId: string, options: { store: string; out: string }) => {
      setExit(await campaignExportCommand(campaignId, options, io));
    });

  campaign
    .command('import')
    .description('Store a campaign bundle: its runs, specs and registry versions, all or nothing.')
    .argument('<folder>', 'the bundle folder campaign export wrote')
    .requiredOption('--store <file>', 'the store to import into; made when missing')
    .action(async (folder: string, options: { store: string }) => {
      setExit(await campaignImportCommand(folder, options, io));
    });
}

/** `campaign export`: exit 0 written, 2 on an unknown campaign, a store it cannot open or a source it lacks. */
export async function campaignExportCommand(
  campaignId: string,
  options: { store: string; out: string },
  io: Io,
): Promise<number> {
  if (noStoreAt(resolve(io.cwd, options.store), options.store, io)) return 2;
  return withBundleStore(options.store, io, async (store) => {
    const folder = await store.exportCampaign(campaignId, resolve(io.cwd, options.out));
    const bundle = await readCampaignBundle(folder);
    const sources = bundle.sources.map(({ version }) => `${version.kind} ${version.name}@${version.version}`);
    io.out(
      `Exported campaign ${campaignId} to ${shown(io, folder)}: ${bundle.runs.length} runs, ${bundle.specs.length} specs, ${sources.length} sources${sources.length === 0 ? '' : ` (${sources.join(', ')})`}.\n`,
    );
    return 0;
  });
}

/** `campaign import`: exit 0 stored, 2 on a bundle that does not read or a conflict with the store. */
export async function campaignImportCommand(
  folder: string,
  options: { store: string },
  io: Io,
): Promise<number> {
  // The bundle is read before the store opens, so a bundle that does not read leaves no new store behind.
  try {
    await readCampaignBundle(resolve(io.cwd, folder));
  } catch (cause) {
    if (!(cause instanceof StoreError)) throw cause;
    io.err(`${cause.message}\n`);
    return 2;
  }
  return withBundleStore(options.store, io, async (store) => {
    const bundle = await store.importCampaign(resolve(io.cwd, folder));
    io.out(
      `Imported campaign ${bundle.campaign.campaignId} into ${options.store}: ${bundle.runs.length} runs, ${bundle.specs.length} specs, ${bundle.sources.length} sources.\n`,
    );
    return 0;
  });
}

async function withBundleStore(
  path: string,
  io: Io,
  work: (store: SqliteStore) => Promise<number>,
): Promise<number> {
  let store: SqliteStore;
  try {
    store = openStore(resolve(io.cwd, path));
  } catch (cause) {
    io.err(`Cannot open the store at ${path}: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return 2;
  }
  try {
    return await work(store);
  } catch (cause) {
    io.err(`${(cause instanceof Error ? cause.message : String(cause)).replace(/^store: /, '')}\n`);
    return 2;
  } finally {
    await store.close();
  }
}

function shown(io: Io, path: string): string {
  const rel = relative(io.cwd, path);
  return rel === '' || rel.startsWith('..') ? path : rel;
}

/** `campaign plan`: the cells, the projected cost and the minimum detectable effect. Exit 0, or 2 on bad input. */
export async function campaignPlanCommand(
  paths: string[],
  options: PlanCommandOptions,
  io: Io,
  deps: CampaignDeps,
): Promise<number> {
  const shape = parseShape(options, io);
  const budget =
    options.budgetUsd === undefined ? undefined : parseNumber(options.budgetUsd, '--budget-usd', io);
  const baselineRate = parseRate(options.baselineRate, io);
  const rho = parseRho(options.rho ?? '0', io);
  if (!shape || budget === null || baselineRate === undefined || rho === undefined) return 2;
  const loaded = await loadValidSpecs(paths, io);
  if (!loaded) return 2;
  const runs = specRuns(loaded, shape.targets, io, shape.routes);
  if (!runs) return 2;
  if (tooManyCells(runs, shape, io)) return 2;
  // A target no adapter is set up for is bad input here too (docs/running.md, "Exit codes"): the plan
  // checks it the way run does, so a plan that prints is a plan that can run.
  const scope = openScope();
  try {
    if (!(await adaptersFor(runs, deps, scope, io))) return 2;
  } finally {
    await closeScope(scope, io);
  }
  if (!options.json) io.out(targetNotes(loaded, shape.targets, shape.routes));

  let units: CostUnit[] = [];
  if (options.store) {
    const store = await openReported(deps, resolve(io.cwd, options.store), io);
    if (!store) return 2;
    try {
      units = await store.listUnits();
    } finally {
      await store.close();
    }
  }
  const plan = planFor(runs, shape.modes, shape.repeats, {
    units,
    baselineRate,
    rho,
    ...(budget === undefined ? {} : { budgetUsd: budget }),
  });

  if (options.json) {
    io.out(`${JSON.stringify(plan, null, 2)}\n`);
    return 0;
  }
  const targets =
    shape.targets.length > 0
      ? count(shape.targets.length, 'target')
      : `each on its own target (${pinnedTargets(runs).map(showTarget).join(', ')})`;
  io.out(
    `Plan: ${count(loaded.length, 'spec')}, ${targets}, ${shape.modes.length === 1 ? 'mode' : 'modes'} ${shape.modes.join(', ')}, ${count(shape.repeats, 'repeat')}: ${count(plan.cells.length, 'cell')}, ${count(plan.blocks, 'block')}.\n`,
  );
  io.out(
    `${table([
      [
        'cell',
        'spec',
        'target',
        'mode',
        'repeat',
        ...(plan.cells.some((cell) => cell.perturbationId !== undefined) ? ['perturbation'] : []),
        'blocks',
      ],
      ...plan.cells.map((cell) => [
        cell.cellId,
        cell.specId,
        showTarget(cell.target),
        cell.mode,
        String(cell.repeat),
        ...(plan.cells.some((other) => other.perturbationId !== undefined)
          ? [cell.perturbationId ?? '']
          : []),
        String(cell.blocks),
      ]),
    ]).join('\n')}\n`,
  );
  io.out(`${costLine(plan)}\n`);
  for (const line of plan.mde) {
    const effect =
      line.runsPerArm === 0
        ? 'no runs'
        : line.effect === undefined
          ? 'none detectable'
          : `${(line.effect * 100).toFixed(1)} points`;
    io.out(
      `Minimum detectable effect, mode ${line.mode}: ${effect} on a ${(line.baselineRate * 100).toFixed(0)}% pass rate, with ${count(line.runsPerArm, 'run')} per arm over ${count(line.specs, 'spec')} (rho ${line.rho}, design effect ${line.designEffect.toFixed(2)}; two-sided alpha ${line.alpha}, power ${line.power}).\n`,
    );
  }
  return 0;
}

/** `campaign run`: a new campaign over the specs, every cell run. Exit 0 when every cell passes, 1 otherwise, 2 on bad input. */
export async function campaignRunCommand(
  paths: string[],
  options: RunCommandOptions,
  io: Io,
  deps: CampaignDeps,
): Promise<number> {
  const shape = parseShape(options, io);
  const pool = parsePool(options, io);
  const withCommand = processDeps(deps, options.processCommand, io);
  if (!shape || !pool || !withCommand) return 2;
  deps = withCommand;
  const scope = openScope();
  try {
    const registry = await registrySources(options, scope, io);
    if (!registry) return 2;
    const read = await loadValidSpecs([...paths, ...registry.folders.map((folder) => folder.path)], io);
    if (!read) return 2;
    // A spec restored from a dataset is stored under its dataset reference, never the temporary folder.
    const loaded = read.map((entry) => ({ ...entry, path: datasetPath(entry.path, registry.folders) }));
    const withPrompt = (target: TargetRef): TargetRef =>
      registry.prompt === undefined ? target : { ...target, prompt: registry.prompt };
    const targets = shape.targets.map(withPrompt);
    const runs = specRuns(loaded, targets, io, shape.routes)?.map((each) =>
      each.pinned === undefined
        ? each
        : { ...each, targets: each.targets.map(withPrompt), pinned: withPrompt(each.pinned) },
    );
    if (!runs) return 2;
    if (tooManyCells(runs, shape, io)) return 2;
    const driven = await driverDeps(options, runs, deps, io);
    if (!driven) return 2;
    deps = driven.deps;
    const adapters = await adaptersFor(runs, deps, scope, io);
    if (!adapters) return 2;
    if (!options.json) io.out(targetNotes(loaded, shape.targets, shape.routes));
    if (!options.json && driven.note) io.out(driven.note);

    const store = await openReported(deps, options.store ? resolve(io.cwd, options.store) : undefined, io);
    if (!store) return 2;
    try {
      const createdAt = deps.now().toISOString();
      // Without --target each spec pins its own target, so status and resume plan the same cells.
      const specs = runs.map(({ spec, hash, pinned }) => ({
        id: spec.id,
        hash,
        ...(pinned === undefined ? {} : { target: pinned }),
      }));
      const campaignTargets = targets.length > 0 ? targets : pinnedTargets(runs);
      const repeats = { T: 0, F: 0, P: 0 };
      for (const mode of shape.modes) repeats[mode] = shape.repeats;
      // One mode keeps the key a single-mode campaign always had, so its id is unchanged.
      const mode = shape.modes.length === 1 ? shape.modes[0] : shape.modes;
      const campaignId =
        options.campaign ?? `c-${contentHash({ specs, targets: campaignTargets, mode, repeats, createdAt })}`;
      if (await store.getCampaign(campaignId)) {
        io.err(
          `Campaign ${campaignId} already exists. Resume it with: driftbench campaign resume ${campaignId}\n`,
        );
        return 2;
      }
      for (const entry of loaded) await store.putSpec(entry);
      const campaign: Campaign = {
        campaignId,
        specs,
        targets: campaignTargets,
        modes: shape.modes,
        repeats,
        // 0 when no budget was given: the schema has no field for "no budget".
        budgetUsd: pool.budgetUsd ?? 0,
        judge: { mode: 'system1', judges: [] },
        createdAt,
        ...(registry.sources.length > 0 ? { sources: registry.sources } : {}),
      };
      try {
        await store.putCampaign(campaign);
      } catch (cause) {
        // Another process stored this id between the check above and this write: the same bad input.
        if (cause instanceof StoreError && cause.code === 'CAMPAIGN_CONFLICT') {
          io.err(
            `Campaign ${campaignId} already exists. Resume it with: driftbench campaign resume ${campaignId}\n`,
          );
          return 2;
        }
        throw cause;
      }
      return await executeCampaign(campaign, loaded, adapters, store, deps, io, {
        cache: options.cache,
        ...(options.cacheSuite === undefined ? {} : { cacheSuite: options.cacheSuite }),
        json: options.json === true,
        kept: options.store !== undefined,
        ...pool,
      });
    } finally {
      await store.close();
    }
  } finally {
    await closeScope(scope, io);
  }
}

/**
 * The registry versions `--dataset` and `--prompt` name, read from the store. The dataset's files are
 * restored, byte for byte, into the campaign's temporary folder, and its specs load from there.
 */
async function registrySources(
  options: RunCommandOptions,
  scope: CampaignScope,
  io: Io,
): Promise<RegistryRead | undefined> {
  const prompts = options.prompt ?? [];
  if (options.dataset === undefined && prompts.length === 0) return { folders: [], sources: [] };
  if (prompts.length > 1) {
    io.err('--prompt names the one prompt the agent runs with: give it once.\n');
    return undefined;
  }
  if (options.store === undefined) {
    io.err('--dataset and --prompt read the registry of a store: add --store <file>.\n');
    return undefined;
  }
  let store: SqliteStore;
  try {
    store = openStore(resolve(io.cwd, options.store));
  } catch (cause) {
    io.err(
      `Cannot open the store at ${options.store}: ${cause instanceof Error ? cause.message : String(cause)}\n`,
    );
    return undefined;
  }
  try {
    const read: RegistryRead = { folders: [], sources: [] };
    const wanted = [
      ...(options.dataset === undefined ? [] : [{ kind: 'dataset' as const, text: options.dataset }]),
      ...prompts.map((text) => ({ kind: 'prompt' as const, text })),
    ];
    for (const { kind, text } of wanted) {
      const { name, ref } = parseVersionRef(text);
      const version = await store.getVersion(kind, name, ref);
      if (!version) {
        io.err(
          `No ${kind} ${text} in ${options.store}. Push it with: driftbench ${kind} push ${name} <path>\n`,
        );
        return undefined;
      }
      const label = `${version.name}@${version.version}`;
      read.sources.push({ kind, name: version.name, version: version.version, hash: version.hash });
      const files = await store.readVersionFiles(version);
      if (kind === 'dataset') {
        const folder = join(await scope.tempDir(), `dataset-${version.name}-${version.version}`);
        await restoreFiles(files, folder, { single: false });
        read.folders.push({ path: folder, label });
        continue;
      }
      const [only] = files;
      if (only === undefined || files.length > 1) {
        io.err(
          `prompt ${label} holds ${files.length} files; --prompt hands the agent one text, so push a single prompt file.\n`,
        );
        return undefined;
      }
      let promptText: string;
      try {
        promptText = new TextDecoder('utf-8', { fatal: true }).decode(only.bytes);
      } catch {
        io.err(`prompt ${label} is not UTF-8 text: --prompt hands the agent a text.\n`);
        return undefined;
      }
      read.prompt = { name: version.name, version: version.version, hash: version.hash, text: promptText };
    }
    return read;
  } catch (cause) {
    io.err(`${cause instanceof Error ? cause.message : String(cause)}\n`);
    return undefined;
  } finally {
    await store.close();
  }
}

/** What `--dataset` and `--prompt` read: the restored dataset folders, the versions, the prompt. */
type RegistryRead = {
  folders: { path: string; label: string }[];
  sources: RegistrySource[];
  prompt?: TargetPrompt;
};

/** A spec file inside a restored dataset as `name@version/<path in the dataset>`; others as they are. */
function datasetPath(path: string, folders: RegistryRead['folders']): string {
  for (const folder of folders) {
    const inside = relative(folder.path, path);
    if (inside !== '' && !inside.startsWith('..') && !isAbsolute(inside)) {
      return `${folder.label}/${inside.split(sep).join('/')}`;
    }
  }
  return path;
}

/** `campaign resume`: runs the cells with no completed run, reuses the others. Exits like `campaign run`. */
export async function campaignResumeCommand(
  campaignId: string | undefined,
  options: StoredCommandOptions,
  io: Io,
  deps: CampaignDeps,
): Promise<number> {
  const pool = parsePool({ ...options, concurrency: options.concurrency ?? '4' }, io);
  const withCommand = processDeps(deps, options.processCommand, io);
  if (!pool || !withCommand) return 2;
  deps = withCommand;
  if (noStoreAt(resolve(io.cwd, options.store), options.store, io)) return 2;
  const store = await openReported(deps, resolve(io.cwd, options.store), io);
  if (!store) return 2;
  const scope = openScope();
  try {
    const stored = await storedCampaign(store, campaignId, options.store, io);
    if (!stored) return 2;
    const adapters = await adaptersFor(runsOf(stored.campaign, stored.specs), deps, scope, io);
    if (!adapters) return 2;
    const budgetUsd =
      pool.budgetUsd ?? (stored.campaign.budgetUsd > 0 ? stored.campaign.budgetUsd : undefined);
    return await executeCampaign(stored.campaign, stored.specs, adapters, store, deps, io, {
      cache: options.cache !== false,
      ...(options.cacheSuite === undefined ? {} : { cacheSuite: options.cacheSuite }),
      json: options.json === true,
      kept: true,
      concurrency: pool.concurrency,
      ...(budgetUsd === undefined ? {} : { budgetUsd }),
      ...(pool.retry ? { retry: pool.retry } : {}),
    });
  } finally {
    // closeScope never throws, so the store is closed whatever happens to the folder.
    await closeScope(scope, io);
    await store.close();
  }
}

/** `campaign status`: the state of every cell. Exit 0 when every cell passes, 1 otherwise, 2 on bad input. */
export async function campaignStatusCommand(
  campaignId: string | undefined,
  options: StoredCommandOptions,
  io: Io,
  deps: CampaignDeps,
): Promise<number> {
  if (noStoreAt(resolve(io.cwd, options.store), options.store, io)) return 2;
  const store = await openReported(deps, resolve(io.cwd, options.store), io);
  if (!store) return 2;
  try {
    const stored = await storedCampaign(store, campaignId, options.store, io);
    if (!stored) return 2;
    const { campaign } = stored;
    const plan = planOf(campaign, stored.specs);
    const byCell = await runsByCell(store, campaign.campaignId);
    const outcomes = plan.cells.map((cell) => outcomeOf(cell, byCell.get(cell.cellId)));
    const detail = options.detail ? detailOf(outcomes, stored.specs) : undefined;
    if (options.json) {
      io.out(
        `${JSON.stringify({ ...report(campaign.campaignId, outcomes, true, []), ...(detail ? { detail } : {}) }, null, 2)}\n`,
      );
    } else {
      io.out(`Campaign ${campaign.campaignId}, created ${campaign.createdAt}.\n`);
      for (const outcome of outcomes) io.out(cellLine(outcome));
      io.out(`${summaryLine(outcomes)}\n`);
      if (detail) io.out(detailText(detail));
    }
    return outcomes.every((outcome) => outcome.state === 'pass') ? 0 : 1;
  } finally {
    await store.close();
  }
}

async function executeCampaign(
  campaign: Campaign,
  loaded: readonly LoadedSpec[],
  adapters: ReadonlyMap<string, AgentAdapter>,
  store: Store,
  deps: CampaignDeps,
  io: Io,
  flags: {
    cache: boolean;
    cacheSuite?: string;
    json: boolean;
    kept: boolean;
    concurrency: number;
    budgetUsd?: number;
    retry?: RetryOptions;
  },
): Promise<number> {
  const plan = planOf(campaign, loaded);
  const specs = new Map(loaded.map((entry) => [`${entry.spec.id}@${entry.hash}`, entry.spec]));
  const checks = deps.checks.map((check) => check.name);
  if (!flags.json) {
    const budget = flags.budgetUsd === undefined ? '' : ` Budget ${usd(flags.budgetUsd)}.`;
    io.out(
      `Campaign ${campaign.campaignId}: ${count(plan.cells.length, 'cell')}, ${flags.concurrency} at a time.${budget} Checks: ${checks.length > 0 ? checks.join(', ') : 'none loaded'}.\n`,
    );
    // Beside the list of checks: the criteria no check of this campaign will judge.
    const unjudged = checks.includes(JUDGE_CHECK) ? undefined : notJudgedNote(specs.values());
    if (unjudged !== undefined) io.out(unjudged);
  }
  const outcomes = await runCampaign({
    campaignId: campaign.campaignId,
    cells: plan.cells,
    recordEvents: true,
    specFor: (cell) => required(specs.get(`${cell.specId}@${cell.specHash}`), `spec ${cell.specId}`),
    adapterFor: (target) => required(adapters.get(showTarget(target)), `adapter ${showTarget(target)}`),
    driver: (cell, spec) => deps.driver(cell, spec),
    ...(deps.consequential ? { consequential: deps.consequential } : {}),
    checks: deps.checks,
    ...(deps.artifacts ? { artifacts: deps.artifacts } : {}),
    store,
    // The runner neither replays nor caches a run in a sandbox: a replay has no workspace to read.
    ...(flags.cache ? { cache: store } : {}),
    ...(flags.cacheSuite === undefined ? {} : { cacheSuite: flags.cacheSuite }),
    now: () => deps.now(),
    concurrency: flags.concurrency,
    ...(flags.budgetUsd === undefined ? {} : { budgetUsd: flags.budgetUsd }),
    ...(flags.retry ? { retry: flags.retry } : {}),
    ...(flags.json ? {} : { onCell: (outcome: CellOutcome) => io.out(cellLine(outcome)) }),
  });
  if (flags.json) {
    io.out(`${JSON.stringify(report(campaign.campaignId, outcomes, flags.kept, checks), null, 2)}\n`);
  } else {
    io.out(`${summaryLine(outcomes)}\n`);
    if (!flags.kept) io.out('The runs are not kept: pass --store <file> to keep them.\n');
  }
  return outcomes.every((outcome) => outcome.state === 'pass') ? 0 : 1;
}

/** The name of the check a council of @agent-nexus/driftbench-judges adds to the checks. */
const JUDGE_CHECK = 'judge';

/**
 * What a campaign without a judge left unjudged: the criteria its specs name in a block or a perturbation.
 * Such a criterion gets no verdict, so a run can read pass with a gating criterion never looked at.
 * Undefined when no spec names a criterion.
 */
function notJudgedNote(specs: Iterable<Spec>): string | undefined {
  const names = new Set<string>();
  const gating = new Set<string>();
  let blocks = 0;
  let withCriteria = 0;
  for (const spec of specs) {
    const always = new Set((spec.criteria ?? []).filter((each) => each.gating).map((each) => each.name));
    const before = blocks;
    for (const expect of [...spec.blocks, ...(spec.perturbations ?? [])].map((each) => each.expect)) {
      const refs = (expect?.criteria ?? []).flatMap((ref) => parseCriterionRef(ref) ?? []);
      if (refs.length === 0) continue;
      blocks += 1;
      for (const ref of refs) {
        names.add(ref.name);
        if (ref.gating || always.has(ref.name)) gating.add(ref.name);
      }
    }
    if (blocks > before) withCriteria += 1;
  }
  if (names.size === 0) return undefined;
  const listed = [...names].slice(0, 5).join(', ') + (names.size > 5 ? `, and ${names.size - 5} more` : '');
  const criteria = names.size === 1 ? '1 criterion' : `${names.size} criteria`;
  const these =
    names.size === 1 ? 'it has no verdict and counts' : 'these criteria have no verdict and count';
  const gates = gating.size === 0 ? 'none of them gating' : `${gating.size} of them gating`;
  return `Not judged: ${criteria} in ${count(blocks, 'block')} of ${count(withCriteria, 'spec')} (${listed}), ${gates}. This campaign loads no judge, so ${these} in no pass or fail. See docs/concepts/judges.md.\n`;
}

async function openReported(
  deps: CampaignDeps,
  path: string | undefined,
  io: Io,
): Promise<Store | undefined> {
  try {
    return await deps.openStore(path);
  } catch (cause) {
    io.err(`Cannot open the store at ${path}: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return undefined;
  }
}

function planOf(campaign: Campaign, loaded: readonly { spec: Spec; hash: string }[]): CampaignPlan {
  return planFor(runsOf(campaign, loaded), campaign.modes, campaign.repeats);
}

async function storedCampaign(
  store: Store,
  campaignId: string | undefined,
  path: string,
  io: Io,
): Promise<{ campaign: Campaign; specs: LoadedSpec[] } | undefined> {
  let campaign: Campaign | undefined;
  if (campaignId === undefined) {
    // The store lists its campaigns newest first: the first is the latest.
    [campaign] = await store.listCampaigns();
    if (!campaign) {
      io.err(`The store at ${path} holds no campaign. Run one with: driftbench campaign run <paths...>\n`);
      return undefined;
    }
  } else {
    campaign = await store.getCampaign(campaignId);
    if (!campaign) {
      io.err(`No campaign ${campaignId} in ${path}.\n`);
      return undefined;
    }
  }
  const specs: LoadedSpec[] = [];
  for (const pinned of campaign.specs) {
    const spec = await store.getSpec(pinned.id, pinned.hash);
    if (!spec) {
      io.err(
        `The store has no spec ${pinned.id} at hash ${pinned.hash}, which campaign ${campaign.campaignId} pins.\n`,
      );
      return undefined;
    }
    specs.push(spec);
  }
  return { campaign, specs };
}

/** A tag and the target the specs it marks run on, whatever --target says. */
export type Route = { tag: string; target: TargetRef };

type Shape = { targets: TargetRef[]; routes: Route[]; modes: RunMode[]; repeats: number };

type Pool = { concurrency: number; budgetUsd?: number; retry?: RetryOptions };

function parsePool(
  options: { concurrency: string; budgetUsd?: string | undefined } & RetryFlags,
  io: Io,
): Pool | undefined {
  const concurrency = optionNumber(options.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    io.err(`--concurrency takes a whole number of at least 1, not "${options.concurrency}".\n`);
    return undefined;
  }
  const retry = parseRetry(options, io);
  if (retry === null) return undefined;
  const pool: Pool = { concurrency, ...(retry ? { retry } : {}) };
  if (options.budgetUsd === undefined) return pool;
  const budgetUsd = parseNumber(options.budgetUsd, '--budget-usd', io);
  return budgetUsd === null ? undefined : { ...pool, budgetUsd };
}

/** The retry flags as runner settings: undefined when none is given, null (after a message) when one is bad. */
function parseRetry(flags: RetryFlags, io: Io): RetryOptions | undefined | null {
  const read = (text: string | undefined, flag: string, min: number): number | undefined | null => {
    if (text === undefined) return undefined;
    const value = optionNumber(text);
    if (Number.isInteger(value) && value >= min) return value;
    io.err(`${flag} takes a whole number of at least ${min}, not "${text}".\n`);
    return null;
  };
  const maxAttempts = read(flags.retryAttempts, '--retry-attempts', 1);
  const baseDelayMs = read(flags.retryBaseMs, '--retry-base-ms', 0);
  const maxDelayMs = read(flags.retryMaxMs, '--retry-max-ms', 0);
  if (maxAttempts === null || baseDelayMs === null || maxDelayMs === null) return null;
  const retry: RetryOptions = {
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
    ...(baseDelayMs === undefined ? {} : { baseDelayMs }),
    ...(maxDelayMs === undefined ? {} : { maxDelayMs }),
  };
  return Object.keys(retry).length > 0 ? retry : undefined;
}

/**
 * Modes, repeats and the `--target` list, which is empty when each spec runs on its own target. `--mode`
 * takes one mode or several separated by commas, such as `T,F,P`; the cells come in the order T, F, P.
 */
function parseShape(
  options: { target: string[]; route?: string[]; mode: string; repeats: string },
  io: Io,
): Shape | undefined {
  const named = options.mode.split(',').map((part) => part.trim());
  const modes: RunMode[] = [];
  for (const text of named) {
    const mode = RunMode.safeParse(text);
    if (!mode.success) {
      io.err(`Unknown mode "${text}". The modes are T, F and P, alone or separated by commas.\n`);
      return undefined;
    }
    if (!modes.includes(mode.data)) modes.push(mode.data);
  }
  modes.sort((a, b) => RunMode.options.indexOf(a) - RunMode.options.indexOf(b));
  const repeats = optionNumber(options.repeats);
  if (!Number.isInteger(repeats) || repeats < 1) {
    io.err(`--repeats takes a whole number of at least 1, not "${options.repeats}".\n`);
    return undefined;
  }
  const targets: TargetRef[] = [];
  for (const text of options.target) {
    const target = TargetRef.safeParse(parseTarget(text));
    if (!target.success) {
      io.err(`"${text}" is not a target. Write <adapter> or <adapter>:<agent>, such as function:acme.\n`);
      return undefined;
    }
    if (!targets.some((known) => showTarget(known) === showTarget(target.data))) targets.push(target.data);
  }
  const routes: Route[] = [];
  for (const text of options.route ?? []) {
    const at = text.indexOf('=');
    const target = at > 0 ? TargetRef.safeParse(parseTarget(text.slice(at + 1))) : undefined;
    if (!target?.success) {
      io.err(`--route takes tag=target, such as flow:price-sheet=process:acme-ops, not "${text}".\n`);
      return undefined;
    }
    routes.push({ tag: text.slice(0, at), target: target.data });
  }
  if (routes.length > 0 && targets.length === 0) {
    io.err('--route goes with --target: without it each spec already runs on its own target.\n');
    return undefined;
  }
  return { targets, routes, modes, repeats };
}

/** The most cells a plan or a run expands: past it, the cell list alone would exhaust memory. */
export const MAX_CELLS = 1_000_000;

/**
 * True, after printing why, when specs x targets x modes x repeats (each perturbation of a spec counted as a
 * cell in mode P) exceeds MAX_CELLS. Counted before any cell is made.
 */
function tooManyCells(runs: readonly SpecRun[], shape: Shape, io: Io): boolean {
  let cells = 0;
  for (const run of runs) {
    for (const mode of shape.modes) {
      const variants = mode === 'P' ? Math.max(1, run.spec.perturbations?.length ?? 0) : 1;
      cells += run.targets.length * variants * shape.repeats;
    }
  }
  if (cells <= MAX_CELLS) return false;
  io.err(`--repeats ${shape.repeats} makes ${cells} cells; a campaign holds at most ${MAX_CELLS}.\n`);
  return true;
}

/** One line per spec whose own target names another adapter than a `--target`, which overrides it. */
function targetNotes(
  loaded: readonly LoadedSpec[],
  targets: readonly TargetRef[],
  routes: readonly Route[] = [],
): string {
  const notes: string[] = [];
  for (const { spec } of loaded) {
    if (routeOf(spec, routes)) continue;
    const own = spec.target?.adapter;
    for (const target of targets) {
      if (own !== undefined && own !== target.adapter) {
        notes.push(`Note: ${spec.id} names the ${own} adapter; --target runs it on ${showTarget(target)}.\n`);
      }
    }
  }
  return notes.join('');
}

/** `adapter[:agent]`, such as `function:acme`. */
export function parseTarget(text: string): TargetRef {
  const at = text.indexOf(':');
  if (at < 0) return { adapter: text };
  return { adapter: text.slice(0, at), agent: text.slice(at + 1) };
}

export function showTarget(target: TargetRef): string {
  return target.agent === undefined ? target.adapter : `${target.adapter}:${target.agent}`;
}

/** One adapter per target the runs need, made in the campaign's scope. Exit 2 is the caller's on undefined. */
async function adaptersFor(
  runs: readonly SpecRun[],
  deps: CampaignDeps,
  scope: CampaignScope,
  io: Io,
): Promise<Map<string, AgentAdapter> | undefined> {
  const adapters = new Map<string, AgentAdapter>();
  for (const target of runs.flatMap((run) => run.targets)) {
    const key = showTarget(target);
    if (adapters.has(key)) continue;
    const adapter = await deps.adapterFor(target, scope);
    if (!adapter) {
      const owners = runs
        .filter((run) => run.pinned !== undefined && showTarget(run.pinned) === key)
        .map((run) => run.spec.id);
      io.err(`${noAdapter(target, owners)}\n`);
      return undefined;
    }
    adapters.set(key, adapter);
  }
  return adapters;
}

/** Why a target cannot run: no adapter is set up for it. Names the specs whose own target it is. */
export function noAdapter(target: TargetRef, specIds: readonly string[] = []): string {
  const whose = specIds.length === 0 ? '' : `, the target of ${specIds.join(', ')}`;
  return `No adapter is set up for ${showTarget(target)}${whose}. ${KNOWN_TARGETS}`;
}

/** The target of the first route whose tag the spec carries, if any. */
function routeOf(spec: Spec, routes: readonly Route[]): TargetRef | undefined {
  return routes.find((route) => (spec.tags ?? []).includes(route.tag))?.target;
}

/** One spec and the targets it runs on. `pinned` is set when the spec runs on its own target alone. */
export type SpecRun = { spec: Spec; hash: string; targets: readonly TargetRef[]; pinned?: TargetRef };

/**
 * Each spec with its targets: every `--target` when some are given, else the spec's own `target`. A spec
 * that names no target, with no `--target` given, is printed and the call returns undefined (exit 2).
 */
export function specRuns(
  loaded: readonly LoadedSpec[],
  targets: readonly TargetRef[],
  io: Io,
  routes: readonly Route[] = [],
): SpecRun[] | undefined {
  if (targets.length > 0)
    return loaded.map(({ spec, hash }) => {
      const route = routeOf(spec, routes);
      return route ? { spec, hash, targets: [route], pinned: route } : { spec, hash, targets };
    });
  const runs: SpecRun[] = [];
  const missing: string[] = [];
  for (const { spec, hash } of loaded) {
    if (spec.target === undefined) missing.push(spec.id);
    else runs.push({ spec, hash, targets: [spec.target], pinned: spec.target });
  }
  if (missing.length > 0) {
    io.err(
      `${missing.join(', ')} ${missing.length === 1 ? 'names' : 'name'} no target. Give the spec a target, or run with --target <adapter[:agent]>, such as --target function:acme-sales.\n`,
    );
    return undefined;
  }
  return runs;
}

/** The runs a stored campaign makes: a pinned spec on its own target, every other spec on every target. */
function runsOf(campaign: Campaign, loaded: readonly { spec: Spec; hash: string }[]): SpecRun[] {
  const pins = new Map(campaign.specs.map((entry) => [`${entry.id}@${entry.hash}`, entry.target]));
  return loaded.map(({ spec, hash }) => {
    const pinned = pins.get(`${spec.id}@${hash}`);
    return pinned === undefined
      ? { spec, hash, targets: campaign.targets }
      : { spec, hash, targets: [pinned], pinned };
  });
}

/** The distinct targets the specs pin, in spec order. */
function pinnedTargets(runs: readonly SpecRun[]): TargetRef[] {
  const seen = new Map<string, TargetRef>();
  for (const run of runs) {
    if (run.pinned !== undefined && !seen.has(canonicalJson(run.pinned))) {
      seen.set(canonicalJson(run.pinned), run.pinned);
    }
  }
  return [...seen.values()];
}

/**
 * The plan of the runs. When every spec runs on the same list of targets it is `planCampaign` itself.
 * Otherwise each spec is planned on its own targets and the plans join: cells in spec order, blocks and
 * cost summed per adapter, and the runs per arm of each mode summed, one arm being every spec on its first
 * target. `planCampaign` crosses every spec with every target, so it cannot pin a target per spec.
 */
function planFor(
  runs: readonly SpecRun[],
  modes: readonly RunMode[],
  repeats: number | Partial<Record<RunMode, number>>,
  options: PlanOptions = {},
): CampaignPlan {
  const first = runs[0]?.targets ?? [];
  if (runs.every((run) => run.targets === first)) return planCampaign(runs, first, modes, repeats, options);
  const parts = runs.map((run) => planCampaign([run], run.targets, modes, repeats, options));
  const cells = parts.flatMap((part) => part.cells);
  const lines = new Map<string, CostLine>();
  for (const line of parts.flatMap((part) => part.cost.byAdapter)) {
    const held = lines.get(line.adapter);
    if (held === undefined) {
      lines.set(line.adapter, { ...line });
    } else {
      held.blocks += line.blocks;
      held.usd = held.blocks * (held.usdPerBlock ?? 0);
    }
  }
  const byAdapter = [...lines.values()];
  const usd = byAdapter.reduce((sum, line) => sum + line.usd, 0);
  const baselineRate = options.baselineRate ?? 0.5;
  return {
    cells,
    blocks: cells.reduce((sum, cell) => sum + cell.blocks, 0),
    cost: {
      usd,
      unmeasured: byAdapter
        .filter((line) => line.usdPerBlock === undefined)
        .map((line) => line.adapter)
        .sort(),
      byAdapter,
    },
    ...(options.budgetUsd === undefined
      ? {}
      : { budgetUsd: options.budgetUsd, withinBudget: usd <= options.budgetUsd }),
    mde: modes.map((mode, index): MinimumDetectableEffect => {
      const runsPerArm = parts.reduce((sum, part) => sum + (part.mde[index]?.runsPerArm ?? 0), 0);
      return mdeLine(mode, runs.length, runsPerArm, baselineRate, options.rho);
    }),
  };
}

/** A campaign's scope. Its folder is made on first use, under the system temp folder. */
function openScope(): CampaignScope & { folder(): Promise<string | undefined> } {
  let made: Promise<string> | undefined;
  return {
    tempDir() {
      made ??= mkdtemp(join(tmpdir(), 'driftbench-sandboxes-'));
      return made;
    },
    folder: async () => made?.catch(() => undefined),
  };
}

/** Ends a scope: its folder goes, with every sandbox a run left in it. A failure is printed, not thrown. */
async function closeScope(scope: ReturnType<typeof openScope>, io: Io): Promise<void> {
  const folder = await scope.folder();
  if (folder === undefined) return;
  try {
    await rm(folder, { recursive: true, force: true });
  } catch (cause) {
    io.err(
      `The campaign folder ${folder} could not be removed: ${cause instanceof Error ? cause.message : String(cause)}\n`,
    );
  }
}

/** Loads the specs; prints every invalid one and returns undefined when any is invalid or none is found. */
export async function loadValidSpecs(paths: string[], io: Io): Promise<LoadedSpec[] | undefined> {
  const results = await loadSpecs(paths.map((path) => resolve(io.cwd, path)));
  if (results.length === 0) {
    io.err('No spec files found.\n');
    return undefined;
  }
  const loaded: LoadedSpec[] = [];
  let invalid = false;
  for (const result of results) {
    if (result.ok) {
      loaded.push(result);
      continue;
    }
    invalid = true;
    const rel = relative(io.cwd, result.path);
    io.err(`✗ ${rel === '' || rel.startsWith('..') ? result.path : rel}\n`);
    for (const issue of result.errors)
      io.err(`    ${issue.path || '(file)'}  ${issue.code}  ${issue.message}\n`);
  }
  if (invalid) {
    io.err('Fix the invalid specs first: nothing ran.\n');
    return undefined;
  }
  return loaded;
}

const MARK: Record<CellOutcome['state'], string> = {
  pass: '✓',
  fail: '✗',
  failed: '!',
  stopped: '!',
  pending: '·',
};

function cellLine(outcome: CellOutcome): string {
  const { cell, run } = outcome;
  const name = [
    cell.specId,
    showTarget(cell.target),
    cell.mode,
    `repeat ${cell.repeat}`,
    ...(cell.perturbationId === undefined ? [] : [cell.perturbationId]),
  ].join(' · ');
  const notes = [
    ...(outcome.reused ? ['reused'] : []),
    ...(run?.cacheHit && !outcome.reused ? ['replayed from the cache'] : []),
  ];
  let detail = '';
  if (outcome.state === 'fail') {
    detail = `  ${outcome.failing.length > 0 ? outcome.failing.join(', ') : 'no block ran'}`;
  } else if (outcome.budgetStop) {
    const { budgetUsd, spentUsd } = outcome.budgetStop;
    detail = `  not started: the campaign spent ${usd(spentUsd)} of its ${usd(budgetUsd)} budget`;
  } else if (outcome.state === 'failed' || outcome.state === 'stopped') detail = `  ${run?.error ?? ''}`;
  else if (outcome.state === 'pass' && run) detail = `  ${count(run.blocks.length, 'block')}`;
  return `${MARK[outcome.state]} ${name}  ${outcome.state}${notes.length > 0 ? ` (${notes.join(', ')})` : ''}${detail}\n`;
}

function summaryLine(outcomes: readonly CellOutcome[]): string {
  const states = (state: CellOutcome['state']) =>
    outcomes.filter((outcome) => outcome.state === state).length;
  const reused = outcomes.filter((outcome) => outcome.reused).length;
  const budgetStops = outcomes.filter((outcome) => outcome.budgetStop).length;
  const parts = [
    `${states('pass')} pass`,
    `${states('fail')} fail`,
    `${states('failed') + states('stopped') - budgetStops} failed`,
    ...(budgetStops > 0 ? [`${budgetStops} stopped by the budget`] : []),
    ...(states('pending') > 0 ? [`${states('pending')} pending`] : []),
  ];
  const spent = outcomes
    .filter((outcome) => outcome.run && !outcome.reused && !outcome.run.cacheHit)
    .reduce((sum, outcome) => sum + (outcome.run?.cost ?? 0), 0);
  return `${count(outcomes.length, 'cell')}: ${parts.join(', ')}${reused > 0 ? `, ${reused} reused` : ''}. Spent ${usd(spent)}.`;
}

function report(campaignId: string, outcomes: readonly CellOutcome[], kept: boolean, checks: string[]) {
  return {
    campaignId,
    stored: kept,
    checks,
    cells: outcomes.map(({ cell, run, reused, state, failing, budgetStop }) => ({
      cellId: cell.cellId,
      specId: cell.specId,
      specHash: cell.specHash,
      target: cell.target,
      mode: cell.mode,
      repeat: cell.repeat,
      ...(cell.perturbationId === undefined ? {} : { perturbationId: cell.perturbationId }),
      state,
      reused,
      failing,
      ...(budgetStop ? { budgetStop } : {}),
      ...(run
        ? {
            runId: run.runId,
            cacheHit: run.cacheHit,
            cost: run.cost,
            ...(run.error ? { error: run.error } : {}),
            ...(run.endState ? { endState: run.endState } : {}),
            blocks: run.blocks.map((block) => ({
              index: block.index,
              ...(block.blockId === undefined ? {} : { blockId: block.blockId }),
              ...(block.injected ? { injected: true } : {}),
              pass: block.pass,
              ...(block.stageObserved === undefined ? {} : { stage: block.stageObserved }),
              verdicts: block.verdicts.map(({ id, outcome, gating, evidence }) => ({
                id,
                outcome,
                gating,
                evidence,
              })),
            })),
          }
        : {}),
    })),
    summary: {
      cells: outcomes.length,
      pass: outcomes.filter((outcome) => outcome.state === 'pass').length,
      fail: outcomes.filter((outcome) => outcome.state === 'fail').length,
      failed: outcomes.filter(
        (outcome) => (outcome.state === 'failed' || outcome.state === 'stopped') && !outcome.budgetStop,
      ).length,
      stoppedByBudget: outcomes.filter((outcome) => outcome.budgetStop).length,
      pending: outcomes.filter((outcome) => outcome.state === 'pending').length,
    },
  };
}

/** The tables `campaign status --detail` prints, from the runs that stand for the cells. */
export type CampaignDetail = {
  compounding: CompoundingIndex;
  succession: Array<{
    specId: string;
    target: TargetRef;
    mode: RunMode;
    repeat: number;
    perturbationId?: string;
    blocks: number;
    succession: RunResult['succession'];
    /** Blocks carrying each drift class. */
    drift: Partial<Record<DriftClass, number>>;
  }>;
  recovery: Array<{
    specId: string;
    target: TargetRef;
    repeat: number;
    perturbationId: string;
    deviation?: string;
    recovery?: RunResult['recovery'];
  }>;
};

/**
 * The detail of a campaign: the compounding index of every spec run in T and F, with the clustered
 * bootstrap interval of @agent-nexus/driftbench-stats (blocks resampled within a spec, specs across the campaign);
 * the succession metrics and drift classes of every run; the recovery of every perturbed run.
 */
export function detailOf(outcomes: readonly CellOutcome[], specs: readonly LoadedSpec[]): CampaignDetail {
  const runs = outcomes.flatMap((outcome) => (outcome.run ? [outcome.run] : []));
  const bySpec = new Map(specs.map((entry) => [`${entry.spec.id}@${entry.hash}`, entry.spec]));
  return {
    compounding: compoundingIndex(runs, {
      interval: (values, clusters) => bootstrapCI(values, { clusters }),
    }),
    succession: runs.map((run) => {
      const drift: Partial<Record<DriftClass, number>> = {};
      for (const block of run.blocks) for (const cls of block.drift) drift[cls] = (drift[cls] ?? 0) + 1;
      return {
        specId: run.specId,
        target: run.target,
        mode: run.mode,
        repeat: run.repeat,
        ...(run.perturbationId === undefined ? {} : { perturbationId: run.perturbationId }),
        blocks: run.blocks.length,
        succession: run.succession,
        drift,
      };
    }),
    recovery: runs
      .filter((run) => run.mode === 'P' && run.perturbationId !== undefined)
      .map((run) => {
        const deviation = bySpec
          .get(`${run.specId}@${run.specHash}`)
          ?.perturbations?.find((entry) => entry.id === run.perturbationId)?.class;
        return {
          specId: run.specId,
          target: run.target,
          repeat: run.repeat,
          perturbationId: run.perturbationId as string,
          ...(deviation === undefined ? {} : { deviation }),
          ...(run.recovery ? { recovery: run.recovery } : {}),
        };
      }),
  };
}

function detailText(detail: CampaignDetail): string {
  const lines: string[] = [''];
  const { compounding } = detail;
  lines.push(
    'Compounding index: the T pass rate minus the F pass rate over the blocks both modes ran. 95% interval: clustered bootstrap (blocks within a spec, specs across).',
  );
  if (compounding.specs.length === 0) {
    lines.push('  No spec ran in both T and F.');
  } else {
    const rows = compounding.specs.map((line) => [
      line.specId,
      showTarget(JSON.parse(line.target) as TargetRef),
      String(line.blocks.length),
      `${line.runsT}/${line.runsF}`,
      percent(line.passT),
      percent(line.passF),
      points(line.index),
      line.interval ? `[${points(line.interval.lower)}, ${points(line.interval.upper)}]` : '',
    ]);
    const overall = compounding.overall;
    if (overall) {
      rows.push([
        'all specs',
        '',
        String(overall.blocks),
        '',
        percent(overall.passT),
        percent(overall.passF),
        points(overall.index),
        overall.interval ? `[${points(overall.interval.lower)}, ${points(overall.interval.upper)}]` : '',
      ]);
    }
    lines.push(...table([['spec', 'target', 'blocks', 'runs T/F', 'T', 'F', 'index', 'interval'], ...rows]));
  }
  lines.push('');
  lines.push(
    'Succession, per run: the first block that fails, how many fail, their share, the longest passing stretch, and whether every block passes; then the blocks carrying each drift class.',
  );
  lines.push(
    ...table([
      [
        'spec',
        'mode',
        'repeat',
        'perturbation',
        'blocks',
        'first drift',
        'drifts',
        'rate',
        'longest clean',
        'all pass',
        'classes',
      ],
      ...detail.succession.map((row) => [
        row.specId,
        row.mode,
        String(row.repeat),
        row.perturbationId ?? '',
        String(row.blocks),
        row.succession.firstDriftBlock === undefined ? 'none' : String(row.succession.firstDriftBlock),
        String(row.succession.driftCount),
        percent(row.succession.driftRate),
        String(row.succession.longestClean),
        row.succession.minOverBlocks ? 'yes' : 'no',
        Object.entries(row.drift)
          .map(([cls, n]) => `${cls} ${n}`)
          .join(', ') || 'none',
      ]),
    ]),
  );
  lines.push('');
  lines.push(
    'Recovery, per perturbed run: the block injected, the blocks until it passed at its stage again, the label against within_blocks, blocks failing what passed in F, no forbidden or unnamed consequential act, and a question before the first consequential act.',
  );
  if (detail.recovery.length === 0) {
    lines.push('  No perturbed run.');
  } else {
    lines.push(
      ...table([
        [
          'spec',
          'perturbation',
          'class',
          'repeat',
          'injected at',
          'turns',
          'label',
          'collateral',
          'safe action',
          'clarified',
        ],
        ...detail.recovery.map((row) => {
          const rec = row.recovery;
          return [
            row.specId,
            row.perturbationId,
            row.deviation ?? '',
            String(row.repeat),
            rec ? String(rec.injectedAt) : '',
            rec?.turnsToRecover === undefined ? (rec ? 'none' : '') : String(rec.turnsToRecover),
            rec ? rec.label : 'not measured',
            rec ? String(rec.collateral) : '',
            rec?.safeAction === undefined ? '' : rec.safeAction ? 'yes' : 'no',
            rec?.clarified === undefined ? '' : rec.clarified ? 'yes' : 'no',
          ];
        }),
      ]),
    );
  }
  return `${lines.join('\n')}\n`;
}

function percent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function points(difference: number): string {
  const value = (difference * 100).toFixed(1);
  return difference > 0 ? `+${value}` : value === '-0.0' ? '0.0' : value;
}

function costLine(plan: CampaignPlan): string {
  const parts = plan.cost.byAdapter.map((line) =>
    line.usdPerBlock === undefined
      ? `${line.adapter}: no unit measured`
      : `${line.adapter}: ${count(line.blocks, 'block')} at ${usd(line.usdPerBlock)}`,
  );
  const budget =
    plan.budgetUsd === undefined
      ? ''
      : ` ${plan.withinBudget ? 'Within' : 'Over'} the budget of ${usd(plan.budgetUsd)}.`;
  return `Projected cost: ${usd(plan.cost.usd)} (${parts.join('; ')}).${budget}`;
}

function usd(value: number): string {
  return `$${value > 0 && value < 0.01 ? value.toFixed(4) : value.toFixed(2)}`;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function parseNumber(text: string, flag: string, io: Io): number | null {
  const value = optionNumber(text);
  if (!Number.isFinite(value) || value < 0) {
    io.err(`${flag} takes a number of at least 0, not "${text}".\n`);
    return null;
  }
  return value;
}

function parseRate(text: string, io: Io): number | undefined {
  const value = optionNumber(text);
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    io.err(`--baseline-rate takes a number between 0 and 1, not "${text}".\n`);
    return undefined;
  }
  return value;
}

function parseRho(text: string, io: Io): number | undefined {
  const value = optionNumber(text);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    io.err(`--rho takes a number from 0 to 1, not "${text}".\n`);
    return undefined;
  }
  return value;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`campaign: no ${what}`);
  return value;
}

/**
 * The Acme Telecom example agent behind the function adapter: a fresh Acme store for each session, so
 * payloads never leak between runs, and its payload log as the end-state source.
 */
export async function acmeFunctionAdapter(): Promise<AgentAdapter> {
  const acme = await import('../../../../examples/acme/src/index');
  type AcmeSession = {
    store: ReturnType<typeof acme.createStore>;
    agent: ReturnType<typeof acme.createAcmeAgent>;
  };
  return functionAdapter<AcmeSession>({
    create: () => {
      const store = acme.createStore();
      return { store, agent: acme.createAcmeAgent(store) };
    },
    respond: (messages, world, _vars, session) => session.agent.respond(messages, world),
    payloads: (session) => session.store.payloads,
    deterministic: true,
  });
}

/**
 * The Acme ops agent behind the process adapter: examples/acme/ops/agent.mjs, run by this Node.js in a
 * local sandbox, one temporary folder per run, with weak isolation (the agent runs as the current user).
 * The sandboxes sit in the campaign's folder when a scope is given, else in the system temp folder. The CLI
 * has no --keep-sandbox flag: a sandbox goes when its run closes, the folder when the campaign closes.
 * Undefined when this install does not hold the example.
 */
export async function acmeOpsAdapter(scope?: CampaignScope): Promise<AgentAdapter | undefined> {
  const agent = acmeOpsAgent();
  if (agent === undefined) return undefined;
  return processAdapter({
    command: process.execPath,
    args: [agent],
    provider: localProvider(scope === undefined ? {} : { dir: await scope.tempDir() }),
    // The same instruction and workspace give the same reply and the same bytes: the agent fixes its times.
    deterministic: true,
  });
}

/**
 * The path of examples/acme/ops/agent.mjs, found from the folder of the CLI package, which holds this
 * module in src/ and in dist/ alike; never from the working folder. Undefined when the file is not there.
 */
export function acmeOpsAgent(): string | undefined {
  const root = cliPackageRoot(dirname(fileURLToPath(import.meta.url)));
  if (root === undefined) return undefined;
  const agent = join(root, '..', '..', 'examples', 'acme', 'ops', 'agent.mjs');
  return existsSync(agent) ? agent : undefined;
}

/** The nearest folder at or above `from` whose package.json names the driftbench CLI. */
function cliPackageRoot(from: string): string | undefined {
  for (let dir = from; ; dir = dirname(dir)) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest) && packageName(manifest) === '@agent-nexus/driftbench') return dir;
    if (dirname(dir) === dir) return undefined;
  }
}

function packageName(manifest: string): unknown {
  try {
    return (JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown }).name;
  } catch {
    // A package.json that does not parse belongs to no package this lookup wants.
    return undefined;
  }
}

/**
 * The deps a run uses for `--driver`: unchanged for scripted; for simulated, each spec a persona plays runs
 * with a fresh simulated user of that persona (under the perturbing driver in mode P). Every spec of the
 * campaign needs a persona, and every target a family other than the user's. Undefined, printed, on bad input.
 */
async function driverDeps(
  options: RunCommandOptions,
  runs: readonly SpecRun[],
  deps: CampaignDeps,
  io: Io,
): Promise<{ deps: CampaignDeps; note?: string } | undefined> {
  const kind = options.driver ?? 'scripted';
  if (kind !== 'scripted' && kind !== 'simulated') {
    io.err(`--driver takes scripted or simulated, not "${kind}".\n`);
    return undefined;
  }
  if (kind === 'scripted') {
    if ((options.persona ?? []).length > 0 || (options.recording ?? []).length > 0 || options.model) {
      io.err('--persona, --recording and --model go with --driver simulated.\n');
      return undefined;
    }
    return { deps };
  }
  if ((options.persona ?? []).length === 0) {
    io.err('--driver simulated needs a --persona for each spec.\n');
    return undefined;
  }
  const source = await userSource(options, () => (deps.modelPort ?? portFromEnv)(), io);
  if (!source) return undefined;
  const personas = await loadPersonas(options.persona ?? [], io);
  if (!personas) return undefined;
  const makers = new Map<string, () => UserDriver>();
  const lines: string[] = [];
  for (const run of runs) {
    const played = personas.find((entry) => entry.specId === run.spec.id);
    if (!played) {
      io.err(`No persona plays ${run.spec.id}: give a --persona whose spec is that file.\n`);
      return undefined;
    }
    const port = portFor(source, played.persona);
    if (typeof port === 'string') {
      io.err(`${port}\n`);
      return undefined;
    }
    for (const target of run.targets) {
      const family = agentFamilyOf(target, options.agentFamily);
      if (family === undefined) {
        io.err(
          `Name the model family of ${showTarget(target)} with --agent-family (none for an agent that is not a model).\n`,
        );
        return undefined;
      }
      const make = userFactory(played.persona, port, family, options.judgeFamily ?? []);
      if (typeof make === 'string') {
        io.err(`${make}\n`);
        return undefined;
      }
      makers.set(run.spec.id, make);
    }
    lines.push(`persona ${played.persona.id} on ${run.spec.id}, ${describeSource(source, played.persona)}`);
  }
  return {
    deps: {
      ...deps,
      driver: (cell, spec) => {
        const make = spec === undefined ? undefined : makers.get(spec.id);
        if (!make || !spec) return deps.driver(cell, spec);
        const user = make();
        return cell?.perturbationId === undefined
          ? user
          : createPerturbingDriver({ spec, perturbation: cell.perturbationId, base: user });
      },
    },
    note: `Driver: simulated, ${lines.join('; ')}.\n`,
  };
}
