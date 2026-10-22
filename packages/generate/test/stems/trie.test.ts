import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSpecs, type Spec, validateSpec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { stemForest } from '../../src/stems/trie';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

function spec(id: string, users: string[], extra: Record<string, unknown> = {}): Spec {
  const result = validateSpec({
    id,
    ...extra,
    blocks: users.map((user, index) => ({ id: `${id}-${index}`, user, expect: { must: [user] } })),
  });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.spec;
}

describe('the stem finder', () => {
  it('shares a block only when the whole chain before it matches, inside one group', () => {
    const specs = [
      spec('a', ['x', 'y', 'z']),
      spec('b', ['x', 'y', 'w']),
      spec('c', ['x', 'q']),
      spec('d', ['x', 'y'], { channel: 'email' }),
      spec('e', ['y', 'z']),
      spec('own', ['x', 'y']),
    ];
    const forest = stemForest(specs, (entry) => (entry.id === 'own' ? undefined : (entry.channel ?? 'web')));
    // x is shared by a, b and c; y by a and b. d is in another group, e starts elsewhere, own is left out.
    expect(forest.saved).toBe(3);
    const rows = (id: string) => forest.rows.filter((row) => row.specId === id).map((row) => row.sharedBy);
    expect(rows('a')).toEqual([3, 2, 1]);
    expect(rows('b')).toEqual([3, 2, 1]);
    expect(rows('c')).toEqual([3, 1]);
    expect(rows('d')).toEqual([1, 1]);
    expect(rows('e')).toEqual([1, 1]);
    expect(rows('own')).toEqual([1, 1]);
    expect(forest.rows.find((row) => row.specId === 'own')?.node).toBeUndefined();
    const x = forest.roots.find((node) => node.specs.includes('a'));
    expect(x?.specs).toEqual(['a', 'b', 'c']);
    expect(x?.children.map((node) => node.specs)).toEqual([['a', 'b'], ['c']]);
    // A block id never decides a match: a and b wrote different ids for x.
    expect(
      forest.rows.filter((row) => row.index === 0 && ['a', 'b'].includes(row.specId)).map((row) => row.node),
    ).toEqual([x?.key, x?.key]);
  });

  it('never shares a block whose Then differs, even with the same stimulus', () => {
    const left = spec('left', ['x', 'y']);
    const right = validateSpec({
      id: 'right',
      blocks: [
        { user: 'x', expect: { must: ['x'] } },
        { user: 'y', expect: { must: ['another'] } },
      ],
    });
    if (!right.ok) throw new Error('invalid');
    const forest = stemForest([left, right.spec], () => 'all');
    expect(forest.saved).toBe(1);
    expect(forest.rows.map((row) => row.sharedBy)).toEqual([2, 1, 2, 1]);
  });

  it('counts the shared blocks of the generated Acme suite, written back out, under a header-equality group', async () => {
    // The committed suite holds stems; loaded as a folder, every spec is written back out whole.
    const loaded = await loadSpecs([join(ROOT, 'examples/acme/generated/specs')]);
    expect(loaded.filter((entry) => !entry.ok)).toEqual([]);
    const specs = loaded
      .flatMap((entry) => (entry.ok ? [entry.spec] : []))
      .filter((entry) => !entry.id.startsWith('stem-'));
    const cosmetic = new Set([
      'id',
      'title',
      'tags',
      'metadata',
      'version',
      'blocks',
      'covers',
      'description',
    ]);
    const header = (entry: Spec) =>
      JSON.stringify(
        Object.entries(entry)
          .filter(([key]) => !cosmetic.has(key))
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      );
    const all = stemForest(specs, header);
    const safe = stemForest(specs, (entry) => (entry.end_state === undefined ? header(entry) : undefined));
    expect(all.rows.length).toBe(specs.reduce((sum, entry) => sum + entry.blocks.length, 0));
    expect(safe.saved).toBeLessThanOrEqual(all.saved);
    expect({ blocks: all.rows.length, all: all.saved, withoutEndState: safe.saved }).toMatchInlineSnapshot(`
      {
        "all": 119,
        "blocks": 1707,
        "withoutEndState": 15,
      }
    `);
  }, 120_000);
});
