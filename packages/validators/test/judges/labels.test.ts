import { fileURLToPath } from 'node:url';
import { fixtureRequest } from '@agent-nexus/driftbench-judges';
import { describe, expect, it } from 'vitest';
import { JUDGED_CRITERIA, loadPool, splitPool } from '../../src/ladders/judges/pool';
import { allEdits, defaultTransforms, loadPhraseBank } from '../../src/ladders/judges/transforms';
import { oracle } from './scripted';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

describe('the labelled set of the judge validator', () => {
  it('labels every slice from the fault family, with both labels for every criterion', async () => {
    const pool = await loadPool(ROOT);
    expect(pool.equivalent).toEqual([]);
    for (const criterion of JUDGED_CRITERIA) {
      const own = pool.items.filter((item) => item.criterion === criterion);
      expect(own.filter((item) => item.label === 'pass').length, criterion).toBeGreaterThanOrEqual(3);
      expect(own.filter((item) => item.label === 'fail').length, criterion).toBeGreaterThanOrEqual(3);
    }
    expect(new Set(pool.items.map((item) => item.id)).size).toBe(pool.items.length);
  });

  it('agrees with a second mechanism: the careful scripted reading gives every label', async () => {
    const pool = await loadPool(ROOT);
    const wrong = pool.items
      .map((item) => ({ id: item.id, label: item.label, ...oracle(item.request) }))
      .filter((row) => row.verdict !== row.label);
    expect(wrong).toEqual([]);
    for (const criterion of pool.criteria) {
      expect(oracle(fixtureRequest(criterion, 'pass')).verdict, criterion.def.name).toBe('pass');
      expect(oracle(fixtureRequest(criterion, 'fail')).verdict, criterion.def.name).toBe('fail');
    }
  });

  it('keeps the label under every preserving edit and moves it to fail under every flipping edit', async () => {
    const pool = await loadPool(ROOT);
    const bank = loadPhraseBank(ROOT);
    const transforms = defaultTransforms();
    const counts: Record<string, number> = {};
    const wrong: string[] = [];
    for (const item of pool.items) {
      for (const edit of allEdits(item, transforms, bank)) {
        counts[edit.kind] = (counts[edit.kind] ?? 0) + 1;
        const got = oracle({ ...item.request, transcript: edit.transcript });
        if (got.verdict !== edit.label) wrong.push(`${item.id} ${edit.kind}#${edit.variant}: ${got.reason}`);
      }
    }
    expect(wrong).toEqual([]);
    for (const kind of Object.keys(transforms)) expect(counts[kind] ?? 0, kind).toBeGreaterThan(0);
  });

  it('splits by seed, stratified by criterion and label, the same on a repeat', async () => {
    const pool = await loadPool(ROOT);
    const one = splitPool(pool.items, 1);
    expect(splitPool(pool.items, 1)).toEqual(one);
    expect(splitPool(pool.items, 2).hidden.map((item) => item.id)).not.toEqual(
      one.hidden.map((item) => item.id),
    );
    expect(one.hidden.length + one.visible.length).toBe(pool.items.length);
    for (const criterion of JUDGED_CRITERIA) {
      for (const label of ['pass', 'fail']) {
        const n = one.hidden.filter((item) => item.criterion === criterion && item.label === label).length;
        expect(n, `${criterion} ${label}`).toBeGreaterThanOrEqual(2);
      }
    }
  });
});
