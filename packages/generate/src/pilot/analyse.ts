import {
  benjaminiHochberg,
  bootstrapCI,
  designEffect,
  effectiveSampleSize,
  icc,
  incompleteBeta,
  mulberry32,
  neymanAllocation,
  type Observation,
  quantile,
  repeatsForFloor,
  type VarianceComponentsResult,
  varianceComponents,
  wilson,
  Z95,
} from '@agent-nexus/driftbench-stats';
import type { PilotObservation } from './run';

/**
 * The pilot analysis: where the spread of pass results comes from. A nested random-effects model
 * (cell > conversation > wording > repeat) over the run outcomes (1 pass, 0 fail), pooled and per cell,
 * with a stratified cluster bootstrap over conversations for the shares; the intraclass correlation per
 * level; the design effect measured from the within-cell conversation correlation; Neyman allocation of
 * a fixed estimation pool across the cells; repeats per block for a stated noise floor; the wording
 * sensitivity per cell; the flip rate per block. A control agent that states its own failure chance
 * gets the planted shares beside the estimates.
 */

export type PilotAnalysisOptions = {
  /** The noise floor: the half-width under which a difference between two versions reads as noise. Default 0.05. */
  floor?: number;
  /** Conversations in the fixed estimation pool the allocation spreads across cells. Default 100. */
  pool?: number;
  /** Bootstrap resamples. Default 500. */
  iterations?: number;
  /** Bootstrap seed. Default 1. */
  seed?: number;
  /** A cell is flagged as wording-sensitive when some conversation's pass rates across wordings span more than this. Default 0.2. */
  sensitivity?: number;
  /** What the bootstrap of the pooled shares draws. Default 'both'. */
  resample?: Resample;
};

export const PILOT_ANALYSIS_DEFAULTS: Required<PilotAnalysisOptions> = {
  floor: 0.05,
  pool: 100,
  iterations: 500,
  seed: 1,
  sensitivity: 0.2,
  resample: 'both',
};

export type Range = { lower: number; upper: number };

export type LevelSummary = {
  level: string;
  groups: number;
  df: number;
  variance: number;
  share: number;
  /** Set when the level has degrees of freedom; a level with one child per parent is not identified. */
  estimable: boolean;
  /** Bootstrap percentile interval of the share (pooled model only). */
  shareInterval?: Range;
  /** Bootstrap percentile interval of the variance (pooled model only). */
  varianceInterval?: Range;
};

export type CellAnalysis = {
  cell: string;
  suite: number;
  conversations: number;
  variants: number;
  runs: number;
  passRate: number;
  /** Cluster bootstrap over the cell's conversations. */
  passInterval: Range;
  /** conversation > wording > repeat inside the cell. */
  levels: LevelSummary[];
  icc: Array<{ level: string; icc: number }>;
  /** sqrt(p (1 - p)): the spread of one run's outcome in the cell, the S_h of the allocation. */
  sd: number;
  allocation: { exact: number; allocated: number };
  wording: WordingSensitivity;
  flip: { blocks: number; mean: number; max: number; flipping: number };
};

export type WordingSensitivity = {
  /** Conversations of the cell with at least two wordings: the only ones that can show a wording effect. */
  conversations: number;
  /** Largest range of pass rates across one conversation's wordings; undefined with no such conversation. */
  maxRange?: number;
  meanRange?: number;
  /**
   * The F test of the wording level inside the cell (wording mean square over repeat mean square, df of
   * each): the chance of a spread across wordings this large with no wording effect. Undefined when no
   * conversation of the cell has two wordings.
   */
  pValue?: number;
  /** The p value adjusted over the cells by Benjamini-Hochberg. */
  adjusted?: number;
  /** True when some conversation's range is above the threshold and the adjusted p value is under 0.05. */
  flagged: boolean;
};

export type BlockFlip = {
  cell: string;
  conversation: string;
  wording: number;
  block: number;
  repeats: number;
  passes: number;
  /** 2 k (r - k) / (r (r - 1)): the chance two repeats of this block disagree. */
  flip: number;
};

export type PilotAnalysis = {
  observations: number;
  /** Runs that did not complete; they are left out of every figure. */
  errored: number;
  passRate: { estimate: number; interval: Range; effectiveRuns: number };
  pooled: {
    method: VarianceComponentsResult['method'];
    balanced: boolean;
    total: number;
    levels: LevelSummary[];
    icc: Array<{ level: string; icc: number }>;
    bootstrap: { iterations: number; seed: number; resample: Resample; cells: number };
  };
  designEffect: {
    /** Runs per conversation in this pilot (wordings x repeats, averaged). */
    m: number;
    /** Correlation of two runs of one conversation inside a cell: conversation variance over the within-cell total. */
    rho: number;
    value: number;
    note: string;
  };
  allocation: {
    pool: number;
    rule: string;
    strata: Array<{ cell: string; suite: number; sd: number; exact: number; allocated: number }>;
  };
  noiseFloor: {
    floor: number;
    /** Run-to-run variance: the repeat component of the pooled model. */
    variance: number;
    /** Repeats per block so a difference between two versions of one block reads against the floor. */
    perBlock: { repeats: number; floor: number };
    /** The same for a cell figure averaged over the cell's conversations in this pilot. */
    perCell: { blocks: number; repeats: number; floor: number };
    /** The floor the pilot's own repeats reach on one block. */
    reached: number;
  };
  flip: { blocks: number; mean: number; flipping: number; top: BlockFlip[] };
  /** threshold: the range a flagged cell exceeds; q: the false discovery rate of its F test over the cells. */
  wording: { threshold: number; q: number; flagged: string[] };
  cells: CellAnalysis[];
  planted?: PlantedCheck;
};

export type PlantedCheck = {
  /** The control agent's parameters, as it states them on its runs. */
  model?: Record<string, unknown>;
  /**
   * The variance the agent planted, for this design: the nested model on each run's stated failure
   * chance (between levels) plus the mean of p (1 - p) (repeat level).
   */
  levels: Array<{
    level: string;
    variance: number;
    share: number;
    estimate: number;
    interval?: Range;
    recovered: boolean;
  }>;
  /** True when every planted share lies inside the bootstrap interval of its estimate. */
  recovered: boolean;
};

const LEVELS = ['cell', 'conversation', 'wording'] as const;
const WORDING_Q = 0.05;
const CELL_LEVELS = ['conversation', 'wording'] as const;

/** Analyses the observations of a pilot. Throws when no run completed. */
export function analysePilot(
  all: readonly PilotObservation[],
  options: PilotAnalysisOptions = {},
): PilotAnalysis {
  const o = { ...PILOT_ANALYSIS_DEFAULTS, ...options };
  const observations = all.filter((observation) => observation.status === 'completed');
  const errored = all.length - observations.length;
  if (observations.length === 0) throw new RangeError('analysePilot: no run completed');

  const pooledResult = varianceComponents(observations.map(toObservation), { levels: [...LEVELS] });
  const boot = bootstrapPooled(observations, o.iterations, o.seed, o.resample);
  const pooledLevels = summarise(pooledResult, boot);
  const pooledIcc = icc(pooledResult).map(({ level, icc: value }) => ({ level, icc: value }));

  // Design effect: clusters are conversations, the unit a run, rho the within-cell conversation correlation.
  const within = pooledLevels.filter((level) => level.level !== 'cell');
  const withinTotal = within.reduce((sum, level) => sum + level.variance, 0);
  const conversationVariance = within.find((level) => level.level === 'conversation')?.variance ?? 0;
  const rho = withinTotal > 0 ? conversationVariance / withinTotal : 0;
  const conversations = groupBy(observations, (row) => `${row.cell}\u0000${row.conversation}`);
  const m = observations.length / conversations.size;

  const repeatVariance = pooledLevels.find((level) => level.level === 'repeat')?.variance ?? 0;
  const repeatsRun = Math.max(
    1,
    Math.round(mean([...groupBy(observations, variantKey).values()].map((rows) => rows.length))),
  );
  const reached = Z95 * Math.sqrt((2 * repeatVariance) / repeatsRun);

  const cells = [...groupBy(observations, (row) => row.cell).entries()].map(([cell, rows]) =>
    analyseCell(cell, rows, o),
  );
  // A wide range alone can be repeat noise: the flag also needs the cell's wording F test to hold after
  // the Benjamini-Hochberg adjustment over the cells that can be tested.
  const tested = cells.filter((cell) => cell.wording.pValue !== undefined);
  const bh = benjaminiHochberg(
    tested.map((cell) => cell.wording.pValue as number),
    WORDING_Q,
  );
  tested.forEach((cell, i) => {
    cell.wording.adjusted = bh.adjusted[i] as number;
    cell.wording.flagged = (cell.wording.maxRange ?? 0) > o.sensitivity && (bh.rejected[i] as boolean);
  });
  const allocation = neymanAllocation({
    sizes: cells.map((cell) => Math.max(cell.suite, cell.conversations)),
    sds: cells.map((cell) => cell.sd),
    total: o.pool,
  });
  cells.forEach((cell, i) => {
    cell.allocation = {
      exact: allocation.exact[i] as number,
      allocated: allocation.allocated[i] as number,
    };
  });

  const perBlock = repeatsForFloor({ variance: repeatVariance, floor: o.floor });
  const cellBlocks = Math.max(1, Math.round(mean(cells.map((cell) => cell.conversations))));
  const perCell = repeatsForFloor({ variance: repeatVariance, floor: o.floor, blocks: cellBlocks });

  const flips = blockFlips(observations);
  const flipping = flips.filter((flip) => flip.flip > 0);
  const passes = observations.filter((row) => row.pass).length;
  const deff = designEffect(Math.max(1, m), Math.min(1, Math.max(0, rho)));
  const effectiveRuns = effectiveSampleSize(
    observations.length,
    Math.max(1, m),
    Math.min(1, Math.max(0, rho)),
  );
  const rate = passes / observations.length;
  // Wilson on the effective number of runs, rounded: clustered runs count for less than independent ones.
  const effectiveN = Math.max(1, Math.round(effectiveRuns));
  const effectivePasses = Math.min(effectiveN, Math.round(rate * effectiveN));

  const analysis: PilotAnalysis = {
    observations: observations.length,
    errored,
    passRate: {
      estimate: rate,
      interval: interval(wilson(effectivePasses, effectiveN)),
      effectiveRuns,
    },
    pooled: {
      method: pooledResult.method,
      balanced: pooledResult.balanced,
      total: pooledResult.total,
      levels: pooledLevels,
      icc: pooledIcc,
      bootstrap: { iterations: o.iterations, seed: o.seed, resample: o.resample, cells: cells.length },
    },
    designEffect: {
      m,
      rho,
      value: deff,
      note:
        withinTotal > 0
          ? 'a run of a conversation counts as 1 / design effect of an independent conversation'
          : 'no spread inside any cell: every run of a cell gives the same outcome',
    },
    allocation: {
      pool: o.pool,
      rule: 'Neyman: n_h proportional to N_h S_h, N_h the suite conversations of the cell, S_h = sqrt(p_h (1 - p_h)); proportional when every S_h is 0',
      strata: cells.map((cell) => ({
        cell: cell.cell,
        suite: cell.suite,
        sd: cell.sd,
        exact: cell.allocation.exact,
        allocated: cell.allocation.allocated,
      })),
    },
    noiseFloor: {
      floor: o.floor,
      variance: repeatVariance,
      perBlock,
      perCell: { blocks: cellBlocks, ...perCell },
      reached,
    },
    flip: {
      blocks: flips.length,
      mean: flips.length > 0 ? mean(flips.map((flip) => flip.flip)) : 0,
      flipping: flipping.length,
      top: [...flipping].sort((a, b) => b.flip - a.flip || order(a, b)).slice(0, 20),
    },
    wording: {
      threshold: o.sensitivity,
      q: WORDING_Q,
      flagged: cells.filter((cell) => cell.wording.flagged).map((cell) => cell.cell),
    },
    cells,
  };
  const planted = plantedCheck(observations, pooledLevels);
  if (planted) analysis.planted = planted;
  return analysis;
}

function analyseCell(
  cell: string,
  rows: PilotObservation[],
  o: Required<PilotAnalysisOptions>,
): CellAnalysis {
  const result = varianceComponents(
    rows.map((row) => ({ value: row.pass, path: [row.conversation, String(row.wording)] })),
    { levels: [...CELL_LEVELS] },
  );
  const values = rows.map((row) => (row.pass ? 1 : 0));
  const passInterval = interval(
    bootstrapCI(values, {
      clusters: rows.map((row) => row.conversation),
      iterations: o.iterations,
      seed: o.seed,
    }),
  );
  const passRate = mean(values);
  const byConversation = groupBy(rows, (row) => row.conversation);
  const ranges: number[] = [];
  for (const conversationRows of byConversation.values()) {
    const byWording = groupBy(conversationRows, (row) => String(row.wording));
    if (byWording.size < 2) continue;
    const rates = [...byWording.values()].map((wordingRows) =>
      mean(wordingRows.map((row) => (row.pass ? 1 : 0))),
    );
    ranges.push(Math.max(...rates) - Math.min(...rates));
  }
  const flips = blockFlips(rows);
  return {
    cell,
    suite: Math.max(...rows.map((row) => row.suite)),
    conversations: byConversation.size,
    variants: groupBy(rows, variantKey).size,
    runs: rows.length,
    passRate,
    passInterval,
    levels: summarise(result),
    icc: icc(result).map(({ level, icc: value }) => ({ level, icc: value })),
    sd: Math.sqrt(passRate * (1 - passRate)),
    allocation: { exact: 0, allocated: 0 },
    wording: {
      conversations: ranges.length,
      ...(ranges.length > 0 ? { maxRange: Math.max(...ranges), meanRange: mean(ranges) } : {}),
      ...(ranges.length > 0 ? { pValue: wordingPValue(result) } : {}),
      flagged: false,
    },
    flip: {
      blocks: flips.length,
      mean: flips.length > 0 ? mean(flips.map((flip) => flip.flip)) : 0,
      max: flips.length > 0 ? Math.max(...flips.map((flip) => flip.flip)) : 0,
      flipping: flips.filter((flip) => flip.flip > 0).length,
    },
  };
}

/**
 * The p value of the wording level of a cell model (conversation > wording > repeat): F = MS_wording /
 * MS_repeat on (df_wording, df_repeat). With no repeat spread, any wording spread is certain (0) and none
 * is no evidence (1).
 */
export function wordingPValue(result: VarianceComponentsResult): number {
  const wording = result.components.find((component) => component.level === 'wording');
  const residual = result.components.at(-1);
  if (!wording || !residual || wording.df <= 0) return 1;
  const msW = wording.meanSquare;
  const msE = residual.df > 0 ? residual.meanSquare : 0;
  if (!(msW > 1e-12)) return 1;
  if (!(msE > 1e-12)) return 0;
  return fSurvival(msW / msE, wording.df, residual.df);
}

/** P(F > f) for an F distribution on (d1, d2) degrees of freedom: I_{d2 / (d2 + d1 f)}(d2 / 2, d1 / 2). */
export function fSurvival(f: number, d1: number, d2: number): number {
  if (!(f > 0)) return 1;
  return Math.min(1, Math.max(0, incompleteBeta(d2 / (d2 + d1 * f), d2 / 2, d1 / 2)));
}

/** The flip rate of every block of every variant that ran at least twice. */
export function blockFlips(rows: readonly PilotObservation[]): BlockFlip[] {
  const flips: BlockFlip[] = [];
  for (const variantRows of groupBy(rows, variantKey).values()) {
    const first = variantRows[0] as PilotObservation;
    const width = Math.max(...variantRows.map((row) => row.blocks.length));
    for (let block = 0; block < width; block += 1) {
      const seen = variantRows.filter((row) => row.blocks.length > block && !row.unscored?.includes(block));
      const r = seen.length;
      if (r < 2) continue;
      const k = seen.filter((row) => row.blocks[block]).length;
      flips.push({
        cell: first.cell,
        conversation: first.conversation,
        wording: first.wording,
        block,
        repeats: r,
        passes: k,
        flip: (2 * k * (r - k)) / (r * (r - 1)),
      });
    }
  }
  return flips;
}

type Boot = { shares: number[][]; variances: number[][] };

/** What the bootstrap draws with replacement: cells, conversations inside each cell, or both in turn. */
export type Resample = 'cells' | 'conversations' | 'both';

/**
 * A cluster bootstrap of the pooled model. `both` (the default) draws cells with replacement, then
 * conversations with replacement inside each drawn cell; `cells` draws whole cells and keeps each as it
 * is; `conversations` keeps the cells and draws conversations inside each. A drawn unit gets a fresh id,
 * so a duplicate is a new group. On simulated designs with planted shares, `both` covered every level at
 * about the nominal rate; `conversations` missed the cell level often (it treats cells as fixed while the
 * model treats them as random) and `cells` missed with few cells.
 */
function bootstrapPooled(
  rows: readonly PilotObservation[],
  iterations: number,
  seed: number,
  resample: Resample,
): Boot {
  const cells = [...groupBy(rows, (row) => row.cell).values()].map((cellRows) => [
    ...groupBy(cellRows, (row) => row.conversation).values(),
  ]);
  const rng = mulberry32(seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rng() * list.length)] as T;
  const levels = LEVELS.length + 1;
  const shares: number[][] = Array.from({ length: levels }, () => []);
  const variances: number[][] = Array.from({ length: levels }, () => []);
  for (let it = 0; it < iterations; it += 1) {
    const drawn: Observation[] = [];
    for (let c = 0; c < cells.length; c += 1) {
      const conversations = resample === 'conversations' ? (cells[c] as PilotObservation[][]) : pick(cells);
      for (let j = 0; j < conversations.length; j += 1) {
        const picked = resample === 'cells' ? (conversations[j] as PilotObservation[]) : pick(conversations);
        for (const row of picked) {
          drawn.push({ value: row.pass, path: [String(c), String(j), String(row.wording)] });
        }
      }
    }
    const result = varianceComponents(drawn, { levels: [...LEVELS] });
    result.components.forEach((component, i) => {
      (shares[i] as number[]).push(component.share);
      (variances[i] as number[]).push(component.variance);
    });
  }
  return { shares, variances };
}

function summarise(result: VarianceComponentsResult, boot?: Boot): LevelSummary[] {
  return result.components.map((component, i) => ({
    level: component.level,
    groups: component.groups,
    df: component.df,
    variance: component.variance,
    share: component.share,
    estimable: component.estimable,
    ...(boot
      ? {
          shareInterval: percentile(boot.shares[i] as number[]),
          varianceInterval: percentile(boot.variances[i] as number[]),
        }
      : {}),
  }));
}

function percentile(values: readonly number[]): Range {
  if (values.length === 0) return { lower: Number.NaN, upper: Number.NaN };
  return { lower: quantile(values, 0.025), upper: quantile(values, 0.975) };
}

/**
 * The planted variance of a control agent, for this design: the between levels from the nested model on
 * each run's stated failure chance (constant across the repeats of a variant), the repeat level the mean
 * of p (1 - p). Exact for the binary noise when p (1 - p) is the same in every group, close otherwise.
 */
function plantedCheck(
  rows: readonly PilotObservation[],
  estimates: readonly LevelSummary[],
): PlantedCheck | undefined {
  if (rows.length === 0 || rows.some((row) => row.planted === undefined)) return undefined;
  const truth = varianceComponents(
    rows.map((row) => ({
      value: 1 - (row.planted as number),
      path: [row.cell, row.conversation, String(row.wording)],
    })),
    { levels: [...LEVELS] },
  );
  const between = truth.components.slice(0, -1).map((component) => component.variance);
  const repeat = mean(rows.map((row) => (row.planted as number) * (1 - (row.planted as number))));
  const variances = [...between, repeat];
  const total = variances.reduce((sum, value) => sum + value, 0);
  const levels = [...LEVELS, 'repeat'].map((level, i) => {
    const variance = variances[i] as number;
    const share = total > 0 ? variance / total : 0;
    const estimate = estimates[i];
    const range = estimate?.shareInterval;
    const recovered = range !== undefined && share >= range.lower - 1e-12 && share <= range.upper + 1e-12;
    return {
      level,
      variance,
      share,
      estimate: estimate?.share ?? Number.NaN,
      ...(range ? { interval: range } : {}),
      recovered,
    };
  });
  const model = rows.find((row) => row.model)?.model;
  return { ...(model ? { model } : {}), levels, recovered: levels.every((level) => level.recovered) };
}

function toObservation(row: PilotObservation): Observation {
  return { value: row.pass, path: [row.cell, row.conversation, String(row.wording)] };
}

function variantKey(row: PilotObservation): string {
  return `${row.cell}\u0000${row.conversation}\u0000${row.wording}`;
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const held = groups.get(k);
    if (held) held.push(row);
    else groups.set(k, [row]);
  }
  return groups;
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function interval(value: { lower: number; upper: number }): Range {
  return { lower: value.lower, upper: value.upper };
}

function order(a: BlockFlip, b: BlockFlip): number {
  return a.cell < b.cell
    ? -1
    : a.cell > b.cell
      ? 1
      : a.conversation < b.conversation
        ? -1
        : a.conversation > b.conversation
          ? 1
          : a.wording - b.wording || a.block - b.block;
}
