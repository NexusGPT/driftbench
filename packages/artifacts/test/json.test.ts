import { jsonReader, parsePath } from '@agent-nexus/driftbench-artifacts';
import type { ArtifactDocument } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { bytesOf, runCases } from './fixtures';

const PLANS = {
  currency: 'USD',
  plans: [
    { id: 'mobile-s', name: 'Acme Mobile S', monthly: 15, tags: ['mobile'] },
    { id: 'fiber-300', name: 'Acme Fiber 300', monthly: 40, tags: ['home', 'fiber'] },
  ],
  totals: { mobile: 15, home: 40, 'home plans': 1 },
  discount: null,
};

const open = async (): Promise<ArtifactDocument> =>
  jsonReader.open(bytesOf(JSON.stringify(PLANS)), 'out/plans.json');

runCases(jsonReader, open, {
  subset: {
    pass: [
      {
        check: { subset: { currency: 'USD', totals: { mobile: 15 } } },
        evidence: 'the root is a mapping with currency, plans, totals, discount',
      },
      { check: { subset: { plans: [{ id: 'mobile-s' }, { id: 'fiber-300', tags: ['home', 'fiber'] }] } } },
      { check: { subset: { discount: null } } },
    ],
    fail: [
      { check: { subset: { totals: { mobile: 20 } } }, evidence: 'totals.mobile is 15, expected 20' },
      { check: { subset: { plans: [{ id: 'mobile-s' }] } }, evidence: 'plans has 2 items, expected 1' },
      {
        check: { subset: { region: 'north', currency: 'EUR' } },
        evidence: 'missing region; currency is "USD", expected "EUR"',
      },
      {
        check: { subset: { plans: [{ id: 'mobile-s' }, { tags: ['fiber', 'home'] }] } },
        evidence: 'plans[1].tags[0] is "home", expected "fiber"',
      },
    ],
  },
  value: {
    pass: [
      { check: { value: { path: 'plans[1].monthly', equals: 40 } }, evidence: 'plans[1].monthly = 40' },
      { check: { value: { path: 'plans.0.id', equals: { regex: '^mobile-' } } } },
      { check: { value: { path: '$.totals["home plans"]', equals: 1 } } },
      { check: { value: { path: 'discount', equals: null } } },
      { check: { value: { path: 'coupon', equals: { absent: true } } } },
      { check: { value: { path: 'totals', equals: { subset: { home: 40 } } } } },
      { check: { value: { path: 'plans[0].tags', equals: { exact: ['mobile'] } } } },
      {
        check: { value: { path: '', equals: { nonempty: true } } },
        evidence: 'the root = {"currency":"USD"',
      },
    ],
    fail: [
      {
        check: { value: { path: 'plans[2].id', equals: 'air-5g' } },
        evidence: 'nothing at plans[2].id: plans is a list of 2 items',
      },
      {
        check: { value: { path: 'discount', equals: { nonempty: true } } },
        evidence: 'discount = null, expected a value that is not empty',
      },
      {
        check: { value: { path: 'totals.mobile', equals: '15' } },
        evidence: 'totals.mobile = 15, expected "15"',
      },
      {
        check: { value: { path: 'totals.office', equals: 1 } },
        evidence: 'nothing at totals.office: totals is a mapping with mobile, home, home plans',
      },
    ],
  },
  contains: {
    pass: [{ check: { contains: '"currency": "USD"' } }],
    fail: [{ check: { contains: '"currency": "EUR"' }, evidence: 'missing "\\"currency\\": \\"EUR\\""' }],
  },
  not_contains: {
    pass: [{ check: { not_contains: 'air-5g' } }],
    fail: [{ check: { not_contains: 'fiber-300' }, evidence: 'found "fiber-300"' }],
  },
  regex: {
    pass: [{ check: { regex: '"monthly": 40' } }],
    fail: [{ check: { regex: '"monthly": 0\\b' }, evidence: 'no match' }],
  },
});

describe('json reader', () => {
  it('gives a judge the JSON pretty printed', async () => {
    expect((await open()).text()).toBe(JSON.stringify(PLANS, null, 2));
  });

  it('reads paths with dots, indexes, quoted keys and the root', () => {
    expect(parsePath('plans[0].id')).toEqual(['plans', 0, 'id']);
    expect(parsePath('$.plans.0.id')).toEqual(['plans', '0', 'id']);
    expect(parsePath("totals['home plans']")).toEqual(['totals', 'home plans']);
    expect(parsePath('$')).toEqual([]);
    expect(parsePath('')).toEqual([]);
  });

  it('says how value is written when its path is malformed or equals is missing', async () => {
    const document = await open();
    expect(document.check({ value: { path: 'plans[x]', equals: 1 } }).evidence).toContain(
      'value has [x] in the path "plans[x]"; write [0] or ["key"]',
    );
    expect(document.check({ value: { path: 'plans' } }).evidence).toContain('value needs equals');
    expect(document.check({ value: { path: 'plans', equals: [1] } }).evidence).toContain(
      'value has a list as equals; write { exact: [...] } to compare a list',
    );
  });

  it('fails the structure checks of invalid JSON with the parse error, and still searches its text', async () => {
    const document = await jsonReader.open(bytesOf('{"currency": "USD",}'), 'broken.json');
    const result = document.check({ value: { path: 'currency', equals: 'USD' } });
    expect(result.ok).toBe(false);
    expect(result.evidence).toMatch(/^broken\.json could not be read as json: /);
    expect(document.check({ contains: '"currency": "USD"' }).ok).toBe(true);
    expect(document.text()).toBe('{"currency": "USD",}');
  });
});
