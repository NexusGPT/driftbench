import type { Assertion, EndState } from '@driftbench/core';
import { describe, expect, it } from 'vitest';
import { compareEndState, matchAssertion } from '../../src/runner';

const absent = { absent: true };

describe('matchAssertion', () => {
  const cases: Array<[string, Assertion, unknown, unknown]> = [
    ['a bare scalar', 'mobile-l', 'mobile-l', 'mobile-m'],
    ['exact', { exact: { a: [1, 2] } }, { a: [1, 2] }, { a: [2, 1] }],
    ['regex', { regex: '^7 Quarry' }, '7 Quarry Lane', '17 Quarry Lane'],
    ['contains', { contains: 'Summit' }, '88 Summit Avenue', '88 Harbor Road'],
    ['one_of', { one_of: ['mobile-m', 'mobile-l'] }, 'mobile-l', 'mobile-s'],
    ['nonempty', { nonempty: true }, 'x', ''],
    ['absent', { absent: true }, undefined, null],
    [
      'subset',
      { subset: { name: 'Jo Okafor' } },
      { name: 'Jo Okafor', email: 'jo.okafor@example.com' },
      { name: 'Jo' },
    ],
  ];
  it.each(cases)('%s passes the right value and fails the wrong one', (_name, assertion, good, bad) => {
    expect(matchAssertion(good, assertion)).toBe(true);
    expect(matchAssertion(bad, assertion)).toBe(false);
  });
});

describe('compareEndState', () => {
  const order: EndState = {
    source: 'tool:order.create',
    expect: { plan_id: 'mobile-l', port_number: { absent: true } },
  };

  it('passes a recorded state that holds every field, an absent one included', () => {
    expect(compareEndState(order, { plan_id: 'mobile-l', type: 'upgrade' })).toEqual({
      match: true,
      diff: [],
    });
  });

  it('fails every expected field, absent ones included, when the source recorded nothing', () => {
    const diff = [
      { field: 'plan_id', expected: 'mobile-l', observed: absent },
      { field: 'port_number', expected: absent, observed: absent },
    ];
    expect(compareEndState(order, undefined)).toEqual({ match: false, diff });
    expect(compareEndState(order, null)).toEqual({ match: false, diff });
  });

  it('fails an empty expect only when the source recorded nothing', () => {
    const any: EndState = { source: 'tool:notify_sales', expect: {} };
    expect(compareEndState(any, { reason: 'callback' })).toEqual({ match: true, diff: [] });
    expect(compareEndState(any, undefined)).toEqual({
      match: false,
      diff: [{ field: 'tool:notify_sales', expected: { nonempty: true }, observed: absent }],
    });
  });

  it('names list fields by source, and the source itself for an empty expect', () => {
    const list: EndState = [
      { source: 'tool:order.create', expect: { plan_id: 'mobile-l' } },
      { source: 'tool:notify_sales', expect: {} },
    ];
    expect(compareEndState(list, { 'tool:order.create': { plan_id: 'mobile-m' } })).toEqual({
      match: false,
      diff: [
        { field: 'tool:order.create.plan_id', expected: 'mobile-l', observed: 'mobile-m' },
        { field: 'tool:notify_sales', expected: { nonempty: true }, observed: absent },
      ],
    });
  });

  it('fails each unexpected field in exact mode, expected absent', () => {
    const exact: EndState = { source: 'tool:order.create', mode: 'exact', expect: { plan_id: 'mobile-l' } };
    expect(compareEndState(exact, { plan_id: 'mobile-l', type: 'upgrade' })).toEqual({
      match: false,
      diff: [{ field: 'type', expected: absent, observed: 'upgrade' }],
    });
  });

  it('passes none on nothing recorded and gives one entry per payload otherwise', () => {
    for (const nothing of [undefined, null, [], {}])
      expect(compareEndState('none', nothing).match).toBe(true);
    expect(compareEndState('none', [{ tool: 'order.create' }, { tool: 'notify_sales' }])).toEqual({
      match: false,
      diff: [
        { field: '*.0', expected: absent, observed: { tool: 'order.create' } },
        { field: '*.1', expected: absent, observed: { tool: 'notify_sales' } },
      ],
    });
  });

  it('writes a missing field of a recorded state as absent, so a diff survives JSON', () => {
    const result = compareEndState(order, { plan_id: undefined, type: 'upgrade' });
    expect(result.diff).toStrictEqual([{ field: 'plan_id', expected: 'mobile-l', observed: absent }]);
    expect(JSON.parse(JSON.stringify(result))).toStrictEqual(result);
  });
});
