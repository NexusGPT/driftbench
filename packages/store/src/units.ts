import type { CostUnit, Observed, RunResult } from '@agent-nexus/driftbench-core';

/** The metric of a unit that prices one block of an agent run. */
export const BLOCK_METRIC = 'block';
/** The metric of a unit that prices one judge call. */
export const JUDGE_CALL_METRIC = 'judge_call';

const UNIT_KEYS = new Set(['adapter', 'metric', 'usd', 'measuredAt', 'samples']);

/** Every way a value fails to be a CostUnit, as readable lines. Empty when it is one. */
export function unitProblems(value: unknown): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return ['expected an object'];
  const unit = value as Record<string, unknown>;
  const problems: string[] = [];
  for (const key of Object.keys(unit)) {
    if (!UNIT_KEYS.has(key)) problems.push(`unknown key: ${key}`);
  }
  for (const key of ['adapter', 'metric', 'measuredAt']) {
    if (typeof unit[key] !== 'string' || unit[key] === '') {
      problems.push(`${key}: expected a non-empty string`);
    }
  }
  if (typeof unit.usd !== 'number' || !Number.isFinite(unit.usd) || unit.usd < 0) {
    problems.push('usd: expected a finite number of 0 or more');
  }
  if (unit.samples !== undefined && !(Number.isInteger(unit.samples) && (unit.samples as number) >= 0)) {
    problems.push('samples: expected a whole number of 0 or more');
  }
  return problems;
}

/** One planned cell, as the cost projection sees it. */
export type CostCell = {
  adapter: string;
  /** Blocks the cell will run. */
  blocks: number;
  /** Judge calls the cell will make. */
  judgeCalls?: number;
};

export type CostProjection = {
  /** The projected spend, in US dollars, over the cells whose units are measured. */
  usd: number;
  /** Adapters that need a unit no measurement covers, sorted. Their cells add nothing to `usd`. */
  unmeasured: string[];
};

/**
 * Projects a campaign's spend before it runs: blocks times the adapter's `block` unit, plus judge
 * calls times the adapter's `judge_call` unit. When several units share an adapter and a metric,
 * the most recently measured one prices the cells.
 */
export function projectCost(cells: readonly CostCell[], units: readonly CostUnit[]): CostProjection {
  const latest = new Map<string, CostUnit>();
  for (const unit of units) {
    const key = unitKey(unit.adapter, unit.metric);
    const known = latest.get(key);
    if (known === undefined || isLater(unit.measuredAt, known.measuredAt)) latest.set(key, unit);
  }

  let usd = 0;
  const unmeasured = new Set<string>();
  for (const cell of cells) {
    const judgeCalls = cell.judgeCalls ?? 0;
    if (!isCount(cell.blocks) || !isCount(judgeCalls)) {
      throw new RangeError(
        `projectCost: a cell for adapter ${cell.adapter} needs whole counts of 0 or more for blocks and judgeCalls`,
      );
    }
    for (const [metric, count] of [
      [BLOCK_METRIC, cell.blocks],
      [JUDGE_CALL_METRIC, judgeCalls],
    ] as const) {
      if (count === 0) continue;
      const unit = latest.get(unitKey(cell.adapter, metric));
      if (unit === undefined) unmeasured.add(cell.adapter);
      else usd += count * unit.usd;
    }
  }
  return { usd, unmeasured: [...unmeasured].sort() };
}

/**
 * Derives one `block` unit per adapter from stored runs: the mean US dollar cost of a block, over
 * every block whose cost is known, with that block count as `samples`. A block's cost is its
 * observed total, or the sum of its segment costs when only segments carry one. Runs served from the
 * cache are skipped: their cost was paid by the run that filled the cache. `measuredAt` is the
 * latest `finishedAt` among the runs that gave a sample.
 */
export function measuredUnits(runs: readonly RunResult[]): CostUnit[] {
  const sums = new Map<string, { usd: number; samples: number; measuredAt: string }>();
  for (const run of runs) {
    if (run.cacheHit || run.carried !== undefined) continue;
    for (const block of run.blocks) {
      const usd = blockUsd(block.observed);
      if (usd === undefined) continue;
      const adapter = run.target.adapter;
      const sum = sums.get(adapter);
      if (sum === undefined) {
        sums.set(adapter, { usd, samples: 1, measuredAt: run.finishedAt });
      } else {
        sum.usd += usd;
        sum.samples += 1;
        if (isLater(run.finishedAt, sum.measuredAt)) sum.measuredAt = run.finishedAt;
      }
    }
  }
  return [...sums.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([adapter, sum]) => ({
      adapter,
      metric: BLOCK_METRIC,
      usd: sum.usd / sum.samples,
      measuredAt: sum.measuredAt,
      samples: sum.samples,
    }));
}

function blockUsd(observed: Observed): number | undefined {
  if (observed.cost.usd !== undefined) return observed.cost.usd;
  const parts = observed.segments.flatMap((segment) =>
    segment.cost?.usd === undefined ? [] : [segment.cost.usd],
  );
  return parts.length === 0 ? undefined : parts.reduce((total, part) => total + part, 0);
}

function unitKey(adapter: string, metric: string): string {
  return `${adapter}\u0000${metric}`;
}

function isCount(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

/** True when `a` is a later moment than `b`. Dates compare as dates, anything else as text. */
function isLater(a: string, b: string): boolean {
  const left = Date.parse(a);
  const right = Date.parse(b);
  return Number.isNaN(left) || Number.isNaN(right) ? a > b : left > right;
}
