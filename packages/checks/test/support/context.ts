import type {
  BlockResult,
  Check,
  CheckContext,
  Observed,
  ResolvedGiven,
  Segment,
  Spec,
  ToolCall,
  Verdict,
} from '@agent-nexus/driftbench-core';

/** A tool call as a test writes it; ids default to call-1, call-2 in order. */
export type Call = { label: string; input?: unknown; output?: unknown; error?: string; id?: string };

/**
 * A hand-built Observed: each call as a tool_call segment and its tool_result, then the reply as one text
 * segment. `extra` sets the runtime trace, the workspace diff, the executions, cost or latency.
 */
export function observed(text: string, calls: Call[] = [], extra: Partial<Observed> = {}): Observed {
  const toolCalls: ToolCall[] = calls.map((call, index) => ({
    id: call.id ?? `call-${index + 1}`,
    label: call.label,
    input: call.input ?? {},
    ...(call.error === undefined ? { output: call.output ?? null } : { error: call.error }),
  }));
  const segments: Segment[] = toolCalls.flatMap((call): Segment[] => [
    { type: 'tool_call', id: call.id, label: call.label, input: call.input },
    {
      type: 'tool_result',
      id: call.id,
      label: call.label,
      output: call.output ?? null,
      ...(call.error === undefined ? {} : { error: call.error }),
    },
  ]);
  if (text !== '') segments.push({ type: 'text', text });
  return { segments, text, toolCalls, cost: { usd: 0 }, latencyMs: 0, ...extra };
}

export const GIVEN: ResolvedGiven = {
  prefix: [],
  ledger: {},
  world: {},
  vars: {},
  target: { adapter: 'function' },
  hash: 'given-test',
};

/** The context of block `blockIndex` of a spec, in free-running mode, with no history unless given. */
export function context(
  spec: Spec,
  blockIndex: number,
  seen: Observed,
  overrides: Partial<CheckContext> = {},
): CheckContext {
  const block = spec.blocks[blockIndex];
  if (!block) throw new Error(`${spec.id} has no block ${blockIndex}`);
  return {
    spec,
    mode: 'F',
    blockIndex,
    block,
    expect: block.expect ?? {},
    given: GIVEN,
    observed: seen,
    history: [],
    ledger: {},
    ...overrides,
  };
}

/** Earlier blocks of the same run, as the runner hands them to a check. */
export function history(blocks: Observed[]): BlockResult[] {
  return blocks.map((block, index) => ({
    index,
    givenHash: 'given-test',
    observed: block,
    verdicts: [],
    ledgerCheck: { ok: true, contradictions: [] },
    drift: [],
    pass: true,
  }));
}

/** Runs a check the way the runner does: no verdict when it does not apply. */
export async function run(check: Check, ctx: CheckContext): Promise<Verdict[]> {
  if (!check.applies(ctx)) return [];
  return await check.evaluate(ctx);
}

/** Verdict id to outcome, for compact assertions. */
export function outcomes(verdicts: Verdict[]): Record<string, Verdict['outcome']> {
  return Object.fromEntries(verdicts.map((verdict) => [verdict.id, verdict.outcome]));
}

export function verdict(verdicts: Verdict[], id: string): Verdict {
  const found = verdicts.find((item) => item.id === id);
  if (!found) throw new Error(`no verdict ${id} among ${verdicts.map((item) => item.id).join(', ')}`);
  return found;
}

/** The ids of the verdicts that did not pass. */
export function failing(verdicts: Verdict[]): string[] {
  return verdicts.filter((item) => item.outcome !== 'pass').map((item) => item.id);
}
