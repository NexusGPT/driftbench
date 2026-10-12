import type { DriftClass, RunMode, RunResult, TargetRef } from '@driftbench/core';
import { passAtK, passK, unreliability } from '@driftbench/stats';
import { blockScore, type CampaignData, deviationOf, groupBy, lineKey, runPassed, specOfRun } from './data';
import { clustered, type Estimate, median, type Rate, rate } from './estimate';

/** pass^k or pass@k at one k, with the Wilson bounds of the per-run rate raised the same way. */
export type AtK = { k: number; value: number; lower: number; upper: number };

/** The succession of the runs of one line: drift per run and where it starts. */
export type SuccessionSummary = {
  runs: number;
  /** Drifting blocks per run; the mean, a run (one conversation) being one cluster. */
  driftCount?: Estimate;
  /** Share of blocks drifting, blocks pooled with the run as the cluster. */
  driftRate?: Estimate;
  /** Runs where every block passes (min over blocks), Wilson. */
  allBlocksPass?: Rate;
  /** How many runs first drift at each block; `none` for runs that never drift. */
  firstDrift: Array<{ block: number | 'none'; runs: number }>;
  /** Mean longest stretch of passing blocks. */
  longestClean?: number;
  /** Blocks carrying each drift class, over every run of the line. */
  classes: Partial<Record<DriftClass, number>>;
};

/** The recovery of the perturbed runs of one line that measured it. */
export type RecoverySummary = {
  /** Runs whose perturbation sets `recovery`, so the runner measured it. */
  measured: number;
  labels: { immediate: number; late: number; never: number };
  /** Runs labelled immediate, Wilson. */
  immediate?: Rate;
  /** Runs that came back at all (immediate or late), Wilson. */
  recovered?: Rate;
  /** Median blocks to recover, over the runs that came back. */
  medianTurns?: number;
  /** Blocks after the injection that fail what passed in the F reference; the mean, a run being a cluster. */
  collateral?: Estimate;
  /** Runs with no forbidden or unnamed consequential act during the detour, Wilson. */
  safeAction?: Rate;
  /** Runs that asked before the first consequential act, Wilson. */
  clarified?: Rate;
};

/** Reliability of one spec on one target in one mode (one perturbation in P), over its repeats. */
export type ReliabilityLine = {
  specId: string;
  specHash: string;
  target: TargetRef;
  mode: RunMode;
  perturbationId?: string;
  deviation?: string;
  runs: number;
  /** Runs that completed; the others failed or were stopped and count as failing. */
  completed: number;
  /** Runs that pass (completed, every block passed, end state matched), Wilson over the repeats. */
  passRate: Rate;
  /** pass^k for k = 1 .. runs: every one of k repeats passes. */
  passK: AtK[];
  /** pass@k for k = 1 .. runs: at least one of k repeats passes. */
  passAtK: AtK[];
  /** p90 minus p10 of the block score (share of passing blocks) across repeats, with a bootstrap over runs. */
  unreliability: Estimate;
  /** Share of passing blocks, blocks pooled with the run (one conversation) as the cluster. */
  blockAccuracy?: Estimate;
  succession: SuccessionSummary;
  recovery?: RecoverySummary;
};

/** Reliability per mode over every line: runs, blocks and the per-line pass^k at the line's repeats. */
export type ModeReliability = {
  mode: RunMode;
  lines: number;
  runs: number;
  /** Runs that pass; the runs of one line (the repeats of one golden) form one cluster. */
  runPass?: Estimate;
  /** Share of passing blocks; one run (one conversation) is one cluster. */
  blockAccuracy?: Estimate;
  /** Mean over the lines of pass^k at the smallest repeat count of the mode. */
  passK?: { k: number; mean: number };
  /** Runs where every block passes, the runs of a line one cluster. */
  allBlocksPass?: Estimate;
  /** Mean drifting blocks per run, a run being one cluster. */
  driftCount?: Estimate;
  classes: Partial<Record<DriftClass, number>>;
};

/** P4.2: reliability per spec line, from the stored runs of a campaign. */
export function reliability(data: CampaignData): ReliabilityLine[] {
  return [...groupBy(data.runs, lineKey).values()].map((runs) => lineOf(data, runs));
}

function lineOf(data: CampaignData, runs: RunResult[]): ReliabilityLine {
  const first = runs[0] as RunResult;
  const n = runs.length;
  const c = runs.filter(runPassed).length;
  const passRate = rate(c, n) as Rate;
  const scores = runs.map(blockScore);
  const bootUnrel = clustered(
    scores,
    runs.map((_, index) => index),
    { statistic: (values) => unreliability(values) },
  ) as Estimate;
  const deviation = deviationOf(specOfRun(data, first), first);
  const recovery = recoveryOf(runs);
  return {
    specId: first.specId,
    specHash: first.specHash,
    target: first.target,
    mode: first.mode,
    ...(first.perturbationId === undefined ? {} : { perturbationId: first.perturbationId }),
    ...(deviation === undefined ? {} : { deviation }),
    runs: n,
    completed: runs.filter((run) => run.status === 'completed').length,
    passRate,
    passK: atK(c, n, passRate, (p, k) => p ** k, passK),
    passAtK: atK(c, n, passRate, (p, k) => 1 - (1 - p) ** k, passAtK),
    unreliability: { ...bootUnrel, estimate: unreliability(scores) },
    ...optional('blockAccuracy', blockAccuracy(runs)),
    succession: successionOf(runs),
    ...(recovery ? { recovery } : {}),
  };
}

function atK(
  c: number,
  n: number,
  interval: Rate,
  raise: (p: number, k: number) => number,
  exact: (c: number, n: number, k: number) => number,
): AtK[] {
  return atKRows(c, n, interval.lower, interval.upper, raise, exact);
}

/**
 * One row per k. The value is the exact estimate; its interval is the per-run rate's Wilson bounds raised to k (or
 * the pass@k form), widened where needed so that the interval always contains the value. The raised bounds alone do
 * not contain the exact estimate for every count, since the exact pass^k is below the plug-in rate raised to k.
 */
export function atKRows(
  c: number,
  n: number,
  lower: number,
  upper: number,
  raise: (p: number, k: number) => number,
  exact: (c: number, n: number, k: number) => number,
): AtK[] {
  const out: AtK[] = [];
  for (let k = 1; k <= n; k += 1) {
    const value = exact(c, n, k);
    out.push({
      k,
      value,
      lower: Math.min(raise(lower, k), value),
      upper: Math.max(raise(upper, k), value),
    });
  }
  return out;
}

/** Share of passing blocks over the runs, one run being one cluster. */
export function blockAccuracy(runs: readonly RunResult[]): Estimate | undefined {
  const values: number[] = [];
  const clusters: number[] = [];
  runs.forEach((run, index) => {
    for (const block of run.blocks) {
      values.push(block.pass ? 1 : 0);
      clusters.push(index);
    }
  });
  return clustered(values, clusters, { rate: true });
}

export function successionOf(runs: readonly RunResult[]): SuccessionSummary {
  const ids = runs.map((_, index) => index);
  const driftValues: number[] = [];
  const driftClusters: number[] = [];
  const classes: Partial<Record<DriftClass, number>> = {};
  const first = new Map<number | 'none', number>();
  runs.forEach((run, index) => {
    for (const block of run.blocks) {
      driftValues.push(block.drift.length > 0 ? 1 : 0);
      driftClusters.push(index);
      for (const cls of block.drift) classes[cls] = (classes[cls] ?? 0) + 1;
    }
    const at = run.succession.firstDriftBlock ?? 'none';
    first.set(at, (first.get(at) ?? 0) + 1);
  });
  const firstDrift = [...first.entries()]
    .sort(([a], [b]) => (a === 'none' ? 1 : b === 'none' ? -1 : a - b))
    .map(([block, count]) => ({ block, runs: count }));
  const allBlocksPass = rate(runs.filter((run) => run.succession.minOverBlocks).length, runs.length);
  return {
    runs: runs.length,
    ...optional(
      'driftCount',
      clustered(
        runs.map((run) => run.succession.driftCount),
        ids,
      ),
    ),
    ...optional('driftRate', clustered(driftValues, driftClusters, { rate: true })),
    ...optional('allBlocksPass', allBlocksPass),
    firstDrift,
    ...(runs.length === 0
      ? {}
      : {
          longestClean: runs.reduce((sum, run) => sum + run.succession.longestClean, 0) / runs.length,
        }),
    classes,
  };
}

/** The recovery summary of the runs that carry a recovery record; undefined when none does. */
export function recoveryOf(runs: readonly RunResult[]): RecoverySummary | undefined {
  const measured = runs.flatMap((run) => (run.recovery ? [run.recovery] : []));
  if (measured.length === 0) return undefined;
  const labels = { immediate: 0, late: 0, never: 0 };
  for (const entry of measured) labels[entry.label] += 1;
  const turns = measured.flatMap((entry) =>
    entry.label !== 'never' && entry.turnsToRecover !== undefined ? [entry.turnsToRecover] : [],
  );
  const safe = measured.filter((entry) => entry.safeAction !== undefined);
  const clarified = measured.filter((entry) => entry.clarified !== undefined);
  const turnsMedian = median(turns);
  return {
    measured: measured.length,
    labels,
    ...optional('immediate', rate(labels.immediate, measured.length)),
    ...optional('recovered', rate(labels.immediate + labels.late, measured.length)),
    ...(turnsMedian === undefined ? {} : { medianTurns: turnsMedian }),
    ...optional(
      'collateral',
      clustered(
        measured.map((entry) => entry.collateral),
        measured.map((_, index) => index),
      ),
    ),
    ...optional('safeAction', rate(safe.filter((entry) => entry.safeAction).length, safe.length)),
    ...optional('clarified', rate(clarified.filter((entry) => entry.clarified).length, clarified.length)),
  };
}

/** Reliability per mode, over every line of the mode. */
export function modeReliability(data: CampaignData, lines: readonly ReliabilityLine[]): ModeReliability[] {
  const modes = [...new Set(data.runs.map((run) => run.mode))];
  return modes.map((mode) => {
    const runs = data.runs.filter((run) => run.mode === mode);
    const modeLines = lines.filter((line) => line.mode === mode);
    const lineOfRun = runs.map((run) => lineKey(run));
    const minRepeats = Math.min(...modeLines.map((line) => line.runs));
    const k = Math.min(5, minRepeats);
    const passKValues = modeLines.map((line) => line.passK.find((entry) => entry.k === k)?.value ?? 0);
    const succession = successionOf(runs);
    return {
      mode,
      lines: modeLines.length,
      runs: runs.length,
      ...optional(
        'runPass',
        clustered(
          runs.map((run) => (runPassed(run) ? 1 : 0)),
          lineOfRun,
          { rate: true },
        ),
      ),
      ...optional('blockAccuracy', blockAccuracy(runs)),
      ...(modeLines.length === 0
        ? {}
        : { passK: { k, mean: passKValues.reduce((a, b) => a + b, 0) / passKValues.length } }),
      ...optional(
        'allBlocksPass',
        clustered(
          runs.map((run) => (run.succession.minOverBlocks ? 1 : 0)),
          lineOfRun,
          { rate: true },
        ),
      ),
      ...optional(
        'driftCount',
        clustered(
          runs.map((run) => run.succession.driftCount),
          runs.map((_, index) => index),
        ),
      ),
      classes: succession.classes,
    };
  });
}

/** `{ [key]: value }` when the value is defined, else `{}`: keeps optional keys absent, never undefined. */
export function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}
