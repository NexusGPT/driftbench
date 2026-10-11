import type { AcmeStore } from '../../../../../examples/acme/src/index';
import { createStore } from '../../../../../examples/acme/src/index';
import type {
  AgentInputItemLike,
  RunItemLike,
  RunnerLike,
  RunOptionsLike,
  RunResultLike,
} from '../../../src/openai-agents/index';
import { type AcmeCall, type AcmeTurn, nextAction, runAcmeTool, tokens } from './acme-model';

/**
 * A fake OpenAI Agents SDK runner that plays the Acme agent: `run(agent, input, options)` reads the input
 * items, lets the Acme model decide, runs the agent's tools on the agent's own store, and returns the new
 * items of the run in the SDK's shapes (`tool_call_item` with a `function_call` raw item,
 * `tool_call_output_item` with the tool's value and a `function_call_result` raw item,
 * `message_output_item` with `output_text` parts), one raw response with usage per model call.
 *
 * A tool reports a failure by returning `{ "error": "..." }`, the way an agent's own tool would.
 */

/** The agent handed to the fake runner: a name and the store its tools act on. */
export type FakeAgent = { name: string; store: AcmeStore };

export function acmeAgent(): FakeAgent {
  return { name: 'Acme sales', store: createStore() };
}

export type FakeRunner = RunnerLike & {
  readonly calls: { input: AgentInputItemLike[]; options?: RunOptionsLike }[];
};

/** An error named like the SDK's, so the adapter reads it as the SDK raised it. */
export class FakeSdkError extends Error {
  constructor(
    name: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = name;
    Object.assign(this, extra);
  }
}

export function fakeRunner(): FakeRunner {
  const calls: FakeRunner['calls'] = [];
  let count = 0;
  return {
    calls,
    async run(agent: FakeAgent, input, options) {
      calls.push({ input: structuredClone(input), ...(options ? { options } : {}) });
      const turns = turnsOf(input);
      const current = turns.at(-1);
      if (current === undefined) throw new FakeSdkError('UserError', 'the input holds no user message');
      const newItems: RunItemLike[] = [];
      const rawResponses: RunResultLike['rawResponses'] & unknown[] = [];
      const maxTurns = options?.maxTurns ?? 10;
      for (let turn = 1; ; turn++) {
        if (turn > maxTurns)
          throw new FakeSdkError('MaxTurnsExceededError', `Max turns (${maxTurns}) exceeded`);
        const action = nextAction(turns);
        count++;
        if (action.kind === 'reply') {
          rawResponses.push({ usage: { inputTokens: tokens(input), outputTokens: tokens(action.text) } });
          newItems.push({
            type: 'message_output_item',
            agent: { name: agent.name },
            rawItem: {
              type: 'message',
              id: `msg_fake_${count}`,
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: action.text, annotations: [] }],
            },
          });
          break;
        }
        const callId = `call_fake_${count}`;
        const args = JSON.stringify(action.input);
        rawResponses.push({ usage: { inputTokens: tokens(input), outputTokens: tokens(args) } });
        newItems.push({
          type: 'tool_call_item',
          agent: { name: agent.name },
          rawItem: {
            type: 'function_call',
            id: `fc_fake_${count}`,
            callId,
            name: action.label,
            arguments: args,
            status: 'completed',
          },
        });
        const outcome = runAcmeTool(agent.store, action.label, action.input);
        const output = JSON.stringify(outcome.ok ? outcome.output : { error: outcome.error });
        newItems.push({
          type: 'tool_call_output_item',
          agent: { name: agent.name },
          output,
          rawItem: {
            type: 'function_call_result',
            callId,
            name: action.label,
            status: 'completed',
            output: { type: 'text', text: output },
          },
        });
        current.calls.push({ label: action.label, input: action.input, outcome });
      }
      return {
        newItems,
        rawResponses,
        inputGuardrailResults: [],
        outputGuardrailResults: [],
        lastAgent: { name: agent.name },
      };
    },
  };
}

/** A runner whose model connection fails, the way the openai client reports it: `APIConnectionError`. */
export function deadRunner(): RunnerLike {
  return {
    async run() {
      throw new FakeSdkError('APIConnectionError', 'Connection error.', {
        cause: new FakeSdkError('TypeError', 'fetch failed', { code: 'ECONNREFUSED' }),
      });
    },
  };
}

/** A runner that answers with the given run results in order, for recorded runs. */
export function recordedRunner(results: readonly unknown[]): FakeRunner {
  const calls: FakeRunner['calls'] = [];
  return {
    calls,
    async run(_agent, input, options) {
      calls.push({ input: structuredClone(input), ...(options ? { options } : {}) });
      const next = results[calls.length - 1];
      if (next === undefined) throw new Error(`no recorded run for call ${calls.length}`);
      return structuredClone(next) as RunResultLike;
    },
  };
}

/** The input items as Acme turns. */
function turnsOf(input: readonly AgentInputItemLike[]): AcmeTurn[] {
  const turns: AcmeTurn[] = [];
  const pending = new Map<string, AcmeCall>();
  for (const item of input) {
    if ('role' in item && item.role === 'user') {
      const open = turns.at(-1);
      if (open && !open.answered) open.text = `${open.text}\n${item.content}`;
      else turns.push({ text: item.content, calls: [], answered: false });
    } else if ('role' in item && item.role === 'assistant') {
      const open = turns.at(-1);
      if (open) open.answered = true;
    } else if ('type' in item && item.type === 'function_call') {
      const call: AcmeCall = { label: item.name, input: JSON.parse(item.arguments) };
      turns.at(-1)?.calls.push(call);
      pending.set(item.callId, call);
    } else if ('type' in item && item.type === 'function_call_result') {
      const call = pending.get(item.callId);
      if (!call) continue;
      const value = JSON.parse(item.output.text) as unknown;
      const error =
        value !== null && typeof value === 'object' && 'error' in value && Object.keys(value).length === 1
          ? String((value as { error: unknown }).error)
          : undefined;
      call.outcome = error !== undefined ? { ok: false, error } : { ok: true, output: value };
    }
  }
  return turns;
}
