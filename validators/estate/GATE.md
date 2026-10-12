# Estate validator: where the gate stands

Status, 2026-10-12: the owner asked to write more capabilities into the docs and, if the gate still fails, to lower the bar per validator. Five planned capabilities are now in docs/estate.md, each with its user purpose, and the bank holds items for them. The gate of docs/validators.md section 12.4 still fails on the forecast and the score. The lowered bar proposed for this validator is at the end. No item was added to reach a number. Every family names its need in [NEEDS.md](NEEDS.md); none is quarantined.

## What the docs now promise (planned, not built)

| Capability | Where | User purpose | Items |
|---|---|---|---|
| Names that fit several files | docs/estate.md section 1, and `AMBIGUOUS_REFERENCE` in the lint table | a bare file name lands on the file the author meant, or is reported, never bound at random | bench.defects, 5 name items (3 fail) |
| Asks that name a task | docs/estate.md section 5 | a code-written ask that restates the rule tests repetition, not compliance | gen.task, 23 items (11 fail) |
| The same outputs on Node 22 | docs/estate.md section 5 | a user who regenerates on another machine gets the same files | estate.determinism, 5 items (all pass) |
| Guard messages and timing | docs/estate.md section 6, `estate unit` | a guard that blocks silently, or runs past its timeout, enforces nothing | unit.runner, 9 items (all fail: `estate unit` is not built) |
| Drift per guard | docs/estate.md section 7, `drift.guards`, with an audit-style finding note | a guard that starts denying more, or stops firing, is the first sign the estate or the agent changed | estate.stats, 4 items (all fail: `estate stats` is not built) |

## The numbers

From `driftbench validate estate --hardness`, journal rows 0 to 10. The rows were measured on origin/main 459beea merged into lane/v-estate. The pilot is the ten component commits of exec/v-estate-pilot2. The hidden seed was fixed at 523931547 for every row.

| Measure | Value | Gate (section 12.4) |
|---|---|---|
| Bank | 1170 items, 39 families, tiers 1 to 5 | 300 items, no family under 20, every tier: holds |
| Score at iteration 0 | 0.629 (736 of 1170) | |
| Score after the pilot | 0.703 (822 of 1170) | at most 0.4: not met |
| Items fixed per iteration | 8.6 (19, 20, 9, 10, 8, 4, 4, 4, 3, 5; none broken) | |
| Forecast | 40.5 iterations (348 failing / 8.6) | at least 100: not met |
| Distinct failing causes after the pilot | 145 | at least 100: holds |
| Audit | `audit.md` absent | required |

Items that the pilot cannot move were measured once and carried to every row; the handover lists which. These are the seed-free families on the committed fixture, the scale run, and the five name items. The name items were measured at rows 0 and 10, which agree.

## Where the 348 failing items sit

| Family | Failing | What they wait for |
|---|---|---|
| unit.runner | 41 | `estate unit` (docs section 6) |
| estate.stats | 37 | `estate stats` (docs section 7) |
| gen.complete | 33 | checks the generator cannot write: registered custom predicates (one cause each), "some call matches", stage reach, guard timing and message |
| kill.fake | 31 | a generated live spec that a mutant of each atom kind turns red on the fixture's stand-in runtime |
| mutant.agent | 27 | the same, on the validator's rule follower |
| plan.relevance | 20 | one relevance table |
| gen.task | 11 | code-written asks that restate a rule or a condition |
| scan.*, blind.*, bench.defects | 101 | reader forms, decoys, empty files, names that fit several files |
| gen.coverage | 13 | a kind with no complete spec, unjudged domain rules, the six named gaps |
| scale | 12 | plan and generate under their budget (the scale run was taken at a load above 100) |
| maintain.impact | 11 | retire a test when its atom under test leaves |
| others | 11 | gen.asks 8, lint 2, plan.contract 1 |

## Why the forecast stays under 100

* A third of the failing items (unit.runner, estate.stats, kill.fake) wait for two unbuilt commands and a stand-in that can show a mutant's effect. Each item is a distinct capability, but a built command turns many of them green in a few iterations.
* The pilot took the largest causes first, so its mean (8.6 items per fix) is high. A reader fix moves every form of one shape at once.
* The cause count (145) is the closer measure of the work left: about 145 changes, one per cause.

## The lowered bar proposed for this validator

For the estate validator, and to be confirmed by the owner:

| Term | Section 12.4 bar | Proposed estate bar | Measured |
|---|---|---|---|
| Forecast | at least 100 | at least 30 | 40.5 |
| Score after the pilot | at most 0.4 | at most 0.75 | 0.703 |
| Distinct failing causes | at least 100 | at least 100 (kept) | 145 |
| Audit | four checks pass | four checks pass (kept) | absent |

Why these numbers: the documented scope of estate testing gives about 145 distinct fixes left after a lean pilot. The cause bar stays at 100, and it is the term that says "this is hard". The forecast and score bars follow from that scope: a validator whose items are all documented needs cannot reach a forecast of 100 when one fix closes a whole form. With this bar, the estate validator still does not merge until the four audit checks pass.

## Flags for the audit

* The reach and decay items read `reached` and `runs` as the docs now define them (sessions per atom, sessions per block index).
* gen.task flags "Stop, that is enough for now." in guard_hostile: that ask is the stop guard's own trigger, not a task. The item may be too strict there; the cause review should decide.
* The pass rate per atom per estate version (the second half of section 7's drift) is not in the contract: it needs a store of past runs and its own finding.
