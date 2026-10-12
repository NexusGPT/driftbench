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

The ladder is a bank (docs/validators.md section 12): seven levels, each a sub-bank of items with threshold 1.0. Level 0 of 7 on seeds 1 to 20 and the hidden seed: the first level (reader and graph) has failing items on every seed. The measurement that matters is the bank score; `pnpm driftbench validate estate --hardness` prints it from the journal.

| Row | Commit | Items passing on every seed | Score |
|---|---|---|---|
| iteration 0 | c14526b (lane/v-estate, the reader merged from main) | 424 of 744 | 0.570 |
| pilot 1 to 10 | exec/v-estate-pilot2 | 443, 462, 471, 481, 487, 492, 496, 500, 503, 507 | 0.681 after pilot 10 |

Items fixed per pilot iteration: 19, 19, 9, 10, 6, 5, 4, 4, 3, 4; mean 8.3; none broken. Failing after the pilot: 237 items, 94 distinct causes. Forecast: 28.6 iterations. The gate of section 12.4 does not hold: forecast under 100, score above 0.4, causes under 100. The audit of section 12.7 has not run (no audit.md). The scale items of every row come from one run at iteration 0 (see Pitfalls).

## Floor

See `validators/floors.json`; `pnpm driftbench validate floors` prints it. The estate has no floor. Its ladder version is the bank of 744 items; a floor waits for the hardness gate and the audit.

## Open items

The first failing level is reader and graph (scan.*). After the pilot, the causes with the most failing items (the full list: `driftbench validate estate --items`, each item names its cause):

* Level 1, reader: routing cells without backticks, a slash command, a link to the skill file, a table whose first column names the skill, a table without outer pipes, routing as a list or a sentence or a heading (scan.standing, code.ts); standing files in subfolders and imported files (claude-code.ts); paths in quotes, bare, in bold, with backslashes, as @imports, as wiki links, with a line number, from the project folder variable, with a space (scan.paths); gate forms then, without, only after, a question, prior to, two on a line, act verbs updating and renaming (scan.gates); hazard synonyms and decoys with an outside owner (scan.hazards); negations, comments, change notes, form numbers, quoted guard messages (scan.decoys); an empty file crashes the scan (scan.hostile).
* Level 4, generation: a registered custom check (44 items), a "some call matches" check (30 items), distinct positive phrases per route (6), no outside trigger row for a rule that applies always (6), guard message and timing checks (4 each), a stage reach check (3).
* Level 3, plan: each situation crossed only with the atom kinds it acts on (plan.relevance, 20 items, one cause).
* Level 5 and 6: deleted registers and gates that no test notices; maintenance retires a test only when every named atom leaves (7 items).
* Level 7, scale: plan and generate over their time budget from 1000 atoms; at 5000 atoms the scan misses 283 of 5003 planted atoms and lint reports 1132 findings on a clean estate.

## Hypotheses tried

The ten pilot iterations are the journal rows 1 to 10 and the commits of `exec/v-estate-pilot2`: a catalogue of checks read as a registry; a path with an anchor, a query or a title; the adjective compact; gate markup; fenced examples skipped; more rule column names; a dispatcher's bare target name; YAML data files; command wrappers; a gate only before an act. A first pilot on the reader before the reader lane merged (`exec/v-estate-pilot`) is history, not measurement: the merged reader already held several of its fixes.

## Next actions

1. Read a routing cell naming a skill or helper without backticks (code.ts routeAtoms): three scan.standing items.
2. Read standing files in subfolders and the files a standing file imports (claude-code.ts walk and readImports).
3. Fix the crash on an empty file: the invariant and skill atoms are anchored on the first non-empty line, and an empty file has none (scan/invariants.ts, claude-code.ts readSkill).

## Pitfalls

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
