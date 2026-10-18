import { type LoadResult, validateSpec } from '@agent-nexus/driftbench-core';
import { type SpaceMap, validateSpaceMap } from '@agent-nexus/driftbench-space';

/** A valid map from a plain object. Throws with the issues when the object is not one. */
export function map(raw: unknown): SpaceMap {
  const result = validateSpaceMap(raw);
  if (!result.ok) throw new Error(`expected a valid map, got ${JSON.stringify(result.errors, null, 2)}`);
  return result.map;
}

/** A valid spec with one block; the fields given replace or add to it. */
export function spec(fields: Record<string, unknown>): LoadResult {
  const result = validateSpec(
    { blocks: [{ user: 'hi', expect: { must: ['hello'] } }], ...fields },
    `specs/${String(fields.id)}.yaml`,
  );
  if (!result.ok) throw new Error(`expected a valid spec, got ${JSON.stringify(result.errors, null, 2)}`);
  return result;
}

/** A block that reaches a stage. */
export const at = (stage: string, user = 'next') => ({ user, expect: { stage } });

/**
 * The hand-computed example used across the tests. Three dimensions of two values each (8 cells); the one
 * constraint forbids a loose confirmation on whatsapp, which removes 2 cells (6 allowed) and 1 of the 12
 * pairs (11 allowed). Stage a weighs 3 to b's 1, none 9 to D4's 1, the channels the same.
 */
export const HAND = {
  version: '1',
  agent: 'hand',
  dimensions: [
    {
      id: 'stage',
      title: 'Stage',
      kind: 'stage',
      values: [
        { id: 'a', title: 'Stage a', weight: 3 },
        { id: 'b', title: 'Stage b', weight: 1 },
      ],
    },
    {
      id: 'deviation',
      title: 'Deviation',
      kind: 'deviation',
      values: [
        { id: 'none', title: 'No deviation', weight: 9 },
        { id: 'D4_loose_confirmation', title: 'A loose yes', weight: 1 },
      ],
    },
    {
      id: 'channel',
      title: 'Channel',
      kind: 'channel',
      values: [
        { id: 'chat', title: 'Chat' },
        { id: 'whatsapp', title: 'WhatsApp' },
      ],
    },
  ],
  constraints: [
    {
      forbid: { deviation: 'D4_loose_confirmation', channel: 'whatsapp' },
      reason: 'No confirmation step on whatsapp.',
    },
  ],
  prior: { kind: 'declared' },
} as const;

/**
 * s1 reaches a then b on chat: (a, none, chat) and (b, none, chat).
 * s2 reaches a on whatsapp, and a loose yes arrives at a: (a, none, whatsapp), and the forbidden
 * (a, D4, whatsapp).
 * s3 reaches a on chat: (a, none, chat), a cell s1 covers too.
 */
export const S1 = spec({ id: 's1', channel: 'chat', stages: ['a', 'b'], blocks: [at('a'), at('b')] });
export const S2 = spec({
  id: 's2',
  channel: 'whatsapp',
  stages: ['a', 'b'],
  blocks: [at('a')],
  perturbations: [
    { id: 'loose', class: 'D4_loose_confirmation', inject_at: 1, user: 'ok', recovery: { within_blocks: 0 } },
  ],
});
export const S3 = spec({ id: 's3', channel: 'chat', stages: ['a', 'b'], blocks: [at('a')] });
