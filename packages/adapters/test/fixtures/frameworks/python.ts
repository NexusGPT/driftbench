import type { Message } from '@agent-nexus/driftbench-core';
import type { ExecLike, ExecRequest } from '../../../src/shared/bridge';
import { labelOf, sdkName, tokens } from '../sdk/acme-model';
import { type AcmeStore, createStore, runTurn, turnsOfMessages } from './acme-loop';

/**
 * Fakes of the two Python bridges: an `exec` that reads the request the adapter writes to stdin, plays the
 * Acme agent, and prints what the bridge prints, framework shapes included. Each fake keeps one store, so
 * one fake serves one session. `noise` adds lines a framework prints on stdout, which the adapter skips.
 */

type Fake = ExecLike & { readonly requests: ExecRequest[] };

const BANNER = 'pydantic-ai v2.55.0 (a banner line the adapter must skip)';

/** The pydantic-ai bridge: `{ user_prompt, message_history }` in, the run's new messages out. */
export function fakePydanticBridge(store: AcmeStore = createStore()): Fake {
  const requests: ExecRequest[] = [];
  const exec = async (request: ExecRequest) => {
    requests.push(request);
    const { user_prompt: prompt, message_history: history } = JSON.parse(request.input) as {
      user_prompt: string;
      message_history: { kind: string; parts: Record<string, unknown>[] }[];
    };
    const turns = turnsOfMessages([...fromPydantic(history), { role: 'user', content: prompt }]);
    const steps = runTurn(turns, store);
    const at = '2026-10-12T08:00:00Z';
    const messages: unknown[] = [
      { kind: 'request', parts: [{ part_kind: 'user-prompt', content: prompt, timestamp: at }] },
    ];
    steps.forEach((step, index) => {
      const usage = { input_tokens: tokens(prompt) + index, output_tokens: tokens(step), cost: null };
      if (step.kind === 'reply') {
        messages.push({
          kind: 'response',
          model_name: 'function:acme',
          usage,
          parts: [{ part_kind: 'text', content: step.text }],
        });
        return;
      }
      const id = `pyd_call_${index + 1}`;
      const name = sdkName(step.label);
      messages.push({
        kind: 'response',
        model_name: 'function:acme',
        usage,
        parts: [{ part_kind: 'tool-call', tool_name: name, args: step.input, tool_call_id: id }],
      });
      messages.push({
        kind: 'request',
        parts: [
          step.ok
            ? {
                part_kind: 'tool-return',
                tool_name: name,
                content: step.output,
                tool_call_id: id,
                outcome: 'success',
              }
            : { part_kind: 'retry-prompt', tool_name: name, content: step.error, tool_call_id: id },
        ],
      });
    });
    return { stdout: `${BANNER}\ndriftbench-result ${JSON.stringify(messages)}\n`, stderr: '', exitCode: 0 };
  };
  return Object.assign(exec, { requests });
}

/** Pydantic AI messages back into driftbench messages. */
function fromPydantic(history: { kind: string; parts: Record<string, unknown>[] }[]): Message[] {
  const out: Message[] = [];
  for (const message of history) {
    for (const part of message.parts) {
      if (part.part_kind === 'user-prompt') out.push({ role: 'user', content: String(part.content) });
      else if (part.part_kind === 'text') out.push({ role: 'assistant', content: String(part.content) });
      else if (part.part_kind === 'tool-call') {
        out.push({
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: String(part.tool_call_id),
              label: labelOf(String(part.tool_name), []),
              input: part.args as never,
            },
          ],
        });
      } else if (part.part_kind === 'tool-return' || part.part_kind === 'retry-prompt') {
        const call = out
          .flatMap((entry) => entry.tool_calls ?? [])
          .find((entry) => entry.id === part.tool_call_id);
        if (!call) continue;
        if (part.part_kind === 'retry-prompt') call.error = String(part.content);
        else call.output = part.content as never;
      }
    }
  }
  return out;
}

/** The crewai bridge: `{ inputs }` in (the history as JSON in `inputs.messages`), the crew's run out. */
export function fakeCrewBridge(store: AcmeStore = createStore()): Fake {
  const requests: ExecRequest[] = [];
  const exec = async (request: ExecRequest) => {
    requests.push(request);
    const { inputs } = JSON.parse(request.input) as { inputs: Record<string, string> };
    const history = JSON.parse(inputs.messages ?? '[]') as Message[];
    const steps = runTurn(turnsOfMessages(history), store);
    const reply = steps.find((step) => step.kind === 'reply');
    const raw = reply?.kind === 'reply' ? reply.text : '';
    const tools = steps.flatMap((step) =>
      step.kind === 'tool'
        ? [
            step.ok
              ? { tool: sdkName(step.label), input: step.input, output: JSON.stringify(step.output) }
              : { tool: sdkName(step.label), input: step.input, error: step.error },
          ]
        : [],
    );
    const result = {
      raw,
      tasks: [{ name: 'answer', agent: 'Acme sales', raw }],
      tools,
      usage: { prompt_tokens: tokens(inputs), completion_tokens: tokens(raw) },
    };
    return {
      stdout: `crew log line\ndriftbench-result ${JSON.stringify(result)}\n`,
      stderr: '',
      exitCode: 0,
    };
  };
  return Object.assign(exec, { requests });
}

/** A bridge whose interpreter is not installed, as `spawnExec` reports it. */
export { spawnExec } from '../../../src/shared/bridge';
