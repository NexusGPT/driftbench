import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { type Spec, validateSpec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import {
  type Budget,
  inHoldout,
  openBundle,
  passRate,
  type SealedBundle,
  spendQuery,
} from '../../src/select';
import { specOfKey } from '../../src/select/evidence';

const SPEC = {
  id: 'sealed-one',
  version: '1',
  kind: 'conversation',
  title: 'A sealed conversation',
  blocks: [{ id: 'b1', when: { user: 'Hello' }, expect: { lang: 'EN' } }],
} as unknown as Spec;

function bundle(spec: unknown, hash: string, id = 'sealed-one'): SealedBundle {
  return {
    sealed: true,
    note: 'n',
    source: 's',
    split: 'draw',
    seed: 1,
    share: 0.2,
    gate_seals: [],
    date: '2026-10-11',
    specs: [{ id, path: 'conversations/sealed-one.yaml', hash, spec }],
  };
}

describe('openBundle', () => {
  /** The hash the loader gives the spec: what a seal records. */
  function sealedHash(): string {
    const result = validateSpec(SPEC);
    if (!result.ok) throw new Error(result.errors[0]?.message ?? 'invalid');
    return result.hash;
  }

  it('reads a sealed spec back when it hashes to the sealed value', () => {
    const opened = openBundle(bundle(SPEC, sealedHash()));
    expect(opened.problems).toEqual([]);
    expect(opened.specs.map((entry) => entry.id)).toEqual(['sealed-one']);
  });

  it('refuses a spec whose content changed after the seal', () => {
    const changed = { ...SPEC, title: 'Edited after the seal' };
    const opened = openBundle(bundle(changed, sealedHash()));
    expect(opened.specs).toEqual([]);
    expect(opened.problems).toEqual([
      `sealed-one: the content hash changed since it was sealed (${sealedHash()})`,
    ]);
  });

  it('refuses a spec whose id changed, and one that is no longer valid', () => {
    expect(openBundle(bundle(SPEC, sealedHash(), 'other-id')).problems).toEqual([
      'other-id: the sealed spec now has the id sealed-one',
    ]);
    expect(openBundle(bundle({ id: 'sealed-one' }, sealedHash())).problems[0]).toMatch(
      /^sealed-one: the sealed spec is no longer valid/,
    );
  });
});

describe('spendQuery', () => {
  it('needs a budget on the first score and fixes it', () => {
    const first = spendQuery(undefined, undefined, 'function:acme-sales', '2026-10-11');
    expect(first).toEqual({ ok: false, code: 2, message: expect.stringContaining('pass --budget') });
    const fixed = spendQuery(undefined, 2, 'function:acme-sales', '2026-10-11');
    expect(fixed).toEqual({
      ok: true,
      query: 1,
      budget: {
        total: 2,
        used: 1,
        scores: [{ query: 1, date: '2026-10-11', target: 'function:acme-sales', state: 'started' }],
      },
    });
  });

  it('spends one query per score and refuses once the budget is spent', () => {
    const one: Budget = { total: 2, used: 1, scores: [] };
    const second = spendQuery(one, undefined, 't:a', '2026-10-12');
    expect(second.ok && second.query).toBe(2);
    expect(second.ok && second.budget.used).toBe(2);
    const spent: Budget = { total: 2, used: 2, scores: [] };
    expect(spendQuery(spent, undefined, 't:a', '2026-10-12')).toEqual({
      ok: false,
      code: 1,
      message: 'The query budget is spent: 2 of 2 queries used. The holdout is not scored again.',
    });
  });

  it('accepts the same budget restated and refuses a different one', () => {
    const found: Budget = { total: 3, used: 1, scores: [] };
    expect(spendQuery(found, 3, 't:a', 'd').ok).toBe(true);
    expect(spendQuery(found, 5, 't:a', 'd')).toEqual({
      ok: false,
      code: 2,
      message: 'The budget was fixed at 3 queries by the first score; it cannot become 5.',
    });
  });
});

describe('passRate', () => {
  it('is the Wilson interval of passed over conversations, and nothing when none ran', () => {
    const rate = passRate(35, 35);
    expect(rate?.estimate).toBe(1);
    expect(rate?.lower).toBeCloseTo(0.9011, 3);
    expect(rate?.upper).toBeCloseTo(1, 9);
    expect(passRate(0, 0)).toBeUndefined();
  });
});

const REPORT = fileURLToPath(new URL('../../../../examples/acme/gated/gate-report.json', import.meta.url));

describe('inHoldout', () => {
  it('draws exactly the specs the gate sealed, with the same seed and share', async () => {
    const parsed = JSON.parse(await readFile(REPORT, 'utf8')) as {
      blocks: Array<{ key: string; status: string; split?: string }>;
    };
    const split = new Map<string, string>();
    for (const block of parsed.blocks) {
      if (block.status === 'accepted' && block.split) split.set(specOfKey(block.key), block.split);
    }
    expect(split.size).toBe(251);
    for (const [id, side] of split) expect(inHoldout(id, 0.2, 1) ? 'holdout' : 'dev').toBe(side);
    expect([...split.keys()].filter((id) => inHoldout(id, 0.2, 2))).not.toEqual(
      [...split.keys()].filter((id) => inHoldout(id, 0.2, 1)),
    );
  });
});
