import type { HistoryNormalization, Message } from '@agent-nexus/driftbench-core';
import { historyOutput, outputText, readToolText, ToolLabels, WireNames } from '../src/anthropic/common';
import { ANTHROPIC_NAME, type AnthropicBlockParam, toAnthropicMessages } from '../src/anthropic/messages';
import { toGoogleContents } from '../src/google/contents';
import { type ChatMessage, toChatMessages } from '../src/http/chat';
import { toLangChainMessages } from '../src/langgraph/messages';
import { type AgentInputItemLike, toInputItems } from '../src/openai-agents/items';
import { toPydanticMessages } from '../src/pydantic-ai/index';
import { toModelMessages } from '../src/vercel-ai/index';

/**
 * Test support for the tool history compiler: each wire's rendering, a reading of each wire back into its
 * tool turns (to check the pairing the wire enforces), and readers of three wires back into the neutral
 * history (to check that a rendering loses nothing the wire can carry).
 */

/** One assistant turn on the wire: the ids of its calls, and the ids its results answer, in order. */
type WireTurn = {
  calls: (string | undefined)[];
  results: (string | undefined)[];
  names?: [string[], string[]];
};

/** A rendering and its tool turns, for one wire. */
type Wire = {
  render: (history: readonly Message[]) => unknown;
  turns: (rendered: unknown) => WireTurn[] | string;
};

const anthropicTurns = (rendered: unknown): WireTurn[] | string => {
  const { messages } = rendered as { messages: { role: string; content: AnthropicBlockParam[] }[] };
  const turns: WireTurn[] = [];
  for (const [at, message] of messages.entries()) {
    const uses = message.content.filter((block) => block.type === 'tool_use');
    const results = message.content.filter((block) => block.type === 'tool_result');
    if (message.role === 'assistant' && uses.length > 0) {
      const next = messages[at + 1];
      const answers = (next?.content ?? []).slice(0, uses.length);
      if (next?.role !== 'user' || answers.some((block) => block.type !== 'tool_result')) {
        return `message ${at}: tool_use blocks not followed by a user message that opens with their tool_result blocks`;
      }
      turns.push({
        calls: uses.map((block) => (block.type === 'tool_use' ? block.id : undefined)),
        results: answers.map((block) => (block.type === 'tool_result' ? block.tool_use_id : undefined)),
      });
    } else if (results.length > 0 && messages[at - 1]?.role !== 'assistant') {
      return `message ${at}: tool_result with no tool_use before it`;
    }
  }
  return turns;
};

/** Chat Completions and LangGraph: an assistant message with `tool_calls`, then one `tool` message per call. */
const chatTurns = (rendered: unknown): WireTurn[] | string => {
  const messages = rendered as { role: string; tool_calls?: { id: string }[]; tool_call_id?: string }[];
  const turns: WireTurn[] = [];
  for (let at = 0; at < messages.length; at++) {
    const message = messages[at] as (typeof messages)[number];
    if (message.role === 'tool') return `message ${at}: a tool message that answers no call before it`;
    const calls = message.role === 'assistant' ? (message.tool_calls ?? []) : [];
    if (calls.length === 0) continue;
    const answers = messages.slice(at + 1, at + 1 + calls.length);
    if (answers.length < calls.length || answers.some((answer) => answer.role !== 'tool')) {
      return `message ${at}: tool_calls not followed by one tool message each`;
    }
    turns.push({
      calls: calls.map((call) => call.id),
      results: answers.map((answer) => answer.tool_call_id),
    });
    at += calls.length;
  }
  return turns;
};

/** Responses input items: each `function_call` answered by the `function_call_result` right after it. */
const responsesTurns = (rendered: unknown): WireTurn[] | string => {
  const items = rendered as AgentInputItemLike[];
  const turns: WireTurn[] = [];
  let open: WireTurn | undefined;
  for (const [at, item] of items.entries()) {
    if ('type' in item && item.type === 'function_call') {
      const answer = items[at + 1];
      if (!answer || !('type' in answer) || answer.type !== 'function_call_result') {
        return `item ${at}: function_call not followed by its result`;
      }
      open ??= { calls: [], results: [] };
      open.calls.push(item.callId);
      open.results.push(answer.callId);
    } else if ('type' in item && item.type === 'function_call_result') {
      if (items[at - 1] === undefined || !('type' in (items[at - 1] as object))) {
        return `item ${at}: function_call_result with no call before it`;
      }
    } else if (open) {
      turns.push(open);
      open = undefined;
    }
  }
  if (open) turns.push(open);
  return turns;
};

const pydanticTurns = (rendered: unknown): WireTurn[] | string => {
  const messages = rendered as { kind: string; parts: { part_kind: string; tool_call_id?: string }[] }[];
  const turns: WireTurn[] = [];
  for (const [at, message] of messages.entries()) {
    const calls = message.parts.filter((part) => part.part_kind === 'tool-call');
    if (message.kind !== 'response' || calls.length === 0) continue;
    const answers = (messages[at + 1]?.parts ?? []).filter((part) =>
      ['tool-return', 'retry-prompt'].includes(part.part_kind),
    );
    turns.push({
      calls: calls.map((part) => part.tool_call_id),
      results: answers.slice(0, calls.length).map((part) => part.tool_call_id),
    });
  }
  return turns;
};

const vercelTurns = (rendered: unknown): WireTurn[] | string => {
  const messages = rendered as { role: string; content: unknown }[];
  const turns: WireTurn[] = [];
  for (const [at, message] of messages.entries()) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue;
    const calls = (message.content as { type: string; toolCallId?: string }[]).filter(
      (part) => part.type === 'tool-call',
    );
    if (calls.length === 0) continue;
    const next = messages[at + 1];
    if (next?.role !== 'tool') return `message ${at}: tool-call parts not followed by a tool message`;
    turns.push({
      calls: calls.map((part) => part.toolCallId),
      results: (next.content as { toolCallId: string }[]).map((part) => part.toolCallId),
    });
  }
  return turns;
};

/** Gemini pairs by name and order: each turn's responses carry the names of its calls, in order. */
const googleTurns = (rendered: unknown): WireTurn[] | string => {
  type Named = { name: string; id?: string };
  const { contents } = rendered as {
    contents: { role: string; parts: { functionCall?: Named; functionResponse?: Named }[] }[];
  };
  const turns: WireTurn[] = [];
  for (const [at, content] of contents.entries()) {
    const calls = content.parts.flatMap((part) => (part.functionCall ? [part.functionCall] : []));
    if (content.role !== 'model' || calls.length === 0) continue;
    const answers = (contents[at + 1]?.parts ?? []).flatMap((part) =>
      part.functionResponse ? [part.functionResponse] : [],
    );
    // Gemini pairs by name and order, and by id when one travels: both must agree, and an id that travels
    // is distinct within its turn (pairingProblems checks it as on every wire).
    turns.push({
      calls: calls.map((call) => call.id),
      results: answers.map((answer) => answer.id),
      names: [calls.map((call) => call.name), answers.map((answer) => answer.name)],
    });
  }
  return turns;
};

const names = () => new WireNames([], ANTHROPIC_NAME);
const labels = new ToolLabels();

export const WIRES: Record<string, Wire> = {
  anthropic: { render: (history) => toAnthropicMessages(history, names()), turns: anthropicTurns },
  chat: { render: (history) => toChatMessages(history), turns: chatTurns },
  responses: { render: (history) => toInputItems(history, labels), turns: responsesTurns },
  langgraph: { render: (history) => toLangChainMessages(history, labels), turns: chatTurns },
  google: { render: (history) => toGoogleContents(history, names()), turns: googleTurns },
  pydantic: { render: (history) => toPydanticMessages(history, labels), turns: pydanticTurns },
  vercel: { render: (history) => toModelMessages(history, labels), turns: vercelTurns },
};

/** What breaks the pairing a wire enforces, or an empty list. */
export function pairingProblems(wire: string, history: readonly Message[]): string[] {
  const { render, turns: read } = WIRES[wire] as Wire;
  const calls = history.reduce(
    (n, message) => n + (message.role === 'assistant' ? (message.tool_calls?.length ?? 0) : 0),
    0,
  );
  const turns = read(render(history));
  if (typeof turns === 'string') return [turns];
  const problems: string[] = [];
  let seen = 0;
  turns.forEach((turn, at) => {
    seen += turn.calls.length;
    if (turn.names && JSON.stringify(turn.names[0]) !== JSON.stringify(turn.names[1])) {
      problems.push(`turn ${at}: responses ${turn.names[1]} do not answer calls ${turn.names[0]}`);
    }
    if (turn.calls.length !== turn.results.length)
      problems.push(`turn ${at}: ${turn.calls.length} calls, ${turn.results.length} results`);
    if (JSON.stringify(turn.calls) !== JSON.stringify(turn.results))
      problems.push(`turn ${at}: results ${turn.results} do not answer calls ${turn.calls}`);
    const ids = turn.calls.filter((id) => id !== undefined);
    if (new Set(ids).size !== ids.length) problems.push(`turn ${at}: a call id repeats in one turn (${ids})`);
    if (ids.some((id) => id === '')) problems.push(`turn ${at}: an empty call id`);
  });
  if (seen !== calls) problems.push(`${seen} calls on the wire, ${calls} in the history`);
  return problems;
}

// ------------------------------------------------------------------ the neutral form a wire carries

/** A call as the model reads it on a text wire: its label, its arguments, and its result as text. */
type CarriedCall = { label: string; input: unknown; result: ['output' | 'error', string] };
type Carried = { role: 'user' | 'assistant' | 'system'; content: string; calls?: CarriedCall[] };

/**
 * The part of a history a text wire carries: a free tool note is user text, a sender name is not carried,
 * an empty assistant turn is nothing, an assistant turn that only called tools and the text right after it
 * are one turn, an absent input is `{}`, and a result is the text the model reads. On Responses, call turns
 * in a row with no text between them are one run of items, so they read back as one turn. Chat keeps an
 * empty assistant message as one. Block-based wires explicitly omit empty text-only turns; their
 * expectations include a separate normalization record, never a blanket relaxation of read-back.
 */
export function carried(
  history: readonly Message[],
  options: {
    system: 'inline' | 'apart';
    mergeCallTurns?: boolean;
    keepEmpty?: boolean;
    omitEmptyText?: 'anthropic' | 'google';
  },
): { messages: Carried[]; normalizations: HistoryNormalization[] } {
  const out: Carried[] = [];
  const normalizations: HistoryNormalization[] = [];
  for (const [historyIndex, message] of history.entries()) {
    const calls = message.role === 'assistant' ? (message.tool_calls ?? []) : [];
    if (options.omitEmptyText && message.content === '' && calls.length === 0) {
      normalizations.push({
        wire: options.omitEmptyText,
        historyIndex,
        role: message.role,
        kind: 'omitted-empty-turn',
      });
      continue;
    }
    if (message.role === 'system' && options.system === 'apart') continue;
    const role = message.role === 'tool' ? 'user' : message.role;
    const last = out.at(-1);
    if (role === 'assistant' && calls.length === 0 && message.content === '' && !options.keepEmpty) continue;
    const open = last?.role === 'assistant' && last.calls !== undefined && last.content === '';
    if (role === 'assistant' && calls.length === 0 && open && last) {
      last.content = message.content;
      continue;
    }
    const mapped = calls.map(
      (call): CarriedCall => ({
        label: call.label,
        input: call.input ?? {},
        result:
          call.error !== undefined ? ['error', call.error] : ['output', outputText(historyOutput(call))],
      }),
    );
    if (options.mergeCallTurns && calls.length > 0 && open && last?.calls) {
      last.calls.push(...mapped);
      last.content = message.content;
      continue;
    }
    out.push({ role, content: message.content, ...(calls.length > 0 ? { calls: mapped } : {}) });
  }
  return { messages: out, normalizations };
}

/** Anthropic messages read back: one message per text block, calls with the results that answer them. */
export function fromAnthropic(rendered: ReturnType<typeof toAnthropicMessages>): Carried[] {
  const out: Carried[] = [];
  const pending = new Map<string, CarriedCall>();
  let calling: Carried | undefined;
  let answered: Carried | undefined;
  for (const message of rendered.messages) {
    for (const block of message.content as AnthropicBlockParam[]) {
      if (block.type === 'tool_use') {
        const call: CarriedCall = { label: block.name, input: block.input, result: ['output', ''] };
        pending.set(block.id, call);
        if (calling?.calls) calling.calls.push(call);
        else {
          calling = { role: 'assistant', content: '', calls: [call] };
          out.push(calling);
        }
        answered = undefined;
      } else if (block.type === 'tool_result') {
        const call = pending.get(block.tool_use_id);
        if (call) call.result = block.is_error ? ['error', block.content] : ['output', block.content];
        answered = calling ?? answered;
        calling = undefined;
      } else {
        calling = undefined;
        if (message.role === 'assistant' && answered && answered.content === '')
          answered.content = block.text;
        else out.push({ role: message.role, content: block.text });
        answered = undefined;
      }
    }
  }
  return out;
}

const resultOfText = (text: string): CarriedCall['result'] => {
  const outcome = readToolText(text);
  return outcome.error !== undefined ? ['error', outcome.error] : ['output', outputText(outcome.output)];
};

/** Chat messages read back. */
export function fromChat(rendered: ChatMessage[]): Carried[] {
  const out: Carried[] = [];
  const pending = new Map<string, CarriedCall>();
  for (const message of rendered) {
    const last = out.at(-1);
    if (message.role === 'tool') {
      const call = pending.get(message.tool_call_id ?? '');
      if (call) call.result = resultOfText(message.content ?? '');
    } else if (message.role === 'assistant' && message.tool_calls) {
      const calls = message.tool_calls.map((tc) => {
        const call: CarriedCall = {
          label: tc.function.name,
          input: JSON.parse(tc.function.arguments),
          result: ['output', ''],
        };
        pending.set(tc.id, call);
        return call;
      });
      out.push({ role: 'assistant', content: '', calls });
    } else if (message.role === 'assistant' && last?.calls && last.content === '') {
      last.content = message.content ?? '';
    } else out.push({ role: message.role as Carried['role'], content: message.content ?? '' });
  }
  return out;
}

/** Responses input items read back. */
export function fromResponses(rendered: AgentInputItemLike[]): Carried[] {
  const out: Carried[] = [];
  const pending = new Map<string, CarriedCall>();
  for (const item of rendered) {
    const last = out.at(-1);
    if ('type' in item && item.type === 'function_call') {
      const call: CarriedCall = {
        label: item.name,
        input: JSON.parse(item.arguments),
        result: ['output', ''],
      };
      pending.set(item.callId, call);
      if (last?.role === 'assistant' && last.calls && last.content === '') last.calls.push(call);
      else out.push({ role: 'assistant', content: '', calls: [call] });
    } else if ('type' in item) {
      const call = pending.get(item.callId);
      if (call) call.result = resultOfText(item.output.text);
    } else if (item.role === 'assistant') {
      const text = item.content.map((part) => part.text).join('');
      if (last?.calls && last.content === '') last.content = text;
      else out.push({ role: 'assistant', content: text });
    } else out.push({ role: item.role, content: item.content });
  }
  return out;
}
