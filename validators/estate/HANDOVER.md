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

The ladder is a bank (docs/validators.md section 12): seven levels, each a sub-bank of items with threshold 1.0. Level 0 of 7 on seeds 1 to 20 and the hidden seed: the first level (reader and graph) has failing items on every seed. The measurement that matters is the bank score, in `validators/estate/hardness.json`:

| Row | Commit | Items passing on every seed | Score |
|---|---|---|---|
| iteration 0 | d1fbab5 (lane/v-estate) | 341 of 707 | 0.482 |
| pilot 1 to 10 | exec/v-estate-pilot | 366, 371, 380, 384, 397, 416, 433, 441, 450, 452 | 0.639 after pilot 10 |

Items fixed per pilot iteration: 25, 5, 9, 4, 13, 19, 17, 8, 9, 2; mean 11.1; none broken. Failing after the pilot: 255. Forecast: 23.0 iterations. The scale items of every row come from one quiet run at iteration 0 (see Pitfalls). The gate of section 12.4 (forecast at least 100, score at most 0.4) does not hold.

## Floor

See `validators/floors.json`; `pnpm driftbench validate floors` prints it. The estate has no floor (0). Its ladder version is the bank of 707 items; a floor waits for the maintainer.

## Open items

The first failing level is reader and graph. After the pilot, the failing items by family (items failing on at least one seed):

* scan.reference-prose 20 (packages/estate/src/scan/claude-code.ts): reference files a skill names are never sent to the splitter; a 250,000-character reference must go in chunks of at most 40,000.
* scan.decoys 16 (packages/estate/src/scan/code.ts, graph/edges.ts): code fences, comments, negations, a form number like a label, a guard message quoting part of a rule.
* scan.combination 11: the pairs holding a rule inside a reference.
* scan.hazards 10, scan.gates 9: synonyms of the hazards (a summary of the conversation, a 429, a reboot), the decoys left (a printer's restart, a supplier's rate limits), acts that are edits in other words, two gates on a line, a gate over two lines.
* scan.steps 7, scan.catalogue 7, scan.registry 7, scan.paths 5, scan.dispatcher 3: steps keyed by id, YAML, nested under another key, JSON with comments or trailing commas, the same ids in two processes; catalogue shapes left (by event, keyed by id, YAML, a markdown table); a label in lower case, a guard named without its extension; paths in angle brackets, with backslashes, in bold, as an import; dispatcher scripts.
* scan.hostile 9: an empty file crashes the scan ("the scan built an atom whose quote is not at its span"); settings with a byte order mark; a prompt hook; helpers in a subfolder; two skills sharing a name.
* Behind level 1 (measured, not reached by the ladder): gen.complete 71, mutant.agent 30, plan.relevance 20, maintain.impact 12, scale 7, gen.asks 4, lint 6, plan.contract 1.

## Hypotheses tried

The ten pilot iterations, each one cause, are the first rows of the journal and the commits of `exec/v-estate-pilot`: the reader follows links; a frontmatter value with a colon and a space; more registry column names; process maps; a guard command behind a prefix; a catalogue reader; a path with an anchor, a query or a title; a gate's act without its markup; the adjective compact; a successor as one id or under then. A first attempt at chunking the reference files was taken back: it changed the estate package's committed fixture map and four of its tests expect the old chunks; the fixture's recording must gain answers for the reference files first.

## Next actions

1. Send the reference files a skill names to the splitter (claude-code.ts) and add the fixture estate's answers for them to examples/estates/fixture/answers.yaml, so the estate package's map tests still hold; then split a reference over 40,000 characters.
2. Make code skip fenced code and HTML comments when it reads references, gates, hazards, routes and dispatches (scan.decoys, five items at once).
3. Fix the crash on an empty file: the invariant atoms are anchored on the first non-empty line, and an empty standing or definition file has none (scan/invariants.ts).

## Pitfalls

* A full measurement (seeds 1 to 20 and the hidden seed, every item) takes about 20 minutes with four seed groups in parallel; the scale family dominates it (each stage at 250 to 5000 atoms in a child process killed at its budget). `_captures/v-estate/measure-par.mts` in the lane worktree runs it; it is not part of the validator.
* The pilot fixed the hidden seed at 523931547 (the one of d1fbab5) so its rows compare item by item; a hidden seed from each commit would move items between rows by chance.
* Families of one cause collapse in one iteration: scan.symlink (23 items) fell to one change of the walker, scan.frontmatter to one change of the frontmatter parser. The pilot's mean is pulled up by them; the failing items left are spread over many more causes (see the handoff).
* The scale family is sensitive to machine load. Two quiet sequential runs at the pilot's two ends, on a machine running other work, failed 7 and 3 scale items, and the difference sat in stages the pilot never touched (plan at 1000 atoms: 18.5 s against 6 s in one run, a pass in the other). The rows hold the first run's scale results for every iteration, so no load difference counts as a fix. Measure scale alone, on an idle machine.
* A fix in the estate package must keep its committed fixture tests: the map of examples/estates/fixture is compared byte for byte.

## How to run

```
pnpm driftbench validate estate --seeds 1..20 --hidden
pnpm driftbench validate estate --seed 1 --json
pnpm driftbench validate estate --brief
```

The ladder must be registered in packages/validators/src/ladders/index.ts (`estate: estateLadder()`), a maintainer change. The bank score and the forecast: `measure-par.mts` and `journal.mts` in `_captures/v-estate/`, or `bankScore` and `hardness` from packages/validators/src/ladders/estate/bank.

## Fixtures

* `packages/validators/fixtures/estate/seed-1.yaml` and `holdout-1.yaml`: the generated estates of seed 1 (files, truth, recorded answers, rule follower sessions).
* Every other input is built by the item's own seeded generator into a temporary folder: planted estates (bank/planted.ts) for the reader and lint families, the generated estates (pipeline.ts) for plan, generation, mutants and maintenance, scale estates (bank/scale-estate.ts).
