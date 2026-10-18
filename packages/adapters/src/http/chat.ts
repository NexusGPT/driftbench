import { isPlainObject, type Message } from '@agent-nexus/driftbench-core';
import { contentText, HistoryCompiler, parseArguments } from '../shared';

/**
 * The OpenAI-compatible chat shape the http adapter speaks: the messages it sends, and the completion an
 * endpoint may answer with.
 */

export type ChatToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };

export type ChatMessage = {
  role: string;
  content: string | null;
  name?: string;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
};

/** What the adapter reads from a completion: the first choice's message and the token usage. */
export type ChatReply = {
  message: { content: string; toolCalls: { id?: string; name: string; arguments: unknown }[] };
  usage?: { inputTokens?: number; outputTokens?: number };
  /** Why the model stopped, as the endpoint reports it on the first choice. */
  finishReason?: string;
};

/**
 * The conversation in the chat shape. An assistant message that recorded tool calls becomes three parts,
 * in the order they happened: the assistant's `tool_calls`, one `tool` message per call carrying the JSON of
 * its output (or `{"error": "..."}`), then the assistant's reply text.
 */
export function toChatMessages(messages: readonly Message[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  const compiler = new HistoryCompiler({ fallback: (n) => `call-h${n}` });
  for (const message of messages) {
    const name = message.name === undefined ? {} : { name: message.name };
    const recorded = compiler.calls(message);
    if (recorded.length === 0) {
      // A free tool note answers no call: the wire refuses a tool message without one, so it is user text.
      const role = message.role === 'tool' ? 'user' : message.role;
      out.push({ role, content: message.content, ...name });
      continue;
    }
    const calls = recorded.map(
      (call): ChatToolCall => ({
        id: call.id as string,
        type: 'function',
        function: { name: call.label, arguments: JSON.stringify(call.input ?? {}) },
      }),
    );
    out.push({ role: 'assistant', content: null, tool_calls: calls, ...name });
    recorded.forEach((call) => {
      const content = call.result.kind === 'error' ? { error: call.result.message } : call.result.value;
      out.push({ role: 'tool', tool_call_id: call.id as string, content: JSON.stringify(content) });
    });
    if (message.content !== '') out.push({ role: 'assistant', content: message.content, ...name });
  }
  return out;
}

/** True for a body shaped like a chat completion: a `choices` list. */
export function isChatCompletion(body: unknown): boolean {
  return isPlainObject(body) && Array.isArray(body.choices);
}

/** Reads a chat completion, or undefined when its first choice carries no message. */
export function readCompletion(body: unknown): ChatReply | undefined {
  if (!isPlainObject(body) || !Array.isArray(body.choices)) return undefined;
  const choice: unknown = body.choices[0];
  if (!isPlainObject(choice) || !isPlainObject(choice.message)) return undefined;
  const message = choice.message;
  const toolCalls = (Array.isArray(message.tool_calls) ? message.tool_calls : []).flatMap((call: unknown) => {
    if (!isPlainObject(call) || !isPlainObject(call.function)) return [];
    const name = call.function.name;
    if (typeof name !== 'string' || name === '') return [];
    const id = typeof call.id === 'string' ? { id: call.id } : {};
    return [{ ...id, name, arguments: parseArguments(call.function.arguments) }];
  });
  const reply: ChatReply = {
    message: { content: contentText(message.content), toolCalls },
    ...(typeof choice.finish_reason === 'string' ? { finishReason: choice.finish_reason } : {}),
  };
  const usage = body.usage;
  if (isPlainObject(usage)) {
    const counts: { inputTokens?: number; outputTokens?: number } = {};
    if (isCount(usage.prompt_tokens)) counts.inputTokens = usage.prompt_tokens;
    if (isCount(usage.completion_tokens)) counts.outputTokens = usage.completion_tokens;
    if (counts.inputTokens !== undefined || counts.outputTokens !== undefined) reply.usage = counts;
  }
  return reply;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
