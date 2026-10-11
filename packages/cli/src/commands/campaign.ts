import { relative, resolve } from 'node:path';
import {
  type AgentAdapter,
  AgentFailure,
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
 * INTERIM until the adapters and checks lanes merge: `function:acme` is the only target (the Acme agent
 * behind a minimal function adapter) and no machine check is loaded (the runner still compares the end
 * state). The store is @driftbench/store: a SQLite file with `--store`, in memory without it.
 */
export const interimDeps: CampaignDeps = {
  adapterFor: async (target) =>
    target.adapter === 'function' && target.agent === 'acme' ? interimAcmeAdapter() : undefined,
  checks: [],
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
  json?: boolean;
};

type StoredCommandOptions = { store: string; cache?: boolean; json?: boolean };

export function registerCampaignCommands(
  program: Command,
  io: Io,
  setExit: (code: number) => void,
  deps: CampaignDeps = interimDeps,
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
    .option('--json', 'print one JSON document')
    .action(async (paths: string[], options: RunCommandOptions) => {
      setExit(await campaignRunCommand(paths, options, io, deps));
    });

  campaign
    .command('resume')
    .description('Run the cells of a stored campaign that have no completed run; reuse the others.')
    .argument('<campaignId>', 'the campaign id')
    .requiredOption('--store <file>', 'the store that holds the campaign')
    .option('--no-cache', 'neither replay runs from the cache nor write to it')
    .option('--json', 'print one JSON document')
    .action(async (campaignId: string, options: StoredCommandOptions) => {
      setExit(await campaignResumeCommand(campaignId, options, io, deps));
    });

  campaign
    .command('status')
    .description('Print the state of every cell of a stored campaign. Exit 0 when every cell passes.')
    .argument('<campaignId>', 'the campaign id')
    .requiredOption('--store <file>', 'the store that holds the campaign')
    .option('--json', 'print one JSON document')
    .action(async (campaignId: string, options: StoredCommandOptions) => {
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
  if (!shape) return 2;
  const loaded = await loadValidSpecs(paths, io);
  if (!loaded) return 2;
  const adapters = await adaptersFor(shape.targets, deps, io);
  if (!adapters) return 2;

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
      budgetUsd: 0,
      judge: { mode: 'system1', judges: [] },
      createdAt,
    };
    await store.putCampaign(campaign);
    return await executeCampaign(campaign, loaded, adapters, store, deps, io, {
      cache: options.cache,
      json: options.json === true,
      kept: options.store !== undefined,
    });
  } finally {
    await store.close();
  }
}

/** `campaign resume`: runs the cells with no completed run, reuses the others. Exits like `campaign run`. */
export async function campaignResumeCommand(
  campaignId: string,
  options: StoredCommandOptions,
  io: Io,
  deps: CampaignDeps,
): Promise<number> {
  const store = await openReported(deps, resolve(io.cwd, options.store), io);
  if (!store) return 2;
  try {
    const stored = await storedCampaign(store, campaignId, options.store, io);
    if (!stored) return 2;
    const adapters = await adaptersFor(stored.campaign.targets, deps, io);
    if (!adapters) return 2;
    return await executeCampaign(stored.campaign, stored.specs, adapters, store, deps, io, {
      cache: options.cache !== false,
      json: options.json === true,
      kept: true,
    });
  } finally {
    await store.close();
  }
}

/** `campaign status`: the state of every cell. Exit 0 when every cell passes, 1 otherwise, 2 on bad input. */
export async function campaignStatusCommand(
  campaignId: string,
  options: StoredCommandOptions,
  io: Io,
  deps: CampaignDeps,
): Promise<number> {
  const store = await openReported(deps, resolve(io.cwd, options.store), io);
  if (!store) return 2;
  try {
    const stored = await storedCampaign(store, campaignId, options.store, io);
    if (!stored) return 2;
    const plan = planOf(stored.campaign, stored.specs);
    const byCell = await runsByCell(store, campaignId);
    const outcomes = plan.cells.map((cell) => outcomeOf(cell, byCell.get(cell.cellId)));
    if (options.json) {
      io.out(`${JSON.stringify(report(campaignId, outcomes, true, []), null, 2)}\n`);
    } else {
      io.out(`Campaign ${campaignId}, created ${stored.campaign.createdAt}.\n`);
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
  flags: { cache: boolean; json: boolean; kept: boolean },
): Promise<number> {
  const plan = planOf(campaign, loaded);
  const specs = new Map(loaded.map((entry) => [`${entry.spec.id}@${entry.hash}`, entry.spec]));
  const checks = deps.checks.map((check) => check.name);
  if (!flags.json) {
    io.out(
      `Campaign ${campaign.campaignId}: ${count(plan.cells.length, 'cell')}. Checks: ${checks.length > 0 ? checks.join(', ') : 'none loaded'}.\n`,
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

async function storedCampaign(
  store: Store,
  campaignId: string,
  path: string,
  io: Io,
): Promise<{ campaign: Campaign; specs: LoadedSpec[] } | undefined> {
  const campaign = await store.getCampaign(campaignId);
  if (!campaign) {
    io.err(`No campaign ${campaignId} in ${path}.\n`);
    return undefined;
  }
  const specs: LoadedSpec[] = [];
  for (const pinned of campaign.specs) {
    const spec = await store.getSpec(pinned.id, pinned.hash);
    if (!spec) {
      io.err(
        `The store has no spec ${pinned.id} at hash ${pinned.hash}, which campaign ${campaignId} pins.\n`,
      );
      return undefined;
    }
    specs.push(spec);
  }
  return { campaign, specs };
}

type Shape = { targets: TargetRef[]; mode: RunMode; repeats: number };

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
        `No adapter in this build reaches ${showTarget(target)}. The interim build reaches function:acme.\n`,
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
  } else if (outcome.state === 'failed' || outcome.state === 'stopped') detail = `  ${run?.error ?? ''}`;
  else if (outcome.state === 'pass' && run) detail = `  ${count(run.blocks.length, 'block')}`;
  return `${MARK[outcome.state]} ${name}  ${outcome.state}${notes.length > 0 ? ` (${notes.join(', ')})` : ''}${detail}\n`;
}

function summaryLine(outcomes: readonly CellOutcome[]): string {
  const states = (state: CellOutcome['state']) =>
    outcomes.filter((outcome) => outcome.state === state).length;
  const reused = outcomes.filter((outcome) => outcome.reused).length;
  const parts = [
    `${states('pass')} pass`,
    `${states('fail')} fail`,
    `${states('failed') + states('stopped')} failed`,
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
    cells: outcomes.map(({ cell, run, reused, state, failing }) => ({
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
      failed: outcomes.filter((outcome) => outcome.state === 'failed' || outcome.state === 'stopped').length,
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
 * INTERIM until the adapters lane merges: the Acme Telecom agent behind a minimal function adapter. Each
 * session gets its own Acme store, so payloads never leak between runs. `send` hands the agent the session
 * history, which ends with the block's user messages, and the block's resolved world; `endState` reads
 * `tool:<label>` as the last payload that tool accepted, and `*` as every payload, in order.
 */
export async function interimAcmeAdapter(): Promise<AgentAdapter> {
  const acme = await import('../../../../examples/acme/src/index');
  type AcmeSession = {
    store: ReturnType<typeof acme.createStore>;
    agent: ReturnType<typeof acme.createAcmeAgent>;
  };
  const stateOf = (state: unknown) => state as AcmeSession;
  let opened = 0;
  return {
    id: 'function',
    version: 'interim-acme-1',
    capabilities: () => ({
      variants: false,
      seedPrefix: true,
      toolStubs: true,
      trace: false,
      sandbox: false,
      endState: true,
      deterministic: true,
    }),
    async open(given) {
      opened += 1;
      const store = acme.createStore();
      const state: AcmeSession = { store, agent: acme.createAcmeAgent(store) };
      return {
        id: `acme-${opened}`,
        adapter: 'function',
        target: given.target,
        given,
        history: structuredClone(given.prefix),
        state,
      };
    },
    async send(session, turn) {
      try {
        return await stateOf(session.state).agent.respond(
          structuredClone(session.history),
          structuredClone(turn.given.world),
        );
      } catch (cause) {
        throw new AgentFailure(cause instanceof Error ? cause.message : String(cause), { cause });
      }
    },
    async endState(session, source) {
      const { payloads } = stateOf(session.state).store;
      if (source === '*') return payloads.map(({ tool, input }) => ({ tool, input }));
      const label = /^tool:(.+)$/.exec(source)?.[1];
      if (label === undefined) {
        throw new AgentFailure(`the Acme adapter reads tool:<label> and * sources, not ${source}`);
      }
      return payloads.filter((payload) => payload.tool === label).at(-1)?.input;
    },
    async close() {},
  };
}
