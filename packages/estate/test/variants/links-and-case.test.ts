import { afterEach, describe, expect, it } from 'vitest';
import { place } from './claude-layout';
import { cleanup, diskKeepsCase, observe, write } from './harness';
import { type CapUnit, exactLinks, expectedOf, MATRIX, refKey, specOf } from './spec';

afterEach(cleanup);

async function observed(spec: ReturnType<typeof specOf>) {
  const placed = place(spec);
  return { placed, obs: await observe(await write(placed.files), placed.paths) };
}

/**
 * Rule (links and names): a link names a part by its name as stored, in the letters it is stored in. A link in
 * other letters names no part, whatever the disk does with it: it is an unresolved link, the stored part is
 * pointed at by nothing, and no part is ever read under two spellings. A setup reads the same on a disk that
 * keeps case and on one that does not.
 */
describe('links name parts by their stored name, on every disk', () => {
  it.each(MATRIX)(
    'finds what the spec says (seed $seed, $mismatch of the links in other letters)',
    async (variant) => {
      const spec = specOf(variant.seed, variant.mismatch);
      const expected = expectedOf(spec);
      const { obs } = await observed(spec);
      expect(obs.count('unresolved-link')).toBe(expected.unresolved);
      expect(obs.count('orphan')).toBe(expected.orphans);
      expect(obs.twins).toEqual([]);
      for (const cap of spec.caps)
        for (const ref of cap.refs) expect(obs.isRead(refKey(cap, ref))).toBe(true);
    },
  );

  it.each(MATRIX)(
    'a copy holds the parts the setup holds, under their names (seed $seed)',
    async (variant) => {
      const spec = specOf(variant.seed, variant.mismatch);
      const { obs } = await observed(spec);
      expect(obs.twins).toEqual([]);
      for (const cap of spec.caps)
        for (const ref of cap.refs) expect(obs.isCopied(refKey(cap, ref))).toBe(true);
    },
  );

  it('holds two parts that differ only in case, each pointed at by its own spelling, on a disk that keeps case', async (context) => {
    if (!(await diskKeepsCase())) context.skip();
    const cap: CapUnit = {
      name: 'harborlantern',
      refs: [
        { stem: 'meadowquarry', stored: 'lower' },
        { stem: 'meadowquarry', stored: 'upper' },
      ],
      links: [
        { ref: 'meadowquarry', written: 'lower' },
        { ref: 'meadowquarry', written: 'upper' },
      ],
    };
    const { obs } = await observed({ caps: [cap] });
    expect(obs.count('unresolved-link')).toBe(0);
    expect(obs.count('orphan')).toBe(0);
    for (const ref of cap.refs) expect(obs.isRead(refKey(cap, ref))).toBe(true);
  });
});

describe('metamorphic: what must not change the findings, and what must', () => {
  it.each(MATRIX)('moving the root changes no finding (seed $seed)', async (variant) => {
    const spec = specOf(variant.seed, variant.mismatch);
    const a = (await observed(spec)).obs;
    const b = (await observed(spec)).obs;
    expect(b.counts).toEqual(a.counts);
    expect(b.readCount).toBe(a.readCount);
    expect(b.map.atoms.map((atom) => atom.id)).toEqual(a.map.atoms.map((atom) => atom.id));
  });

  it.each(MATRIX)(
    'writing every link as its target is stored leaves none unresolved (seed $seed)',
    async (variant) => {
      const { obs } = await observed(exactLinks(specOf(variant.seed, variant.mismatch)));
      expect(obs.count('unresolved-link')).toBe(0);
      expect(obs.count('orphan')).toBe(0);
    },
  );

  it.each(MATRIX.filter((variant) => variant.mismatch === 0))(
    'deleting a pointed-at part makes exactly one unresolved link appear (seed $seed)',
    async (variant) => {
      const spec = specOf(variant.seed, variant.mismatch);
      const cap = spec.caps.find((candidate) => candidate.refs.length > 0);
      const gone = cap?.refs[0];
      if (!cap || !gone) return;
      const placed = place(spec);
      const before = await observe(await write(placed.files), placed.paths);
      const path = placed.paths.get(refKey(cap, gone)) ?? '';
      const { [path]: _removed, ...rest } = placed.files;
      const after = await observe(await write(rest), placed.paths);
      expect(after.count('unresolved-link')).toBe(before.count('unresolved-link') + 1);
    },
  );
});
