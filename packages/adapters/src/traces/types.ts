import type { Observed } from '@driftbench/core';

/**
 * A production trace read into driftbench's run shape: one conversation, its user turns in order, and what
 * the agent did in each, as the Observed of a block. Every reader (OpenTelemetry, a platform export, a
 * recorded session) produces this, so drafting specs and monitoring never depend on where a trace came from.
 */

export const TRACE_SOURCES = ['otel', 'nexus', 'claude-code'] as const;
export type TraceSource = (typeof TRACE_SOURCES)[number];

export type TraceTurn = {
  /** What the user sent: the stimulus of the block. */
  user: string;
  /** When the turn started, ISO 8601, when the source says. */
  startedAt?: string;
  observed: Observed;
};

export type Trace = {
  /** The conversation id the source gives, else the trace id, else the file and its position. */
  id: string;
  source: TraceSource;
  /** When the first turn started, ISO 8601, when the source says. */
  startedAt?: string;
  /** The model that answered, as the source names it, when it names one. */
  model?: string;
  turns: TraceTurn[];
  /** What the reader noticed and could not map: a span with no turn, a call with no result. */
  issues: string[];
};

/** Prices per million tokens, by model, for sources that report tokens but no cost. */
export type PriceTable = Readonly<Record<string, { input: number; output: number }>>;

/** The USD cost of tokens at a model's price, rounded to a micro-dollar; undefined when the model is unpriced. */
export function priced(
  prices: PriceTable | undefined,
  model: string | undefined,
  inputTokens: number,
  outputTokens: number,
): number | undefined {
  const price = model === undefined ? undefined : prices?.[model];
  if (price === undefined) return undefined;
  return Math.round(inputTokens * price.input + outputTokens * price.output) / 1e6;
}
