import type { Message, TargetRef, WorldState } from '../schema/common';
import type { Observed, ResolvedGiven } from '../schema/run';
import type { GivenOverride, Spec, Stimulus } from '../schema/spec';
import { contentHash } from '../spec/hash';
import { deepEqual } from './assertion';

/**
 * The Given of a free-running run, carried from block to block. The spec's `given` is the start. A block's
 * `given` merges into it from that block onwards, and so does the world of an injected perturbation. A
 * block's `ledger_add` joins the ledger after the block. For each tool, store key, fixture, variable and
 * fact the later value wins; a later workspace replaces the earlier one.
 */
export type RunningGiven = {
  ledger: Record<string, unknown>;
  world: WorldState;
  vars: Record<string, unknown>;
};

export function initialGiven(spec: Spec): RunningGiven {
  return {
    ledger: { ...spec.given?.ledger },
    world: mergeWorld({}, spec.given?.world),
    vars: { ...spec.given?.vars },
  };
}

/** The running Given once a block's own `given` (or an injected perturbation's world) is applied. */
export function enterBlock(
  state: RunningGiven,
  given: GivenOverride | undefined,
  world?: WorldState,
): RunningGiven {
  return {
    ledger: { ...state.ledger, ...given?.ledger },
    world: mergeWorld(mergeWorld(state.world, given?.world), world),
    vars: { ...state.vars, ...given?.vars },
  };
}

/** The resolved Given of one block: what it starts from, and the content hash of all of it. */
export function resolveGiven(
  state: RunningGiven,
  prefix: readonly Message[],
  target: TargetRef,
): ResolvedGiven {
  const body = {
    prefix: structuredClone([...prefix]),
    ledger: structuredClone(state.ledger),
    world: structuredClone(state.world),
    vars: structuredClone(state.vars),
    target: structuredClone(target),
  };
  return { ...body, hash: contentHash(body) };
}

/** Merges a later world into an earlier one: tools, store keys and fixtures by name, the workspace whole. */
export function mergeWorld(base: WorldState, next: WorldState | undefined): WorldState {
  if (!next) return base;
  const tools = { ...base.tools, ...next.tools };
  const store = { ...base.store, ...next.store };
  const fixtures = { ...base.fixtures, ...next.fixtures };
  const workspace = next.workspace ?? base.workspace;
  return {
    ...(Object.keys(tools).length > 0 ? { tools } : {}),
    ...(Object.keys(store).length > 0 ? { store } : {}),
    ...(workspace ? { workspace } : {}),
    ...(Object.keys(fixtures).length > 0 ? { fixtures } : {}),
  };
}

/**
 * Adds a block's facts to the ledger. A contradiction is a fact the block adds with a value that differs
 * from the one the ledger already holds; the evidence names the fact and both values.
 */
export function addFacts(
  ledger: Record<string, unknown>,
  facts: Record<string, unknown> | undefined,
): { ledger: Record<string, unknown>; contradictions: string[] } {
  const contradictions: string[] = [];
  for (const [fact, value] of Object.entries(facts ?? {})) {
    if (Object.hasOwn(ledger, fact) && !deepEqual(ledger[fact], value)) {
      contradictions.push(
        `${fact}: the ledger holds ${JSON.stringify(ledger[fact])}, the block adds ${JSON.stringify(value)}`,
      );
    }
  }
  return { ledger: { ...ledger, ...facts }, contradictions };
}

/** The user messages a stimulus sends: one message, the messages of a burst, or the injected message. */
export function stimulusMessages(stimulus: Stimulus): Message[] {
  if ('user' in stimulus) return [{ role: 'user', content: stimulus.user }];
  if ('burst' in stimulus) return stimulus.burst.map((content): Message => ({ role: 'user', content }));
  return [{ role: 'user', content: stimulus.injection.user }];
}

type RecordedCall = NonNullable<Message['tool_calls']>[number];
type Json = RecordedCall['input'];

/** The assistant message the history keeps for a block: the reply, and each tool call with its result or error. */
export function assistantMessage(observed: Observed): Message {
  const calls = observed.toolCalls.map((call) => {
    const recorded: RecordedCall = { label: call.label };
    if (call.id !== undefined) recorded.id = call.id;
    if (call.input !== undefined) recorded.input = call.input as Json;
    if (call.error !== undefined) recorded.error = call.error;
    else recorded.output = call.output as Json;
    return recorded;
  });
  return calls.length > 0
    ? { role: 'assistant', content: observed.text, tool_calls: calls }
    : { role: 'assistant', content: observed.text };
}
