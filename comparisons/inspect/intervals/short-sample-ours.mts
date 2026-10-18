// pass@k on short samples: our value and the interval the report attaches (packages/report/src/reliability.ts, atKRows),
// next to the single value inspect_ai's pass_at returns. Run: npx tsx comparisons/inspect/intervals/short-sample-ours.mts

import { atKRows } from '../../../packages/report/src/reliability';
import { passAtK, wilson } from '../../../packages/stats/src/index';

const pA = (p: number, k: number) => 1 - (1 - p) ** k;
for (const [c, n, k] of [
  [1, 3, 2],
  [1, 2, 2],
  [1, 3, 3],
  [0, 3, 2],
] as const) {
  const w = wilson(c, n);
  const row = atKRows(c, n, w.lower, w.upper, pA, passAtK)[k - 1];
  console.log(
    `c=${c} n=${n} k=${k}: pass@k ${row?.value.toFixed(3)}, interval [${row?.lower.toFixed(3)}, ${row?.upper.toFixed(3)}]`,
  );
}
