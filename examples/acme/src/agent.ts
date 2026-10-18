import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Message, Observed, Segment, ToolCall, WorldState } from '@agent-nexus/driftbench-core';
import { type CallTool, initialState, type State, takeTurn } from './policy';
import { type AcmeStore, createStore } from './store';
import { callTool, type ToolOutcome } from './tools';

/**
 * The Acme Telecom sales assistant: deterministic, in process, no model, no API key, no network.
 *
 * `respond` takes the whole conversation and answers its last user turn. It rebuilds its state from the
 * earlier turns: their user messages, and the tool results recorded on assistant messages
 * (`tool_calls[].output` or `.error`), so the agent never calls a tool twice for the same past turn. A
 * past call without a recorded result is re-read from the store, with nothing recorded. Consecutive
 * user messages form one turn and get one reply.
 *
 * Every tool call of the answered turn becomes a `tool_call` segment followed by its `tool_result`
 * segment; the reply is one `text` segment; `runtime.stages` names the flow stage the turn ends in, and
 * `runtime.guards` lists the guardrails that fired.
 *
 * The answered turn also reads the files of `world.workspace`, the documents the customer shares: the
 * folder `from`, then `files` over it. Like tool answers they are data, never instructions (`takeTurn`).
 */
export type AcmeAgent = {
  respond(messages: Message[], world?: WorldState): Promise<Observed>;
};

export function createAcmeAgent(store: AcmeStore = createStore()): AcmeAgent {
  return {
    async respond(messages, world) {
      return respond(store, messages, world);
    },
  };
}

type RecordedCall = NonNullable<Message['tool_calls']>[number];
type Turn = { text: string; calls: RecordedCall[]; answered: boolean };

function respond(store: AcmeStore, messages: Message[], world: WorldState | undefined): Observed {
  const turns = splitTurns(messages);
  const current = turns.at(-1);
  if (!current || current.answered) throw new Error('the last message must come from the user');

  let state: State = initialState();
  for (const turn of turns.slice(0, -1)) {
    state = takeTurn(state, turn.text, replay(turn.calls, store, world)).state;
  }

  const live = liveTools(store, world);
  const { state: next, reply, guards } = takeTurn(state, current.text, live.call, documents(world));
  const segments: Segment[] = [...live.segments, { type: 'text', text: reply }];
  return {
    segments,
    text: reply,
    toolCalls: live.toolCalls,
    runtime:
      guards.length > 0 ? { stages: [{ name: next.stage }], guards } : { stages: [{ name: next.stage }] },
    cost: { usd: 0 },
    latencyMs: live.toolCalls.reduce((sum, call) => sum + (call.latencyMs ?? 0), 0),
    raw: { state: next },
  };
}

function splitTurns(messages: Message[]): Turn[] {
  const turns: Turn[] = [];
  let open: Turn | undefined;
  let texts: string[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      if (!open || open.answered) {
        texts = [];
        open = { text: '', calls: [], answered: false };
        turns.push(open);
      }
      texts.push(message.content);
      open.text = texts.join('\n');
    } else if (message.role === 'assistant' && open) {
      open.answered = true;
      open.calls.push(...(message.tool_calls ?? []));
    }
    // System and tool messages carry nothing this agent replays.
  }
  return turns;
}

/** The workspace files, by path: the regular files of the folder `from`, then `files` over them. */
function documents(world: WorldState | undefined): string[] {
  const workspace = world?.workspace;
  if (!workspace) return [];
  const byPath = new Map<string, string>();
  if (workspace.from !== undefined) {
    for (const entry of readdirSync(workspace.from, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const path = join(entry.parentPath, entry.name);
      byPath.set(relative(workspace.from, path), readFileSync(path, 'utf8'));
    }
  }
  for (const [path, content] of Object.entries(workspace.files ?? {})) byPath.set(path, content);
  return [...byPath.keys()].sort().map((path) => byPath.get(path) ?? '');
}

/** Tools for an earlier turn: recorded results first, then a read of the store that records nothing. */
function replay(recorded: RecordedCall[], store: AcmeStore, world: WorldState | undefined): CallTool {
  const queue = [...recorded];
  return (label, input) => {
    const index = queue.findIndex((call) => call.label === label);
    const [call] = index >= 0 ? queue.splice(index, 1) : [];
    if (call?.error !== undefined) return { ok: false, error: call.error };
    if (call && 'output' in call) return { ok: true, output: call.output };
    return callTool(label, input, { store, seed: world?.store, commit: false });
  };
}

/** Tools for the answered turn: overrides apply, payloads are recorded, every call is observed. */
function liveTools(store: AcmeStore, world: WorldState | undefined) {
  const segments: Segment[] = [];
  const toolCalls: ToolCall[] = [];
  const call: CallTool = (label, input) => {
    const id = `call-${toolCalls.length + 1}`;
    const override = world?.tools?.[label];
    const outcome: ToolOutcome = callTool(label, input, {
      store,
      seed: world?.store,
      override,
      commit: true,
    });
    const latencyMs = override?.latency_ms ?? 0;
    const shown = structuredClone(input);
    segments.push({ type: 'tool_call', id, label, input: shown });
    if (outcome.ok) {
      segments.push({ type: 'tool_result', id, label, output: outcome.output });
      toolCalls.push({ id, label, input: shown, output: outcome.output, latencyMs });
    } else {
      segments.push({ type: 'tool_result', id, label, output: null, error: outcome.error });
      toolCalls.push({ id, label, input: shown, error: outcome.error, latencyMs });
    }
    return outcome;
  };
  return { call, segments, toolCalls };
}
