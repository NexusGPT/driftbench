# Validator constants

This file records the numbers the validators judge by that are not derived from a seed: what each number is, where it lives in the code, how it was derived and the runs behind it. Change a number here and in the code in the same commit, on a fix/ branch with an independent review (docs/validators.md section 12).

## Generator scale

The time items `scale.10x.time` and `scale.100x.time` (docs/validators.md section 3.1). The code is in `packages/validators/src/ladders/generator/scale.ts`.

| Constant | Value | What it is |
|---|---|---|
| `SCALE_REFERENCE_UNIT_MS` | 51.3 | the reference unit's CPU time, in ms, on the host class that judges: the CI runner (ubuntu-24.04) |
| `SCALE_BUDGET_UNITS[10]` | 584 | the 10 times budget in units: floor(30000 / 51.3) |
| `SCALE_BUDGET_UNITS[100]` | 1169 | the 100 times budget in units: floor(60000 / 51.3) |
| `SCALE_MIN_UNITS` | 10 | the fewest unit samples in the window that measure anything |
| `SCALE_UNIT_WARMUP` | 5 | the sampler's units that end before the window starts, while its code is compiled |
| `SCALE_BUDGET_MS` | 60000 at 10 times, 120000 at 100 times | unchanged: the wall-clock cap is 10 times this |

### How they were derived

* The second budgets, 30 s for the two runs at 10 times and 60 s at 100 times (half of `SCALE_BUDGET_MS`), are the earlier budgets. The unit budgets keep them on a runner whose unit takes 51.3 ms.
* 51.3 ms is the mean unit over the 18 clean 100 times windows of six separate jobs on the CI runner, three windows each (the table below). Each job's three windows weigh the same. The runners differed: the jobs' CPU time at 100 times ranged from 37450 to 73549 ms, and their unit from 30.83 to 66.21 ms.
* The units held across the jobs: 1097 to 1217 at 100 times, an 11% spread, while the CPU time nearly doubled. The pass condition was a spread under 15%.
* The three jobs on the final sampler code (`ea28036fa`) alone give a mean of 47.01 ms, so 1276 units. The reference rests on six jobs, not three, because one runner (job 39040746597) ran the unit twice as fast as the others. A seventh job could move the mean again.
* The minimum is 10 samples. A 10 times window on the runner gave 17 to 22 samples, and a 100 times window 166 to 184.
* The warm-up is 5 units. Before it, the unit cost 13 to 37% more in the 10 times windows than in the 100 times windows (jobs 39032147370 to 39032157025). After it, it still cost 0 to 33% more (jobs 39040741057 to 39040752461). Alone on a Mac, the sampler's unit is flat from its second unit on, so the excess most likely comes from the product starting up beside it, a larger share of a short window. Both time items therefore divide by the unit of the 100 times window of the same ladder run; read in its own window, a 10 times run would count up to a quarter fewer units, and the 10 times budget would mean up to 39.6 s.

### The runs behind them

`validators/generator/evidence/scale-reference-unit-runner.jsonl` holds every row. The scale window at 10 and 100 times the behaviours of seed 1, beside the sampler, on the CI runner, dispatched separately (`jobs=generator-scale,plants`). The product is main `183abfd`:

| Job | Head | Clean 100x CPU ms | Unit ms | Clean 100x units | Clean 10x units | Twice as slow | Quadratic | Host three times slower |
|---|---|---|---|---|---|---|---|---|
| 39032147370 | `1b1c8c1b2` | 68540 to 69513 | 57.34 to 58.28 | 1181 to 1209 | 138 to 165 | 2005 | 1734 | 1177 |
| 39032152170 | `1b1c8c1b2` | 72952 to 73549 | 64.08 to 64.48 | 1137 to 1144 | 138 to 145 | 1879 | 1617 | 1147 |
| 39032157025 | `1b1c8c1b2` | 53395 to 53930 | 44.34 to 45.65 | 1174 to 1216 | 146 to 159 | 2095 | 1921 | 1188 |
| 39040741057 | `ea28036fa` | 72657 to 72844 | 64.29 to 66.21 | 1097 to 1133 | 144 to 150 | 1940 | 1652 | 1133 |
| 39040746597 | `ea28036fa` | 37450 to 37551 | 30.83 to 31.56 | 1187 to 1217 | 170 to 192 | 2123 | 2306 | 1260 |
| 39040752461 | `ea28036fa` | 53176 to 53422 | 44.27 to 45.25 | 1175 to 1204 | 143 to 169 | 2064 | 1918 | 1188 |

At the budgets above, on every job:
* **Twice as slow fails** (1879 to 2123 units). Each generation spends its own CPU time again.
* **Quadratic fails** (1617 to 2306 units). After each generation, it spends 0.012 µs times the specs squared.
* **The clean product sits at the budget** (1097 to 1217 against 1169), so its verdict depends on the runner. The product passes on some runners and fails on others: it is too slow for a margin, and that is a product finding.
* **The planted slower host gives the clean product's units** (1133 to 1260). It reads every CPU time in the child and the sampler as three times the real one, so it cancels by construction: it checks the division, not a real slower host. The runner jobs above are the evidence that a slower host keeps its units.

On a Mac with 12 cores, shared and at load 40 to 90, the same product read 266 to 313 units at 10 times and 1626 to 2430 at 100 times. The unit stayed at 26 to 27 ms while the product's CPU time moved from 42 to 63 s with the load. The unit corrects for the speed of a runner, not for contention on an oversubscribed host, so a Mac's units do not compare with a runner's.

### Earlier measures, kept for the record

* An absolute budget of 30 s and 60 s of CPU time: the same code took 47 to 98 s on that Mac.
* A file-based unit (200 small JSON files written, read and deleted): 21.5 to 22.1 ms on the runner against 38 to 40 ms on the Mac, while the product cost more on the runner. The same run read 2.1 times more units there.
* The growth from 10 to 100 times in one process: it does not catch a product twice as slow, since both sizes slow down alike (clean 6.5 to 11.1, twice as slow 7.5 to 9.1). The blocks scale family's slack of 4 times the multiple is 40, and a quadratic product grew only 14.8 to 18.0.
