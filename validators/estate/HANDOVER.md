# Handover: validator estate

Rewritten by the executor every iteration (docs/validators.md section 10). A stranger continues from this file alone. The level table is written by `driftbench validate estate --journal <row.json>` from the last journal row.

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
| 1 | 0 |
| 2 | 0 |
| 3 | 0 |
| 4 | 0 |
| 5 | 0 |
| 6 | 0 |
| 7 | 0 |
| 8 | 0 |
| 9 | 0 |
| 10 | 0 |
| 11 | 0 |
| 12 | 0 |
| 13 | 0 |
| 14 | 0 |
| 15 | 0 |
| 16 | 0 |
| 17 | 0 |
| 18 | 0 |
| 19 | 0 |
| 20 | 0 |
| hidden | 0 |
<!-- level-table:end -->

The ladder is a bank (docs/validators.md section 12): seven levels, each a sub-bank of items with threshold 1.0. Level 0 of 7 on seeds 1 to 20 and the hidden seed: the first level (reader and graph) has failing items on every seed. `pnpm driftbench validate estate --hardness` prints the bank score from the journal. Measured on origin/main 459beea merged into the lane (lane commit f1e6ec9).

| Row | Commit | Items passing on every seed | Score |
|---|---|---|---|
| iteration 0 | f1e6ec9 (lane/v-estate) | 697 of 1065 | 0.654 |
| pilot 1 to 10 | exec/v-estate-pilot2 | 716, 736, 745, 755, 763, 767, 771, 775, 778, 783 | 0.735 after pilot 10 |

Items fixed per pilot iteration: 19, 20, 9, 10, 8, 4, 4, 4, 3, 5; mean 8.6; none broken. Failing after the pilot: 282 items, 135 distinct causes. Forecast: 32.8 iterations. validators/estate/NEEDS.md cites the need of every family; gen.task is quarantined. The gate does not hold on the forecast and the score; the cause term holds. No audit.md yet.

## The unit runner contract (frozen with the lead and the reader lane)

`driftbench estate unit <specs...> --estate <root> --json` runs the unit-mode specs. It prints `{ runs: [{ spec, pass, failing: string[] }], guards: [{ guard, event, decision: "allow"|"deny"|"ask", message?: string, ms: number }], scripts: [{ script, exit: number, stdout: string }] }`. It exits 0 when every spec passes, 1 when a spec fails, and 2 on bad input. The unit.runner items read `runs[].spec` and `runs[].pass`.

## Floor

See `validators/floors.json`; `pnpm driftbench validate floors` prints it. The estate has no floor. Its ladder version is the bank of 744 items; a floor waits for the hardness gate and the audit.

## Open items

The first failing level is reader and graph (scan.*). After the pilot, the causes with the most failing items (the full list: `driftbench validate estate --items`, each item names its cause):

* Level 1, reader: routing cells without backticks, a slash command, a link to the skill file, a table whose first column names the skill, a table without outer pipes, routing as a list or a sentence or a heading (scan.standing, code.ts); standing files in subfolders and imported files (claude-code.ts); paths in quotes, bare, in bold, with backslashes, as @imports, as wiki links, with a line number, from the project folder variable, with a space (scan.paths); gate forms then, without, only after, a question, prior to, two on a line, act verbs updating and renaming (scan.gates); hazard synonyms and decoys with an outside owner (scan.hazards); negations, comments, change notes, form numbers, quoted guard messages (scan.decoys); an empty file crashes the scan (scan.hostile).
* Level 4, generation: a registered custom check (44 items), a "some call matches" check (30 items), distinct positive phrases per route (6), no outside trigger row for a rule that applies always (6), guard message and timing checks (4 each), a stage reach check (3).
* Level 3, plan: each situation crossed only with the atom kinds it acts on (plan.relevance, 20 items, one cause).
* Level 5 and 6: deleted registers and gates that no test notices; maintenance retires a test only when every named atom leaves (7 items).
* Level 7, scale: plan and generate over their time budget; at 5000 atoms lint reports 1132 findings on a clean estate, because a routing table longer than one prose chunk loses its rows past the chunk's end (bench.defects.long-routing-table holds the same cause at 400 rows).
* bench.defects: the reference index offers files under ignored folders (hooks tests, skills/synced, __pycache__); a delete mutant of a guard or an env setting in settings.json is refused; `estate run --map` on a mutant folder drops the original pin; a phrase bank with no situation is refused; a registry row naming its guard by the adapter's short name, and an id cell holding two ids.
* blind.*: comments and tilde fences read as prose; "never read X before Y" read as a gate; plural hazard words; a link with a title; characters counted in code units; list order as next edges; a helper named without backticks.

## Hypotheses tried

The ten pilot iterations are the journal rows 1 to 10 and the commits of `exec/v-estate-pilot2`: a catalogue of checks read as a registry; a path with an anchor, a query or a title; the adjective compact; gate markup; fenced examples skipped; more rule column names; a dispatcher's bare target name; YAML data files; command wrappers; a gate only before an act. A first pilot on the reader before the reader lane merged (`exec/v-estate-pilot`) is history, not measurement: the merged reader already held several of its fixes.

## Next actions

1. Read a routing cell naming a skill or helper without backticks (code.ts routeAtoms): three scan.standing items.
2. Read standing files in subfolders and the files a standing file imports (claude-code.ts walk and readImports).
3. Fix the crash on an empty file: the invariant and skill atoms are anchored on the first non-empty line, and an empty file has none (scan/invariants.ts, claude-code.ts readSkill).

## Pitfalls

* Families on the Northwind fixture's generated suite (examples/estates/fixture, fictional), judged once per run (seed-free): unit.runner (26: every guard's unit specs pass, and turn red when the guard allows all, blocks all, changes its message or runs past its timeout; scripts on their fixtures), kill.fake (31: a generated live spec, green on the original, turns red on the delete or invert mutant of each atom kind, on the fake runtime), gen.task (23: every ask holds a task; quarantined, see NEEDS.md), gen.reads (23: no Read of a missing file), gen.coverage (25: one complete spec per atom of each kind, judged domain rules, the gap markers), maintain.fixture (20: impact on structural edits and on the two committed versions).
* kill.fake fails on all 31: the fake runtime knows only the Northwind proof asks, so most specs naming an atom fail on the original, and the specs that pass do not change on the mutant (D15 of the bench).
* The bank holds bench.defects (20 items from a model-free bench run: D2, D5, D6, D7, D9 and the long routing table) and five blind.* families (176 items) written by a breaker that never read packages/estate. The bench items D6 and D7 run the CLI as a child process, so a row takes several minutes on a loaded machine.
* The scale run of this measurement ran at a load average above 100: scale.scan-250 took 7 s against 4 s. A quieter run earlier passed the scan through 2500 atoms. Measure scale alone on a quiet machine.
* A measurement of every item except scale on seeds 1 to 20 and the hidden seed takes under a minute with six seed groups in parallel (`SKIP=scale` in `_captures/v-estate/measure-par.mts`). The scale family alone takes about 70 minutes and depends on machine load: measure it alone, on a quiet machine. Every journal row holds the scale results of the one run at iteration 0, so no load difference counts as a fix.
* The pilot fixed the hidden seed at 523931547 for every row, so rows compare item by item.
* An item that turned out wrong is fixed by the bank's author in a commit of its own (section 12.3): a step of a named process may be qualified `<process>/<id>`, and the oracle compared it with the bare id (commit c14526b).
* Several items can share one cause; the cause of each item is in bank/causes.ts. The largest causes (a registered custom check, a "some call matches" check, the plan's relevance table) hold 94 of the 237 failing items.
* A fix in the estate package must keep its committed fixture tests: the map of examples/estates/fixture is compared byte for byte, and its gates include "Read X before matching any line".

## How to run

```
pnpm driftbench validate estate --seeds 1..20 --hidden
pnpm driftbench validate estate --hardness
pnpm driftbench validate estate --items --seed 1
pnpm driftbench validate estate --brief
```

The ladder must be registered in packages/validators/src/ladders/index.ts (`estate: estateLadder()`), a maintainer change.

## Fixtures

* `packages/validators/fixtures/estate/seed-1.yaml` and `holdout-1.yaml`: the generated estates of seed 1 (files, truth, recorded answers, rule follower sessions).
* Every other input is built by the item's own seeded generator into a temporary folder: planted estates (bank/planted.ts) for the reader and lint families, the generated estates (pipeline.ts) for plan, generation, mutants and maintenance, scale estates (bank/scale-estate.ts).
