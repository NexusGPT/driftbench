// Coverage of the pass^k and pass@k intervals by seeded simulation.
// Usage: npx tsx comparisons/intervals/coverage-sim.mts [raw|widened]
//   raw: the Wilson bounds raised to k, as the report computed them before the fix.
//   widened: the same bounds, widened to contain the exact value (the current rule).
import { mulberry32, passAtK, passK, wilson } from '../../../packages/stats/src/index';

const rule = process.argv[2] ?? 'widened';
const rng = mulberry32(20261012);
const reps = 4000;
let minCover = 1;
let minContain = 1;
const rows: string[] = [];
for (const p of [0.3, 0.5, 0.7, 0.9]) {
  for (const n of [3, 5, 10]) {
    for (const k of [1, 2, 3].filter((x) => x <= n)) {
      let coverK = 0;
      let coverA = 0;
      let containK = 0;
      let containA = 0;
      for (let r = 0; r < reps; r += 1) {
        let c = 0;
        for (let i = 0; i < n; i += 1) if (rng() < p) c += 1;
        const iv = wilson(c, n);
        const vK = passK(c, n, k);
        const vA = passAtK(c, n, k);
        let lK = iv.lower ** k;
        let uK = iv.upper ** k;
        let lA = 1 - (1 - iv.lower) ** k;
        let uA = 1 - (1 - iv.upper) ** k;
        if (rule === 'widened') {
          lK = Math.min(lK, vK);
          uK = Math.max(uK, vK);
          lA = Math.min(lA, vA);
          uA = Math.max(uA, vA);
        }
        if (p ** k >= lK && p ** k <= uK) coverK += 1;
        if (1 - (1 - p) ** k >= lA && 1 - (1 - p) ** k <= uA) coverA += 1;
        if (vK >= lK && vK <= uK) containK += 1;
        if (vA >= lA && vA <= uA) containA += 1;
      }
      minCover = Math.min(minCover, coverK / reps, coverA / reps);
      minContain = Math.min(minContain, containK / reps, containA / reps);
      rows.push(
        `p=${p} n=${n} k=${k}  pass^k cover ${(coverK / reps).toFixed(3)} value-in ${(containK / reps).toFixed(3)} | pass@k cover ${(coverA / reps).toFixed(3)} value-in ${(containA / reps).toFixed(3)}`,
      );
    }
  }
}
console.log(rows.join('\n'));
console.log(
  `rule ${rule}: smallest coverage ${minCover.toFixed(3)}, smallest share of values inside their interval ${minContain.toFixed(3)}`,
);
