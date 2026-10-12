import {
  type CompoundingIndex,
  type Count,
  compoundingIndex,
  type DriftClass,
  type RunMode,
  type RunResult,
  type Verdict,
} from '@driftbench/core';
import { bootstrapCI } from '@driftbench/stats';
import { type CompareResult, compareCampaigns } from './compare';
import {
  blocksWithSpec,
  type CampaignData,
  deviationOf,
  groupBy,
  runPassed,
  showTarget,
  specOfRun,
  stimulusText,
} from './data';
import { clustered, type Estimate, type Rate, rate } from './estimate';
import type { PilotReport } from './pilot';
import {
  type ModeReliability,
  modeReliability,
  optional,
  type RecoverySummary,
  type ReliabilityLine,
  recoveryOf,
  reliability,
  successionOf,
} from './reliability';
import { type Spread, spread } from './spread';

export type ScorecardOptions = {
  /** A baseline campaign: the scorecard then carries the compare diff and reads cells against it. */
  baseline?: CampaignData;
  /** The non-inferiority margin, as a proportion. Default 0.02 (2 points). */
  margin?: number;
  /** Passed to the compare diff: gating criteria on fewer goldens are underpowered. Default MIN_GOLDENS. */
  minGoldens?: number;
  /** Passed to the compare diff: underpowered criteria gate too. */
  strict?: boolean;
  /** A pilot report to render beside the spread view. */
  pilot?: PilotReport;
  /** Dimensions of the generated cell that name a spread cell. */
  by?: readonly string[];
  /** The mode the spread view reads. Default F when the campaign ran it. */
  spreadMode?: RunMode;
  /** Runs shown in the drilldown, failing runs first. Default 200. */
  maxRuns?: number;
};

export type ToolCall = { label: string; input?: unknown; output?: unknown; error?: string };

export type BlockDetail = {
  index: number;
  /** The spec block this block stands for; absent for a block a driver injected. */
  specBlock?: number;
  injected: boolean;
  stimulus?: string;
  expectedStage?: string;
  observedStage?: string;
  pass: boolean;
  drift: DriftClass[];
  text: string;
  toolCalls: ToolCall[];
  verdicts: Verdict[];
};

export type RunDetail = {
  runId: string;
  specId: string;
  title?: string;
  target: string;
  mode: RunMode;
  repeat: number;
  perturbationId?: string;
  deviation?: string;
  status: RunResult['status'];
  error?: string;
  pass: boolean;
  endState?: RunResult['endState'];
  succession: RunResult['succession'];
  recovery?: RunResult['recovery'];
  blocks: BlockDetail[];
};

export type ToolAccuracy = {
  /** Calls matched to an expected call (per label, the smaller of the two counts). */
  matched: number;
  expected: number;
  observed: number;
  precision?: Estimate;
  recall?: Estimate;
  f1?: Estimate;
};

export type Scorecard = {
  campaign: {
    campaignId: string;
    createdAt: string;
    targets: string[];
    modes: RunMode[];
    repeats: Record<RunMode, number>;
    budgetUsd: number;
    specs: number;
    runs: number;
    passing: number;
    failing: number;
    /** Runs that did not complete: failed or stopped. */
    broken: number;
  };
  modes: ModeReliability[];
  lines: ReliabilityLine[];
  /** Runs whose end state was compared and matched, Wilson. */
  endState?: Rate;
  tools: ToolAccuracy;
  cost: { totalUsd: number; perBlockUsd?: Estimate; latencyMsPerBlock?: Estimate };
  compounding: CompoundingIndex;
  /** Recovery over every perturbed run, then per deviation class. */
  recovery?: RecoverySummary;
  recoveryByClass: Array<{ deviation: string; summary: RecoverySummary }>;
  /** Blocks carrying each drift class, over every run. */
  drift: Partial<Record<DriftClass, number>>;
  spread: Spread;
  compare?: CompareResult;
  pilot?: PilotReport;
  drilldown: RunDetail[];
  /** Runs left out of the drilldown by maxRuns. */
  omittedRuns: number;
};

/** P4.4: everything the scorecard shows, computed from the stored campaign. Deterministic: bootstraps are seeded. */
export function buildScorecard(data: CampaignData, options: ScorecardOptions = {}): Scorecard {
  const margin = options.margin ?? 0.02;
  const lines = reliability(data);
  const runs = data.runs;
  const compared = runs.filter((run) => run.endState !== undefined);
  const endState = rate(compared.filter((run) => run.endState?.match).length, compared.length);
  const perturbed = runs.filter((run) => run.mode === 'P');
  const recovery = recoveryOf(perturbed);
  const byClass = groupBy(
    perturbed.filter((run) => run.recovery),
    (run) => deviationOf(specOfRun(data, run), run) ?? 'unknown',
  );
  const recoveryByClass = [...byClass.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))
    .map(([deviation, group]) => ({ deviation, summary: recoveryOf(group) as RecoverySummary }));
  const maxRuns = options.maxRuns ?? 200;
  const ordered = [...runs.filter((run) => !runPassed(run)), ...runs.filter(runPassed)];
  const shown = ordered.slice(0, maxRuns);
  const repeats = data.campaign.repeats;
  return {
    campaign: {
      campaignId: data.campaign.campaignId,
      createdAt: data.campaign.createdAt,
      targets: [...new Set(runs.map((run) => showTarget(run.target)))],
      modes: [...data.campaign.modes],
      repeats: { T: repeats.T, F: repeats.F, P: repeats.P },
      budgetUsd: data.campaign.budgetUsd,
      specs: data.campaign.specs.length,
      runs: runs.length,
      passing: runs.filter(runPassed).length,
      failing: runs.filter((run) => run.status === 'completed' && !runPassed(run)).length,
      broken: runs.filter((run) => run.status !== 'completed').length,
    },
    modes: modeReliability(data, lines),
    lines,
    ...optional('endState', endState),
    tools: toolAccuracy(data),
    cost: costOf(runs),
    compounding: compoundingIndex(runs, {
      interval: (values, clusters) => bootstrapCI(values, { clusters, seed: 1 }),
    }),
    ...optional('recovery', recovery),
    recoveryByClass,
    drift: successionOf(runs).classes,
    spread: spread(data, {
      margin,
      ...optional('mode', options.spreadMode),
      ...optional('by', options.by),
      ...optional('baseline', options.baseline),
    }),
    ...(options.baseline
      ? {
          compare: compareCampaigns(options.baseline, data, {
            margin,
            ...optional('minGoldens', options.minGoldens),
            ...optional('strict', options.strict),
          }),
        }
      : {}),
    ...optional('pilot', options.pilot),
    drilldown: shown.map((run) => runDetailOf(data, run)),
    omittedRuns: runs.length - shown.length,
  };
}

/** The drilldown of one run: its blocks with stimulus, reply, tool calls and verdicts. */
export function runDetailOf(data: CampaignData, run: RunResult): RunDetail {
  const spec = specOfRun(data, run);
  const deviation = deviationOf(spec, run);
  const perturbation = spec?.perturbations?.find((entry) => entry.id === run.perturbationId);
  return {
    runId: run.runId,
    specId: run.specId,
    ...optional('title', spec?.title),
    target: showTarget(run.target),
    mode: run.mode,
    repeat: run.repeat,
    ...optional('perturbationId', run.perturbationId),
    ...optional('deviation', deviation),
    status: run.status,
    ...optional('error', run.error),
    pass: runPassed(run),
    ...optional('endState', run.endState),
    succession: run.succession,
    ...optional('recovery', run.recovery),
    blocks: blocksWithSpec(run, spec).map(({ result, specBlock }) => {
      const injectedText =
        specBlock === undefined && perturbation
          ? `[${perturbation.class}] ${perturbation.user ?? perturbation.burst?.join('\n') ?? '(world change)'}`
          : undefined;
      const stimulus = specBlock === undefined ? injectedText : stimulusText(spec, specBlock);
      const expectedStage =
        specBlock === undefined ? perturbation?.expect?.stage : spec?.blocks[specBlock]?.expect?.stage;
      return {
        index: result.index,
        ...optional('specBlock', specBlock),
        injected: result.injected === true,
        ...optional('stimulus', stimulus),
        ...optional('expectedStage', expectedStage),
        ...optional('observedStage', result.stageObserved),
        pass: result.pass,
        drift: [...result.drift],
        text: result.observed.text,
        toolCalls: result.observed.toolCalls.map((call) => ({
          label: call.label,
          ...(call.input === undefined ? {} : { input: call.input }),
          ...(call.output === undefined ? {} : { output: call.output }),
          ...optional('error', call.error),
        })),
        verdicts: result.verdicts,
      };
    }),
  };
}

/** The expected number of calls for a tool expectation: the count, else its min, else 1. */
function expectedCalls(count: Count | undefined): number {
  if (count === undefined) return 1;
  if (typeof count === 'number') return count;
  if (count.max === 0) return 0;
  return count.min ?? 1;
}

/**
 * Tool precision, recall and F1 over the blocks whose spec lists its expected tools: a call is matched when
 * its label is expected (per label, the smaller of the expected and observed counts). Precision divides by
 * every call of those blocks, recall by every expected call. One run is one cluster of the interval.
 */
export function toolAccuracy(data: CampaignData): ToolAccuracy {
  const perRun: Array<{ matched: number; expected: number; observed: number }> = [];
  for (const run of data.runs) {
    const spec = specOfRun(data, run);
    const sums = { matched: 0, expected: 0, observed: 0 };
    let counted = false;
    for (const { result, specBlock } of blocksWithSpec(run, spec)) {
      if (specBlock === undefined) continue;
      const tools = spec?.blocks[specBlock]?.expect?.tools;
      if (!tools) continue;
      counted = true;
      const expected = new Map<string, number>();
      for (const tool of tools)
        expected.set(tool.label, (expected.get(tool.label) ?? 0) + expectedCalls(tool.count));
      const observed = new Map<string, number>();
      for (const call of result.observed.toolCalls)
        observed.set(call.label, (observed.get(call.label) ?? 0) + 1);
      for (const [label, n] of expected) sums.matched += Math.min(n, observed.get(label) ?? 0);
      sums.expected += [...expected.values()].reduce((a, b) => a + b, 0);
      sums.observed += result.observed.toolCalls.length;
    }
    if (counted) perRun.push(sums);
  }
  const total = perRun.reduce(
    (acc, entry) => ({
      matched: acc.matched + entry.matched,
      expected: acc.expected + entry.expected,
      observed: acc.observed + entry.observed,
    }),
    { matched: 0, expected: 0, observed: 0 },
  );
  const indices = perRun.map((_, index) => index);
  const ratio =
    (pick: (sums: { matched: number; expected: number; observed: number }) => number) =>
    (drawn: readonly number[]) => {
      let num = 0;
      let den = 0;
      for (const index of drawn) {
        const entry = perRun[index] as (typeof perRun)[number];
        num += entry.matched;
        den += pick(entry);
      }
      return den === 0 ? 1 : num / den;
    };
  const f1 = (drawn: readonly number[]) => {
    const p = ratio((entry) => entry.observed)(drawn);
    const r = ratio((entry) => entry.expected)(drawn);
    return p + r === 0 ? 0 : (2 * p * r) / (p + r);
  };
  return {
    ...total,
    ...optional(
      'precision',
      total.observed === 0
        ? undefined
        : clustered(indices, indices, { statistic: ratio((entry) => entry.observed) }),
    ),
    ...optional(
      'recall',
      total.expected === 0
        ? undefined
        : clustered(indices, indices, { statistic: ratio((entry) => entry.expected) }),
    ),
    ...optional(
      'f1',
      total.observed === 0 || total.expected === 0
        ? undefined
        : clustered(indices, indices, { statistic: f1 }),
    ),
  };
}

function costOf(runs: readonly RunResult[]): Scorecard['cost'] {
  const usd: number[] = [];
  const usdClusters: number[] = [];
  const latency: number[] = [];
  const latencyClusters: number[] = [];
  runs.forEach((run, index) => {
    if (run.cacheHit) return;
    for (const block of run.blocks) {
      const observed = block.observed;
      const segmentUsd = observed.segments.flatMap((segment) =>
        segment.cost?.usd === undefined ? [] : [segment.cost.usd],
      );
      const cost =
        observed.cost.usd ?? (segmentUsd.length === 0 ? undefined : segmentUsd.reduce((a, b) => a + b, 0));
      if (cost !== undefined) {
        usd.push(cost);
        usdClusters.push(index);
      }
      latency.push(observed.latencyMs);
      latencyClusters.push(index);
    }
  });
  return {
    totalUsd: runs.filter((run) => !run.cacheHit).reduce((sum, run) => sum + run.cost, 0),
    ...optional('perBlockUsd', clustered(usd, usdClusters)),
    ...optional('latencyMsPerBlock', clustered(latency, latencyClusters)),
  };
}
