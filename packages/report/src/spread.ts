import { blockStatus, isScored, type RunMode, type RunResult, type Spec } from '@agent-nexus/driftbench-core';
import { quantile, repeatsForFloor, sampleVariance, Z95 } from '@agent-nexus/driftbench-stats';
import {
  blocksWithSpec,
  type CampaignData,
  groupBy,
  lineKey,
  runPassed,
  scoredRuns,
  specOfRun,
} from './data';
import { clustered, type Estimate, type Rate, rate } from './estimate';

export type SpreadOptions = {
  /** The margin, as a proportion: a cell is undecided when its interval straddles reference minus margin. */
  margin: number;
  /** The mode the spread reads. Default F when the campaign ran it, else its first mode. */
  mode?: RunMode;
  /** The dimensions of `metadata.generated.cell` that name a cell. Default behaviour when present, else all. */
  by?: readonly string[];
  /** A baseline campaign: its cell rate becomes each cell's reference. Without it the reference is 1. */
  baseline?: CampaignData;
  /** A wording range above this flags a cell, when the range is also above the cell's noise floor. Default 0.2. */
  wordingThreshold?: number;
};

export type CellSpread = {
  cell: string;
  runs: number;
  conversations: number;
  /** Runs that pass. Conversations are the clusters when the cell holds two or more, else Wilson over runs. */
  rate: Estimate;
  /** The rate the margin is read against: the baseline cell rate, or 1. */
  reference: number;
  /** above: the interval sits above reference minus margin; below: under it; undecided: it straddles it. */
  status: 'above' | 'undecided' | 'below';
  /** Wording sensitivity: over the conversations run in two wordings or more. */
  wording?: { conversations: number; maxRange: number; meanRange: number; floor: number; flagged: boolean };
};

export type NoiseFloor = {
  /** Lines (one golden in one mode) with two repeats or more. */
  lines: number;
  /** Median repeats per line. */
  repeats: number;
  /** Pooled within-line variance of the run pass flag across repeats. */
  variance: number;
  /** z sqrt(2 variance / repeats): a difference in one golden's pass rate between two versions under this is noise. */
  perGolden: number;
  /** z sqrt(2 variance / (repeats lines)): the same for the pass rate of the whole mode. */
  perCampaign: number;
  /** Blocks (same golden, same block) whose pass flag differs across repeats, Wilson over those blocks. */
  blockFlip?: Rate;
  /** Repeats per golden that keep its noise floor under 5 points. */
  repeatsFor5Points: number;
};

export type JudgeFlip = {
  criterion: string;
  /** Judged verdicts with two votes or more. */
  verdicts: number;
  /** Verdicts whose votes disagree, Wilson. */
  flip: Rate;
  inconclusive: number;
};

export type Spread = {
  mode: RunMode;
  /** How cells are named: from the pilot factors, the generated cell, or one spec per cell. */
  source: 'pilot' | 'generated' | 'spec';
  by: string[];
  margin: number;
  /** Runs of the mode left out as no measurement (a block not run or blocked, no failure). Absent when 0. */
  unscored?: number;
  cells: CellSpread[];
  /** Quantiles of the cell rates. */
  quantiles?: { min: number; p10: number; p25: number; p50: number; p75: number; p90: number; max: number };
  /** The five cells with the lowest rate (ties: the lower upper bound first). */
  worst: CellSpread[];
  undecided: CellSpread[];
  noise?: NoiseFloor;
  judgeFlip: JudgeFlip[];
};

type Factors = { cell: string; conversation: string; wording: number; source: Spread['source'] };

/** The cell, conversation and wording of a spec, from `metadata.pilot`, else `metadata.generated.cell`. */
export function factorsOf(
  spec: Spec | undefined,
  specId: string,
  by: readonly string[] | undefined,
): Factors {
  const metadata = spec?.metadata;
  const pilot = record(metadata?.pilot);
  if (pilot && typeof pilot.cell === 'string') {
    return {
      cell: pilot.cell,
      conversation: typeof pilot.conversation === 'string' ? pilot.conversation : specId,
      wording: typeof pilot.wording === 'number' ? pilot.wording : 0,
      source: 'pilot',
    };
  }
  const cell = record(record(metadata?.generated)?.cell);
  if (cell) {
    const dims = by && by.length > 0 ? by : 'behaviour' in cell ? ['behaviour'] : Object.keys(cell);
    const name = dims.map((dim) => `${dim}=${cell[dim] === undefined ? '-' : String(cell[dim])}`).join(',');
    return { cell: name, conversation: specId, wording: 0, source: 'generated' };
  }
  return { cell: specId, conversation: specId, wording: 0, source: 'spec' };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** P4.9: the spread view of one mode of a campaign. */
export function spread(data: CampaignData, options: SpreadOptions): Spread {
  const modes = [...new Set(data.runs.map((run) => run.mode))];
  const mode = options.mode ?? (modes.includes('F') ? 'F' : (modes[0] ?? 'F'));
  // A run neither passed nor failed (a block not run or blocked) is no measurement: it is left out.
  const runs = scoredRuns(data.runs).filter((run) => run.mode === mode);
  const unscored = data.runs.filter((run) => run.mode === mode).length - runs.length;
  const threshold = options.wordingThreshold ?? 0.2;
  const factors = new Map(runs.map((run) => [run, factorsOf(specOfRun(data, run), run.specId, options.by)]));
  const sources = new Set([...factors.values()].map((entry) => entry.source));
  const source: Spread['source'] = sources.has('pilot')
    ? 'pilot'
    : sources.has('generated')
      ? 'generated'
      : 'spec';

  const reference = new Map<string, number>();
  if (options.baseline) {
    const baselineRuns = scoredRuns(options.baseline.runs).filter((run) => run.mode === mode);
    const byCell = groupBy(
      baselineRuns,
      (run) => factorsOf(specOfRun(options.baseline as CampaignData, run), run.specId, options.by).cell,
    );
    for (const [cell, cellRuns] of byCell) {
      reference.set(cell, cellRuns.filter(runPassed).length / cellRuns.length);
    }
  }

  const cells: CellSpread[] = [];
  for (const [cell, cellRuns] of groupBy(runs, (run) => (factors.get(run) as Factors).cell)) {
    const conversations = new Set(cellRuns.map((run) => (factors.get(run) as Factors).conversation));
    const flags = cellRuns.map((run) => (runPassed(run) ? 1 : 0));
    const passed = flags.reduce<number>((a, b) => a + b, 0);
    const estimate =
      conversations.size >= 2
        ? (clustered(
            flags,
            cellRuns.map((run) => (factors.get(run) as Factors).conversation),
            { rate: true },
          ) as Estimate)
        : (rate(passed, cellRuns.length) as Rate);
    const ref = reference.get(cell) ?? 1;
    const bar = ref - options.margin;
    const status = estimate.lower > bar ? 'above' : estimate.upper < bar ? 'below' : 'undecided';
    const wording = wordingOf(cellRuns, factors, threshold);
    cells.push({
      cell,
      runs: cellRuns.length,
      conversations: conversations.size,
      rate: estimate,
      reference: ref,
      status,
      ...(wording ? { wording } : {}),
    });
  }

  const rates = cells.map((cell) => cell.rate.estimate);
  const worst = [...cells]
    .sort(
      (a, b) =>
        a.rate.estimate - b.rate.estimate || a.rate.upper - b.rate.upper || a.cell.localeCompare(b.cell),
    )
    .slice(0, 5);
  const noise = noiseOf(data, runs);
  return {
    mode,
    ...(unscored > 0 ? { unscored } : {}),
    source,
    by: source === 'generated' ? byOf(data, runs, options.by) : [],
    margin: options.margin,
    cells,
    ...(rates.length === 0
      ? {}
      : {
          quantiles: {
            min: Math.min(...rates),
            p10: quantile(rates, 0.1),
            p25: quantile(rates, 0.25),
            p50: quantile(rates, 0.5),
            p75: quantile(rates, 0.75),
            p90: quantile(rates, 0.9),
            max: Math.max(...rates),
          },
        }),
    worst,
    undecided: cells.filter((cell) => cell.status === 'undecided'),
    ...(noise ? { noise } : {}),
    judgeFlip: judgeFlip(data.runs),
  };
}

function byOf(data: CampaignData, runs: readonly RunResult[], by: readonly string[] | undefined): string[] {
  if (by && by.length > 0) return [...by];
  for (const run of runs) {
    const cell = record(record(specOfRun(data, run)?.metadata?.generated)?.cell);
    if (cell) return 'behaviour' in cell ? ['behaviour'] : Object.keys(cell);
  }
  return [];
}

/** Pooled within-group variance of pass flags over groups of two runs or more; undefined when none. */
function within(groups: Iterable<readonly number[]>): {
  variance: number;
  groups: number;
  repeats: number[];
} {
  let ss = 0;
  let df = 0;
  let count = 0;
  const repeats: number[] = [];
  for (const flags of groups) {
    if (flags.length < 2) continue;
    ss += sampleVariance(flags) * (flags.length - 1);
    df += flags.length - 1;
    count += 1;
    repeats.push(flags.length);
  }
  return { variance: df === 0 ? Number.NaN : ss / df, groups: count, repeats };
}

function wordingOf(
  runs: readonly RunResult[],
  factors: ReadonlyMap<RunResult, Factors>,
  threshold: number,
): CellSpread['wording'] {
  const ranges: number[] = [];
  for (const convRuns of groupBy(runs, (run) => (factors.get(run) as Factors).conversation).values()) {
    const byWording = groupBy(convRuns, (run) => String((factors.get(run) as Factors).wording));
    if (byWording.size < 2) continue;
    const rates = [...byWording.values()].map((group) => group.filter(runPassed).length / group.length);
    ranges.push(Math.max(...rates) - Math.min(...rates));
  }
  if (ranges.length === 0) return undefined;
  const repeatGroups = groupBy(runs, (run) => {
    const f = factors.get(run) as Factors;
    return `${f.conversation}\u0000${f.wording}\u0000${run.perturbationId ?? ''}`;
  });
  const noise = within(
    [...repeatGroups.values()].map((group) => group.map((run) => (runPassed(run) ? 1 : 0))),
  );
  const repeats = noise.repeats.length === 0 ? 1 : median(noise.repeats);
  const floor = Number.isNaN(noise.variance) ? 0 : Z95 * Math.sqrt((2 * noise.variance) / repeats);
  const maxRange = Math.max(...ranges);
  return {
    conversations: ranges.length,
    maxRange,
    meanRange: ranges.reduce((a, b) => a + b, 0) / ranges.length,
    floor,
    flagged: maxRange > threshold && maxRange > floor,
  };
}

function median(values: readonly number[]): number {
  return quantile(values, 0.5);
}

function noiseOf(data: CampaignData, runs: readonly RunResult[]): NoiseFloor | undefined {
  const lines = groupBy(runs, lineKey);
  const noise = within([...lines.values()].map((group) => group.map((run) => (runPassed(run) ? 1 : 0))));
  if (noise.groups === 0) return undefined;
  const repeats = median(noise.repeats);
  const variance = noise.variance;
  let flipping = 0;
  let blocks = 0;
  for (const group of lines.values()) {
    if (group.length < 2) continue;
    const byBlock = new Map<number, Set<boolean>>();
    for (const run of group) {
      for (const { result, specBlock } of blocksWithSpec(run, specOfRun(data, run))) {
        if (specBlock === undefined || !isScored(result)) continue;
        const seen = byBlock.get(specBlock) ?? new Set<boolean>();
        seen.add(blockStatus(result) === 'pass');
        byBlock.set(specBlock, seen);
      }
    }
    for (const seen of byBlock.values()) {
      blocks += 1;
      if (seen.size > 1) flipping += 1;
    }
  }
  const flip = rate(flipping, blocks);
  return {
    lines: noise.groups,
    repeats,
    variance,
    perGolden: Z95 * Math.sqrt((2 * variance) / repeats),
    perCampaign: Z95 * Math.sqrt((2 * variance) / (repeats * noise.groups)),
    ...(flip ? { blockFlip: flip } : {}),
    repeatsFor5Points: variance === 0 ? 1 : repeatsForFloor({ variance, floor: 0.05 }).repeats,
  };
}

/** The judge flip rate per judged criterion: verdicts whose votes disagree, over verdicts with two votes or more. */
export function judgeFlip(runs: readonly RunResult[]): JudgeFlip[] {
  const byCriterion = new Map<string, { verdicts: number; flipping: number; inconclusive: number }>();
  for (const run of runs) {
    for (const block of run.blocks) {
      for (const verdict of block.verdicts) {
        if (verdict.kind !== 'judge') continue;
        const entry = byCriterion.get(verdict.id) ?? { verdicts: 0, flipping: 0, inconclusive: 0 };
        if (verdict.outcome === 'inconclusive') entry.inconclusive += 1;
        const votes = verdict.judge?.votes ?? [];
        if (votes.length >= 2) {
          entry.verdicts += 1;
          if (new Set(votes.map((vote) => vote.outcome)).size > 1) entry.flipping += 1;
        }
        byCriterion.set(verdict.id, entry);
      }
    }
  }
  return [...byCriterion.entries()]
    .filter(([, entry]) => entry.verdicts > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([criterion, entry]) => ({
      criterion,
      verdicts: entry.verdicts,
      flip: rate(entry.flipping, entry.verdicts) as Rate,
      inconclusive: entry.inconclusive,
    }));
}
