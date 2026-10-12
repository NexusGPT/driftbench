# Handover: validator judges

Rewritten by the executor every iteration (docs/validators.md section 10). A stranger continues from this file alone. The level table is written by `driftbench validate judges --journal <row.json>` from the last journal row.

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
| 1 | 1 |
| 2 | 1 |
| 3 | 1 |
| 4 | 1 |
| 5 | 1 |
| 6 | 1 |
| 7 | 1 |
| 8 | 1 |
| 9 | 1 |
| 10 | 1 |
| 11 | 1 |
| 12 | 1 |
| 13 | 1 |
| 14 | 1 |
| 15 | 1 |
| 16 | 1 |
| 17 | 1 |
| 18 | 1 |
| 19 | 1 |
| 20 | 1 |
| hidden | 1 |
<!-- level-table:end -->

This is ladder version 2 (docs/validators.md section 12): `judgesLadderV2()` in `packages/validators/src/ladders/judges/v2/`, registered in `packages/validators/src/ladders/index.ts`, so `driftbench validate judges` runs it. The bank holds 769 items; 111 deterministic items are quarantined because no page needs them (`validators/judges/NEEDS.md`, lists in `v2/needs.ts`), which leaves 638 deterministic items in 20 levels, each level's threshold 1, plus 20 live items. Level 1 (the seven v1 levels per criterion) passes on every seed; level 2 (contract) fails. Bank score after the ten-iteration pilot: 260 of 638 items pass on every seed (0.4075); iteration 0 was 249 (0.3903). Hardness: 1.1 items fixed per iteration, 378 remaining, forecast 343.6 iterations, 150 distinct failing causes. `validators/judges/GATE.md` lowers the score bar for judges to 0.41 (`Max score after the pilot: 0.41`, read by `--hardness`), which the pilot meets; the gate then waits only on `audit.md`. These rows are the pilot's package; on main's judges package the bank gives 258 of 638 (0.4044) and 153 causes, and the next executor starts there. The judges page's "Planned" section (docs/concepts/judges.md) is the roadmap most failing items point at. The record is `validators/judges/journal.jsonl`: iteration 0 and pilot rows 1 to 10; `pnpm driftbench validate judges --hardness` prints the measurement and its gate.

The journal rows were measured on the 736-item bank (the pilot replayed with families/more.ts) and the quarantined items were then dropped from each recorded row, from the per-item captures `_captures/v-judges2/bank-iteration-<n>.txt`; nothing was re-run. Every quarantined item fails in every row, so dropping them leaves the passing counts as recorded. Items added after the recording (the round 2 and 3 items of NEEDS.md) take in every row the verdict a run of HEAD gives: the pilot never touched their code. Row 2's capture holds 47 failures that rows 1 and 3 to 10 do not record, none of them a contract item, the family its change touched (22 scale items, which run under time budgets, 9 render, 5 council, 3 each of calibration, check and criteria, 1 cascade, 1 clients); row 2 is the failures of row 1 that the row 2 capture also records, which gives 249 passing, as the earlier 656-item row 2 recorded.

Every item carries a cause, the one change in packages/judges that makes it pass (`packages/validators/src/ladders/judges/v2/causes.ts` and `causes-more.ts`). Screen items that the base screen alone turns green carry the base screen's cause (`BASE_SCREEN_ITEMS` in causes.ts). A screen behaviour item whose `screenData` does not exist yet says in its Fix line to add the base screen first. A failing item's detail ends with `Fix: <the change>`, so you can act on it without reading the validator's code: make that change in packages/judges, add its test, measure. `--blind` drops every cause and every `Fix:` hint from the output, for an auditor; `--all-levels` lists every failing item of every level.

## Floor

Floors are per ladder version (section 12.5); `validators/floors.json` is the maintainer's. The judges floor of 7 belongs to version 1. Version 2 starts at the level the pilot reached: 1.

## Open items

Executor exec/judges-v2 (from lane/v-judges2). Finding at start: the handover described the pilot's package (260 of 638), but this branch carries main's judges package, so the baseline was 258 of 638 (0.4044), 153 causes, level 1; iteration 11 is the first fix here.

Level 2, contract (13 items): near-JSON the page asks to repair and mark repaired: score as a string, single quotes, trailing comma, line comment, typographic quotes (each with its `repaired-marked-*` twin), then `contract/probability-above-one`, `-below-zero`, `-crossed-bounds`, then `contract/unescaped-quotes` if still red. Then level 3, consistency (`judgeRepeated`, chat client temperature). `pnpm driftbench validate judges --seeds 1..20 --hidden --items` lists everything.

## Hypotheses tried

Iteration 11 (cause: outcome with capitals): `recaseOutcome` in packages/judges/src/contract.ts reads "Pass", "FAIL", " Inconclusive " after the strict parse fails, and sets `repaired: true`. Test: packages/judges/test/contract.test.ts "near-JSON: the outcome written with capitals". Bank 258 -> 260, causes 153 -> 152. Nothing rejected.

## Next actions

1. Near-JSON repair, one kind per iteration, same place (`parseAnswerText`): a score written as a number in quotes; then single quotes; trailing comma; `//` comment line; typographic quotes. Each marks `repaired: true`.
2. `outcomeFromProbability`: inconclusive outside 0 to 1 or not finite; RangeError when failAt is not under passAt.
3. `judgeRepeated(client, request, k)` and temperature 0 in the three chat clients.
4. Every fix: one cause, its test in packages/judges/test, then `measure.ts --iteration N` (run from the repo root with `pnpm exec tsx`) and `validate judges --journal row.json`.

## Pitfalls

* Never edit the bank (`packages/validators/src/ladders/judges/**`): a wrong item goes to the maintainer with the oracle's answer and a counter-example.
* Do not read `packages/validators/test/judges/v2/witness.ts` (an exec/ branch cannot change it: packages/validators/test/ is protected). It proves every item can pass and holds an implementation of most of the roadmap; copying it would empty the ladder without building anything.
* Scale items run under time budgets on the whole seed set; a laptop under load can push one over. Re-measure before you treat a scale failure as real.
* Each item runs in a child process with a limit of 120 seconds. An item that hangs fails alone with "timed out" and the run goes on at the next item, so a slow change shows up as timed-out items, never as a stalled run. A run with several timed-out items takes much longer; that is expected.
* One capability can flip a family at once (the screen flips injection, precision and attacks together; `agreementInterval` flips 15 calibration items). The pilot forecast comes from contract fixes of one or two items each; expect larger steps later and re-measure the forecast every ten iterations.
* The ladder v1 cassettes are keyed by request hash: a change to the Acme agent or criteria needs `pnpm exec tsx packages/validators/test/judges/record.ts`.

## How to run

```
pnpm driftbench validate judges --seeds 1..3 --hidden            # stops at the first failing level
pnpm driftbench validate judges --seeds 1..20 --hidden --items   # the whole bank, pass or fail per seed
pnpm driftbench validate judges --seeds 1..20 --hidden --all-levels --blind --json   # every failing item, no cause
pnpm exec tsx packages/validators/test/judges/v2/measure.ts --iteration N --hypothesis "..." \
  --files a,b --commit <sha> --tests "test name" --out row.json
pnpm driftbench validate judges --journal row.json
pnpm driftbench validate judges --hardness
```

## Fixtures

* The items: `packages/validators/src/ladders/judges/v2/families/*.ts`, one file per family, each with its spec in the head comment.
* The quarantine: `packages/validators/src/ladders/judges/v2/needs.ts` and `validators/judges/NEEDS.md`. `judgesBank({ quarantined: true })` returns the quarantined items too.
* The labelled slices and transforms reused from version 1: `packages/validators/src/ladders/judges/pool.ts`, `transforms.ts`, `packages/validators/fixtures/judges/`.
* Live items (20) run only with `DRIFTBENCH_BILLED_APPROVAL` set to the id of an owner-approved sized card.
