import type { Message } from '@agent-nexus/driftbench-core';
import { type AcmeStore, createStore } from '../../../../../examples/acme/src/index';
import { type AcmeCall, type AcmeTurn, labelOf, nextAction, runAcmeTool } from '../sdk/acme-model';

/**
 * The Acme agent's loop for the framework fakes: turns read from driftbench messages, then the Acme model
 * asked again and again, its tools run on the fake's store, until it replies. Each fake writes what this
 * loop did in its framework's own shapes.
 */

/** Driftbench messages as Acme turns: a recorded call carries its output or error as its outcome. */
export function turnsOfMessages(messages: readonly Message[]): AcmeTurn[] {
  const turns: AcmeTurn[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      const open = turns.at(-1);
      if (open && !open.answered) open.text = `${open.text}\n${message.content}`;
      else turns.push({ text: message.content, calls: [], answered: false });
    } else if (message.role === 'assistant') {
      const open = turns.at(-1);
      for (const call of message.tool_calls ?? []) {
        const recorded: AcmeCall = { label: labelOf(call.label, []), input: call.input ?? {} };
        if (call.error !== undefined) recorded.outcome = { ok: false, error: call.error };
        else if ('output' in call) recorded.outcome = { ok: true, output: call.output };
        open?.calls.push(recorded);
      }
      if (open && message.content !== '') open.answered = true;
    }
  }
  return turns;
}

/** One step of the loop: a tool the agent called with its outcome, or the reply. */
export type LoopStep =
  | {
      kind: 'tool';
      label: string;
      input: Record<string, unknown>;
      ok: boolean;
      output?: unknown;
      error?: string;
    }
  | { kind: 'reply'; text: string };

/**
 * Runs the current turn to its reply. `answer` runs a tool and gives its outcome; by default the Acme tool
 * on `store`. Throws when the agent asks for more than `maxSteps` tools.
 */
export function runTurn(
  turns: AcmeTurn[],
  store: AcmeStore,
  answer?: (
    label: string,
    input: Record<string, unknown>,
  ) => { ok: true; output: unknown } | { ok: false; error: string },
  maxSteps = 12,
): LoopStep[] {
  const current = turns.at(-1);
  if (!current) throw new Error('no customer turn');
  const steps: LoopStep[] = [];
  for (let step = 0; step < maxSteps; step++) {
    const action = nextAction(turns);
    if (action.kind === 'reply') {
      steps.push({ kind: 'reply', text: action.text });
      return steps;
    }
    const outcome = answer
      ? answer(action.label, action.input)
      : runAcmeTool(store, action.label, action.input);
    current.calls.push({ label: action.label, input: action.input, outcome });
    steps.push(
      outcome.ok
        ? { kind: 'tool', label: action.label, input: action.input, ok: true, output: outcome.output }
        : { kind: 'tool', label: action.label, input: action.input, ok: false, error: outcome.error },
    );
  }
  throw new Error(`the agent asked for more than ${maxSteps} tools`);
}

export { type AcmeStore, createStore };
