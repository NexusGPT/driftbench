# Handover: validator judges

Rewritten by the executor every iteration (docs/validators.md section 10). A stranger continues from this file alone. The level table is written by `driftbench validate judges --journal <row.json>` from the last journal row.

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
| 1 | 7 |
| 2 | 7 |
| 3 | 7 |
| 4 | 7 |
| 5 | 7 |
| 6 | 7 |
| 7 | 7 |
| 8 | 7 |
| 9 | 7 |
| 10 | 7 |
| 11 | 7 |
| 12 | 7 |
| 13 | 7 |
| 14 | 7 |
| 15 | 7 |
| 16 | 7 |
| 17 | 7 |
| 18 | 7 |
| 19 | 7 |
| 20 | 7 |
| hidden | 7 |
<!-- level-table:end -->

This is ladder version 2 (docs/validators.md section 12): `judgesLadderV2()` in `packages/validators/src/ladders/judges/v2/`, registered in `packages/validators/src/ladders/index.ts`, so `driftbench validate judges` runs it. The bank holds 769 items; 111 deterministic items are quarantined because no page needs them (`validators/judges/NEEDS.md`, lists in `v2/needs.ts`), which leaves 638 deterministic items in 20 levels, each level's threshold 1, plus 20 live items. Level 1 (the seven v1 levels per criterion) passes on every seed; level 2 (contract) fails. Bank score after the ten-iteration pilot: 260 of 638 items pass on every seed (0.4075); iteration 0 was 249 (0.3903). Hardness: 1.1 items fixed per iteration, 378 remaining, forecast 343.6 iterations, 150 distinct failing causes. `validators/judges/GATE.md` lowers the score bar for judges to 0.41 (`Max score after the pilot: 0.41`, read by `--hardness`), which the pilot meets; the gate then waits only on `audit.md`. These rows are the pilot's package; on main's judges package the bank gives 258 of 638 (0.4044) and 153 causes, and the next executor starts there. The judges page's "Planned" section (docs/concepts/judges.md) is the roadmap most failing items point at. The record is `validators/judges/journal.jsonl`: iteration 0 and pilot rows 1 to 10; `pnpm driftbench validate judges --hardness` prints the measurement and its gate.

The journal rows were measured on the 736-item bank (the pilot replayed with families/more.ts) and the quarantined items were then dropped from each recorded row, from the per-item captures `_captures/v-judges2/bank-iteration-<n>.txt`; nothing was re-run. Every quarantined item fails in every row, so dropping them leaves the passing counts as recorded. Items added after the recording (the round 2 and 3 items of NEEDS.md) take in every row the verdict a run of HEAD gives: the pilot never touched their code. Row 2's capture holds 47 failures that rows 1 and 3 to 10 do not record, none of them a contract item, the family its change touched (22 scale items, which run under time budgets, 9 render, 5 council, 3 each of calibration, check and criteria, 1 cascade, 1 clients); row 2 is the failures of row 1 that the row 2 capture also records, which gives 249 passing, as the earlier 656-item row 2 recorded.

Every item carries a cause, the one change in packages/judges that makes it pass (`packages/validators/src/ladders/judges/v2/causes.ts` and `causes-more.ts`). Screen items that the base screen alone turns green carry the base screen's cause (`BASE_SCREEN_ITEMS` in causes.ts). A screen behaviour item whose `screenData` does not exist yet says in its Fix line to add the base screen first. A failing item's detail ends with `Fix: <the change>`, so you can act on it without reading the validator's code: make that change in packages/judges, add its test, measure. `--blind` drops every cause and every `Fix:` hint from the output, for an auditor; `--all-levels` lists every failing item of every level.

## Floor

Floors are per ladder version (section 12.5); `validators/floors.json` is the maintainer's. The judges floor of 7 belongs to version 1. Version 2 starts at the level the pilot reached: 1.

## Open items

Level 7 (check) passes since iteration 38. Level 8, rubric (6 items left); next code: compound. Then render, budget, evidence, injection (102 items), precision, attacks, council, cascade, turns, pairwise, calibration, scale. Handover test (`--brief --fresh`) last run at iteration 25 (reproduced level 3).

## Hypotheses tried

Iteration 11 (cause: outcome with capitals): `recaseOutcome` in packages/judges/src/contract.ts reads "Pass", "FAIL", " Inconclusive " after the strict parse fails, and sets `repaired: true`. Test: packages/judges/test/contract.test.ts "near-JSON: the outcome written with capitals". Bank 258 -> 260, causes 153 -> 152. Nothing rejected.
Iteration 12 (cause: score in quotes): `recaseOutcome` (now also coercing a quoted finite number). Test: "near-JSON: the score written as a number in quotes". Bank 260 -> 262.
Iteration 13 (cause: single quotes): `singleToDoubleQuotes` in the repair loop of `parseAnswerText`, and `extractObject` tracks the opening quote. Test: "near-JSON: an object written with single quotes". Bank 262 -> 264.
Iteration 14 (cause: trailing comma): `dropTrailingComma`. Test: "near-JSON: a comma before a closing brace". Bank 264 -> 266.
Iteration 15 (cause: comment line): `dropCommentLines`. Test: "near-JSON: a line that is only a comment". Bank 266 -> 268 (0.4201). Its source landed in the iteration 14 handover commit by a script slip; the row 15 measurement is of that code. The level stayed 1 for three iterations because level 2 needs all 48 contract items; the bank score rose each time, so the executor kept going (stop rule read as no progress).
Iteration 26 (cause: key not hex): check in `loadCassette`. Test: "loading a cassette with a key that is not a request hash" (red before, green after). Bank 287 -> 289 (0.4530): the answer-breaking-contract item turned green too, so its failing state came from the same validation path (not separately fixed). Level 3 -> 4.
Iteration 27 (cause: content parts): `contentText` in clients/chat.ts. Test: clients.test.ts "an OpenAI answer whose content is a list of parts" (red first). Bank 289 -> 290 (0.4545).
Iteration 28 (cause: content_filter stop): decline branch in clients/chat.ts. Test: "an OpenAI answer stopped by the content filter" (red first). Bank 290 -> 291 (0.4561).
Iteration 29 (cause: blocked prompt): branch in the Google client. Test: "a Google answer whose prompt was blocked" (red first). Bank 291 -> 292 (0.4577).
Iteration 30 (cause: RECITATION): added to the Google decline branch. Test: "a Google answer stopped for recitation" (red first). Bank 292 -> 293 (0.4592).
Iteration 31 (cause: short echoed header): `scrub` threshold in http.ts lowered from 8 to 1. Test: "an error body that echoes a short header value" (red first). Bank 293 -> 294 (0.4608).
Iteration 32 (cause: OpenAI schema): `ANSWER_SCHEMA` and response_format json_schema (strict false) in clients/chat.ts. Test: "the OpenAI client asks for the answer schema" (red first). Bank 294 -> 295 (0.4624).
Iteration 33 (cause: Google schema): `GOOGLE_ANSWER_SCHEMA`. Test: "the Google client gives a response schema" (red first). Bank 295 -> 296 (0.4639). PR 86 stays open and takes every push; a second PR from the same branch is not possible. PR 86 holds iterations 11 to 25.
Iteration 34 (cause: usageFromResponse missing): packages/judges/src/clients/usage.ts, exported. Test: packages/judges/test/usage.test.ts (red first). Bank 296 -> 299 (0.4687). Level 4 -> 6. Iteration 35 (cause: empty verdict list passed): `combineVerdicts` needs at least one verdict. Test: check.test.ts "a block with no verdict at all" (red first). Bank 299 -> 300 (0.4702).
Iteration 36 (cause: duplicate judge ids): `combineVerdicts` refuses two judge verdicts with one id. Test: check.test.ts "two judge verdicts with one id" (red first). Bank 300 -> 301 (0.4718).
Iteration 37 (cause: safe-id collision): `uniqueIds` in judgeCheck (suffix -2, -3). Test: check.test.ts "two criterion names that map to one safe id" (red first). Bank 301 -> 302 (0.4734).
The first commit of iteration 34 lacked the index export; a second commit added it and the row is of that second commit.
Iteration 38 (cause: raw file names in diff summary): `oneLine` in artifacts.ts. Test: task.test.ts "a diff summary with a line break in a file name" (red proved by reverting the source). Bank 302 -> 303 (0.4749). Level 6 -> 7.
Iteration 39 (cause: lintCriterion missing): packages/judges/src/lint.ts, a RULES table with `two-questions`, exported. Test: packages/judges/test/lint.test.ts (red proved by removing the export). Bank 303 -> 304 (0.4765). Add each next code as one row of RULES.
Iteration 40 (cause: no subjective rule): row in RULES. Test: lint.test.ts (red proved by reverting the rule). Bank 304 -> 305 (0.4781). The 15 iterations of the second brief are done (26 to 40). Pitfall: a heredoc turns \u2028 in test text into the raw character; write such escapes with python and a doubled backslash.
Iteration 41 (cause: no vague-quantity rule): row in RULES. Test: lint.test.ts (red proved by reverting the source). Bank 305 -> 306 (0.4796).
Iteration 42 (cause: no double-negative rule): row in RULES counting not, no, never, cannot, without, fail to, n't per sentence. Test: lint.test.ts (red proved by reverting the source). Bank 306 -> 307 (0.4812).
Iteration 43 (cause: no no-observable rule): row in RULES. Test: lint.test.ts (red proved). Bank 307 -> 308 (0.4828).
Iteration 44 (cause: no too-long rule): rubric over 400 characters. Test: lint.test.ts (red proved). Bank 308 -> 309 (0.4843).
Iteration 45 (cause: no no-fail-picture rule): missing or blank FAIL picture. Test: lint.test.ts (red proved). Bank 309 -> 310 (0.4859).
Iteration 46 (cause: no no-pass-picture rule). Test: lint.test.ts (red proved). Bank 310 -> 311 (0.4875).
Iteration 47 (cause: no same-pictures rule). Test: lint.test.ts (red proved). Bank 311 -> 312 (0.4890).
Iteration 48 (cause: no picture-contradicts-rubric rule): one picture is the other with not (do, does, did ignored). Test: lint.test.ts (red proved). Bank 312 -> 313 (0.4906).
Iteration 49 (cause: no scope-mismatch rule, conversation side). Test: lint.test.ts (red proved). Bank 313 -> 314 (0.4922). Block side (rubric/block-scope-whole-conversation) is its own item.
Iteration 50 (cause: no placeholder rule). Test: lint.test.ts (red proved). Bank 314 -> 315 (0.4937).
Iteration 51 (cause: no unbalanced-quotes rule). Test: lint.test.ts (red proved). Bank 315 -> 316 (0.4953).
Iteration 52 (cause: no empty-rubric rule). Test: lint.test.ts (red proved). Bank 316 -> 317 (0.4969).

## Next actions

1. Level 8 rubric: add one code per iteration as a row of RULES in packages/judges/src/lint.ts, in the order of docs/concepts/judges.md ("Rubric lint"), next: compound. The clean twin of every item must still give no issue.
2. Then the first failing level of `validate judges --seeds 1..20 --hidden --items`.
3. Every fix: red test first, one cause, commit, `vitest run packages/judges --maxWorkers=2`, `measure.ts --iteration N` (repo root, `pnpm exec tsx`), `validate judges --journal row.json`. PR 86 takes every push.

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
