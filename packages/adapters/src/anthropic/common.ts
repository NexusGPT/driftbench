import { randomUUID } from 'node:crypto';
import {
  AdapterTransportError,
  AgentFailure,
  copyHistory,
  isPlainObject,
  type Observed,
  type ResolvedGiven,
  type RetryLayer,
  type RetryPolicy,
  retryDecision,
  retrying,
  retryPolicy,
  type Segment,
  type Session,
  type ToolCall,
  type Turn,
  type WorldState,
} from '@agent-nexus/driftbench-core';
import { describeError, joinText, parseObserved, readSource, type ToolPayload } from '../shared';

/**
 * What the four SDK adapters (anthropic, google, openai-agents, langgraph) share: the error rule for a
 * vendor client, the session guard, the payload log that answers `endState`, the world tools a closed
 * agent loop answers from, tool names on the wire, and the Observed a list of segments makes.
 *
 * It lives in the anthropic folder because the SDK lane owns only the four adapter folders; the adapters
 * import it from here. It holds no vendor type: each adapter mirrors its SDK's call shape locally.
 */

/**
 * Tells a transport failure (retryable) from the agent's own failure, for an error a vendor client threw,
 * by the shared retry rule: a 429, a 5xx (529 included) or a network error is a transport failure, anything
 * else (a bad request, a refused key) is the agent's. A transport error passes through as it came.
 */
export function vendorError(cause: unknown, context: string): AdapterTransportError | AgentFailure {
  // A framework may wrap the error a model call ended with; the contract's own error inside wins.
  for (
    let inner: unknown = cause, depth = 0;
    inner instanceof Error && depth < 5;
    inner = inner.cause, depth++
  ) {
    if (inner instanceof AdapterTransportError || inner instanceof AgentFailure) return inner;
  }
  const message = `${context}: ${describeError(cause)}`;
  const decision = retryDecision(cause);
  if (!decision.retry) return new AgentFailure(message, { cause });
  return new AdapterTransportError(message, {
    cause,
    ...(decision.status === undefined ? {} : { status: decision.status }),
    ...(decision.retryAfterMs === undefined ? {} : { retryAfterMs: decision.retryAfterMs }),
  });
}

/** True when the shared retry rule retries this vendor error. */
export function isTransient(cause: unknown): boolean {
  return retryDecision(cause).retry;
}

/** What an adapter that calls a model itself takes about retries. */
export type RetryOption = {
  /** The adapter's own retry settings, under the spec target's and the run's. */
  retry?: RetryLayer;
  /** How a wait between attempts is spent. Tests pass one that returns at once. */
  sleep?: (ms: number) => Promise<void>;
};

/** The policy of a block's model calls: the runner's, or else the spec target's over the adapter's own. */
export function policyOf(turn: Turn, session: Session, own: RetryOption): RetryPolicy {
  return turn.retry ?? retryPolicy(own.retry, session.target.retry);
}

/**
 * One model call under the shared retry policy. A transient failure is retried and recorded (the runner
 * puts the records into the block's Observed); the last one ends as a transport error marked exhausted, so
 * the runner does not retry the block on top. Any other failure is the agent's.
 */
export async function callModel<T>(
  call: string,
  run: () => PromiseLike<T>,
  policy: RetryPolicy,
  own: RetryOption,
): Promise<T> {
  try {
    return await retrying(call, async () => await run(), {
      policy,
      ...(own.sleep ? { sleep: own.sleep } : {}),
    });
  } catch (cause) {
    throw vendorError(cause, call);
  }
}

/** The part of a session an SDK adapter keeps: whether it closed, and what each block's tools received. */
export type SdkState = {
  readonly kind: string;
  closed: boolean;
  /** Side-effect payloads by block index, so a retried block replaces its entries instead of adding twice. */
  payloads: Map<number, ToolPayload[]>;
};

/** Opens a session: an id, the adapter, the target and the Given, and a fresh array of the shared frozen prefix messages. */
export function openSession<S extends SdkState>(adapter: string, given: ResolvedGiven, state: S): Session {
  return {
    id: randomUUID(),
    adapter,
    target: given.target,
    given,
    history: copyHistory(given.prefix),
    state,
  };
}

/** The state of a session this adapter opened and has not closed; anything else is a caller error. */
export function ownState<S extends SdkState>(session: Session, adapter: string, kind: string): S {
  const state = session.state as S | undefined;
  if (session.adapter !== adapter || state?.kind !== kind) {
    throw new Error(`session ${session.id} was not opened by the ${adapter} adapter`);
  }
  if (state.closed) throw new Error(`session ${session.id} is closed`);
  return state;
}

/** Records the payloads of a block: each call of a side-effect tool that did not fail, in call order. */
export function recordPayloads(
  state: SdkState,
  blockIndex: number,
  calls: readonly ToolCall[],
  sideEffects: ReadonlySet<string>,
): void {
  const payloads = calls
    .filter((call) => sideEffects.has(call.label) && call.error === undefined)
    .map((call): ToolPayload => ({ tool: call.label, input: structuredClone(call.input) }));
  state.payloads.set(blockIndex, payloads);
}

/** Reads an end-state source from a payload log: `tool:<label>` the last input, `*` the whole log. */
export function readPayloads(log: readonly ToolPayload[], source: string, adapter: string): unknown {
  const read = readSource(source, adapter);
  const copy = log.map((entry): ToolPayload => ({ tool: entry.tool, input: structuredClone(entry.input) }));
  if ('all' in read) return copy;
  return copy.reverse().find((entry) => entry.tool === read.tool)?.input;
}

/** The payload log of a session, blocks in index order. */
export function payloadLog(state: SdkState): ToolPayload[] {
  return [...state.payloads.entries()].sort(([a], [b]) => a - b).flatMap(([, entries]) => entries);
}

/**
 * A tool of a closed agent loop: the name the spec and the checks use, what the model reads about it,
 * and the agent's own implementation. A forced result or error in `world.tools` wins over `run`.
 */
export type SdkTool = {
  /** The tool label, as specs name it, such as `coverage.check`. The adapter maps it to a name the vendor accepts. */
  name: string;
  description?: string;
  /** The JSON Schema of the input. Default an object with any properties. */
  inputSchema?: Record<string, unknown>;
  /** The agent's own implementation. A throw is the tool's error, with the thrown message. */
  run?: (input: unknown, context: ToolContext) => unknown | Promise<unknown>;
};

/** What a tool implementation receives besides its input. */
export type ToolContext = {
  readonly sessionId: string;
  readonly blockIndex: number;
  /** The block's world: `store` seeds, `fixtures`, and the forced `tools` already applied by the adapter. */
  readonly world: WorldState;
  readonly vars: Record<string, unknown>;
};

/** The tools of a session: one list for every session, or a factory called once per session at `open`. */
export type SdkTools = readonly SdkTool[] | ((given: ResolvedGiven) => readonly SdkTool[]);

/** What one tool call came to. */
export type ToolOutcome = { output: unknown; error?: undefined } | { output?: undefined; error: string };

/**
 * Answers one tool call of a closed loop: the forced result or error in `world.tools` first, then the
 * tool's own `run`. A tool with neither fails the block, since the agent asked for something nothing answers.
 */
export async function answerTool(
  label: string,
  input: unknown,
  tools: ReadonlyMap<string, SdkTool>,
  context: ToolContext,
): Promise<{ outcome: ToolOutcome; latencyMs: number }> {
  const forced = context.world.tools?.[label];
  if (forced?.error !== undefined)
    return { outcome: { error: forced.error }, latencyMs: forced.latency_ms ?? 0 };
  if (forced !== undefined && 'result' in forced) {
    return { outcome: { output: forced.result ?? null }, latencyMs: forced.latency_ms ?? 0 };
  }
  const tool = tools.get(label);
  if (tool?.run === undefined) {
    throw new AgentFailure(
      `the agent called ${label}, and neither world.tools nor a tool implementation answers it`,
    );
  }
  const started = performance.now();
  let outcome: ToolOutcome;
  try {
    outcome = { output: (await tool.run(structuredClone(input), context)) ?? null };
  } catch (cause) {
    outcome = { error: describeError(cause) };
  }
  return { outcome, latencyMs: forced?.latency_ms ?? Math.round(performance.now() - started) };
}

/**
 * Tool names on the wire. A vendor accepts fewer characters in a name than a spec label holds
 * (`coverage.check` has a dot): each label gets a name the vendor accepts, unique within the session, and
 * the name maps back to the label. A name the model invents maps to itself.
 */
export class WireNames {
  private readonly toWire = new Map<string, string>();
  private readonly toLabel = new Map<string, string>();

  constructor(
    labels: Iterable<string>,
    private readonly allowed: RegExp,
    private readonly maxLength = 64,
  ) {
    for (const label of labels) this.wire(label);
  }

  /** The name the vendor sees for a label. */
  wire(label: string): string {
    const known = this.toWire.get(label);
    if (known !== undefined) return known;
    const base = [...label].map((char) => (this.allowed.test(char) ? char : '_')).join('') || 'tool';
    let name = base.slice(0, this.maxLength);
    for (let n = 2; this.toLabel.has(name); n++) {
      const suffix = `_${n}`;
      name = `${base.slice(0, this.maxLength - suffix.length)}${suffix}`;
    }
    this.toWire.set(label, name);
    this.toLabel.set(name, label);
    return name;
  }

  /** The label a name on the wire stands for. */
  label(name: string): string {
    return this.toLabel.get(name) ?? name;
  }
}

/**
 * Tool names an SDK agent declares, mapped to the labels specs use: `{ coverage_check: 'coverage.check' }`.
 * The OpenAI and LangChain tool names take no dot, so an agent built on them names its tools apart from the
 * spec. A name absent from the map is its own label.
 */
export class ToolLabels {
  private readonly byLabel: Map<string, string>;

  constructor(private readonly byName: Readonly<Record<string, string>> = {}) {
    this.byLabel = new Map(Object.entries(byName).map(([name, label]) => [label, name]));
  }

  /** The spec label of an SDK tool name. */
  label(name: string): string {
    return Object.hasOwn(this.byName, name) ? (this.byName[name] as string) : name;
  }

  /** The SDK tool name of a spec label, for a call the history replays. */
  name(label: string): string {
    return this.byLabel.get(label) ?? label;
  }
}

/** Adds one model call's token usage into a running total. */
export type Usage = { inputTokens: number; outputTokens: number; seen: boolean };

export function addUsage(total: Usage, input: unknown, output: unknown): Observed['cost'] | undefined {
  const inputTokens = isCount(input) ? input : undefined;
  const outputTokens = isCount(output) ? output : undefined;
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  total.seen = true;
  total.inputTokens += inputTokens ?? 0;
  total.outputTokens += outputTokens ?? 0;
  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
  };
}

export function newUsage(): Usage {
  return { inputTokens: 0, outputTokens: 0, seen: false };
}

export function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Puts one model call's latency and tokens on the first segment the call adds, so the segments add up
 * to the block. `take()` hands the measure out once.
 */
export function measureOnce(
  measure: Pick<Segment, 'cost' | 'latencyMs'>,
): () => Pick<Segment, 'cost' | 'latencyMs'> {
  let left: Pick<Segment, 'cost' | 'latencyMs'> | undefined = measure;
  return () => {
    const taken = left ?? {};
    left = undefined;
    return taken;
  };
}

/** The tool calls of a list of segments, each tool_call paired with its tool_result by id. */
export function pairedCalls(segments: readonly Segment[]): ToolCall[] {
  const results = new Map<string, Extract<Segment, { type: 'tool_result' }>>();
  for (const segment of segments) {
    if (segment.type === 'tool_result' && segment.id !== undefined) results.set(segment.id, segment);
  }
  return segments.flatMap((segment): ToolCall[] => {
    if (segment.type !== 'tool_call') return [];
    const call: ToolCall = { label: segment.label, input: segment.input };
    if (segment.id !== undefined) call.id = segment.id;
    const result = segment.id === undefined ? undefined : results.get(segment.id);
    if (result?.error !== undefined) call.error = result.error;
    else if (result !== undefined) call.output = result.output;
    if (result?.latencyMs !== undefined) call.latencyMs = result.latencyMs;
    return [call];
  });
}

/**
 * Closes every tool call that never got its result (the run stopped first: an interrupt, an approval
 * wait): a tool_result with an error saying so goes right after the last segment of the block.
 */
export function closeOpenCalls(segments: Segment[], why: string): void {
  const answered = new Set(
    segments.flatMap((segment) => (segment.type === 'tool_result' && segment.id ? [segment.id] : [])),
  );
  for (const segment of [...segments]) {
    if (segment.type !== 'tool_call' || segment.id === undefined || answered.has(segment.id)) continue;
    segments.push({ type: 'tool_result', id: segment.id, label: segment.label, output: null, error: why });
  }
}

/** The Observed of a block from its segments; validated, so a mapping slip is the agent's failure, named. */
export function observedOf(
  segments: Segment[],
  usage: Usage,
  latencyMs: number,
  source: string,
  extra: Partial<Pick<Observed, 'runtime' | 'raw' | 'historyNormalizations'>> = {},
): Observed {
  return parseObserved(
    {
      segments,
      text: joinText(segments),
      toolCalls: pairedCalls(segments),
      cost: usage.seen ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } : {},
      latencyMs,
      ...extra,
    },
    source,
  );
}

/**
 * A tool output as text, for vendors that carry tool results as text: a string stays as it is, anything
 * else is its JSON.
 */
export function outputText(output: unknown): string {
  return typeof output === 'string' ? output : JSON.stringify(output ?? null);
}

/**
 * What a model is told for a history call that recorded neither an output nor an error. A teacher-forced
 * prefix holds such a call when the spec's world forces no result for its tool; sending `null` would tell
 * the model that the call returned nothing, which no one recorded.
 */
export const UNRECORDED_RESULT =
  'Not recorded: this earlier call comes from a replayed conversation that states the call, with only the arguments it fixes, and not what it returned.';

/** The output of a history call that is not an error: its recorded output, or the note that none was recorded. */
export function historyOutput(call: { output?: unknown }): unknown {
  return call.output === undefined ? UNRECORDED_RESULT : call.output;
}

/**
 * A tool output read back from text: JSON when it parses, the text otherwise. An object holding a single
 * string `error` is a tool error, the convention the http adapter writes too.
 */
export function readToolText(text: string): ToolOutcome {
  let value: unknown = text;
  if (text.trim() !== '') {
    try {
      value = JSON.parse(text);
    } catch {
      value = text;
    }
  }
  return errorOf(value);
}

/** A value with a single string `error` is a tool error; anything else is an output. */
export function errorOf(value: unknown): ToolOutcome {
  if (isPlainObject(value) && typeof value.error === 'string' && Object.keys(value).length === 1) {
    return { error: value.error };
  }
  return { output: value ?? null };
}

/** The most model calls a block may take: the adapter's cap, lowered by the block's step budget. */
export function stepCap(adapterCap: number, budgetSteps: number | undefined): number {
  return budgetSteps === undefined ? adapterCap : Math.max(1, Math.min(adapterCap, budgetSteps));
}
