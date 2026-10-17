import { describe, expect, it } from 'vitest';
import { planV2 } from '../../src/plan-v2';
import { makeStore, uncovered, validCells } from './helpers';

/**
 * Four rules in pairs: a is named by two rules, b by two others. `a` and `b` are shared axes though no rule
 * names both; `p`, `q`, `r`, `s` are each named by one rule.
 */
const shared = () =>
  makeStore([
    {
      id: 'a',
      values: [{ id: 'a1', when: { p: ['p1'] } }, { id: 'a2', when: { q: ['q1'] } }, 'a3'],
    },
    {
      id: 'b',
      values: [{ id: 'b1', when: { r: ['r1'] } }, { id: 'b2', when: { s: ['s1'] } }, 'b3'],
    },
    { id: 'p', values: ['p1', 'p2'] },
    { id: 'q', values: ['q1', 'q2'] },
    { id: 'r', values: ['r1', 'r2'] },
    { id: 's', values: ['s1', 's2'] },
  ]);

describe('strength 2 on the axes that several rules share', () => {
  it('covers every pair of values of two axes that two rules each share', () => {
    const store = shared();
    const plan = planV2(store);
    expect(
      uncovered(
        plan.rows.map((row) => row.values),
        validCells(store),
        ['a', 'b'],
      ),
    ).toEqual([]);
    expect(plan.layers.find((entry) => entry.layer === 'shared')).toMatchObject({ groups: 1, targets: 9 });
  });

  it('does not pair an axis that only one rule names with another one', () => {
    const plan = planV2(shared());
    // Own pairs: a with p, a with q, b with r, b with s. Shared pair: a with b. Nothing pairs p with r.
    const own = plan.layers.find((entry) => entry.layer === 'own');
    const sharedLayer = plan.layers.find((entry) => entry.layer === 'shared');
    expect(own?.groups).toBe(4);
    expect(sharedLayer?.groups).toBe(1);
  });

  it('shares only axes: a detail named by two rules is not paired', () => {
    const store = makeStore([
      { id: 'a', values: [{ id: 'a1', when: { p: ['p1'] } }, { id: 'a2', when: { p: ['p2'] } }, 'a3'] },
      { id: 'b', values: [{ id: 'b1', when: { p: ['p1'] } }, { id: 'b2', when: { p: ['p2'] } }, 'b3'] },
      { id: 'p', role: 'detail', values: ['p1', 'p2'] },
    ]);
    const plan = planV2(store);
    // a and b are axes named by two rules each: they are shared, so their 9 pairs are targets.
    expect(plan.layers.find((entry) => entry.layer === 'shared')).toMatchObject({ groups: 1, targets: 9 });
    // p is a detail named by four rules: it is never part of a shared pair.
    const rowsOf = plan.rows.map((row) => row.values);
    expect(uncovered(rowsOf, validCells(store), ['a', 'b'])).toEqual([]);
  });

  it('counts a rule once however many of its entries name the axis', () => {
    const store = makeStore([
      {
        id: 'a',
        values: [
          { id: 'a1', when: { p: ['p1'] }, quotes: [{ quote: 'One passage.', ledger: 'dddddddddd' }] },
          { id: 'a2', quotes: [{ quote: 'One passage, again.', ledger: 'dddddddddd' }] },
          'a3',
        ],
      },
      { id: 'b', values: [{ id: 'b1', quotes: [{ quote: 'One passage.', ledger: 'dddddddddd' }] }, 'b2'] },
      { id: 'p', values: ['p1', 'p2'] },
    ]);
    const plan = planV2(store);
    // One rule names a, b and p: a, b and p are each in one rule, so none is shared.
    expect(plan.layers.find((entry) => entry.layer === 'shared')).toMatchObject({ groups: 0, targets: 0 });
    expect(plan.layers.find((entry) => entry.layer === 'own')).toMatchObject({ groups: 1 });
  });
});
