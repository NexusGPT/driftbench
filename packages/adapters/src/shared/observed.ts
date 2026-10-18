import {
  AdapterTransportError,
  AgentFailure,
  type Message,
  Observed,
  type Segment,
  type Stimulus,
  type ToolCall,
} from '@agent-nexus/driftbench-core';

/**
 * What the adapters share about a turn: the messages a stimulus delivers, the text of a turn, the check on
 * an Observed an agent returns, end-state sources, and the error rule.
 */

/** Text segments join with a newline into `Observed.text`: one line for each message the agent sent. */
export const TEXT_SEPARATOR = '\n';

/** The user messages a stimulus delivers: one for `user` and `injection`, one per item for `burst`. */
export function stimulusMessages(stimulus: Stimulus): Message[] {
  if ('user' in stimulus) return [{ role: 'user', content: stimulus.user }];
  if ('burst' in stimulus) return stimulus.burst.map((content): Message => ({ role: 'user', content }));
  return [{ role: 'user', content: stimulus.injection.user }];
}

/** The customer-visible text of a turn: its text segments, in order, joined by `TEXT_SEPARATOR`. */
export function joinText(segments: readonly Segment[]): string {
  return segments.flatMap((segment) => (segment.type === 'text' ? [segment.text] : [])).join(TEXT_SEPARATOR);
}

/**
 * The tool calls a list of segments holds: each `tool_call` with the `tool_result` that answers it, found by
 * id, or else the next unanswered result with the same label.
 */
export function toolCallsOf(segments: readonly Segment[]): ToolCall[] {
  const calls: ToolCall[] = [];
  const answered = new Set<number>();
  segments.forEach((segment, index) => {
    if (segment.type !== 'tool_call') return;
    const resultIndex = segments.findIndex(
      (other, at) =>
        at > index &&
        !answered.has(at) &&
        other.type === 'tool_result' &&
        other.label === segment.label &&
        (segment.id === undefined || other.id === undefined || other.id === segment.id),
    );
    const result = segments[resultIndex];
    const call: ToolCall = { label: segment.label, input: segment.input };
    if (segment.id !== undefined) call.id = segment.id;
    if (result?.type === 'tool_result') {
      answered.add(resultIndex);
      if (result.error !== undefined) call.error = result.error;
      else call.output = result.output;
      if (result.latencyMs !== undefined) call.latencyMs = result.latencyMs;
    }
    calls.push(call);
  });
  return calls;
}

/** Validates what an agent returned. An invalid Observed is the agent's failure, named with its first issues. */
export function parseObserved(value: unknown, source: string): Observed {
  const parsed = Observed.safeParse(value);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`);
  throw new AgentFailure(`${source} returned an invalid Observed: ${issues.join('; ')}`);
}

/** One payload a side-effecting tool received: the tool label and its input. Source `*` lists these. */
export type ToolPayload = { readonly tool: string; readonly input: unknown };

/**
 * An end-state source: `tool:<label>` reads the last payload that tool received, `*` lists every payload in
 * the order they were received. Any other source is a configuration error.
 */
export function readSource(source: string, adapter: string): { tool: string } | { all: true } {
  if (source === '*') return { all: true };
  const tool = /^tool:(.+)$/.exec(source)?.[1];
  if (tool === undefined) {
    throw new Error(
      `the ${adapter} adapter reads end-state sources written tool:<label> or *, not "${source}"`,
    );
  }
  return { tool };
}

/** Passes the contract's two errors through and turns anything else into an AgentFailure. */
export function asAgentError(cause: unknown, context: string): AdapterTransportError | AgentFailure {
  if (cause instanceof AdapterTransportError || cause instanceof AgentFailure) return cause;
  return new AgentFailure(`${context}: ${describeError(cause)}`, { cause });
}

export function describeError(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}
