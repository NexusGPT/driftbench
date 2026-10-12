import type { TraceObservation } from './types';

/**
 * Totals over a line and everything nested under it. Cost and tokens count only the chat lines that carry
 * them, so a total of zero means no line gave a figure. `latencyMs` is the time from the earliest start to the
 * latest end of the subtree.
 */
export type SubtreeTotals = {
  usd: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  spans: number;
};

export type Rollup = {
  /** Totals of each observation's subtree, by observation id. */
  totals: Map<string, SubtreeTotals>;
  /**
   * The slowest path: from the root that finishes last, the child that finishes last at each step, down to a
   * leaf. It is the chain the trace waited on.
   */
  slowestPath: string[];
};

const ms = (iso: string) => Date.parse(iso);

/** Rolls the observations up into subtree totals and finds the slowest path. A cycle in the parent links is cut. */
export function rollUp(observations: readonly TraceObservation[]): Rollup {
  const byId = new Map(observations.map((entry) => [entry.id, entry]));
  const children = new Map<string, TraceObservation[]>();
  for (const entry of observations) {
    if (entry.parentId === undefined || !byId.has(entry.parentId)) continue;
    children.set(entry.parentId, [...(children.get(entry.parentId) ?? []), entry]);
  }
  const roots = observations.filter((entry) => entry.parentId === undefined || !byId.has(entry.parentId));

  const totals = new Map<string, SubtreeTotals>();
  const bounds = new Map<string, { first: number; last: number }>();
  const visit = (entry: TraceObservation, seen: Set<string>): SubtreeTotals => {
    const known = totals.get(entry.id);
    if (known) return known;
    seen.add(entry.id);
    let usd = entry.usd ?? 0;
    let inputTokens = entry.usage?.inputTokens ?? 0;
    let outputTokens = entry.usage?.outputTokens ?? 0;
    let spans = 1;
    let first = ms(entry.start);
    let last = ms(entry.end);
    for (const child of children.get(entry.id) ?? []) {
      if (seen.has(child.id)) continue;
      const below = visit(child, seen);
      usd += below.usd;
      inputTokens += below.inputTokens;
      outputTokens += below.outputTokens;
      spans += below.spans;
      const span = bounds.get(child.id);
      if (span) {
        first = Math.min(first, span.first);
        last = Math.max(last, span.last);
      }
    }
    const result = { usd, inputTokens, outputTokens, latencyMs: last - first, spans };
    bounds.set(entry.id, { first, last });
    totals.set(entry.id, result);
    return result;
  };
  for (const root of roots) visit(root, new Set());

  const endOf = (entry: TraceObservation) => ms(entry.end);
  const latestFirst = (a: TraceObservation, b: TraceObservation) => endOf(b) - endOf(a);
  const slowestPath: string[] = [];
  let step = [...roots].sort(latestFirst)[0];
  const onPath = new Set<string>();
  while (step && !onPath.has(step.id)) {
    slowestPath.push(step.id);
    onPath.add(step.id);
    step = [...(children.get(step.id) ?? [])].sort(latestFirst)[0];
  }
  return { totals, slowestPath };
}
