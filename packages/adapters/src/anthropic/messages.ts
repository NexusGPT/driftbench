import type { HistoryNormalization, Message } from '@agent-nexus/driftbench-core';
import { emptyTurnNormalizations, HistoryCompiler } from '../shared';
import { outputText, type WireNames } from './common';

/**
 * The slice of the Anthropic Messages API the adapter speaks, mirrored from `@anthropic-ai/sdk` 0.133.0
 * (`client.messages.create(body)`, a `Message` answer). Only the fields the adapter writes or reads are
 * named; the real client and its types fit these shapes.
 */

export type AnthropicTextBlock = { type: 'text'; text: string };
export type AnthropicToolUseBlock = { type: 'tool_use'; id: string; name: string; input: unknown };
export type AnthropicToolResultBlock = {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};

/** A block of a message the adapter sends: text, a tool call it replays, or a tool result. */
export type AnthropicBlockParam = AnthropicTextBlock | AnthropicToolUseBlock | AnthropicToolResultBlock;

export type AnthropicMessageParam = {
  role: 'user' | 'assistant';
  /** What the adapter writes is a list of blocks; an answer's own content goes back as it came. */
  content: AnthropicBlockParam[] | readonly unknown[];
};

export type AnthropicToolParam = {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
};

/** The body of one `messages.create` call. */
export type AnthropicCreateParams = {
  model: string;
  max_tokens: number;
  messages: AnthropicMessageParam[];
  system?: string;
  tools?: AnthropicToolParam[];
};

/** The answer of one call: content blocks (text, tool_use, and others the adapter passes through), a stop reason, usage. */
export type AnthropicMessage = {
  id?: string;
  type?: string;
  role?: string;
  model?: string;
  content: readonly { type: string; text?: string; id?: string; name?: string; input?: unknown }[];
  stop_reason: string | null;
  usage?: { input_tokens?: number | null; output_tokens?: number | null } | null;
};

/** The client the adapter calls: `new Anthropic()` from `@anthropic-ai/sdk`, or a fake with the same shape. */
export type AnthropicClientLike = {
  messages: {
    create(
      body: AnthropicCreateParams,
      options?: { signal?: AbortSignal; maxRetries?: number },
    ): PromiseLike<AnthropicMessage>;
  };
};

/** Tool names the Messages API accepts: letters, digits, underscore and dash, 64 at most. */
export const ANTHROPIC_NAME = /[a-zA-Z0-9_-]/;
/** Tool use ids the Messages API accepts, the same characters. */
const ID_CHARS = /[^a-zA-Z0-9_-]/g;

/**
 * The session history as Messages API messages, in the order things happened.
 *
 * - A system message joins the `system` text; the API takes no system role in the list.
 * - A user message, and a `tool` message (a free tool note with no call id), become user text.
 * - An assistant message with recorded tool calls becomes the assistant's `tool_use` blocks, then a user
 *   message of `tool_result` blocks (the output as JSON text, an error with `is_error`), then the reply
 *   text, when there is one.
 * - Messages of the same role in a row merge into one, so roles alternate as the API expects; a user
 *   message keeps its `tool_result` blocks first.
 * - Empty text-only turns are omitted and recorded in `normalizations`; no placeholder reaches the model.
 */
export function toAnthropicMessages(
  history: readonly Message[],
  names: WireNames,
): { messages: AnthropicMessageParam[]; system: string[]; normalizations: HistoryNormalization[] } {
  const system: string[] = [];
  const messages: { role: 'user' | 'assistant'; content: AnthropicBlockParam[] }[] = [];
  const compiler = new HistoryCompiler({ fallback: (n) => `toolu_h${n}`, count: 'every', clean: toolUseId });
  const push = (role: 'user' | 'assistant', blocks: AnthropicBlockParam[]) => {
    if (blocks.length === 0) return;
    const last = messages.at(-1);
    if (last?.role === role) last.content.push(...blocks);
    else messages.push({ role, content: [...blocks] });
  };
  const text = (value: string): AnthropicTextBlock[] => (value === '' ? [] : [{ type: 'text', text: value }]);

  for (const message of history) {
    if (message.role === 'system') {
      if (message.content !== '') system.push(message.content);
      continue;
    }
    if (message.role === 'user' || message.role === 'tool') {
      push('user', text(message.content));
      continue;
    }
    const calls = compiler.calls(message);
    if (calls.length > 0) {
      push(
        'assistant',
        calls.map((call) => ({
          type: 'tool_use',
          id: call.id as string,
          name: names.wire(call.label),
          input: call.input ?? {},
        })),
      );
      push(
        'user',
        calls.map(
          (call): AnthropicToolResultBlock =>
            call.result.kind === 'error'
              ? {
                  type: 'tool_result',
                  tool_use_id: call.id as string,
                  content: call.result.message,
                  is_error: true,
                }
              : {
                  type: 'tool_result',
                  tool_use_id: call.id as string,
                  content: outputText(call.result.value),
                },
        ),
      );
    }
    push('assistant', text(message.content));
  }
  return { messages, system, normalizations: emptyTurnNormalizations(history, 'anthropic') };
}

/** A recorded call id as a tool use id the API accepts. */
function toolUseId(id: string): string {
  return id.replace(ID_CHARS, '_');
}
