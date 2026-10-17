# Planted bugs, 20 of 20 caught

Method: 20 bugs planted one at a time in packages/stats/src (branch audit/stats-planted-bugs, never pushed), each measured with `pnpm driftbench validate stats --seed 1 --items --json`, each undone with `git checkout -- packages/stats/src` and a clean `git status --short` before the next. Baseline: 834 of 834 items pass. 12 files, 20 functions. No paid model call.

No bug is an equivalent mutant: the distinguishing call below gives a different result on the original and on the bugged code.

| # | file:line | function | kind | caught | items lost | first ids (max 10) |
|---|---|---|---|---|---|---|
| 1 | packages/stats/src/basics.ts:115 | sampleVariance | unit mix-up (n vs n - 1) | yes | 8 of 834 | reference.drift.cusum, exact.sampleVariance.rational, exact.sampleVariance.integers, exact.sampleVariance.two-values, exact.sampleVariance.offset, exact.sampleVariance.tiny-spread, exact.sampleVariance.mixed-scale, agree.report.noise-floor |
| 2 | packages/stats/src/basics.ts:34 | quantileSorted | wrong quantile type (type 6) | yes | 17 of 834 | reference.bootstrap.replay, reference.reliability.unreliability, exact.quantile.type7, exact.quantileSorted.type7, exact.unreliability.p90-minus-p10, exact.quantile.order-statistics, exact.quantile.interpolation, exact.quantile.small-samples, exact.quantile.ties, exact.quantile.unsorted |
| 3 | packages/stats/src/intervals.ts:35 | wilson | dropped factor n (4n^2 to 4n) | yes | 26 of 834 | reference.intervals.wilson, reference.paired.pairedRateDifference, reference.paired.nonInferiority, exact.simulateCoverage.replay, exact.clusterRate.rate-over-goldens, exact.pairedRateDifference.newcombe, exact.nonInferiority.verdict, exact.pairedRateDifference.positive-covariance, exact.pairedRateDifference.negative-covariance, exact.pairedRateDifference.zero-margin |
| 4 | packages/stats/src/intervals.ts:46 | clopperPearson | off-by-one (n-k+1 to n-k) | yes | 12 of 834 | reference.intervals.clopperPearson, analytic.binomial.clopper-pearson-minimum.n5, analytic.binomial.clopper-pearson-minimum.n10, analytic.binomial.clopper-pearson-minimum.n20, analytic.binomial.clopper-pearson-minimum.n50, analytic.binomial.clopper-pearson-minimum.n100, analytic.binomial.clopper-pearson-minimum.n200, analytic.binomial.clopper-pearson-minimum.n500, edge.clopperPearson.n1-pass, edge.clopperPearson.one-in-1e6 |
| 5 | packages/stats/src/intervals.ts:70 | designEffect | dropped term (m-1 to m) | yes | 19 of 834 | reference.intervals.designEffect, reference.mde.mde, exact.designEffect.closed-form, exact.effectiveSampleSize.closed-form, exact.designEffect.no-clustering, exact.designEffect.full-correlation, exact.designEffect.negative-rho, exact.designEffect.fractional-m, exact.effectiveSampleSize.no-clustering, exact.effectiveSampleSize.full-correlation |
| 6 | packages/stats/src/intervals.ts:149 | clusteredMeanInterval | wrong degrees of freedom (g-1 to g) | yes | 8 of 834 | roadmap.clusteredMeanInterval.1, roadmap.clusteredMeanInterval.2, roadmap.clusteredMeanInterval.3, roadmap-degenerate.clusteredMeanInterval.empty, roadmap-degenerate.clusteredMeanInterval.nan, roadmap-degenerate.clusteredMeanInterval.infinity, roadmap-scale.clusteredMeanInterval, roadmap-purity.clusteredMeanInterval |
| 7 | packages/stats/src/reliability.ts:31 | passAtK | inclusive/exclusive comparison | yes | 1 of 834 | analytic.binomial.passatk.c5n8k3 |
| 8 | packages/stats/src/multiple.ts:39 | benjaminiHochberg | inclusive/exclusive comparison (<= to <) | yes | 1 of 834 | edge.rule.benjamini-hochberg-equality |
| 9 | packages/stats/src/repeat-reducers.ts:42 | reduceRepeats | wrong tie rule (first seen to last seen) | yes | 3 of 834 | exact.reduceRepeats.verdicts, exact.reduceRepeats.mode, edge.rule.mode-tie |
| 10 | packages/stats/src/drift.ts:75 | cusum | wrong sign | yes | 7 of 834 | reference.drift.cusum, analytic.drift.cusum-down.s1.5t10h5k0.5, analytic.drift.cusum-down.s2t12h4k0.5, analytic.drift.cusum-down.s3t25h8k1, analytic.drift.cusum-down.s0.8t10h2k0.25, exact.cusum.sums, exact.cusum.alarms |
| 11 | packages/stats/src/drift.ts:135 | pageHinkley | wrong sign | yes | 10 of 834 | reference.drift.pageHinkley, exact.pageHinkley.statistics, exact.pageHinkley.alarms, exact.pageHinkley.before-minimum, exact.pageHinkley.alarm-up, exact.pageHinkley.alarm-down, exact.pageHinkley.reset-after-alarm, exact.pageHinkley.delta-tolerance, exact.pageHinkley.min-instances-boundary, exact.pageHinkley.quiet-series |
| 12 | packages/stats/src/drift.ts:228 | ksTest | inclusive/exclusive comparison in the exact band | yes | 12 of 834 | reference.drift.ksTest, degenerate.ksTest.single, analytic.tests.ks-exact.m3n3, analytic.tests.ks-exact.m4n3, analytic.tests.ks-exact.m5n4, analytic.tests.ks-exact.m6n5, analytic.tests.ks-exact.m4n7, analytic.tests.ks-exact.m8n6, edge.ksTest.ties, edge.ksTest.unequal |
| 13 | packages/stats/src/agreement.ts:62 | cohenKappa | swapped weights (linear and quadratic) | yes | 9 of 834 | reference.kappa.kappa, analytic.agreement.kappa-linear.5, analytic.agreement.kappa-linear.6, analytic.agreement.kappa-linear.7, analytic.agreement.kappa-quadratic.8, analytic.agreement.kappa-quadratic.9, analytic.agreement.kappa-quadratic.10, edge.cohenKappa.linear-unused-category, edge.cohenKappa.quadratic-unused-category |
| 14 | packages/stats/src/agreement.ts:170 | krippendorffAlpha | unit mix-up (n(n-1) to n^2) | yes | 13 of 834 | reference.krippendorff.krippendorff, analytic.agreement.alpha-nominal.1, analytic.agreement.alpha-nominal.2, analytic.agreement.alpha-nominal.3, analytic.agreement.alpha-nominal.4, analytic.agreement.alpha-interval.1, analytic.agreement.alpha-interval.2, analytic.agreement.alpha-interval.3, edge.krippendorffAlpha.missing-nominal, edge.krippendorffAlpha.missing-ordinal |
| 15 | packages/stats/src/coverage.ts:71 | chaoCoverage | dropped term ((n-1)/n) | yes | 6 of 834 | reference.coverage.coverage, analytic.unseen.chao1-near.s20-even.x1.5, analytic.unseen.chao1-near.s20-even.x3, analytic.unseen.chao1-near.s40-tail5.x1.5, analytic.unseen.chao1-near.s40-tail5.x3, analytic.unseen.chao1-near.s80-tail10.x1.5 |
| 16 | packages/stats/src/power.ts:57 | mde | wrong tail (two-sided to one-sided) | yes | 11 of 834 | reference.mde.mde, exact.suiteHeadline.detectable-drop, edge.mde.baseline-all-pass, edge.mde.baseline-near-zero, edge.mde.rho-1, edge.mde.huge-n, simulation.power.n60-r1-p0.85, simulation.power.n80-r3-p0.8, simulation.power.n40-r5-p0.7, simulation.power.n150-r2-p0.9 |
| 17 | packages/stats/src/special.ts:224 | binomialCdf | loop bound | yes | 17 of 834 | reference.special.binomialCdf, reference.mcnemar.mcnemar, analytic.tests.mcnemar-exact.b1c7, analytic.tests.mcnemar-exact.b3c9, analytic.tests.mcnemar-exact.b10c4, analytic.tests.mcnemar-exact.b0c6, analytic.tests.mcnemar-size.n6, analytic.tests.mcnemar-size.n12, analytic.tests.mcnemar-size.n25, exact.binomialCdf.exact-small |
| 18 | packages/stats/src/paired.ts:33 | mcnemar | wrong default option (exact below 25 to below 10) | yes | 2 of 834 | reference.mcnemar.mcnemar, edge.mcnemar.exact-one-sided |
| 19 | packages/stats/src/variance.ts:365 | neymanAllocation | wrong tie rule (lower index to higher) | yes | 1 of 834 | reference.neyman.neyman |
| 20 | packages/stats/src/variance.ts:421 | repeatsForFloor | wrong default option (difference true to false) | yes | 10 of 834 | reference.repeatsForFloor.repeatsForFloor, analytic.allocation.repeats-floor.1, analytic.allocation.repeats-floor.2, analytic.allocation.repeats-floor.3, analytic.allocation.repeats-floor.4, analytic.allocation.repeats-floor.5, analytic.allocation.repeats-floor.6, analytic.allocation.repeats-floor.7, analytic.allocation.repeats-floor.8, agree.report.noise-floor |

## Edits and distinguishing inputs

### 1. sampleVariance (basics.ts:115), unit mix-up (n vs n - 1)
- Edit: `return ss / (n - 1);` replaced by `return ss / n;`
- Call: `sampleVariance([1,2,3,4])`
- Original: `1.6666666666666667`
- Bugged: `1.25`
- Validator: 8 items lost, caught.

### 2. quantileSorted (basics.ts:34), wrong quantile type (type 6)
- Edit: `const h = (n - 1) * p;   const lo` replaced by `const h = Math.min(Math.max((n + 1) * p - 1, 0), n - 1);   const lo`
- Call: `quantileSorted([1,2,3,4],0.25)`
- Original: `1.75`
- Bugged: `1.25`
- Validator: 17 items lost, caught.

### 3. wilson (intervals.ts:35), dropped factor n (4n^2 to 4n)
- Edit: `z2 / (4 * n * n));   return { estimate: p, lower: Math.max(0, center` replaced by `z2 / (4 * n));   return { estimate: p, lower: Math.max(0, center`
- Call: `wilson(3,10)`
- Original: `{"estimate": 0.3, "lower": 0.10779126740630099, "upper": 0.6032218525388546}`
- Bugged: `{"estimate": 0.3, "lower": 0, "upper": 0.839931879212395}`
- Validator: 26 items lost, caught.

### 4. clopperPearson (intervals.ts:46), off-by-one (n-k+1 to n-k)
- Edit: `betaQuantile(alpha / 2, k, n - k + 1)` replaced by `betaQuantile(alpha / 2, k, n - k)`
- Call: `clopperPearson(3,10)`
- Original: `{"estimate": 0.3, "lower": 0.0667395111777346, "upper": 0.6524528500599971}`
- Bugged: `{"estimate": 0.3, "lower": 0.07485463141969181, "upper": 0.6524528500599971}`
- Validator: 12 items lost, caught.

### 5. designEffect (intervals.ts:70), dropped term (m-1 to m)
- Edit: `const de = 1 + (m - 1) * rho;` replaced by `const de = 1 + m * rho;`
- Call: `designEffect(5,0.2)`
- Original: `1.8`
- Bugged: `2`
- Validator: 19 items lost, caught.

### 6. clusteredMeanInterval (intervals.ts:149), wrong degrees of freedom (g-1 to g)
- Edit: `studentQuantile(alpha, g - 1)` replaced by `studentQuantile(alpha, g)`
- Call: `clusteredMeanInterval([1,2,3,4,5,6],[a,a,b,b,c,c])`
- Original: `{"estimate": 3.5, "lower": -0.5565798963955437, "upper": 7.556579896395544}`
- Bugged: `{"estimate": 3.5, "lower": 0.49956084902908593, "upper": 6.500439150970914}`
- Validator: 8 items lost, caught.

### 7. passAtK (reliability.ts:31), inclusive/exclusive comparison
- Edit: `if (n - c < k) return 1;` replaced by `if (n - c <= k) return 1;`
- Call: `passAtK(3,5,2)`
- Original: `0.9`
- Bugged: `1`
- Validator: 1 items lost, caught.

### 8. benjaminiHochberg (multiple.ts:39), inclusive/exclusive comparison (<= to <)
- Edit: `if (p <= (rank * q) / m) {` replaced by `if (p < (rank * q) / m) {`
- Call: `benjaminiHochberg([0.025,0.5],0.05).rejected`
- Original: `[true, false]`
- Bugged: `[false, false]`
- Validator: 1 items lost, caught.

### 9. reduceRepeats (repeat-reducers.ts:42), wrong tie rule (first seen to last seen)
- Edit: `if (count > bestCount) {` replaced by `if (count >= bestCount) {`
- Call: `reduceRepeats([1,0],{kind:'mode'})`
- Original: `1`
- Bugged: `0`
- Validator: 3 items lost, caught.

### 10. cusum (drift.ts:75), wrong sign
- Edit: `sl = Math.max(0, sl - z - k);` replaced by `sl = Math.max(0, sl + z - k);`
- Call: `cusum([0,0,0,0,3,3,-3,-3],{target:0,sd:1}).lower`
- Original: `[0, 0, 0, 0, 0, 0, 2.5, 5]`
- Bugged: `[0, 0, 0, 0, 2.5, 5, 1.5, 0]`
- Validator: 7 items lost, caught.

### 11. pageHinkley (drift.ts:135), wrong sign
- Edit: `mDown += x - runningMean + delta;` replaced by `mDown += x - runningMean - delta;`
- Call: `pageHinkley([1,2,3,4,5,6],{minInstances:1}).down`
- Original: `[0, 0, 0, 0, 0, 0]`
- Bugged: `[0.005, 0, 0, 0, 0, 0]`
- Validator: 10 items lost, caught.

### 12. ksTest (drift.ts:228), inclusive/exclusive comparison in the exact band
- Edit: `Math.abs(ii * n - jj * m) < gap;` replaced by `Math.abs(ii * n - jj * m) <= gap;`
- Call: `ksTest([1,2,3],[4,5,6],{method:exact})`
- Original: `{"statistic": 1, "pValue": 0.09999999999999998, "method": "exact"}`
- Bugged: `{"statistic": 1, "pValue": 0, "method": "exact"}`
- Validator: 12 items lost, caught.

### 13. cohenKappa (agreement.ts:62), swapped weights (linear and quadratic)
- Edit: `return weights === 'linear' ? d : d * d;` replaced by `return weights === 'linear' ? d * d : d;`
- Call: `cohenKappa([0,1,2,2],[0,2,2,0],{weights:'linear'}).kappa`
- Original: `0.25`
- Bugged: `0.2857142857142857`
- Validator: 9 items lost, caught.

### 14. krippendorffAlpha (agreement.ts:170), unit mix-up (n(n-1) to n^2)
- Edit: `expectedSum / (n * (n - 1));` replaced by `expectedSum / (n * n);`
- Call: `krippendorffAlpha([[1,2,3,3],[1,2,3,4]]).alpha`
- Original: `{"alpha": 0.6956521739130435, "observed": 0.25, "expected": 0.8214285714285714, "pairable": 8}`
- Bugged: `{"alpha": 0.6521739130434783, "observed": 0.25, "expected": 0.71875, "pairable": 8}`
- Validator: 13 items lost, caught.

### 15. chaoCoverage (coverage.ts:71), dropped term ((n-1)/n)
- Edit: `? observed + ((n - 1) / n) * ((f1 * f1) / (2 * f2))` replaced by `? observed + ((f1 * f1) / (2 * f2))`
- Call: `chaoCoverage([1,1,2,5]).chao1`
- Original: `5.777777777777778`
- Bugged: `6`
- Validator: 6 items lost, caught.

### 16. mde (power.ts:57), wrong tail (two-sided to one-sided)
- Edit: `const za = normalQuantile(1 - alpha / 2);` replaced by `const za = normalQuantile(1 - alpha);`
- Call: `mde({n:100,baselineRate:0.5}).effect`
- Original: `0.1932251509298104`
- Bugged: `0.1722876130666937`
- Validator: 11 items lost, caught.

### 17. binomialCdf (special.ts:224), loop bound
- Edit: `for (let i = 0; i <= k; i += 1) sum += binomialPmf` replaced by `for (let i = 0; i < k; i += 1) sum += binomialPmf`
- Call: `binomialCdf(2,5,0.5)`
- Original: `0.5000000000000012`
- Bugged: `0.18750000000000067`
- Validator: 17 items lost, caught.

### 18. mcnemar (paired.ts:33), wrong default option (exact below 25 to below 10)
- Edit: `options.exact ?? n < 25;` replaced by `options.exact ?? n < 10;`
- Call: `mcnemar(8,16)`
- Original: `{"statistic": 8, "pValue": 0.15158963203429865, "method": "exact", "b": 8, "c": 16}`
- Bugged: `{"statistic": 2.0416666666666665, "pValue": 0.15304188415881959, "method": "chi-square", "b": 8, "c": 16}`
- Validator: 2 items lost, caught.

### 19. neymanAllocation (variance.ts:365), wrong tie rule (lower index to higher)
- Edit: `x.gain > y.gain || (x.gain === y.gain && x.i < y.i);` replaced by `x.gain > y.gain || (x.gain === y.gain && x.i > y.i);`
- Call: `neymanAllocation({sizes:[1,1],sds:[1,1],total:3}).allocated`
- Original: `[2, 1]`
- Bugged: `[1, 2]`
- Validator: 1 items lost, caught.

### 20. repeatsForFloor (variance.ts:421), wrong default option (difference true to false)
- Edit: `const factor = (input.difference ?? true) ? 2 : 1;` replaced by `const factor = (input.difference ?? false) ? 2 : 1;`
- Call: `repeatsForFloor({variance:0.25,floor:0.1})`
- Original: `{"repeats": 193, "floor": 0.09975954017897502}`
- Bugged: `{"repeats": 97, "floor": 0.09950209577513758}`
- Validator: 10 items lost, caught.
