import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { functionAdapter, processAdapter } from '@driftbench/adapters';
import { defaultReaders } from '@driftbench/artifacts';
import { classifyTool, defaultChecks } from '@driftbench/checks';
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
  minimumDetectableEffect,
  outcomeOf,
  type PlannedCell,
  type PlanOptions,
  planCampaign,
  type RetryOptions,
  RunMode,
  type RunResult,
  runCampaign,
  runsByCell,
  type Spec,
  type Store,
  TargetRef,
  type UserDriver,
} from '@driftbench/core';
import { localProvider } from '@driftbench/sandbox';
import { bootstrapCI } from '@driftbench/stats';
import { openMemoryStore, openStore } from '@driftbench/store';
import { createPerturbingDriver, createScriptedDriver } from '@driftbench/users';
import type { Command } from 'commander';
import type { Io } from '../io';

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
  /** The store at a path, or one held in memory without a path. A failure to open is reported, exit 2. */
  openStore(path: string | undefined): Promise<Store>;
  now(): Date;
};

const MODE_HELP =
  'the run mode: T teacher-forced, F free-running, P perturbed; several separated by commas, such as T,F';

const TARGET_HELP =
  'run every spec on this target; repeat for several. Without it, each spec runs on its own target';

/** The targets this build reaches, for the message of a target it does not. */
const KNOWN_TARGETS =
  'The CLI reaches function:acme-sales (or function:acme), the Acme sales assistant, and process:acme-ops, the Acme ops agent.';

/**
 * What the commands run with. `function:acme-sales`, the target the Acme conversation specs name, and its
 * short form `function:acme` are the Acme sales assistant behind the function adapter of
 * @driftbench/adapters. `process:acme-ops`, the target of the Acme task spec, is the Acme ops agent behind
 * the process adapter. The checks are `defaultChecks()` of @driftbench/checks with the readers of
 * @driftbench/artifacts, and the store is @driftbench/store, a SQLite file with `--store` and in memory
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
  mode: string;
  repeats: string;
  budgetUsd?: string;
  baselineRate: string;
  store?: string;
  json?: boolean;
};

type RunCommandOptions = {
  target: string[];
  mode: string;
  repeats: string;
  campaign?: string;
  store?: string;
  cache: boolean;
  concurrency: string;
  budgetUsd?: string;
  json?: boolean;
} & RetryFlags;

/** The retry flags of `campaign run` and `campaign resume`: the run's settings over the spec target's. */
type RetryFlags = { retryAttempts?: string; retryBaseMs?: string; retryMaxMs?: string };

type StoredCommandOptions = RetryFlags & {
  store: string;
  cache?: boolean;
  concurrency?: string;
  budgetUsd?: string;
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
    .option('--mode <modes>', MODE_HELP, 'F')
    .option('--repeats <n>', 'runs per spec, target and mode', '1')
    .option('--budget-usd <usd>', 'compare the projected cost with this budget')
    .option('--baseline-rate <rate>', 'the pass rate the minimum detectable effect assumes', '0.5')
    .option('--store <file>', 'read the measured unit costs from this store')
    .option('--json', 'print one JSON document')
    .action(async (paths: string[], options: PlanCommandOptions) => {
      setExit(await campaignPlanCommand(paths, options, io, deps));
    });

  campaign
    .command('run')
    .description('Run every cell and print pass or fail per cell. Exit 1 on any failed or failing cell.')
    .argument('<paths...>', 'spec files or folders')
    .option('--target <adapter[:agent]>', TARGET_HELP, collect, [])
    .option('--mode <modes>', MODE_HELP, 'F')
    .option('--repeats <n>', 'runs per spec, target and mode', '1')
    .option('--campaign <id>', 'the campaign id; one is made from the content and the clock without it')
    .option('--store <file>', 'keep the campaign, its runs and the cache in this store')
    .option('--no-cache', 'neither replay runs from the cache nor write to it')
    .option('--concurrency <n>', 'cells run at the same time', '4')
    .option('--budget-usd <usd>', 'a hard stop: no cell starts once the campaign has spent this much')
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
  if (!shape || budget === null || baselineRate === undefined) return 2;
  const loaded = await loadValidSpecs(paths, io);
  if (!loaded) return 2;
  const runs = specRuns(loaded, shape.targets, io);
  if (!runs) return 2;
  if (!options.json) io.out(targetNotes(loaded, shape.targets));

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
    const effect = line.effect === undefined ? 'no runs' : `${(line.effect * 100).toFixed(1)} points`;
    io.out(
      `Minimum detectable effect, mode ${line.mode}: ${effect} on a ${(line.baselineRate * 100).toFixed(0)}% pass rate, with ${count(line.runsPerArm, 'run')} per arm (two-sided alpha ${line.alpha}, power ${line.power}).\n`,
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
  if (!shape || !pool) return 2;
  const loaded = await loadValidSpecs(paths, io);
  if (!loaded) return 2;
  const runs = specRuns(loaded, shape.targets, io);
  if (!runs) return 2;
  const scope = openScope();
  try {
    const adapters = await adaptersFor(runs, deps, scope, io);
    if (!adapters) return 2;
    if (!options.json) io.out(targetNotes(loaded, shape.targets));

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
      const targets = shape.targets.length > 0 ? shape.targets : pinnedTargets(runs);
      const repeats = { T: 0, F: 0, P: 0 };
      for (const mode of shape.modes) repeats[mode] = shape.repeats;
      // One mode keeps the key a single-mode campaign always had, so its id is unchanged.
      const mode = shape.modes.length === 1 ? shape.modes[0] : shape.modes;
      const campaignId = options.campaign ?? `c-${contentHash({ specs, targets, mode, repeats, createdAt })}`;
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
        targets,
        modes: shape.modes,
        repeats,
        // 0 when no budget was given: the schema has no field for "no budget".
        budgetUsd: pool.budgetUsd ?? 0,
        judge: { mode: 'system1', judges: [] },
        createdAt,
      };
      await store.putCampaign(campaign);
      return await executeCampaign(campaign, loaded, adapters, store, deps, io, {
        cache: options.cache,
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

/** `campaign resume`: runs the cells with no completed run, reuses the others. Exits like `campaign run`. */
export async function campaignResumeCommand(
  campaignId: string | undefined,
  options: StoredCommandOptions,
  io: Io,
  deps: CampaignDeps,
): Promise<number> {
  const pool = parsePool({ ...options, concurrency: options.concurrency ?? '4' }, io);
  if (!pool) return 2;
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
  }
  const outcomes = await runCampaign({
    campaignId: campaign.campaignId,
    cells: plan.cells,
    specFor: (cell) => required(specs.get(`${cell.specId}@${cell.specHash}`), `spec ${cell.specId}`),
    adapterFor: (target) => required(adapters.get(showTarget(target)), `adapter ${showTarget(target)}`),
    driver: (cell, spec) => deps.driver(cell, spec),
    ...(deps.consequential ? { consequential: deps.consequential } : {}),
    checks: deps.checks,
    ...(deps.artifacts ? { artifacts: deps.artifacts } : {}),
    store,
    // The runner neither replays nor caches a run in a sandbox: a replay has no workspace to read.
    ...(flags.cache ? { cache: store } : {}),
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

type Shape = { targets: TargetRef[]; modes: RunMode[]; repeats: number };

type Pool = { concurrency: number; budgetUsd?: number; retry?: RetryOptions };

function parsePool(
  options: { concurrency: string; budgetUsd?: string | undefined } & RetryFlags,
  io: Io,
): Pool | undefined {
  const concurrency = Number(options.concurrency);
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
    const value = Number(text);
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
function parseShape(options: { target: string[]; mode: string; repeats: string }, io: Io): Shape | undefined {
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
  const repeats = Number(options.repeats);
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
  return { targets, modes, repeats };
}

/** One line per spec whose own target names another adapter than a `--target`, which overrides it. */
function targetNotes(loaded: readonly LoadedSpec[], targets: readonly TargetRef[]): string {
  const notes: string[] = [];
  for (const { spec } of loaded) {
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
): SpecRun[] | undefined {
  if (targets.length > 0) return loaded.map(({ spec, hash }) => ({ spec, hash, targets }));
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
      const effect = minimumDetectableEffect(runsPerArm, baselineRate);
      return {
        mode,
        runsPerArm,
        baselineRate,
        alpha: 0.05,
        power: 0.8,
        ...(effect === undefined ? {} : { effect }),
      };
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
 * bootstrap interval of @driftbench/stats (blocks resampled within a spec, specs across the campaign);
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
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) {
    io.err(`${flag} takes a number of at least 0, not "${text}".\n`);
    return null;
  }
  return value;
}

function parseRate(text: string, io: Io): number | undefined {
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    io.err(`--baseline-rate takes a number between 0 and 1, not "${text}".\n`);
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

/** Pads every column but the last to its widest cell, two spaces apart, indented by two. */
function table(rows: string[][]): string[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, cell.length);
    });
  }
  return rows.map((row) =>
    `  ${row.map((cell, index) => (index === row.length - 1 ? cell : cell.padEnd(widths[index] ?? 0))).join('  ')}`.trimEnd(),
  );
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
    if (existsSync(manifest) && packageName(manifest) === 'driftbench') return dir;
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
