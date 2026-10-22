import { callCoverage, callInterval, makeStore, must, names, planError, type Stem, show, valueIds, need } from '../kit';

/**
 * Items added after the audit of round 2 (validators/variables/audit.md): one for each planted bug the bank did not
 * notice, each with a mutant of the reference in test/variables-blind/mutants.ts that loses it.
 */

const at = (list: readonly string[], i: number): string => list[i] as string;

export const HARDENING_STEMS: readonly Stem[] = [
  {
    id: 'hardening.interval',
    rules: ['R13', 'R10'],
    family: 'weights',
    component: 'store/weights',
    cause: 'weightInterval refuses a count above its total, a negative count and a total below 1 with a RangeError',
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
            let got: unknown;
            let threw: Error | undefined;
            try {
              got = need(ctx, 'weightInterval')(count, total);
            } catch (error) {
              threw = error as Error;
            }
            must(
              threw instanceof RangeError,
              () => `weightInterval(${count}, ${total}) returned ${show(got)}; a count above its total is a RangeError`,
            );
          }
          // The edge stays valid: a count equal to its total is an interval.
          const [lo, hi] = callInterval(ctx, 3, 3);
          must(lo > 0 && hi === 1, () => `[${lo}, ${hi}] for 3 of 3`);
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
            let threw: Error | undefined;
            let got: unknown;
            try {
              got = need(ctx, 'weightInterval')(count, total);
            } catch (error) {
              threw = error as Error;
            }
            must(
              threw instanceof RangeError,
              () => `weightInterval(${count}, ${total}) returned ${show(got)}; it is a RangeError`,
            );
          }
        },
      ],
    ],
  },
  {
    id: 'hardening.coverage',
    rules: ['R7', 'R12'],
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
          must(Number(off.allowed) === 4, () => `allowed ${String(off.allowed)} with a forbid nobody approved; it excludes nothing, so 4`);
          const on = callCoverage(ctx, plain(true), [], groups);
          must(Number(on.allowed) === 3, () => `allowed ${String(on.allowed)} with the forbid approved; 3`);
        },
      ],
    ],
  },
];
