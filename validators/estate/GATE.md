# Estate validator: where the gate stands

Status, 2026-10-12: the bank stays at its honest size until the owner decides. The owner will choose between lowering the estate forecast bar to what the documented needs support and widening the documented scope. No item was added to reach the bar. Every family names its need in [NEEDS.md](NEEDS.md); one family (gen.task) is quarantined for want of one.

## The numbers

From `driftbench validate estate --hardness`, journal rows 0 to 10, measured on origin/main 459beea merged into lane/v-estate. The bank and docs are at lane/v-estate after 5d714ff. The pilot is the ten component commits of exec/v-estate-pilot2, the hidden seed fixed at 523931547 for every row.

| Measure | Value | Gate (docs/validators.md section 12) |
|---|---|---|
| Bank | 1124 items, 38 families, tiers 1 to 5 | 300 items, no family under 20, every tier: holds |
| Score at iteration 0 | 0.638 (717 of 1124) | |
| Score after the pilot | 0.714 (803 of 1124) | at most 0.4: not met |
| Items fixed per iteration | 8.6 (19, 20, 9, 10, 8, 4, 4, 4, 3, 5; none broken) | |
| Forecast | 37.3 iterations (321 failing / 8.6) | at least 100: not met |
| Distinct failing causes after the pilot | 140 | at least 100: holds |
| Audit | `audit.md` absent | required |

## Where the 321 failing items sit

| Family | Failing | What they wait for |
|---|---|---|
| estate.stats | 33 | `estate stats`, not built (docs/estate.md section 7, the frozen contract) |
| gen.complete | 33 | checks the generator cannot write yet: registered custom predicates (one cause each), "some call matches", stage reach, guard timing and message |
| unit.runner | 32 | `estate unit`, not built (docs/estate.md section 6, the frozen contract) |
| kill.fake | 31 | a generated live spec that a mutant of each atom kind turns red on the fixture's stand-in runtime |
| mutant.agent | 27 | the same, on the validator's rule follower |
| plan.relevance | 20 | one relevance table: each situation crossed only with the atom kinds it acts on |
| scan.* and blind.* | 96 | reader forms: routing cells without backticks, paths in quotes or bare, gate decoys, hazard synonyms, empty files, comments |
| gen.coverage | 13 | an atom kind with no complete spec (gates, a tool, a stage), domain rules with no judged criterion, the six named gaps |
| scale | 12 | plan and generate under their time budget; the scale run was taken at a load above 100 |
| maintain.impact | 11 | retire a test when its atom under test leaves |
| others | 13 | gen.asks, bench.defects, lint, plan.contract |

## Why the forecast stays under 100

* The pilot took the largest causes first, so its mean (8.6 items per fix) is high: a reader fix moves every form of one shape at once.
* About a third of the failing items (estate.stats, unit.runner, kill.fake) wait for two commands and a runtime stand-in that do not exist yet. Each item is a distinct capability, but the commands, once built, will turn many of them green in a few iterations.
* Adding items of known causes does not move the forecast, and adding causes no page needs is against NEEDS.md. The honest bar is the owner's call.

## Real product findings

1. **`estate stats` and `estate unit` are promised and not built** (docs/estate.md sections 6 and 7). Their contracts are now in the docs and the CLI reference, frozen.
2. **The fake runtime cannot measure a mutant.** It plays only the Northwind proof asks, so no generated spec of 14 atom kinds turns red on any of their mutants (kill.fake, 31 items). `estate run` never checks that a spec passes on the original before it counts a mutant (bench D15).
3. **The reader's index offers files under ignored folders** (bench D2), for hook test folders, `skills/synced` and `__pycache__`.
4. **A routing table longer than one prose chunk loses its rows** past the chunk's end: 283 of 5003 atoms at 5000 atoms, and 1132 lint findings on a clean estate.
5. **The generator writes asks that hold no task** ("Please do this: never guess a shipment status"). gen.task measures it and is quarantined, because no page asks for task asks.

## Not added, and why

* **Drift** (docs/estate.md section 7: deny rates per guard, pass rate per atom per estate version): the frozen `estate stats` contract has no field for it. It needs an audit finding to change the contract first.
* **Node versions**: only Node 24 is on this machine; estate.determinism covers runs, processes, folders, file orders, time zones and locales (20 items, all pass).
* **Reach and decay** have 5 items. They read `reached` as the number of recorded sessions that reached the atom's moment (a skill load, a read of the reference, a guard decision, a dispatch), and `runs` as the number of sessions that hold the block index. The docs give the field names, not these counts: the reading is flagged for the audit's cause review.
