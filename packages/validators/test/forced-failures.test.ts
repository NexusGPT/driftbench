import { describe, expect, it } from 'vitest';
import { check, none } from '../src/failure';
import { type BankItem, ok } from '../src/ladders/variables/bank/item';
import { auditEveryCheckSite } from './forced-failures';

const item = (id: string, run: () => void): BankItem => ({
  id,
  stem: 's',
  family: 'f',
  tier: 1,
  level: 'store-core' as never,
  component: 'c',
  cause: 'c',
  check: () => {
    run();
    return ok();
  },
});

describe('the audit of every check site', () => {
  it('passes sites that keep the wanted value out of the rule and the input, and lists the sites with none', async () => {
    const audit = await auditEveryCheckSite(
      [
        item('good', () => {
          check(true, () => ({ rule: 'a count is exact', got: { n: 5 }, expected: { n: 7000 } }));
          check(true, () => ({ rule: 'the product did something', expected: none('observation') }));
        }),
      ],
      {},
      1,
    );
    expect(audit.leaking).toEqual([]);
    expect(audit.unstructured).toEqual([]);
    expect(audit.sites).toBe(2);
    expect(audit.none).toEqual(['observation :: the product did something']);
  });

  it('finds a wanted value written into the rule of a site that no wrong product reaches', async () => {
    const audit = await auditEveryCheckSite(
      [item('bad', () => check(true, () => ({ rule: 'the count is 7000', expected: { n: 7000 } })))],
      {},
      1,
    );
    expect(audit.leaking.length).toBeGreaterThan(0);
    expect(audit.leaking.join(' ')).toContain('7000');
  });

  it('finds a wanted value written into the input', async () => {
    const audit = await auditEveryCheckSite(
      [
        item('bad', () =>
          check(true, () => ({ rule: 'r', input: { limit: 'CODE_X1' }, expected: 'CODE_X1' })),
        ),
      ],
      {},
      1,
    );
    expect(audit.leaking.length).toBeGreaterThan(0);
  });

  it('finds a number written into a rule that declares nothing wanted', async () => {
    const audit = await auditEveryCheckSite(
      [
        item('bad', () =>
          check(true, () => ({
            rule: 'the interval has an upper bound of 1',
            expected: none('observation'),
          })),
        ),
      ],
      {},
      1,
    );
    expect(audit.leaking.join(' ')).toContain('a number in the rule');
  });
});
