import { type AcmeStore, createStore } from '../../../../../examples/acme/src/index';
import type { GraphConfigLike, GraphLike, LangChainMessageLike } from '../../../src/langgraph/index';
import {
  type AcmeCall,
  type AcmeTurn,
  labelOf,
  nextAction,
  runAcmeTool,
  sdkName,
  tokens,
} from './acme-model';

/**
 * A fake compiled LangGraph graph that plays the Acme agent as a ReAct loop: an `agent` node (the Acme
 * model) and a `tools` node (the Acme tools on the thread's store), until the agent replies.
 *
 * Messages are LangChain-like instances: `getType()` answers `human`, `ai`, `tool` or `system`; an AI
 * message carries `tool_calls` and `usage_metadata`; a tool message carries `tool_call_id`, `name` and a
 * `status` of `error` when the tool failed, as LangGraph's `ToolNode` writes it. With `checkpointed`, a
 * `MemorySaver`-like checkpointer keeps each thread's messages and `getState` reads them; without, every
 * invoke starts from the messages it is given.
 */

type Kind = 'human' | 'ai' | 'tool' | 'system';

export class FakeMessage {
  constructor(
    readonly kind: Kind,
    readonly content: string,
    readonly id: string,
    readonly extra: {
      tool_calls?: { id: string; name: string; args: Record<string, unknown>; type: 'tool_call' }[];
      tool_call_id?: string;
      name?: string;
      status?: 'success' | 'error';
      usage_metadata?: { input_tokens: number; output_tokens: number; total_tokens: number };
    } = {},
  ) {
    Object.assign(this, extra);
  }
  getType(): Kind {
    return this.kind;
  }
}

export type FakeSaver = {
  threads: Map<string, FakeMessage[]>;
  deleteThread(threadId: string): Promise<void>;
};

export type FakeGraph = GraphLike & {
  readonly invocations: { input: LangChainMessageLike[]; config?: GraphConfigLike }[];
  readonly saver?: FakeSaver;
};

export function fakeGraph(options: { checkpointed: boolean }): FakeGraph {
  const invocations: FakeGraph['invocations'] = [];
  const stores = new Map<string, AcmeStore>();
  let count = 0;
  const saver: FakeSaver | undefined = options.checkpointed
    ? {
        threads: new Map(),
        async deleteThread(threadId) {
          this.threads.delete(threadId);
          stores.delete(threadId);
        },
      }
    : undefined;
  const nextId = (prefix: string) => `${prefix}-${++count}`;

  return {
    invocations,
    ...(saver ? { saver, checkpointer: saver } : {}),
    async invoke(input, config) {
      invocations.push({ input: structuredClone(input.messages), ...(config ? { config } : {}) });
      const thread = config?.configurable?.thread_id ?? 'default';
      const messages = [
        ...(saver?.threads.get(thread) ?? []),
        ...input.messages.map((message) => coerce(message, nextId)),
      ];
      let store = stores.get(thread);
      if (!store) {
        store = createStore();
        stores.set(thread, store);
      }
      const limit = config?.recursionLimit ?? 25;
      for (let step = 1; ; step++) {
        if (step > limit) {
          throw Object.assign(
            new Error(`Recursion limit of ${limit} reached without hitting a stop condition.`),
            { name: 'GraphRecursionError' },
          );
        }
        const last = messages.at(-1);
        if (last?.kind === 'ai' && !last.extra.tool_calls?.length) break;
        if (last?.kind === 'ai') {
          // The tools node: run every call of the last AI message.
          for (const call of last.extra.tool_calls ?? []) {
            const outcome = runAcmeTool(store, labelOf(call.name, []), call.args);
            messages.push(
              new FakeMessage(
                'tool',
                outcome.ok ? JSON.stringify(outcome.output) : outcome.error,
                nextId('tool'),
                {
                  tool_call_id: call.id,
                  name: call.name,
                  status: outcome.ok ? 'success' : 'error',
                },
              ),
            );
          }
          continue;
        }
        // The agent node.
        const action = nextAction(turnsOf(messages));
        const usage = (text: unknown) => ({
          input_tokens: tokens(messages.map((message) => message.content)),
          output_tokens: tokens(text),
        });
        if (action.kind === 'reply') {
          const u = usage(action.text);
          messages.push(
            new FakeMessage('ai', action.text, nextId('ai'), {
              tool_calls: [],
              usage_metadata: { ...u, total_tokens: u.input_tokens + u.output_tokens },
            }),
          );
        } else {
          const u = usage(action.input);
          messages.push(
            new FakeMessage('ai', '', nextId('ai'), {
              tool_calls: [
                { id: nextId('call'), name: sdkName(action.label), args: action.input, type: 'tool_call' },
              ],
              usage_metadata: { ...u, total_tokens: u.input_tokens + u.output_tokens },
            }),
          );
        }
      }
      saver?.threads.set(thread, messages);
      return { messages: [...messages] };
    },
    async getState(config) {
      if (!saver) throw new Error('No checkpointer set');
      const thread = config.configurable?.thread_id ?? 'default';
      return { values: { messages: [...(saver.threads.get(thread) ?? [])] }, next: [], config };
    },
  };
}

/** A graph whose remote server refuses connections, the way a `RemoteGraph` reports it. */
export function deadGraph(): GraphLike {
  return {
    async invoke() {
      throw Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
      });
    },
  };
}

/** A graph that answers the given states in order, for recorded invokes. */
export function recordedGraph(states: readonly unknown[]): FakeGraph {
  const invocations: FakeGraph['invocations'] = [];
  return {
    invocations,
    async invoke(input, config) {
      invocations.push({ input: structuredClone(input.messages), ...(config ? { config } : {}) });
      const next = states[invocations.length - 1];
      if (next === undefined) throw new Error(`no recorded state for invoke ${invocations.length}`);
      return structuredClone(next);
    },
  };
}

/** A message-like dict as a fake message, the way LangChain coerces one. */
function coerce(message: LangChainMessageLike, nextId: (prefix: string) => string): FakeMessage {
  if (message.role === 'user') return new FakeMessage('human', message.content, nextId('human'));
  if (message.role === 'system') return new FakeMessage('system', message.content, nextId('system'));
  if (message.role === 'tool') {
    return new FakeMessage('tool', message.content, nextId('tool'), {
      tool_call_id: message.tool_call_id,
      name: message.name,
      status: message.status ?? 'success',
    });
  }
  if (message.role !== 'assistant') throw new Error(`a message of role ${message.role} cannot be coerced`);
  return new FakeMessage('ai', message.content, nextId('ai'), {
    tool_calls: (message.tool_calls ?? []).map((call) => ({ ...call, type: 'tool_call' as const })),
  });
}

/** The thread's messages as Acme turns. */
function turnsOf(messages: readonly FakeMessage[]): AcmeTurn[] {
  const turns: AcmeTurn[] = [];
  const pending = new Map<string, AcmeCall>();
  for (const message of messages) {
    if (message.kind === 'human') {
      const open = turns.at(-1);
      if (open && !open.answered) open.text = `${open.text}\n${message.content}`;
      else turns.push({ text: message.content, calls: [], answered: false });
    } else if (message.kind === 'ai') {
      for (const call of message.extra.tool_calls ?? []) {
        const recorded: AcmeCall = { label: labelOf(call.name, []), input: call.args };
        turns.at(-1)?.calls.push(recorded);
        pending.set(call.id, recorded);
      }
      if (message.content !== '') {
        const open = turns.at(-1);
        if (open) open.answered = true;
      }
    } else if (message.kind === 'tool') {
      const call = pending.get(message.extra.tool_call_id ?? '');
      if (!call) continue;
      call.outcome =
        message.extra.status === 'error'
          ? { ok: false, error: message.content }
          : { ok: true, output: JSON.parse(message.content) as unknown };
    }
  }
  return turns;
}
