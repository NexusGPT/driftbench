import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { blockCacheKey, type ResolvedGiven, validateSpec } from '../src/index';
import { type ExampleKey, exampleKeys } from './fixtures/class-keys/keys';

const ROOT = resolve(import.meta.dirname, '../../..');
const REF = { id: 'refund.request', set: '0123456789ab' };

const plain = { id: 'classed', blocks: [{ user: 'I want a refund for order 1042.' }, { user: 'Thanks.' }] };
const classed = {
  id: 'classed',
  blocks: [{ when: { user: 'I want a refund for order 1042.', class: REF } }, { user: 'Thanks.' }],
};

const GIVEN = {
  prefix: [],
  ledger: {},
  world: {},
  vars: {},
  target: { adapter: 'probe' },
  hash: 'probe',
} as unknown as ResolvedGiven;

function keyOf(specHash: string, stimulus: unknown): string {
  return blockCacheKey({
    specHash,
    repeat: 1,
    position: 0,
    given: GIVEN,
    stimulus: stimulus as never,
    target: { adapter: 'probe' },
    adapter: 'probe',
    adapterVersion: '1',
  });
}

describe('when.class', () => {
  it('loads a block that names its utterance class beside its seed message', () => {
    const result = validateSpec(classed);
    expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
    if (!result.ok) return;
    expect(result.spec.blocks[0]?.when).toEqual({ user: 'I want a refund for order 1042.', class: REF });
  });

  it('refuses a class ref whose id or set hash is malformed', () => {
    for (const bad of [
      { id: 'Refund Request', set: '0123456789ab' },
      { id: 'refund', set: 'abc' },
      { id: 'refund', set: '0123456789ab', version: 2 },
      { id: 'refund' },
    ]) {
      const result = validateSpec({ id: 'x', blocks: [{ when: { user: 'Hi', class: bad } }] });
      expect(result.ok, JSON.stringify(bad)).toBe(false);
      if (!result.ok) expect(result.errors[0]?.path).toMatch(/^blocks\.0\.when/);
    }
  });

  it('enters the spec hash and the block cache key only when present', () => {
    const a = validateSpec(plain);
    const b = validateSpec(classed);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(b.hash).not.toBe(a.hash);
    expect(keyOf(b.hash, b.spec.blocks[0]?.when)).not.toBe(keyOf(a.hash, a.spec.blocks[0]?.when));
    // The other block's stimulus is untouched.
    expect(b.spec.blocks[1]?.when).toEqual(a.spec.blocks[1]?.when);
    // A changed set hash is a changed block.
    const other = validateSpec({
      ...classed,
      blocks: [
        { when: { user: 'I want a refund for order 1042.', class: { ...REF, set: 'ba9876543210' } } },
        classed.blocks[1],
      ],
    });
    expect(other.ok && other.hash !== b.hash).toBe(true);
  });

  it('changes no spec hash and no block cache key of any example spec (recorded on the base commit)', async () => {
    const recorded = JSON.parse(
      gunzipSync(
        await readFile(resolve(import.meta.dirname, 'fixtures/class-keys/example-keys.json.gz')),
      ).toString('utf8'),
    ) as Record<string, ExampleKey>;
    const now = await exampleKeys(ROOT);
    let compared = 0;
    const changed: string[] = [];
    for (const [path, [file, spec, keys]] of Object.entries(recorded)) {
      const current = now[path];
      // A file edited since the recording is a different spec; it says nothing about this key.
      if (!current || current[0] !== file) continue;
      compared += 1;
      if (current[1] !== spec || current[2] !== keys) changed.push(path);
    }
    expect(changed).toEqual([]);
    expect(compared).toBeGreaterThan(2000);
  }, 120_000);
});
