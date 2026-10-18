import {
  type AgentAdapter,
  type ArtifactReaderRegistry,
  blockStatus,
  blocksOutcome,
  type Campaign,
  type CellOutcome,
  type CheckSet,
  type CostUnit,
  contentHash,
  isScored,
  planCampaign,
  type RunResult,
  runCampaign,
  type Store,
  type TargetRef,
  type UserDriver,
} from '@agent-nexus/driftbench-core';
import { pilotControlCheck } from './control';
import { designVariants, type PilotDesign, type PilotFactors, pilotFactors } from './design';

/** The projected size and cost of one cell of the pilot, or of the whole pilot. */
export type PilotPlanLine = {
  cell: string;
  conversations: number;
  /** Wordings summed over the cell's conversations: the variants that run. */
  wordings: number;
  repeats: number;
  runs: number;
  blocks: number;
  /** Undefined when no unit is measured for the target's adapter and it is not in process. */
  usd?: number;
};

export type PilotPlan = {
  target: TargetRef;
  /** How the cost was priced: a measured unit, in process (free), or not measured. */
  pricing:
    | { kind: 'measured'; usdPerBlock: number; measuredAt: string }
    | { kind: 'in-process' }
    | { kind: 'unmeasured' };
  cells: PilotPlanLine[];
  total: PilotPlanLine;
};

/** Adapters that run the agent inside this process: no model call, nothing billed. */
const IN_PROCESS = new Set(['function']);

/**
 * The run count and projected cost per cell. A cell's cost is its blocks times the latest measured
 * `block` unit of the target's adapter; an in-process adapter with no unit costs 0; any other adapter
 * with no unit has no projection, and the plan says so instead of printing 0.
 */
export function planPilot(
  design: PilotDesign,
  target: TargetRef,
  units: readonly CostUnit[] = [],
): PilotPlan {
  const unit = latestBlockUnit(units, target.adapter);
  const pricing: PilotPlan['pricing'] = unit
    ? { kind: 'measured', usdPerBlock: unit.usd, measuredAt: unit.measuredAt }
    : IN_PROCESS.has(target.adapter)
      ? { kind: 'in-process' }
      : { kind: 'unmeasured' };
  const price = (blocks: number): number | undefined =>
    pricing.kind === 'measured'
      ? blocks * pricing.usdPerBlock
      : pricing.kind === 'in-process'
        ? 0
        : undefined;
  const repeats = design.options.repeats;
  const cells = design.cells.map((cell): PilotPlanLine => {
    const variants = cell.conversations.flatMap((conversation) =>
      conversation.variants.map(() => conversation.blocks),
    );
    const blocks = variants.reduce((sum, count) => sum + count, 0) * repeats;
    const usd = price(blocks);
    return {
      cell: cell.cell,
      conversations: cell.conversations.length,
      wordings: variants.length,
      repeats,
      runs: variants.length * repeats,
      blocks,
      ...(usd === undefined ? {} : { usd }),
    };
  });
  const sum = (key: 'conversations' | 'wordings' | 'runs' | 'blocks') =>
    cells.reduce((total, line) => total + line[key], 0);
  const usd = price(sum('blocks'));
  return {
    target,
    pricing,
    cells,
    total: {
      cell: 'total',
      conversations: sum('conversations'),
      wordings: sum('wordings'),
      repeats,
      runs: sum('runs'),
      blocks: sum('blocks'),
      ...(usd === undefined ? {} : { usd }),
    },
  };
}

function latestBlockUnit(units: readonly CostUnit[], adapter: string): CostUnit | undefined {
  let latest: CostUnit | undefined;
  for (const unit of units) {
    if (unit.adapter !== adapter || unit.metric !== 'block') continue;
    if (!latest || later(unit.measuredAt, latest.measuredAt)) latest = unit;
  }
  return latest;
}

function later(a: string, b: string): boolean {
  const left = Date.parse(a);
  const right = Date.parse(b);
  return Number.isNaN(left) || Number.isNaN(right) ? a > b : left > right;
}

export type PilotRunOptions = {
  design: PilotDesign;
  target: TargetRef;
  adapter: AgentAdapter;
  store: Store;
  checks: CheckSet;
  driver(): UserDriver;
  artifacts?: ArtifactReaderRegistry;
  now?: () => Date;
  concurrency?: number;
  campaignId?: string;
  onCell?(outcome: CellOutcome): void;
};

/**
 * Runs the design through the real runner, as one campaign: every variant spec is stored, the campaign
 * pins each to the target, and `runCampaign` runs each variant `repeats` times in mode F with the cache
 * off (a replayed repeat would measure nothing). Each run is filed in the store as it finishes.
 */
export async function runPilot(
  options: PilotRunOptions,
): Promise<{ campaign: Campaign; outcomes: CellOutcome[] }> {
  const { design, target, store } = options;
  const now = options.now ?? (() => new Date());
  const variants = designVariants(design);
  if (variants.length === 0) throw new Error('runPilot: the design has no conversation to run');
  const createdAt = now().toISOString();
  const specs = variants.map((entry) => ({ id: entry.spec.id, hash: entry.hash, target }));
  const repeats = design.options.repeats;
  const campaignId =
    options.campaignId ?? `pilot-${contentHash({ map: design.map.hash, specs, target, repeats, createdAt })}`;
  if (await store.getCampaign(campaignId)) throw new Error(`runPilot: campaign ${campaignId} already exists`);
  for (const entry of variants) await store.putSpec(entry);
  const campaign: Campaign = {
    campaignId,
    specs,
    targets: [target],
    modes: ['F'],
    repeats: { T: 0, F: repeats, P: 0 },
    budgetUsd: 0,
    judge: { mode: 'system1', judges: [] },
    createdAt,
  };
  await store.putCampaign(campaign);
  const plan = planCampaign(variants, [target], ['F'], repeats);
  const byKey = new Map(variants.map((entry) => [`${entry.spec.id}@${entry.hash}`, entry.spec]));
  const outcomes = await runCampaign({
    campaignId,
    cells: plan.cells,
    specFor: (cell) => {
      const spec = byKey.get(`${cell.specId}@${cell.specHash}`);
      if (!spec) throw new Error(`runPilot: no spec ${cell.specId}@${cell.specHash}`);
      return spec;
    },
    adapterFor: () => options.adapter,
    driver: () => options.driver(),
    checks: options.checks,
    ...(options.artifacts ? { artifacts: options.artifacts } : {}),
    store,
    now,
    concurrency: options.concurrency ?? 4,
    ...(options.onCell ? { onCell: options.onCell } : {}),
  });
  return { campaign, outcomes };
}

const CONTROL_CHECK = pilotControlCheck.name;

/** One run of the pilot with its factors: the unit the analysis reads. */
export type PilotObservation = PilotFactors & {
  specId: string;
  repeat: number;
  status: RunResult['status'];
  /** Completed, every block passed and the end state matched, as `outcomeOf` of the runner decides. */
  pass: boolean;
  /** The pass flag of each block, in order. */
  blocks: boolean[];
  /** Indices of the blocks not run or blocked in a run that still failed: no measurement, left out of block flips. */
  unscored?: number[];
  /**
   * The chance this run fails, when the agent states it (a control agent records `pilotControl.pFail`
   * on every block's raw output): 1 minus the product of the blocks' chances to pass. A control wraps a
   * deterministic agent, so a run whose other gating checks fail (or whose end state differs) fails
   * whatever the control draws: its chance is 1.
   */
  planted?: number;
  /** The control agent's own parameters, when it states them. */
  model?: Record<string, unknown>;
};

/**
 * The observation of a stored run, or undefined when its spec carries no pilot factors, or when the run is no
 * measurement: a block not run or blocked and no failure.
 */
export function observationOf(
  run: RunResult,
  factors: PilotFactors | undefined,
): PilotObservation | undefined {
  if (!factors) return undefined;
  const outcome = blocksOutcome(run);
  if (outcome === 'not_run' || outcome === 'blocked') return undefined;
  const pass = outcome === 'pass';
  const unscored = run.blocks.flatMap((block, index) => (isScored(block) ? [] : [index]));
  const controls = run.blocks.map((block) => controlOf(block.observed.raw));
  const stated = controls.length > 0 && controls.every((control) => control !== undefined);
  const baseFailed =
    run.status !== 'completed' ||
    run.endState?.match === false ||
    run.blocks.some((block) =>
      block.verdicts.some(
        (verdict) => verdict.gating && verdict.outcome !== 'pass' && verdict.name !== CONTROL_CHECK,
      ),
    );
  const planted = !stated
    ? undefined
    : baseFailed
      ? 1
      : 1 - controls.reduce((product, control) => product * (1 - (control?.pFail as number)), 1);
  const model = controls.find((control) => control?.model)?.model;
  return {
    ...factors,
    specId: run.specId,
    repeat: run.repeat,
    status: run.status,
    pass,
    blocks: run.blocks.map((block) => blockStatus(block) === 'pass'),
    ...(unscored.length > 0 ? { unscored } : {}),
    ...(planted === undefined ? {} : { planted }),
    ...(model === undefined ? {} : { model }),
  };
}

function controlOf(raw: unknown): { pFail: number; model?: Record<string, unknown> } | undefined {
  if (raw === null || typeof raw !== 'object') return undefined;
  const control = (raw as { pilotControl?: unknown }).pilotControl as
    | { pFail?: unknown; model?: unknown }
    | undefined;
  if (!control || typeof control.pFail !== 'number') return undefined;
  const model =
    control.model !== null && typeof control.model === 'object'
      ? (control.model as Record<string, unknown>)
      : undefined;
  return { pFail: control.pFail, ...(model ? { model } : {}) };
}

/**
 * Every run of a pilot campaign with its factors, read back from the store: the factors come from the
 * stored spec of each run (`metadata.pilot`), so a store alone is enough to analyse a pilot again.
 */
export async function pilotObservations(
  store: Store,
  campaignId: string,
): Promise<{ observations: PilotObservation[]; unlabelled: number }> {
  const runs = await store.listRuns({ campaignId });
  const factors = new Map<string, PilotFactors | undefined>();
  const observations: PilotObservation[] = [];
  let unlabelled = 0;
  for (const run of runs) {
    const key = `${run.specId}@${run.specHash}`;
    if (!factors.has(key)) {
      const loaded = await store.getSpec(run.specId, run.specHash);
      factors.set(key, loaded ? pilotFactors(loaded.spec) : undefined);
    }
    const observation = observationOf(run, factors.get(key));
    if (observation) observations.push(observation);
    else unlabelled += 1;
  }
  observations.sort(
    (a, b) =>
      compare(a.cell, b.cell) ||
      compare(a.conversation, b.conversation) ||
      a.wording - b.wording ||
      a.repeat - b.repeat,
  );
  return { observations, unlabelled };
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
