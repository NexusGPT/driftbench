import { describe, expect, it } from 'vitest';
import { planV2 } from '../../src/plan-v2';
import { makeStore, uncovered, validCells } from './helpers';

/**
 * Four rules in pairs: a is named by two rules, b by two others; `p`, `q`, `r`, `s` are each named by one rule.
 * All six are axes. No rule names `a` and `b` together, or `p` and `r`.
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

describe('strength 2 on every pair of approved axes', () => {
  it('covers every pair of values of every pair of axes, whether or not a rule joins them', () => {
    const store = shared();
    const plan = planV2(store);
    const rows = plan.rows.map((row) => row.values);
    const axes = ['a', 'b', 'p', 'q', 'r', 's'];
    for (let i = 0; i < axes.length; i += 1)
      for (let j = i + 1; j < axes.length; j += 1)
        expect(uncovered(rows, validCells(store), [axes[i] as string, axes[j] as string])).toEqual([]);
  });

  it('asks the floor only for the pairs no rule group holds already', () => {
    const plan = planV2(shared());
    // Own pairs: a with p, a with q, b with r, b with s. The other 11 of the 15 pairs of axes are the floor.
    expect(plan.layers.find((entry) => entry.layer === 'own')?.groups).toBe(4);
    expect(plan.layers.find((entry) => entry.layer === 'shared')).toMatchObject({ groups: 11, targets: 57 });
  });

  it('pairs two axes that only rules of one variable name: the floor does not need a rule', () => {
    const store = makeStore([
      { id: 'a', values: [{ id: 'a1', limit: 2 }, { id: 'a2', limit: 3 }, 'a3'] },
      { id: 'b', values: [{ id: 'b1', limit: 2 }, { id: 'b2', limit: 3 }, 'b3'] },
    ]);
    const plan = planV2(store);
    // Each rule names one variable, so no rule joins a and b; the floor asks for their 9 pairs.
    expect(plan.layers.find((entry) => entry.layer === 'shared')).toMatchObject({ groups: 1, targets: 9 });
    expect(plan.rows).toHaveLength(9);
  });

  it('pairs only axes: a detail is not paired by the floor', () => {
    const store = makeStore([
      { id: 'a', values: [{ id: 'a1', when: { p: ['p1'] } }, { id: 'a2', when: { p: ['p2'] } }, 'a3'] },
      { id: 'b', values: [{ id: 'b1', when: { p: ['p1'] } }, { id: 'b2', when: { p: ['p2'] } }, 'b3'] },
      { id: 'p', role: 'detail', values: ['p1', 'p2'] },
    ]);
    const plan = planV2(store);
    // a and b are axes: the floor asks for their 9 pairs.
    expect(plan.layers.find((entry) => entry.layer === 'shared')).toMatchObject({ groups: 1, targets: 9 });
    // p is a detail named by four rules: it is never part of a shared pair.
    const rowsOf = plan.rows.map((row) => row.values);
    expect(uncovered(rowsOf, validCells(store), ['a', 'b'])).toEqual([]);
    // Four rules ask for two own pairs, (a, p) and (b, p), each once however many rules ask for it.
    expect(plan.layers.find((entry) => entry.layer === 'own')).toMatchObject({ groups: 2 });
  });

  it('pairs the axes of a store that has a detail, and leaves the detail out of the floor', () => {
    const store = makeStore([
      { id: 'x', values: [{ id: 'x1', when: { m: ['m1'] } }, { id: 'x2', when: { n: ['n1'] } }, 'x3'] },
      { id: 'm', values: ['m1', 'm2'] },
      { id: 'n', values: ['n1', 'n2'] },
      {
        id: 'p',
        role: 'detail',
        values: [{ id: 'p1', when: { r: ['r1'] } }, { id: 'p2', when: { s: ['s1'] } }, 'p3'],
      },
      { id: 'r', values: ['r1', 'r2'] },
      { id: 's', values: ['s1', 's2'] },
    ]);
    const plan = planV2(store);
    // Axes x, m, n, r, s: 10 pairs, two of them rule groups (x with m, x with n); p is a detail and never pairs.
    expect(plan.layers.find((entry) => entry.layer === 'shared')).toMatchObject({ groups: 8, targets: 36 });
  });

  it('asks no floor pair that a rule group holds already', () => {
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
    // One rule names a, b and p: its own triple holds every pair of the three, so the floor adds nothing.
    expect(plan.layers.find((entry) => entry.layer === 'shared')).toMatchObject({ groups: 0, targets: 0 });
    expect(plan.layers.find((entry) => entry.layer === 'own')).toMatchObject({ groups: 1 });
  });
});
