import type { Trace } from '@agent-nexus/driftbench-adapters';
import { mean, sampleVariance } from '@agent-nexus/driftbench-stats';
import type { SeriesPoint } from './monitor';

/**
 * Production traces as a monitored series: conversations fall into fixed time windows by their start, and
 * each window is one point, the mean of a metric over its conversations with the standard error of that
 * mean. The detectors of `driftbench monitor` then read the windows as they read campaigns.
 */

export const TRACE_METRICS = ['latency', 'cost', 'tokens', 'tool_calls', 'tool_errors', 'turns'] as const;
export type TraceMetric = (typeof TRACE_METRICS)[number];

/** A window length: a whole number and a unit, s, m, h or d. */
export function parseWindow(text: string): number | undefined {
  const match = /^(\d+)(s|m|h|d)$/.exec(text.trim());
  if (!match) return undefined;
  const size = Number(match[1]);
  const unit = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as 's' | 'm' | 'h' | 'd'];
  return size > 0 ? size * unit : undefined;
}

/**
 * The value of one conversation: mean turn latency in ms, total cost in USD (only when every turn has one),
 * total tokens (only when the source counts them), tool calls per turn, number of turns. tool_errors is a
 * share over the calls of a window, so it has no per-conversation value here.
 */
export function conversationValue(
  trace: Trace,
  metric: Exclude<TraceMetric, 'tool_errors'>,
): number | undefined {
  const turns = trace.turns;
  if (turns.length === 0) return undefined;
  if (metric === 'turns') return turns.length;
  if (metric === 'latency') return mean(turns.map((turn) => turn.observed.latencyMs));
  if (metric === 'tool_calls')
    return turns.reduce((sum, turn) => sum + turn.observed.toolCalls.length, 0) / turns.length;
  if (metric === 'cost') {
    if (!turns.every((turn) => turn.observed.cost.usd !== undefined)) return undefined;
    return turns.reduce((sum, turn) => sum + (turn.observed.cost.usd ?? 0), 0);
  }
  const counted = turns.filter(
    (turn) => turn.observed.cost.inputTokens !== undefined || turn.observed.cost.outputTokens !== undefined,
  );
  if (counted.length === 0) return undefined;
  return counted.reduce(
    (sum, turn) => sum + (turn.observed.cost.inputTokens ?? 0) + (turn.observed.cost.outputTokens ?? 0),
    0,
  );
}

export type TraceSeries = {
  points: SeriesPoint[];
  /** Windows with no conversation, or none that has the metric: left out of the series. */
  skipped: string[];
  /** Conversations with no start time: no window can hold them. */
  undated: number;
  /** Conversations whose source does not give the metric (no cost, no tokens). */
  unmeasured: number;
};

/**
 * The series of windows of `windowMs`, from the window of the earliest conversation to the window of the
 * latest. A point's `campaignId` and `createdAt` are the window's start, `runs` its conversations.
 */
export function traceSeries(traces: readonly Trace[], metric: TraceMetric, windowMs: number): TraceSeries {
  let undated = 0;
  let unmeasured = 0;
  const dated: Array<{ trace: Trace; at: number }> = [];
  for (const trace of traces) {
    const at = trace.startedAt === undefined ? Number.NaN : Date.parse(trace.startedAt);
    if (Number.isNaN(at)) undated += 1;
    else dated.push({ trace, at });
  }
  if (dated.length === 0) return { points: [], skipped: [], undated, unmeasured };
  const first = Math.floor(Math.min(...dated.map((item) => item.at)) / windowMs);
  const last = Math.floor(Math.max(...dated.map((item) => item.at)) / windowMs);
  const windows = new Map<number, Trace[]>();
  for (const item of dated) {
    const index = Math.floor(item.at / windowMs);
    windows.set(index, [...(windows.get(index) ?? []), item.trace]);
  }

  const points: SeriesPoint[] = [];
  const skipped: string[] = [];
  for (let window = first; window <= last; window += 1) {
    const label = new Date(window * windowMs).toISOString();
    const members = windows.get(window) ?? [];
    let value: number | undefined;
    let se = 0;
    let runs = members.length;
    if (metric === 'tool_errors') {
      const calls = members.flatMap((trace) => trace.turns.flatMap((turn) => turn.observed.toolCalls));
      if (calls.length > 0) {
        value = calls.filter((call) => call.error !== undefined).length / calls.length;
        se = Math.sqrt((value * (1 - value)) / calls.length);
      }
    } else {
      const values: number[] = [];
      for (const trace of members) {
        const one = conversationValue(trace, metric);
        if (one === undefined) unmeasured += 1;
        else values.push(one);
      }
      runs = values.length;
      if (values.length > 0) {
        value = mean(values);
        se = values.length > 1 ? Math.sqrt(sampleVariance(values) / values.length) : 0;
      }
    }
    if (value === undefined) {
      skipped.push(label);
      continue;
    }
    points.push({ index: points.length, campaignId: label, createdAt: label, runs, value, se });
  }
  return { points, skipped, undated, unmeasured };
}
