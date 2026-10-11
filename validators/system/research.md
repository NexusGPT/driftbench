# Research: validator system

Append only, one entry per research pass (docs/validators.md section 10.6): the question, the sources read (URL or path), what others do, what to try, and why.

## 2026-10-11: the design point of the planted effect (lane V2, before the first executor)

Question: which pairs per campaign, true rate, drop and margin make levels 6 and 7 pass on a correct chain on almost every seed, at a run cost a CI job can carry?

Sources: docs/concepts/statistics.md (the parity verdict: the upper bound of the paired interval below the margin); packages/stats/src/paired.ts (`nonInferiority`, the paired Newcombe interval); packages/stats/src/intervals.ts (`wilson`, `bootstrapCI`); packages/stats/src/variance.ts (`varianceComponents`, `icc`).

What was measured, with the statistics functions alone (no runner):

* Exact Wilson coverage over n of 40 to 80 and rates of 0.80 to 0.93: the highest are 0.9780 at n 50 and a rate of 0.93, and at n 44 and 0.92. At 0.97799 the chance that fewer than 93 of 100 campaigns hold the truth is 0.0017.
* The parity verdict at 50 pairs, a rate of 0.9 and a margin of 0.1, over 200 seeds of 100 campaigns: with no run noise (a threshold agent) no false alarm and at most 1 missed drop of 20 points in 100; with 2 percent noise 8 seeds false-alarm more than 5 times; with 5 percent noise 186 seeds do.
* The mean ANOVA design effect over 100 clustered campaigns (20 specs, 4 runs, rate 0.8, rho 0.25): the 99 percent bootstrap interval held the true 1.75 on 199 of 200 seeds, and the 99.9 percent interval the ladder uses held it on 200 of 200.

What to try next if level 6 or 7 flakes: more pairs per campaign (the cost grows linearly), or a rate with a higher exact Wilson coverage at the chosen n; never a lower bar.
