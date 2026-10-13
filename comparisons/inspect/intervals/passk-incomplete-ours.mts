// pass^k over incomplete runs, ours: the value counts each incomplete run as failing and the range covers both outcomes.
// Run: npx tsx comparisons/inspect/intervals/passk-incomplete-ours.mts

import { incompleteRange } from '../../../packages/report/src/reliability';
import { passK } from '../../../packages/stats/src/index';

for (const [c, n, m, k] of [
  [2, 3, 1, 2],
  [1, 3, 1, 2],
] as const) {
  const r = incompleteRange(c, n, m, k, passK);
  console.log(
    `ours pass^k c=${c} n=${n} incomplete=${m} k=${k}: value ${r.value.toFixed(3)}, range [${r.lower.toFixed(3)}, ${r.upper.toFixed(3)}]`,
  );
}
