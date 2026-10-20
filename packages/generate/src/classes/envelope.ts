import { blockStatus, type RunResult, type Spec, type Store } from '@agent-nexus/driftbench-core';
import { type Interval, mulberry32, wilson, wilsonEffective, zFor } from '@agent-nexus/driftbench-stats';
import { localise, rowOfCell, type Suspect } from './planner';
import { type ClassVariant, classVariantOf } from './set';

/**
 * The envelope of a class block: its pass rate over the frozen realisations, never one string. The runs of one
 * realisation are correlated, so the headline interval is Wilson on the effective number of runs, with the
 * realisations as the clusters. Each cell (a combination of axis values) gets its own rate, because one cell at
 * 0 hides inside a fair class rate; MinP is the lowest cell rate. The phrasing share is how much of the spread
 * is between realisations rather than between runs of one. Class results are reported in their own column and
 * are never averaged with the results of blocks that send one string.
 */

/** One realisation's outcomes over its runs (1 pass, 0 fail) and its cell. */
export type EnvelopeItem = { item: string; cell: string; outcomes: number[] };

export type CellRate = {
  cell: string;
  items: number;
  passes: number;
  runs: number;
  rate: number;
  wilson: Interval;
};

export type Envelope = {
  /** Realisations. */
  n: number;
  runs: number;
  passes: number;
  rate: number;
  /** Wilson on the effective runs, clustered by realisation. */
  interval: Interval;
  designEffect: number;
  effectiveN: number;
  cells: CellRate[];
  /** The rate of each axis value over every cell that holds it: where a cell at 0 comes from. */
  byValue: { value: string; passes: number; runs: number; rate: number }[];
  /** The localiser over the realisations: the axis values and pairs no consistently passing realisation holds. */
  suspects: Suspect[];
  minP: number;
  /** The cells most likely to be the worst, by posterior draws (Beta(1 + passes, 1 + fails) per cell). */
  worst: { cell: string; pWorst: number }[];
  /** Share of the outcome variance between realisations; undefined below 2 runs per realisation. */
  phrasingShare?: number;
  /** Smallest drop of the class rate the design detects, alpha 0.05 two-sided, power 0.80. */
  mde: number;
};

const mean = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
function variance(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
}

/** Marsaglia and Tsang gamma sampler (k >= 1; boosted for k < 1). */
function gammaSample(k: number, random: () => number): number {
  if (k < 1) return gammaSample(k + 1, random) * random() ** (1 / k);
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      const u1 = random();
      const u2 = random();
      x = Math.sqrt(-2 * Math.log(u1 || 1e-12)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = random();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function betaSample(a: number, b: number, random: () => number): number {
  const x = gammaSample(a, random);
  return x / (x + gammaSample(b, random));
}

export type EnvelopeOptions = { alpha?: number; seed?: number; draws?: number };

/** The envelope of one class block. Throws a RangeError on no realisation or a realisation with no run. */
export function envelope(items: readonly EnvelopeItem[], options: EnvelopeOptions = {}): Envelope {
  if (items.length === 0) throw new RangeError('envelope: no realisation');
  for (const item of items)
    if (item.outcomes.length === 0) throw new RangeError(`envelope: ${item.item} has no run`);
  const alpha = options.alpha ?? 0.05;
  const clustered = wilsonEffective(
    items.map((item) => ({ n: item.outcomes.length, k: item.outcomes.filter((o) => o === 1).length })),
    { alpha },
  );
  const byCell = new Map<string, EnvelopeItem[]>();
  for (const item of items) byCell.set(item.cell, [...(byCell.get(item.cell) ?? []), item]);
  const cells = [...byCell.entries()]
    .map(([cell, list]) => {
      const passes = list.reduce((s, i) => s + i.outcomes.filter((o) => o === 1).length, 0);
      const runs = list.reduce((s, i) => s + i.outcomes.length, 0);
      return { cell, items: list.length, passes, runs, rate: passes / runs, wilson: wilson(passes, runs) };
    })
    .sort((a, b) => a.rate - b.rate || (a.cell < b.cell ? -1 : 1));
  const random = mulberry32(options.seed ?? 1);
  const draws = options.draws ?? 4000;
  const wins = new Map<string, number>();
  for (let d = 0; d < draws; d++) {
    let low = Number.POSITIVE_INFINITY;
    let at = '';
    for (const c of cells) {
      const theta = betaSample(1 + c.passes, 1 + c.runs - c.passes, random);
      if (theta < low) {
        low = theta;
        at = c.cell;
      }
    }
    wins.set(at, (wins.get(at) ?? 0) + 1);
  }
  const worst = [...wins.entries()]
    .map(([cell, w]) => ({ cell, pWorst: w / draws }))
    .sort((a, b) => b.pWorst - a.pWorst || (a.cell < b.cell ? -1 : 1))
    .slice(0, 3);
  const means = items.map((item) => mean(item.outcomes));
  const k = Math.min(...items.map((item) => item.outcomes.length));
  let phrasingShare: number | undefined;
  if (k >= 2) {
    const within = mean(items.map((item) => variance(item.outcomes)));
    const between = Math.max(0, variance(means) - within / k);
    phrasingShare = between + within === 0 ? 0 : between / (between + within);
  }
  const values = new Map<string, { passes: number; runs: number }>();
  for (const cell of cells) {
    for (const part of cell.cell.split('|')) {
      const v = values.get(part) ?? { passes: 0, runs: 0 };
      v.passes += cell.passes;
      v.runs += cell.runs;
      values.set(part, v);
    }
  }
  const byValue = [...values.entries()]
    .map(([value, v]) => ({ value, ...v, rate: v.passes / v.runs }))
    .sort((a, b) => a.rate - b.rate || (a.value < b.value ? -1 : 1));
  const axes = rowOfCell(items[0]?.cell ?? '').axes;
  const suspects = localise(
    axes,
    items.map((item) => ({
      row: rowOfCell(item.cell).row,
      passes: item.outcomes.filter((o) => o === 1).length,
      runs: item.outcomes.length,
    })),
  )
    .filter((s) => !s.inPassing)
    .slice(0, 5);
  const se = Math.sqrt(variance(means) / items.length);
  const runs = items.reduce((s, i) => s + i.outcomes.length, 0);
  const passes = items.reduce((s, i) => s + i.outcomes.filter((o) => o === 1).length, 0);
  return {
    n: items.length,
    runs,
    passes,
    rate: passes / runs,
    interval: { estimate: clustered.estimate, lower: clustered.lower, upper: clustered.upper },
    designEffect: clustered.designEffect,
    effectiveN: clustered.effectiveN,
    cells,
    byValue,
    suspects,
    minP: cells[0]?.rate ?? 0,
    worst,
    ...(phrasingShare === undefined ? {} : { phrasingShare }),
    mde: (zFor(alpha) + zFor(0.4)) * se,
  };
}

/** The class blocks of a campaign, each with its envelope, beside the single-string blocks counted apart. */
export type ClassReport = {
  classes: { class: string; set: string; block: number; specs: string[]; envelope: Envelope }[];
  /** Blocks of specs that are no class copy: one string each. Their rate is never averaged into a class rate. */
  single: { specs: number; runs: number; passes: number; rate: number | null };
  /** Class runs left out because the class block was not run or blocked. */
  unscored: number;
};

type Run = Pick<RunResult, 'specId' | 'specHash' | 'blocks'>;

/**
 * The report over stored runs: runs of a class copy go to their class block's envelope (one item per
 * realisation, its runs the repeats); every other run counts in `single`.
 */
export function classReport(
  runs: readonly Run[],
  specOf: (run: Run) => Spec | undefined,
  options: EnvelopeOptions = {},
): ClassReport {
  const groups = new Map<
    string,
    { variant: ClassVariant; specs: Set<string>; items: Map<string, EnvelopeItem> }
  >();
  const single = { specs: new Set<string>(), runs: 0, passes: 0 };
  let unscored = 0;
  for (const run of runs) {
    const spec = specOf(run);
    const variant = spec ? classVariantOf(spec) : undefined;
    if (!variant) {
      for (const block of run.blocks) {
        const status = blockStatus(block);
        if (status !== 'pass' && status !== 'fail') continue;
        single.runs += 1;
        if (status === 'pass') single.passes += 1;
      }
      single.specs.add(run.specId);
      continue;
    }
    const block = run.blocks.find((b) => (b.specIndex ?? b.index) === variant.block);
    const status = block ? blockStatus(block) : undefined;
    if (status !== 'pass' && status !== 'fail') {
      unscored += 1;
      continue;
    }
    const key = `${variant.id}|${variant.set}|${variant.block}`;
    const group = groups.get(key) ?? { variant, specs: new Set<string>(), items: new Map() };
    group.specs.add(run.specId.replace(/\.c\d+\.[^.]+$/, ''));
    const item = group.items.get(variant.item) ?? { item: variant.item, cell: variant.cell, outcomes: [] };
    item.outcomes.push(status === 'pass' ? 1 : 0);
    group.items.set(variant.item, item);
    groups.set(key, group);
  }
  return {
    classes: [...groups.values()]
      .map((group) => ({
        class: group.variant.id,
        set: group.variant.set,
        block: group.variant.block,
        specs: [...group.specs].sort(),
        envelope: envelope(
          [...group.items.values()].sort((a, b) => (a.item < b.item ? -1 : 1)),
          options,
        ),
      }))
      .sort((a, b) => (a.class < b.class ? -1 : a.class > b.class ? 1 : a.block - b.block)),
    single: {
      specs: single.specs.size,
      runs: single.runs,
      passes: single.passes,
      rate: single.runs === 0 ? null : single.passes / single.runs,
    },
    unscored,
  };
}

/** The report of a campaign in a store, every spec read back from the store. */
export async function classReportOfStore(
  store: Store,
  campaignId: string,
  options: EnvelopeOptions = {},
): Promise<ClassReport> {
  const runs = await store.listRuns({ campaignId });
  const specs = new Map<string, Spec | undefined>();
  for (const run of runs) {
    const key = `${run.specId}@${run.specHash}`;
    if (!specs.has(key)) specs.set(key, (await store.getSpec(run.specId, run.specHash))?.spec);
  }
  return classReport(runs, (run) => specs.get(`${run.specId}@${run.specHash}`), options);
}
