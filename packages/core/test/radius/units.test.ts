import { describe, expect, it } from 'vitest';
import type { ChangeManifest } from '../../src/radius/change';
import { radiusOf } from '../../src/radius/radius';
import { UNIT_SELECTION_ADVISORY, unitSelection } from '../../src/radius/select';
import { BlockLink } from '../../src/schema/links';
import type { Spec } from '../../src/schema/spec';

const unitLink = (block: string, unit: string, status: BlockLink['status'] = 'declared'): BlockLink => ({
  block,
  to: { kind: 'estate_unit', unit },
  status,
});
const spec = (id: string, blocks: { id: string; links?: BlockLink[] }[]): { spec: Spec; hash: string } => ({
  hash: id,
  spec: {
    id,
    kind: 'conversation',
    blocks: blocks.map((block) => ({ id: block.id, when: { user: '.' } })),
    metadata: { links: blocks.flatMap((block) => block.links ?? []) },
  } as Spec,
});
const changeOf = (...units: string[]): ChangeManifest => ({
  from: 'v1',
  to: 'v2',
  changes: units.map((id) => ({ kind: 'unit', id })),
});
const states = (selection: ReturnType<typeof unitSelection>, id: string) =>
  Object.fromEntries(
    (selection.specs.find((s) => s.specId === id)?.blocks ?? []).map((b) => [b.id, b.state]),
  );

describe('the estate unit link', () => {
  it('names a ledger id and may carry the fingerprint it was made at', () => {
    expect(BlockLink.safeParse(unitLink('a', 'k7m2q9x4ab')).success).toBe(true);
    expect(
      BlockLink.safeParse({ to: { kind: 'estate_unit', unit: 'k7m2q9x4ab', fp: '0a9c' }, status: 'verified' })
        .success,
    ).toBe(true);
    expect(BlockLink.safeParse({ to: { kind: 'estate_unit' }, status: 'declared' }).success).toBe(false);
    expect(
      BlockLink.safeParse({ to: { kind: 'estate_unit', unit: 'x', quote: 'no' }, status: 'declared' })
        .success,
    ).toBe(false);
  });
});

describe('unit selection', () => {
  const specs = [
    spec('order', [
      { id: 'a', links: [unitLink('a', 'u1')] },
      { id: 'b', links: [unitLink('b', 'u2')] },
      { id: 'c', links: [unitLink('c', 'u3')] },
    ]),
    spec('refund', [
      { id: 'r1', links: [unitLink('r1', 'u2', 'refuted'), unitLink('r1', 'u4')] },
      { id: 'r2', links: [unitLink('r2', 'u5', 'stale')] },
    ]),
    spec('plain', [{ id: 'p1' }]),
  ];

  it('selects the blocks linked to a changed unit, then forward, and never through a refuted link', () => {
    const selection = unitSelection(specs, changeOf('u2'));
    expect(selection.changed).toEqual(['u2']);
    expect(states(selection, 'order')).toEqual({ a: 'out', b: 'direct', c: 'forward' });
    expect(states(selection, 'refund')).toEqual({ r1: 'out', r2: 'direct' });
    expect(selection.specs[1]?.blocks[1]?.why).toEqual(['stale-link:unit:u5']);
    expect(selection.specs[0]?.blocks[1]?.why).toEqual(['link:unit:u2 (declared)']);
  });

  it('selects a block with no unit link: no record always runs', () => {
    const selection = unitSelection(specs, changeOf('u2'));
    expect(states(selection, 'plain')).toEqual({ p1: 'direct' });
    expect(selection.specs[2]?.blocks[0]?.why).toEqual(['no-links:ledger']);
  });

  it('selects every block for a global unit change or a unit change with no id', () => {
    expect(
      unitSelection(specs, { from: 'v1', to: 'v2', changes: [{ kind: 'unit', global: true }] }).all,
    ).toMatch(/declared global/);
    expect(unitSelection(specs, { from: 'v1', to: 'v2', changes: [{ kind: 'unit' }] }).all).toMatch(
      /names no unit/,
    );
  });

  it('keeps the radius the whole suite and adds the advisory selection to it', () => {
    const report = radiusOf(specs, changeOf('u2'), { modes: ['F'] });
    expect(report.whole).toEqual({ change: 'unit:u2', reason: UNIT_SELECTION_ADVISORY });
    expect(report.unitAdvisory?.counts).toEqual({ selected: 4, direct: 3, forward: 1, skipped: 2, total: 6 });
    expect(
      radiusOf(specs, { from: 'v1', to: 'v2', changes: [{ kind: 'model' }] }).unitAdvisory,
    ).toBeUndefined();
  });
});
