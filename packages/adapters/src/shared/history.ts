import type { HistoryNormalization, Message } from '@agent-nexus/driftbench-core';
import { historyOutput } from '../anthropic/common';

/** Record empty turns a block-based wire omits, without replacing them with invented model text. */
export function emptyTurnNormalizations(history: readonly Message[], wire: string): HistoryNormalization[] {
  return history.flatMap((message, historyIndex) =>
    message.content === '' && (message.role !== 'assistant' || (message.tool_calls?.length ?? 0) === 0)
      ? [{ wire, historyIndex, role: message.role, kind: 'omitted-empty-turn' as const }]
      : [],
  );
}

/**
 * The tool history compiler: one pass over a history that pairs each recorded call with its result and gives
 * it the id the wire receives. Every adapter that sends a history to a model renders tool calls from it, so a
 * past call reaches every wire as a real tool call and tool result pair (Anthropic `tool_use` and
 * `tool_result`, OpenAI Responses `function_call` and `function_call_output`, Chat Completions `tool_calls`
 * and `tool` messages, and the framework shapes built on them), never as prose.
 *
 * Pairing rules, the ones the wires enforce:
 * - Every call has a result: its recorded output, its recorded error, or, for a call recorded with neither,
 *   what `historyOutput` sends for a call that recorded neither (the run modes page quotes it). A result
 *   always follows its own call, in the same order.
 * - The calls of one assistant message have distinct ids. A recorded id that repeats one earlier in the same
 *   message gets a fresh id, so the wire can pair each result with its call; the neutral history already
 *   pairs them, so no meaning changes. An id repeated across messages is kept: the wires accept it.
 * - A call recorded with no id gets one from the wire's own fallback.
 */

/** What a history call returned, as the wire carries it. */
export type HistoryResult =
  | { readonly kind: 'output'; readonly value: unknown }
  | { readonly kind: 'error'; readonly message: string };

/** One recorded call, paired with its result and the id the wire receives. */
export type PairedCall = {
  /** The wire id; undefined only when the wire takes calls without ids (no `fallback`). */
  readonly id: string | undefined;
  readonly label: string;
  /** The recorded input, absent when none was recorded; each wire writes its own empty arguments. */
  readonly input: unknown;
  readonly result: HistoryResult;
};

/** How a wire names calls. */
export type HistoryIds = {
  /** The id of call number `n` (from 1) when it needs a fresh one. Without it, a call keeps its recorded id or none. */
  fallback?: (n: number) => string;
  /** Which calls advance the counter: every call, or only those that need a fresh id. Default `fresh`. */
  count?: 'every' | 'fresh';
  /** Rewrites a recorded id into one the wire accepts; an empty result counts as no id. */
  clean?: (id: string) => string;
  /** `keep` (default): the recorded ids. `rekey`: a fresh id for every call. */
  policy?: 'keep' | 'rekey';
  /**
   * Whether a call recorded with no id gets a fresh one. Default true. False suits a wire whose ids are
   * optional (Gemini): such a call stays without one, and only a repeated id is replaced.
   */
  fillMissing?: boolean;
};

/** The result of one recorded call. */
export function resultOf(call: NonNullable<Message['tool_calls']>[number]): HistoryResult {
  if (call.error !== undefined) return { kind: 'error', message: call.error };
  // The unrecorded-result rule lives in `historyOutput`; the call stays a call with a result, so the history
  // stays paired.
  return { kind: 'output', value: historyOutput(call) };
}

/**
 * The calls of a history, paired and named for one wire. Make one per rendering: it numbers the calls it
 * names, in history order.
 */
export class HistoryCompiler {
  private counter = 0;

  constructor(private readonly ids: HistoryIds = {}) {}

  /** The calls of one message, each with its result and wire id; an empty list for a message without calls. */
  calls(message: Message): PairedCall[] {
    const recorded = message.role === 'assistant' ? (message.tool_calls ?? []) : [];
    const cleaned = recorded.map((call) => this.cleaned(call.id));
    // Ids the message's own recorded calls hold: under `keep`, a fresh id never takes one.
    const reserved = new Set(cleaned.filter((id): id is string => id !== undefined));
    const taken = new Set<string>();
    return recorded.map((call, index) => {
      const id = this.idOf(cleaned[index], taken, reserved);
      if (id !== undefined) taken.add(id);
      return { id, label: call.label, input: call.input, result: resultOf(call) };
    });
  }

  private cleaned(recorded: string | undefined): string | undefined {
    const id = recorded === undefined || !this.ids.clean ? recorded : this.ids.clean(recorded);
    return id === '' ? undefined : id;
  }

  private idOf(
    kept: string | undefined,
    taken: ReadonlySet<string>,
    reserved: ReadonlySet<string>,
  ): string | undefined {
    const { fallback, count = 'fresh', policy = 'keep', fillMissing = true } = this.ids;
    if (count === 'every') this.counter++;
    if (policy === 'keep' && kept !== undefined && !taken.has(kept)) return kept;
    if (!fallback) return kept;
    if (policy === 'keep' && kept === undefined && !fillMissing) return undefined;
    if (count === 'fresh') this.counter++;
    const base = fallback(this.counter);
    let fresh = base;
    for (let n = 2; taken.has(fresh) || (policy === 'keep' && reserved.has(fresh)); n++)
      fresh = `${base}_${n}`;
    return fresh;
  }
}
