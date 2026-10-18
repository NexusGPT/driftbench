import type { WorldState } from '@agent-nexus/driftbench-core';
import {
  type AcmeStore,
  callTool,
  createStore,
  initialState,
  isToolLabel,
  type State,
  TOOL_LABELS,
  type ToolOutcome,
  takeTurn,
} from '../../../../../examples/acme/src/index';

/**
 * The Acme Telecom sales agent played as a model: deterministic, no network, no key.
 *
 * A vendor fake turns its request into turns, asks `nextAction` what the model does next, and writes the
 * answer in its vendor's shape. The decision is the Acme policy's: earlier turns replay from the tool
 * results recorded in the conversation, and the current turn runs until it needs a tool result the
 * conversation does not hold yet (the model asks for that tool) or ends with a reply.
 *
 * The Acme agent calls one tool at a time, since each call depends on the last; so does this model.
 */

/** One tool call as a conversation records it: the label, the input, and the outcome when it came back. */
export type AcmeCall = { label: string; input: unknown; outcome?: ToolOutcome };

/** One customer turn: the user text, the tool calls made for it in order, and whether it was answered. */
export type AcmeTurn = { text: string; calls: AcmeCall[]; answered: boolean };

export type AcmeAction =
  | { kind: 'tool'; label: string; input: Record<string, unknown> }
  | { kind: 'reply'; text: string; stage: string; guards: { name: string; verdict: string }[] };

class NeedsTool {
  constructor(
    readonly label: string,
    readonly input: Record<string, unknown>,
  ) {}
}

/** What the model does next for the last turn: ask for a tool, or reply. */
export function nextAction(turns: readonly AcmeTurn[]): AcmeAction {
  const current = turns.at(-1);
  if (current === undefined || current.answered) throw new Error("the last turn must be the customer's");
  let state: State = initialState();
  const reader = createStore();
  for (const turn of turns.slice(0, -1)) state = takeTurn(state, turn.text, replay(turn.calls, reader)).state;

  let answered = 0;
  try {
    const {
      state: next,
      reply,
      guards,
    } = takeTurn(state, current.text, (label, input) => {
      const call = current.calls[answered];
      if (call?.outcome === undefined) throw new NeedsTool(label, input);
      answered++;
      return call.outcome;
    });
    return { kind: 'reply', text: reply, stage: next.stage, guards };
  } catch (thrown) {
    if (thrown instanceof NeedsTool) return { kind: 'tool', label: thrown.label, input: thrown.input };
    throw thrown;
  }
}

/** An earlier turn's tools: the recorded results first, by label, then a read of a store that records nothing. */
function replay(recorded: readonly AcmeCall[], reader: AcmeStore) {
  const queue = [...recorded];
  return (label: (typeof TOOL_LABELS)[number], input: Record<string, unknown>): ToolOutcome => {
    const index = queue.findIndex((call) => call.label === label && call.outcome !== undefined);
    const [call] = index >= 0 ? queue.splice(index, 1) : [];
    if (call?.outcome) return call.outcome;
    return callTool(label, input, { store: reader, commit: false });
  };
}

/** Runs one Acme tool against a session's store, the way the agent's own implementation would. */
export function runAcmeTool(
  store: AcmeStore,
  label: string,
  input: unknown,
  world: WorldState = {},
): ToolOutcome {
  if (!isToolLabel(label)) return { ok: false, error: `unknown tool ${label}` };
  return callTool(label, (input ?? {}) as Record<string, unknown>, {
    store,
    seed: world.store,
    commit: true,
  });
}

/** The tool labels and the side-effecting ones, as the adapters' options name them. */
export const ACME_TOOLS = TOOL_LABELS;
export const ACME_SIDE_EFFECTS = ['order.create', 'notify_sales'] as const;

/** The Acme tools as an agent built on the OpenAI or LangChain SDK names them (no dot), to their spec labels. */
export const ACME_TOOL_NAMES: Readonly<Record<string, string>> = Object.fromEntries(
  ACME_TOOLS.map((label) => [sdkName(label), label]),
);

/** The SDK tool name of an Acme label: the dot becomes an underscore. */
export function sdkName(label: string): string {
  return label.replace(/\./g, '_');
}

/** A wire name back to its Acme label: the vendor fake reads the tool list it was sent. */
export function labelOf(wireName: string, offered: readonly string[]): string {
  const flat = (value: string) => value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  return (
    ACME_TOOLS.find((label) => label === wireName || flat(label) === flat(wireName)) ??
    offered.find((name) => name === wireName) ??
    wireName
  );
}

/** The Acme label as the wire name the request offered for it, the way a model reads its tool list. */
export function wireOf(label: string, offered: readonly string[]): string {
  const flat = (value: string) => value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  const found = offered.find((name) => name === label) ?? offered.find((name) => flat(name) === flat(label));
  if (found === undefined) throw new Error(`the request offered no tool for ${label}: ${offered.join(', ')}`);
  return found;
}

/** A tool outcome the way the Acme tools give it, from a vendor's result text or value. */
export function outcomeFromOutput(output: unknown, error?: string): ToolOutcome {
  return error !== undefined ? { ok: false, error } : { ok: true, output };
}

/** A deterministic token count for fake usage: one token per four characters, at least one. */
export function tokens(value: unknown): number {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return Math.max(1, Math.ceil(text.length / 4));
}
