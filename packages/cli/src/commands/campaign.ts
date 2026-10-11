import { relative, resolve } from 'node:path';
import { functionAdapter } from '@driftbench/adapters';
import { defaultChecks } from '@driftbench/checks';
import {
  type AgentAdapter,
  type Campaign,
  type CheckSet,
  type CostUnit,
  contentHash,
  type LoadedSpec,
  loadSpecs,
  RunMode,
  type Spec,
  type Store,
  TargetRef,
  type UserDriver,
} from '@driftbench/core';
import { openMemoryStore, openStore } from '@driftbench/store';
import { createScriptedDriver } from '@driftbench/users';
import type { Command } from 'commander';
// root: becomes '@driftbench/core' at merge
import {
  type CampaignPlan,
  type CellOutcome,
  outcomeOf,
  planCampaign,
  runCampaign,
  runsByCell,
} from '../../../core/src/runner/index';
import type { Io } from '../io';

/** What the campaign and smoke commands run with. Tests pass their own. */
export type CampaignDeps = {
  /** The adapter for a target, or undefined when this build has none for it. */
  adapterFor(target: TargetRef): Promise<AgentAdapter | undefined>;
  /** The machine checks applied to every block. */
  checks: CheckSet;
  /** A fresh driver for one run. */
  driver(): UserDriver;
  /** The store at a path, or one held in memory without a path. A failure to open is reported, exit 2. */
  openStore(path: string | undefined): Promise<Store>;
  now(): Date;
};

/**
 * What the commands run with: `function:acme` is the Acme example agent behind the function adapter of
 * @driftbench/adapters, the checks are `defaultChecks()` of @driftbench/checks, and the store is
 * @driftbench/store, a SQLite file with `--store` and in memory without it.
 */
export const defaultDeps: CampaignDeps = {
  adapterFor: async (target) =>
    target.adapter === 'function' && target.agent === 'acme' ? acmeFunctionAdapter() : undefined,
  checks: defaultChecks(),
  driver: createScriptedDriver,
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
};

type StoredCommandOptions = {
  store: string;
  cache?: boolean;
  concurrency?: string;
  budgetUsd?: string;
  json?: boolean;
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
    .option('--target <adapter[:agent]>', 'a target to run on; repeat for several', collect, [])
    .option('--mode <mode>', 'the run mode; F today, T and P are planned, phase 3', 'F')
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
    .option('--target <adapter[:agent]>', 'a target to run on; repeat for several', collect, [])
    .option('--mode <mode>', 'the run mode; F today, T and P are planned, phase 3', 'F')
    .option('--repeats <n>', 'runs per spec, target and mode', '1')
    .option('--campaign <id>', 'the campaign id; one is made from the content and the clock without it')
    .option('--store <file>', 'keep the campaign, its runs and the cache in this store')
    .option('--no-cache', 'neither replay runs from the cache nor write to it')
    .option('--concurrency <n>', 'cells run at the same time', '4')
    .option('--budget-usd <usd>', 'a hard stop: no cell starts once the campaign has spent this much')
    .option('--json', 'print one JSON document')
    .action(async (paths: string[], options: RunCommandOptions) => {
      setExit(await campaignRunCommand(paths, options, io, deps));
    });

  campaign
    .command('resume')
    .description('Run the cells of a stored campaign that have no completed run; reuse the others.')
    .argument('[campaignId]', 'the campaign id; the latest campaign when the store can list them')
    .requiredOption('--store <file>', 'the store that holds the campaign')
    .option('--no-cache', 'neither replay runs from the cache nor write to it')
    .option('--concurrency <n>', 'cells run at the same time', '4')
    .option('--budget-usd <usd>', "a hard stop on the campaign's spend; default: the budget it was run with")
    .option('--json', 'print one JSON document')
    .action(async (campaignId: string | undefined, options: StoredCommandOptions) => {
      setExit(await campaignResumeCommand(campaignId, options, io, deps));
    });

  campaign
    .command('status')
    .description('Print the state of every cell of a stored campaign. Exit 0 when every cell passes.')
    .argument('[campaignId]', 'the campaign id; the latest campaign when the store can list them')
    .requiredOption('--store <file>', 'the store that holds the campaign')
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
  const plan = planCampaign(loaded, shape.targets, [shape.mode], shape.repeats, {
    units,
    baselineRate,
    ...(budget === undefined ? {} : { budgetUsd: budget }),
  });

  if (options.json) {
    io.out(`${JSON.stringify(plan, null, 2)}\n`);
    return 0;
  }
  io.out(
    `Plan: ${count(loaded.length, 'spec')}, ${count(shape.targets.length, 'target')}, mode ${shape.mode}, ${count(shape.repeats, 'repeat')}: ${count(plan.cells.length, 'cell')}, ${count(plan.blocks, 'block')}.\n`,
  );
  io.out(
    `${table([
      ['cell', 'spec', 'target', 'mode', 'repeat', 'blocks'],
      ...plan.cells.map((cell) => [
        cell.cellId,
        cell.specId,
        showTarget(cell.target),
        cell.mode,
        String(cell.repeat),
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
  const adapters = await adaptersFor(shape.targets, deps, io);
  if (!adapters) return 2;
  if (!options.json) io.out(targetNotes(loaded, shape.targets));

  const store = await openReported(deps, options.store ? resolve(io.cwd, options.store) : undefined, io);
  if (!store) return 2;
  try {
    const createdAt = deps.now().toISOString();
    const specs = loaded.map((entry) => ({ id: entry.spec.id, hash: entry.hash }));
    const repeats = { T: 0, F: 0, P: 0, [shape.mode]: shape.repeats };
    const campaignId =
      options.campaign ??
      `c-${contentHash({ specs, targets: shape.targets, mode: shape.mode, repeats, createdAt })}`;
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
      targets: shape.targets,
      modes: [shape.mode],
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
}

/** `campaign resume`: runs the cells with no completed run, reuses the others. Exits like `campaign run`. */
export async function campaignResumeCommand(
  campaignId: string | undefined,
  options: StoredCommandOptions,
  io: Io,
  deps: CampaignDeps,
): Promise<number> {
  const pool = parsePool({ concurrency: options.concurrency ?? '4', budgetUsd: options.budgetUsd }, io);
  if (!pool) return 2;
  const store = await openReported(deps, resolve(io.cwd, options.store), io);
  if (!store) return 2;
  try {
    const stored = await storedCampaign(store, campaignId, options.store, io, 'resume');
    if (!stored) return 2;
    const adapters = await adaptersFor(stored.campaign.targets, deps, io);
    if (!adapters) return 2;
    const budgetUsd =
      pool.budgetUsd ?? (stored.campaign.budgetUsd > 0 ? stored.campaign.budgetUsd : undefined);
    return await executeCampaign(stored.campaign, stored.specs, adapters, store, deps, io, {
      cache: options.cache !== false,
      json: options.json === true,
      kept: true,
      concurrency: pool.concurrency,
      ...(budgetUsd === undefined ? {} : { budgetUsd }),
    });
  } finally {
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
    const stored = await storedCampaign(store, campaignId, options.store, io, 'status');
    if (!stored) return 2;
    const { campaign } = stored;
    const plan = planOf(campaign, stored.specs);
    const byCell = await runsByCell(store, campaign.campaignId);
    const outcomes = plan.cells.map((cell) => outcomeOf(cell, byCell.get(cell.cellId)));
    if (options.json) {
      io.out(`${JSON.stringify(report(campaign.campaignId, outcomes, true, []), null, 2)}\n`);
    } else {
      io.out(`Campaign ${campaign.campaignId}, created ${campaign.createdAt}.\n`);
      for (const outcome of outcomes) io.out(cellLine(outcome));
      io.out(`${summaryLine(outcomes)}\n`);
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
  flags: { cache: boolean; json: boolean; kept: boolean; concurrency: number; budgetUsd?: number },
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
    driver: () => deps.driver(),
    checks: deps.checks,
    store,
    ...(flags.cache ? { cache: store } : {}),
    now: () => deps.now(),
    concurrency: flags.concurrency,
    ...(flags.budgetUsd === undefined ? {} : { budgetUsd: flags.budgetUsd }),
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
  return planCampaign(loaded, campaign.targets, campaign.modes, campaign.repeats);
}

/** A store that can list its campaigns. The Store contract has no such call yet; one is proposed for it. */
type CampaignListing = { listCampaigns(): Promise<Campaign[]> };

async function storedCampaign(
  store: Store,
  campaignId: string | undefined,
  path: string,
  io: Io,
  command: 'status' | 'resume',
): Promise<{ campaign: Campaign; specs: LoadedSpec[] } | undefined> {
  let campaign: Campaign | undefined;
  if (campaignId === undefined) {
    const list = (store as Partial<CampaignListing>).listCampaigns;
    if (typeof list !== 'function') {
      io.err(
        `Name the campaign: driftbench campaign ${command} <campaignId> --store ${path}. campaign run prints the id; this store cannot list its campaigns.\n`,
      );
      return undefined;
    }
    for (const each of await list.call(store)) {
      if (!campaign || each.createdAt > campaign.createdAt) campaign = each;
    }
    if (!campaign) {
      io.err(`The store at ${path} holds no campaign.\n`);
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

type Shape = { targets: TargetRef[]; mode: RunMode; repeats: number };

type Pool = { concurrency: number; budgetUsd?: number };

function parsePool(
  options: { concurrency: string; budgetUsd?: string | undefined },
  io: Io,
): Pool | undefined {
  const concurrency = Number(options.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    io.err(`--concurrency takes a whole number of at least 1, not "${options.concurrency}".\n`);
    return undefined;
  }
  if (options.budgetUsd === undefined) return { concurrency };
  const budgetUsd = parseNumber(options.budgetUsd, '--budget-usd', io);
  return budgetUsd === null ? undefined : { concurrency, budgetUsd };
}

function parseShape(options: { target: string[]; mode: string; repeats: string }, io: Io): Shape | undefined {
  if (options.target.length === 0) {
    io.err('Name at least one target with --target <adapter[:agent]>, such as --target function:acme.\n');
    return undefined;
  }
  const mode = RunMode.safeParse(options.mode);
  if (!mode.success) {
    io.err(`Unknown mode "${options.mode}". The modes are F, T and P.\n`);
    return undefined;
  }
  if (mode.data !== 'F') {
    io.err(`Mode ${mode.data} is planned, phase 3. Campaigns run in mode F today.\n`);
    return undefined;
  }
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
  return { targets, mode: mode.data, repeats };
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

async function adaptersFor(
  targets: readonly TargetRef[],
  deps: CampaignDeps,
  io: Io,
): Promise<Map<string, AgentAdapter> | undefined> {
  const adapters = new Map<string, AgentAdapter>();
  for (const target of targets) {
    const adapter = await deps.adapterFor(target);
    if (!adapter) {
      io.err(
        `No adapter is set up for ${showTarget(target)}. The CLI reaches function:acme, the Acme example agent.\n`,
      );
      return undefined;
    }
    adapters.set(showTarget(target), adapter);
  }
  return adapters;
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
