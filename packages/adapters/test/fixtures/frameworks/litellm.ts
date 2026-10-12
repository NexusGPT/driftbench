import type { ChatCompletionParams, OpenAIChatClientLike } from '../../../src/litellm/index';
import { fromChatMessages } from '../http/acme-server';
import { labelOf, nextAction, tokens } from '../sdk/acme-model';
import { turnsOfMessages } from './acme-loop';

/**
 * A fake LiteLLM proxy behind the `openai` client's shape: `chat.completions.create` answers as the Acme
 * agent would, one tool call at a time, in the chat completion shape LiteLLM returns (the routed model in
 * `model`, `usage`, `finish_reason`). It refuses a function name the OpenAI shape refuses, as the proxy's
 * providers do, and records each request and its options.
 */

export type FakeLitellm = OpenAIChatClientLike & {
  readonly requests: { body: ChatCompletionParams; options?: { maxRetries?: number } }[];
};

/** An error shaped like the `openai` package's `APIError`: a status and the response headers. */
export class FakeOpenAIError extends Error {
  constructor(
    readonly status: number | undefined,
    message: string,
    readonly headers: Headers = new Headers(),
    name = 'APIError',
  ) {
    super(message);
    this.name = name;
  }
}

export function fakeLitellm(routedTo = 'anthropic/claude-fake-acme'): FakeLitellm {
  const requests: FakeLitellm['requests'] = [];
  let count = 0;
  return {
    requests,
    chat: {
      completions: {
        async create(body, options) {
          requests.push({ body: structuredClone(body), ...(options ? { options } : {}) });
          for (const tool of body.tools ?? []) {
            if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tool.function.name)) {
              throw new FakeOpenAIError(
                400,
                `Invalid 'tools[].function.name': ${tool.function.name}`,
                undefined,
                'BadRequestError',
              );
            }
          }
          count++;
          const offered = (body.tools ?? []).map((tool) => tool.function.name);
          const messages = fromChatMessages(body.messages.filter((message) => message.role !== 'system'));
          const relabelled = messages.map((message) =>
            message.tool_calls
              ? {
                  ...message,
                  tool_calls: message.tool_calls.map((call) => ({
                    ...call,
                    label: labelOf(call.label, offered),
                  })),
                }
              : message,
          );
          const action = nextAction(turnsOfMessages(relabelled));
          const message =
            action.kind === 'tool'
              ? {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: `call_fake_${count}`,
                      type: 'function',
                      function: {
                        name: offered.find((name) => labelOf(name, offered) === action.label) ?? action.label,
                        arguments: JSON.stringify(action.input),
                      },
                    },
                  ],
                }
              : { role: 'assistant', content: action.text };
          return {
            id: `chatcmpl-fake-${count}`,
            object: 'chat.completion',
            created: 1_760_000_000 + count,
            model: routedTo,
            choices: [{ index: 0, message, finish_reason: action.kind === 'tool' ? 'tool_calls' : 'stop' }],
            usage: {
              prompt_tokens: tokens(body.messages),
              completion_tokens: tokens(message),
              total_tokens: tokens(body.messages) + tokens(message),
            },
          };
        },
      },
    },
  };
}

/** A client whose connection to the proxy fails, as the `openai` package reports it. */
export function deadLitellm(): OpenAIChatClientLike {
  return {
    chat: {
      completions: {
        async create() {
          throw new FakeOpenAIError(undefined, 'Connection error.', undefined, 'APIConnectionError');
        },
      },
    },
  };
}
