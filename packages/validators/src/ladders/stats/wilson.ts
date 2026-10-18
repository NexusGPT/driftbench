import { showNumber } from '../../format';
import type { Item, Measure } from '../../ladder';
import { generator } from './draw';
import { STATS_COMPONENTS, type StatsImpl } from './reference';

/** Level 2 of the statistics validator: the Wilson interval covers the true rate. */

/** Level 2: the sample sizes, the draws per size and seed, the coverage bar and the range of true rates. */
export const WILSON_SIZES = [20, 50, 200] as const;
/**
 * The draws and the bar, set by the false failures of a correct Wilson interval and the faults they must catch.
 *
 * A draw's interval holds its true rate with a fixed chance (the exact coverage over rates uniform on [0.1, 0.9]:
 * 0.9529, 0.9509 and 0.9503 at n 20, 50 and 200), so the contained count of one size is binomial over the draws.
 * At 1000 draws and 0.93 a correct interval fails one of the sizes on 4.0e-3 of the seeds (24 item failures over
 * seeds 1 to 5000 on main 4dc61151). At 20000 draws and 0.943 it fails on 1.7e-6. Planted intervals, the chance a
 * seed fails at 20000 and 0.943 against 1000 and 0.93: Wald 1 against 0.974; Wilson at z 1.645, 1 against 1;
 * without the z^2 / 4n^2 term, 1 against 0.966; centred on k / n, 1 against 0.995; Wilson at z 1.90 (coverage
 * 0.943 to 0.946), 0.729 against 0.082.
 */
export const WILSON_DRAWS = 20000;
export const WILSON_COVERAGE = 0.943;
export const WILSON_RATES = { low: 0.1, high: 0.9 } as const;

/**
 * Level 2: for each sample size, WILSON_DRAWS draws of a true rate uniform on [0.1, 0.9] and a binomial count
 * at that rate; the coverage is the share of Wilson intervals that contain the true rate. The observed value
 * is the lowest coverage over the sizes; a size below the bar is an item with its first misses.
 */
export function wilsonLevel(seed: number, s: StatsImpl): Measure {
  const items: Item[] = [];
  let lowest = 1;
  for (const n of WILSON_SIZES) {
    const rng = generator(seed, n);
    let contained = 0;
    const misses: string[] = [];
    for (let draw = 0; draw < WILSON_DRAWS; draw += 1) {
      const truth = WILSON_RATES.low + (WILSON_RATES.high - WILSON_RATES.low) * rng();
      let k = 0;
      for (let trial = 0; trial < n; trial += 1) if (rng() < truth) k += 1;
      const ci = s.wilson(k, n);
      if (ci.lower <= truth && truth <= ci.upper) contained += 1;
      else if (misses.length < 3) {
        misses.push(
          `draw ${draw}: truth ${showNumber(truth)}, estimate ${showNumber(ci.estimate)}, interval [${showNumber(ci.lower)}, ${showNumber(ci.upper)}]`,
        );
      }
    }
    const coverage = contained / WILSON_DRAWS;
    lowest = Math.min(lowest, coverage);
    if (coverage < WILSON_COVERAGE) {
      items.push({
        id: `wilson-n${n}`,
        component: STATS_COMPONENTS.intervals as string,
        detail: `estimator wilson, seed ${seed}, n ${n}: ${contained} of ${WILSON_DRAWS} intervals contain the truth (coverage ${showNumber(coverage)}); first misses: ${misses.join('; ')}`,
      });
    }
  }
  return { value: lowest, items };
}
