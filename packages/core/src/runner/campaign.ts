import type { AgentAdapter } from '../contracts/adapter';
import type { ArtifactReaderRegistry } from '../contracts/artifacts';
import type { CheckSet } from '../contracts/check';
import type { UserDriver } from '../contracts/driver';
import type { CostUnit, Store } from '../contracts/store';
import type { TargetRef } from '../schema/common';
import type { RunMode, RunResult } from '../schema/run';
import type { Spec } from '../schema/spec';
import type { ObservedCache } from './cache';
import { cellId } from './cell';
import type { RetryOptions } from './retry';
import { runSpec } from './run';

/** One run to make: one spec, on one target, in one mode, for one repeat (and one perturbation in P). */
export type PlannedCell = {
  cellId: string;
  specId: string;
  specHash: string;
  target: TargetRef;
  mode: RunMode;
  repeat: number;
  perturbationId?: string;
  /** Blocks the cell sends: the spec's blocks, plus the injected one in P mode. */
  blocks: number;
};

/** The cell a stored run belongs to: its run id is its cell id unless the caller chose another. */
export function cellIdOf(run: RunResult): string {
  return cellId(run);
}

export type CostLine = {
  adapter: string;
  blocks: number;
  /** The latest measured cost per block for this adapter, when one is stored. */
  usdPerBlock?: number;
  usd: number;
  note?: 'no unit measured';
};

/**
 * The minimum detectable effect of a comparison between two arms (a baseline target and a candidate)
 * that each run `runsPerArm` runs, by the two-proportion normal approximation:
 *
 *   effect = (z(1 - alpha / 2) + z(power)) * sqrt(2 * p * (1 - p) / n)
 *
 * with p the baseline pass rate and n the runs per arm, two-sided. It treats runs as independent, so
 * repeats of one spec count as separate runs; the clustered version moves to the stats package in phase 4.
 */
export type MinimumDetectableEffect = {
  mode: RunMode;
  runsPerArm: number;
  baselineRate: number;
  alpha: 0.05;
  power: 0.8;
  /** The smallest drop in pass rate the design detects, as a proportion; undefined with no runs. */
  effect?: number;
};

export type CampaignPlan = {
  cells: PlannedCell[];
  /** Blocks sent over every cell. */
  blocks: number;
  /** As `projectCost` of @driftbench/store computes it, with a line per adapter. */
  cost: { usd: number; unmeasured: string[]; byAdapter: CostLine[] };
  budgetUsd?: number;
  /** True when the projected cost fits the budget; absent without a budget. */
  withinBudget?: boolean;
  mde: MinimumDetectableEffect[];
};

export type PlanOptions = {
  /** Measured unit costs; the `block` metric of a target's adapter prices its cells. */
  units?: readonly CostUnit[];
  budgetUsd?: number;
  /** The baseline pass rate the MDE assumes. Default 0.5, where the variance is largest. */
  baselineRate?: number;
};

/**
 * z(0.975) and z(0.8), the standard normal quantiles for a two-sided alpha of 0.05 and a power of 0.8,
 * as Python's statistics.NormalDist().inv_cdf gives them.
 */
const Z_ALPHA = 1.9599639845400534;
const Z_POWER = 0.8416212335729144;

export function minimumDetectableEffect(runsPerArm: number, baselineRate = 0.5): number | undefined {
  if (runsPerArm <= 0) return undefined;
  return (Z_ALPHA + Z_POWER) * Math.sqrt((2 * baselineRate * (1 - baselineRate)) / runsPerArm);
}

/**
 * Expands specs x targets x modes x repeats into cells (P mode: one cell per perturbation and repeat),
 * projects the cost from measured units, and prints the minimum detectable effect of each mode.
 */
export function planCampaign(
  specs: ReadonlyArray<{ spec: Spec; hash: string }>,
  targets: readonly TargetRef[],
  modes: readonly RunMode[],
  repeats: number | Partial<Record<RunMode, number>>,
  options: PlanOptions = {},
): CampaignPlan {
  const repeatsOf = (mode: RunMode) => (typeof repeats === 'number' ? repeats : (repeats[mode] ?? 0));
  const cells: PlannedCell[] = [];
  for (const { spec, hash } of specs) {
    for (const target of targets) {
      for (const mode of modes) {
        const perturbations =
          mode === 'P' ? (spec.perturbations ?? []).map((perturbation) => perturbation.id) : [undefined];
        for (const perturbationId of perturbations) {
          for (let repeat = 0; repeat < repeatsOf(mode); repeat++) {
            const key = { specHash: hash, target, mode, repeat, perturbationId };
            cells.push({
              cellId: cellId(key),
              specId: spec.id,
              ...key,
              ...(perturbationId === undefined ? {} : { perturbationId }),
              blocks: spec.blocks.length + (perturbationId === undefined ? 0 : 1),
            });
          }
        }
      }
    }
  }

  const byAdapter = new Map<string, CostLine>();
  for (const cell of cells) {
    const adapter = cell.target.adapter;
    let line = byAdapter.get(adapter);
    if (!line) {
      const unit = latestUnit(options.units ?? [], adapter, 'block');
      line = unit
        ? { adapter, blocks: 0, usdPerBlock: unit.usd, usd: 0 }
        : { adapter, blocks: 0, usd: 0, note: 'no unit measured' };
      byAdapter.set(adapter, line);
    }
    line.blocks += cell.blocks;
    line.usd = line.blocks * (line.usdPerBlock ?? 0);
  }
  const lines = [...byAdapter.values()];
  const usd = lines.reduce((sum, line) => sum + line.usd, 0);
  const unmeasured = lines
    .filter((line) => line.usdPerBlock === undefined)
    .map((line) => line.adapter)
    .sort();

  const baselineRate = options.baselineRate ?? 0.5;
  const firstTarget = targets[0];
  const mde = modes.map((mode): MinimumDetectableEffect => {
    const runsPerArm = cells.filter((cell) => cell.mode === mode && cell.target === firstTarget).length;
    const effect = minimumDetectableEffect(runsPerArm, baselineRate);
    return {
      mode,
      runsPerArm,
      baselineRate,
      alpha: 0.05,
      power: 0.8,
      ...(effect === undefined ? {} : { effect }),
    };
  });

  return {
    cells,
    blocks: cells.reduce((sum, cell) => sum + cell.blocks, 0),
    cost: { usd, unmeasured, byAdapter: lines },
    ...(options.budgetUsd === undefined
      ? {}
      : { budgetUsd: options.budgetUsd, withinBudget: usd <= options.budgetUsd }),
    mde,
  };
}

/** The most recently measured unit of an adapter and metric; dates compare as dates, anything else as text. */
function latestUnit(units: readonly CostUnit[], adapter: string, metric: string): CostUnit | undefined {
  let latest: CostUnit | undefined;
  for (const unit of units) {
    if (unit.adapter !== adapter || unit.metric !== metric) continue;
    if (!latest || isLater(unit.measuredAt, latest.measuredAt)) latest = unit;
  }
  return latest;
}

function isLater(a: string, b: string): boolean {
  const left = Date.parse(a);
  const right = Date.parse(b);
  return Number.isNaN(left) || Number.isNaN(right) ? a > b : left > right;
}

/** A cell after the campaign ran it, or found it already done. */
export type CellOutcome = {
  cell: PlannedCell;
  /** The run behind the outcome; absent while the cell is pending. */
  run?: RunResult;
  /** True when a completed run of this cell was already in the store. */
  reused: boolean;
  state: 'pass' | 'fail' | 'failed' | 'stopped' | 'pending';
  /** Gating verdicts that did not pass, as `block <index> <verdict id>`, and end-state fields that differ. */
  failing: string[];
  /** Set when the budget stopped the cell before it started: the budget, and what the campaign had spent. */
  budgetStop?: { budgetUsd: number; spentUsd: number };
};

/** The outcome of a cell from its run: pass when the run completed, every block passed and the end state matched. */
export function outcomeOf(cell: PlannedCell, run: RunResult | undefined, reused = false): CellOutcome {
  if (!run) return { cell, reused, state: 'pending', failing: [] };
  const failing = [
    ...run.blocks.flatMap((block) =>
      block.verdicts
        .filter((verdict) => verdict.gating && verdict.outcome !== 'pass')
        .map((verdict) => `block ${block.index} ${verdict.id}`),
    ),
    ...(run.endState && !run.endState.match
      ? run.endState.diff.map((entry) => `end_state ${entry.field}`)
      : []),
  ];
  if (run.status !== 'completed') return { cell, run, reused, state: run.status, failing };
  const pass =
    run.blocks.length > 0 && run.blocks.every((block) => block.pass) && run.endState?.match !== false;
  return { cell, run, reused, state: pass ? 'pass' : 'fail', failing };
}

/** The run that stands for each cell of a campaign: its latest completed run, else its latest run. */
export async function runsByCell(store: Store, campaignId: string): Promise<Map<string, RunResult>> {
  return byCell(await store.listRuns({ campaignId }));
}

function byCell(runs: readonly RunResult[]): Map<string, RunResult> {
  const byCell = new Map<string, RunResult>();
  const rank = (run: RunResult) => (run.status === 'completed' ? 1 : 0);
  for (const run of runs) {
    const id = cellIdOf(run);
    const held = byCell.get(id);
    if (!held || rank(run) > rank(held) || (rank(run) === rank(held) && run.finishedAt >= held.finishedAt)) {
      byCell.set(id, run);
    }
  }
  return byCell;
}

export type CampaignRunOptions = {
  campaignId: string;
  cells: readonly PlannedCell[];
  /** The spec of a cell, by id and hash. */
  specFor(cell: PlannedCell): Spec;
  adapterFor(target: TargetRef): AgentAdapter;
  /** A fresh driver for each run. */
  driver(cell: PlannedCell): UserDriver;
  checks: CheckSet;
  /** Readers for the artifact checks, passed to every run. */
  artifacts?: ArtifactReaderRegistry;
  store: Store;
  cache?: ObservedCache;
  retry?: RetryOptions;
  now?: () => Date;
  /** Cells that run at the same time. Default 4. */
  concurrency?: number;
  /**
   * A hard stop on spend, in US dollars, over the whole campaign: the runs already in the store count, runs
   * replayed from the cache do not. Once it is reached no new cell starts; the cells in flight finish.
   */
  budgetUsd?: number;
  /** Called once per cell in cell order, as soon as the cell and every cell before it have an outcome. */
  onCell?(outcome: CellOutcome): void;
  /** Mode P: more tools whose call is a consequential act, for the recovery metrics. */
  consequential?: (label: string) => boolean;
};

/**
 * Runs the cells of a campaign on a pool of workers and files every run in the store as it finishes. A cell
 * whose completed run is already in the store is reused, not run again: that is how `resume` works. Failed
 * and stopped cells run again. Outcomes come back, and `onCell` hears them, in cell order. With a budget, a
 * cell that would start once the campaign's spend has reached it is stopped instead and never starts.
 *
 * Perturbed cells start after every other cell: each takes as the reference of its recovery the F run of
 * the same spec, target and repeat (else repeat 0) in this campaign, run now or stored, waiting for it when
 * it is still in flight. A campaign without that F cell gives P runs no reference.
 */
export async function runCampaign(options: CampaignRunOptions): Promise<CellOutcome[]> {
  const stored = await options.store.listRuns({ campaignId: options.campaignId });
  const done = byCell(stored);
  const { cells, budgetUsd } = options;
  let spentUsd = stored.filter((run) => !run.cacheHit).reduce((sum, run) => sum + run.cost, 0);
  const outcomes: Array<CellOutcome | undefined> = cells.map(() => undefined);
  let next = 0;
  let heard = 0;
  let failure: { cause: unknown } | undefined;
  // P cells last, so the F run each takes as its reference has started before it.
  const order = [
    ...cells.flatMap((cell, index) => (cell.mode === 'P' ? [] : [index])),
    ...cells.flatMap((cell, index) => (cell.mode === 'P' ? [index] : [])),
  ];
  const fRuns = new Map<string, { promise: Promise<RunResult | undefined>; settle(run?: RunResult): void }>();
  for (const cell of cells) {
    if (cell.mode !== 'F') continue;
    let settle: (run?: RunResult) => void = () => {};
    const promise = new Promise<RunResult | undefined>((resolve) => {
      settle = resolve;
    });
    fRuns.set(cell.cellId, { promise, settle });
  }
  const referenceFor = async (cell: PlannedCell): Promise<RunResult | undefined> => {
    for (const repeat of [...new Set([cell.repeat, 0])]) {
      const id = cellId({ specHash: cell.specHash, target: cell.target, mode: 'F', repeat });
      const planned = fRuns.get(id);
      const run = planned ? await planned.promise : done.get(id);
      if (run) return run;
    }
    return undefined;
  };

  const start = async (cell: PlannedCell): Promise<CellOutcome> => {
    const previous = done.get(cell.cellId);
    if (previous?.status === 'completed') return outcomeOf(cell, previous, true);
    if (budgetUsd !== undefined && spentUsd >= budgetUsd) {
      return { cell, reused: false, state: 'stopped', failing: [], budgetStop: { budgetUsd, spentUsd } };
    }
    const reference = cell.mode === 'P' ? await referenceFor(cell) : undefined;
    const run = await runSpec(options.specFor(cell), {
      adapter: options.adapterFor(cell.target),
      driver: options.driver(cell),
      checks: options.checks,
      ...(options.artifacts ? { artifacts: options.artifacts } : {}),
      mode: cell.mode,
      repeat: cell.repeat,
      target: cell.target,
      ...(cell.perturbationId === undefined ? {} : { perturbationId: cell.perturbationId }),
      store: options.store,
      campaignId: options.campaignId,
      ...(options.cache ? { cache: options.cache } : {}),
      ...(options.retry ? { retry: options.retry } : {}),
      ...(options.now ? { now: options.now } : {}),
      ...(reference ? { reference } : {}),
      ...(options.consequential ? { consequential: options.consequential } : {}),
    });
    if (!run.cacheHit) spentUsd += run.cost;
    return outcomeOf(cell, run);
  };

  const hear = () => {
    for (let outcome = outcomes[heard]; outcome; outcome = outcomes[heard]) {
      options.onCell?.(outcome);
      heard += 1;
    }
  };

  const worker = async () => {
    while (!failure && next < order.length) {
      const index = order[next] as number;
      next += 1;
      const cell = cells[index];
      if (!cell) return;
      try {
        outcomes[index] = await start(cell);
      } catch (cause) {
        failure ??= { cause };
        return;
      } finally {
        fRuns.get(cell.cellId)?.settle(outcomes[index]?.run);
      }
      hear();
    }
  };

  const workers = Math.max(1, Math.min(Math.floor(options.concurrency ?? 4), cells.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  for (const planned of fRuns.values()) planned.settle();
  if (failure) throw failure.cause;
  return outcomes.filter((outcome): outcome is CellOutcome => outcome !== undefined);
}
