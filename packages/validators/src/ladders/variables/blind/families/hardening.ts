import { check } from '../../../../failure';
import type { ItemContext } from '../../bank/item';
import { callCoverage, callInterval, makeStore, names, need, planError, type Stem, valueIds } from '../kit';

/**
 * Items added after the audit of round 2 (validators/variables/audit.md): one for each planted bug the bank did not
 * notice, each with a mutant of the reference in test/variables-blind/mutants.ts that loses it.
 */

const at = (list: readonly string[], i: number): string => list[i] as string;

/**
 * What weightInterval does with a count and a total it must refuse: the error it raises, or the value it returns. The
 * wanted error class is the wanted value, so the message names neither it nor a verdict, only what the product did.
 */
function refusedByInterval(ctx: ItemContext, rule: string, count: number, total: number): void {
  let value: unknown;
  let threw: Error | undefined;
  try {
    value = need(ctx, 'weightInterval')(count, total);
  } catch (error) {
    threw = error as Error;
  }
  check(threw instanceof RangeError, () => ({
    rule,
    input: { count, total },
    got: threw === undefined ? { returned: value } : { threw: threw.name },
    expected: { raises: 'RangeError' },
  }));
}

export const HARDENING_STEMS: readonly Stem[] = [
  {
    id: 'hardening.interval',
    rules: ['R13'],
    family: 'weights',
    component: 'store/weights',
    cause:
      'weightInterval refuses a count above its total, a negative count and a total below 1 with a RangeError',
    cases: [
      [
        'count-above-total-is-refused',
        2,
        (ctx) => {
          for (const [count, total] of [
            [5, 3],
            [4, 3],
            [11, 10],
          ] as const) {
            refusedByInterval(ctx, 'weightInterval given a count above its total', count, total);
          }
          // The edge stays valid: a count equal to its total is an interval, open above zero and closed at the top. The
          // wanted value is the upper end; the lower end is only required to be above zero.
          const [lo, hi] = callInterval(ctx, 3, 3);
          check(lo > 0 && hi === 1, () => ({
            rule: 'weightInterval given a count equal to its total',
            input: { count: 3, total: 3 },
            got: { interval: [lo, hi] },
            expected: { high: 1 },
          }));
        },
      ],
      [
        'negative-count-and-empty-total-are-refused',
        2,
        (ctx) => {
          for (const [count, total] of [
            [-1, 3],
            [0, 0],
            [3, 0],
          ] as const) {
            refusedByInterval(
              ctx,
              'weightInterval given a negative count or a total below one',
              count,
              total,
            );
          }
        },
      ],
    ],
  },
  {
    id: 'hardening.coverage',
    rules: ['R6', 'R12'],
    family: 'counter',
    component: 'planner/counter',
    cause: 'coverage leaves out of its count the tuples only a constraint nobody approved would exclude',
    cases: [
      [
        'unapproved-forbid-excludes-nothing',
        2,
        (ctx) => {
          const [a, b] = names(ctx.rng, 2) as [string, string];
          const plain = (approved: boolean) =>
            makeStore({
              vars: [
                { id: a, values: valueIds(2), shared: true },
                { id: b, values: valueIds(2), shared: true },
              ],
              forbids: [{ forbid: { [a]: 'v0', [b]: 'v0' }, approved }],
            });
          const groups = [{ variables: [a, b], strength: 2 }];
          const off = callCoverage(ctx, plain(false), [], groups);
          check(Number(off.allowed) === 4, () => ({
            rule: 'the allowed tuples coverage counts for two variables when the only forbid is not approved',
            input: { forbidApproved: false },
            got: { allowed: String(off.allowed) },
            expected: { allowed: 4 },
          }));
          const on = callCoverage(ctx, plain(true), [], groups);
          check(Number(on.allowed) === 3, () => ({
            rule: 'the allowed tuples coverage counts for two variables when the only forbid is approved',
            input: { forbidApproved: true },
            got: { allowed: String(on.allowed) },
            expected: { allowed: 3 },
          }));
        },
      ],
    ],
  },
];
