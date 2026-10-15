import { deepEqual } from '@agent-nexus/driftbench-core';
import { isRecord, show } from '../support/values';
import type { Rung } from './ladder';

/**
 * Rung 1, the outcome: ask the tool. The tool that receives a value decides what the value means, so the rung
 * replays the agent's own call twice on the same world, once as the agent wrote it and once with the gold
 * value in its place, and compares what the tool resolves (the output fields its declaration names: an id,
 * found or not, the canonical form it echoes back). The same result passes, however different the strings
 * look; a different result fails, however close they look. value_equivalence.md section 3, rung 1; HF6.
 *
 * The replay always runs the real tool, never a forced result: a forced result answers the same for any value.
 */

/** What a replayable tool declares once: the output fields that are its resolved result. */
export type ToolDeclaration = {
  /** Dotted output paths: `address_id`, `customer.id`. */
  resolved: readonly string[];
  /**
   * True when the replay world holds neighbours of the gold referent (another address, another customer), so a
   * same result is not a coincidence. A policy with `distractors_required` passes nothing on a world without.
   */
  distractors?: boolean;
};

/** What one replayed call returned. */
export type ReplayOutcome = { ok: true; output: unknown } | { ok: false; error: string };

/** Runs a tool in the sandbox. A tool it has no declaration for is not replayable. */
export type ToolReplayer = {
  declaration(tool: string): ToolDeclaration | undefined;
  call(
    tool: string,
    input: Record<string, unknown>,
    world: Readonly<Record<string, unknown>> | undefined,
  ): Promise<ReplayOutcome> | ReplayOutcome;
};

export const outcome: Rung = async (value, ctx) => {
  const replayer = ctx.services.replayer;
  const declaration = value.tool === undefined ? undefined : replayer?.declaration(value.tool);
  if (replayer === undefined || value.tool === undefined || declaration === undefined) {
    return { skip: 'no replayer declares this tool' };
  }
  if (value.input === undefined) return { skip: 'no call input to replay' };
  const tool = value.tool;
  const mine = await replayer.call(tool, structuredClone({ ...value.input }), value.world);
  const gold = await replayer.call(tool, withPath(value.input, value.field, value.gold), value.world);
  if (!gold.ok) return { skip: `${tool} refuses the gold call itself: ${gold.error}` };
  if (!mine.ok) {
    return {
      settles: 'fail',
      evidence: `${tool} refuses ${show(value.value)}: ${mine.error}; the gold ${show(value.gold)} is accepted`,
      emits: { outcome: 'failed' },
    };
  }
  const agent = resolvedOf(mine.output, declaration.resolved);
  const reference = resolvedOf(gold.output, declaration.resolved);
  if (deepEqual(agent, reference)) {
    if (ctx.params.distractors_required === true && declaration.distractors !== true) {
      return {
        skip: `${tool} resolves both values the same, but its world declares no distractor to tell the gold referent apart`,
      };
    }
    return {
      settles: 'pass',
      evidence: `${tool} resolves ${show(value.value)} as it resolves the gold ${show(value.gold)}: ${show(agent)}`,
      emits: { outcome: 'accepted_as_gold' },
    };
  }
  const failed = Object.values(agent).every(
    (entry) => entry === undefined || entry === null || entry === false,
  );
  return {
    settles: 'fail',
    evidence: `${tool} resolves ${show(value.value)} to ${show(agent)}, and the gold ${show(value.gold)} to ${show(reference)}`,
    emits: { outcome: failed ? 'failed' : 'resolved_differently' },
  };
};

/** The declared output fields of a result, by dotted path; a missing field reads as null. */
function resolvedOf(output: unknown, paths: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(paths.map((path) => [path, valueAt(output, path) ?? null]));
}

/** The value at a dotted path, or undefined. */
export function valueAt(root: unknown, path: string): unknown {
  let at = root;
  for (const key of path.split('.')) {
    if (!isRecord(at)) return undefined;
    at = at[key];
  }
  return at;
}

/** A copy of an input with the value at a dotted path replaced; missing objects on the way are created. */
export function withPath(input: Readonly<Record<string, unknown>>, path: string, replacement: unknown) {
  const copy = structuredClone({ ...input }) as Record<string, unknown>;
  const keys = path.split('.');
  let at = copy;
  for (const key of keys.slice(0, -1)) {
    const next = at[key];
    if (!isRecord(next)) at[key] = {};
    at = at[key] as Record<string, unknown>;
  }
  at[keys[keys.length - 1] as string] = replacement;
  return copy;
}
