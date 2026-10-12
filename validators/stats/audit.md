# Independent audit: stats (ladder version 2)

Base: audit-base/stats-v2 at ae1e22f0 (root commit "Root: stats ladder version 2 tests and registration (audit base v2)").
Audit branch: audit/stats-v2.
Model calls: none. Paid runs: none. Full suite: not run.
Bank: 1326 items (live, from `--items --json`, confirmed before any role ran).

## Verdict

FAIL. The blind pilot did not reach the full pass rule. The cheater gained score on 2 of 4 attempts. The cause review scored 0.20 against a 0.8 rule. The planted-bug check missed 5 of 20 bugs.

## Checks

| check | verdict | note |
|---|---|---|
| blind | fail | 10 iterations ran, each red then green, committed, with a journal row. Final 1 to 20 run: level 1 on every seed, 488 of 1326 items pass on every seed. Levels 4, 6 and 7 were not worked. A vitest run shows 1 of 220 failing in `packages/validators/test/stats/ladder.test.ts`, which the executor attributes to its iteration 4 change. |
| cheater | fail | 4 attempts, 2 gains. Baseline 430 of 1326 pass on every seed (0.3243). Attempt 1 (throw on non-finite input in every export) gained +45. Attempt 4 (option-string guard narrowed per function) gained +3. |
| cause | fail | Answers came from item id and family only, committed before any tag was read. Agreement 6 of 30 (0.20). 24 of 30 tags say "add <function>": the function is missing, and the id does not show that. |
| planted | fail | 15 of 20 caught. 5 misses, filed as new items below. |

## Blind pilot: items fixed per iteration

| iteration | cause fixed | items fixed | commit |
|---|---|---|---|
| 1 | basics accepted NaN and infinite data, and a NaN quantile level | 22 | 48c7a3b7 |
| 2 | pageHinkley had no input validation | 6 | 844a4275 |
| 3 | cusum options not checked | 3 | 300d696d |
| 4 | ksTest did not check data or method, and looped forever on NaN | 4 | 03f2d18e |
| 5 | wilcoxonSignedRank ranked non-finite data | 3 | 7e7eb6a1 |
| 6 | upperIncompleteGamma returned NaN at infinity | 3 | ab595a8e |
| 7 | special functions had no domain checks | 4 | 7ad8ae7c |
| 8 | scalar arguments checked one-sided, so Infinity and NaN passed | 11 | 0df340e4 |
| 9 | agreement option strings not validated | 2 | 4033528c |
| 10 | `mean` of an all-equal sample off by one ulp | 1 | 9d50f806 |

Level-2 failures on seed 1 went from 60 to 1 in the 1 to 3 runs. Open after the pilot: `quantileSorted` with unsorted input (fails on 20 of 20 seeds), `varianceComponents.equal` (12 of 20 seeds), and `bootstrapCI.equal` (4 of 20 seeds).

## Cheater: attempts

| # | idea | before | after | gain |
|---|---|---|---|---|
| 1 | wrap every export to throw RangeError on NaN or infinite argument | 430 | 475 | yes, +45, no regressions |
| 2 | throwing stubs for every roadmap method name | 430 | 430 | no |
| 3 | option-string guard on weights, level and method, for every function | 430 | 419 | no, breaks 14 bootstrap items |
| 4 | the same guard, narrowed per function with the valid values | 430 | 433 | yes, +3 |

Gains that fail the audit: attempts 1 and 4. Attempt 1 generalises a contract check across every export and is not a correct fix for the special-function items, which expect limits at infinity.

## Cause review: answers and tags

Failing items: 889 of 1326 (seed 1). Sample: 30 ids, sorted lexicographically, `random.Random(7).sample`, under `python3 -I`. Answers committed in the step 1 commit on audit-stats-v2-cause before any cause field was read.

Agreement: 6 of 30 (0.20). Distinct causes in the 30 answers: 5. Distinct cause strings in the 30 tags: 27 (24 "add <function>", 3 input or domain checks). Pass rule 0.8: fail.

## Planted bugs: missed

- `multiple.ts` line 38: `p <= (rank * q) / m` changed to `p < (rank * q) / m` in `benjaminiHochberg`. No item covers the threshold boundary.
- `power.ts` line 43: `input.power ?? 0.8` changed to `?? 0.9` in `mde`. The default power is never checked.
- `repeat-reducers.ts` line 40: `count > bestCount` changed to `>=` in `reduceRepeats`. The mode tie rule is not checked.
- `repeat-reducers.ts` line 55: `median > 0.5` changed to `>= 0.5`. A median of exactly 0.5 is not checked.
- `repeat-reducers.ts` line 10: `at_least:([1-9][0-9]*)` changed to `at_least:([0-9]+)`. `at_least:0` is accepted.

## Notes

- The stats source has no async code, so a missing-await bug was replaced by a second wrong-default bug.
- The blind pilot did not open the forbidden paths, but its ksTest change altered behaviour the validators test suite relies on. That test regression needs fixing before any verdict on the blind pilot can pass.
