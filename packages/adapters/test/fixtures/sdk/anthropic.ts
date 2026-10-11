import type {
  AnthropicClientLike,
  AnthropicCreateParams,
  AnthropicMessage,
} from '../../../src/anthropic/index';
import { type AcmeTurn, labelOf, nextAction, tokens, wireOf } from './acme-model';

/**
 * A fake Anthropic client: `messages.create` answers as the Acme agent would through the Messages API.
 *
 * It checks each request the way the API does (roles alternate and start with the user, tool names and
 * tool use ids use the allowed characters, every `tool_use` is answered by a `tool_result` first thing in
 * the next user message, no empty text block) and answers a 400 `invalid_request_error` otherwise, so a
 * mapping slip in the adapter fails loudly. Answers carry the envelope of a real `Message`.
 */

export type FakeAnthropic = AnthropicClientLike & {
  /** Every request body, in order. */
  readonly requests: AnthropicCreateParams[];
};

/** An error shaped like the SDK's `APIError`: a status and the API's error body. */
export class FakeAnthropicError extends Error {
  constructor(
    readonly status: number | undefined,
    message: string,
    name = 'BadRequestError',
  ) {
    super(message);
    this.name = name;
  }
}

export function fakeAnthropic(): FakeAnthropic {
  const requests: AnthropicCreateParams[] = [];
  let count = 0;
  return {
    requests,
    messages: {
      async create(body) {
        requests.push(structuredClone(body));
        validate(body);
        count++;
        const offered = (body.tools ?? []).map((tool) => tool.name);
        const action = nextAction(turnsOf(body, offered));
        const content: AnthropicMessage['content'] =
          action.kind === 'tool'
            ? [
                {
                  type: 'tool_use',
                  id: `toolu_fake_${count}`,
                  name: wireOf(action.label, offered),
                  input: action.input,
                },
              ]
            : [{ type: 'text', text: action.text }];
        return {
          id: `msg_fake_${count}`,
          type: 'message',
          role: 'assistant',
          model: body.model,
          content,
          stop_reason: action.kind === 'tool' ? 'tool_use' : 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: tokens(body.messages), output_tokens: tokens(content) },
        } as AnthropicMessage;
      },
    },
  };
}

/** A client whose connection fails, the way the SDK reports it: `APIConnectionError`, no status. */
export function deadAnthropic(): AnthropicClientLike {
  return {
    messages: {
      async create() {
        throw new FakeAnthropicError(undefined, 'Connection error.', 'APIConnectionError');
      },
    },
  };
}

/** A client that answers the given messages in order and records each request, for recorded exchanges. */
export function recordedAnthropic(answers: readonly unknown[]): FakeAnthropic {
  const requests: AnthropicCreateParams[] = [];
  return {
    requests,
    messages: {
      async create(body) {
        requests.push(structuredClone(body));
        const next = answers[requests.length - 1];
        if (next === undefined) throw new Error(`no recorded answer for request ${requests.length}`);
        return structuredClone(next) as AnthropicMessage;
      },
    },
  };
}

type Block = {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
};

/** The conversation as Acme turns: user text opens a turn, tool uses and results fill it, assistant text answers it. */
function turnsOf(body: AnthropicCreateParams, offered: readonly string[]): AcmeTurn[] {
  const turns: AcmeTurn[] = [];
  const pending = new Map<string, AcmeTurn['calls'][number]>();
  for (const message of body.messages) {
    for (const block of message.content as Block[]) {
      if (message.role === 'user' && block.type === 'text') {
        const open = turns.at(-1);
        if (open && !open.answered) open.text = `${open.text}\n${block.text}`;
        else turns.push({ text: block.text ?? '', calls: [], answered: false });
      } else if (message.role === 'user' && block.type === 'tool_result') {
        const call = pending.get(block.tool_use_id ?? '');
        if (!call) continue;
        const text = typeof block.content === 'string' ? block.content : '';
        call.outcome = block.is_error ? { ok: false, error: text } : { ok: true, output: parse(text) };
      } else if (message.role === 'assistant' && block.type === 'tool_use') {
        const call = { label: labelOf(block.name ?? '', offered), input: block.input };
        turns.at(-1)?.calls.push(call);
        pending.set(block.id ?? '', call);
      } else if (message.role === 'assistant' && block.type === 'text') {
        const open = turns.at(-1);
        if (open) open.answered = true;
      }
    }
  }
  return turns;
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** The checks the Messages API makes that an adapter can get wrong. */
function validate(body: AnthropicCreateParams): void {
  const fail = (why: string): never => {
    throw new FakeAnthropicError(400, `invalid_request_error: ${why}`);
  };
  if (typeof body.model !== 'string' || body.model === '') fail('model: Field required');
  if (!Number.isInteger(body.max_tokens) || body.max_tokens < 1)
    fail('max_tokens: must be a positive integer');
  if (body.messages.length === 0) fail('messages: at least one message is required');
  if (body.messages[0]?.role !== 'user') fail('messages: first message must use the "user" role');
  for (const tool of body.tools ?? []) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tool.name))
      fail(`tools: tool name ${tool.name} does not match ^[a-zA-Z0-9_-]{1,64}$`);
    if (tool.input_schema?.type !== 'object') fail(`tools.${tool.name}.input_schema.type: must be "object"`);
  }
  body.messages.forEach((message, index) => {
    if (index > 0 && body.messages[index - 1]?.role === message.role)
      fail(`messages.${index}: roles must alternate`);
    const blocks = message.content as Block[];
    if (blocks.length === 0) fail(`messages.${index}: content must not be empty`);
    for (const block of blocks) {
      if (block.type === 'text' && block.text === '')
        fail(`messages.${index}: text content blocks must be non-empty`);
      if (block.type === 'tool_use' && !/^[a-zA-Z0-9_-]+$/.test(block.id ?? ''))
        fail(`messages.${index}: tool_use.id does not match ^[a-zA-Z0-9_-]+$`);
    }
    const uses = blocks.filter((block) => block.type === 'tool_use').map((block) => block.id);
    if (message.role !== 'assistant' || uses.length === 0) return;
    const next = (body.messages[index + 1]?.content ?? []) as Block[];
    const answered = next
      .slice(0, uses.length)
      .map((block) => (block.type === 'tool_result' ? block.tool_use_id : undefined));
    if (body.messages[index + 1] !== undefined && uses.some((id) => !answered.includes(id))) {
      fail(`messages.${index + 1}: tool_use ids were found without tool_result blocks immediately after`);
    }
  });
}
