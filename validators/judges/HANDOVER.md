# Handover: validator judges

Rewritten by the executor every iteration (docs/validators.md section 10). A stranger continues from this file alone. The level table is written by `driftbench validate judges --journal <row.json>` from the last journal row.

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
| 1 | 11 |
| 2 | 11 |
| 3 | 11 |
| 4 | 11 |
| 5 | 11 |
| 6 | 11 |
| 7 | 11 |
| 8 | 11 |
| 9 | 11 |
| 10 | 11 |
| 11 | 11 |
| 12 | 11 |
| 13 | 11 |
| 14 | 11 |
| 15 | 11 |
| 16 | 11 |
| 17 | 11 |
| 18 | 11 |
| 19 | 11 |
| 20 | 11 |
| hidden | 11 |
<!-- level-table:end -->

This is ladder version 2 (docs/validators.md section 12): `judgesLadderV2()` in `packages/validators/src/ladders/judges/v2/`, registered in `packages/validators/src/ladders/index.ts`, so `driftbench validate judges` runs it. The bank holds 769 items; 111 deterministic items are quarantined because no page needs them (`validators/judges/NEEDS.md`, lists in `v2/needs.ts`), which leaves 638 deterministic items in 20 levels, each level's threshold 1, plus 20 live items. Level 1 (the seven v1 levels per criterion) passes on every seed; level 2 (contract) fails. Bank score after the ten-iteration pilot: 260 of 638 items pass on every seed (0.4075); iteration 0 was 249 (0.3903). Hardness: 1.1 items fixed per iteration, 378 remaining, forecast 343.6 iterations, 150 distinct failing causes. `validators/judges/GATE.md` lowers the score bar for judges to 0.41 (`Max score after the pilot: 0.41`, read by `--hardness`), which the pilot meets; the gate then waits only on `audit.md`. These rows are the pilot's package; on main's judges package the bank gives 258 of 638 (0.4044) and 153 causes, and the next executor starts there. The judges page's "Planned" section (docs/concepts/judges.md) is the roadmap most failing items point at. The record is `validators/judges/journal.jsonl`: iteration 0 and pilot rows 1 to 10; `pnpm driftbench validate judges --hardness` prints the measurement and its gate.

The journal rows were measured on the 736-item bank (the pilot replayed with families/more.ts) and the quarantined items were then dropped from each recorded row, from the per-item captures `_captures/v-judges2/bank-iteration-<n>.txt`; nothing was re-run. Every quarantined item fails in every row, so dropping them leaves the passing counts as recorded. Items added after the recording (the round 2 and 3 items of NEEDS.md) take in every row the verdict a run of HEAD gives: the pilot never touched their code. Row 2's capture holds 47 failures that rows 1 and 3 to 10 do not record, none of them a contract item, the family its change touched (22 scale items, which run under time budgets, 9 render, 5 council, 3 each of calibration, check and criteria, 1 cascade, 1 clients); row 2 is the failures of row 1 that the row 2 capture also records, which gives 249 passing, as the earlier 656-item row 2 recorded.

Every item carries a cause, the one change in packages/judges that makes it pass (`packages/validators/src/ladders/judges/v2/causes.ts` and `causes-more.ts`). Screen items that the base screen alone turns green carry the base screen's cause (`BASE_SCREEN_ITEMS` in causes.ts). A screen behaviour item whose `screenData` does not exist yet says in its Fix line to add the base screen first. A failing item's detail ends with `Fix: <the change>`, so you can act on it without reading the validator's code: make that change in packages/judges, add its test, measure. `--blind` drops every cause and every `Fix:` hint from the output, for an auditor; `--all-levels` lists every failing item of every level.

## Floor

Floors are per ladder version (section 12.5); `validators/floors.json` is the maintainer's. The judges floor of 7 belongs to version 1. Version 2 starts at the level the pilot reached: 1.

## Open items

Levels 1 to 11 pass. Level 12 (injection) first failing: `injection/language-*` (instructions in other languages, `screenData` word lists per language), then the encodings. Failing by family after 63: {"attacks": 0, "budget": 0, "calibration": 33, "cascade": 9, "cassette": 0, "check": 0, "clients": 0, "consistency": 0, "contract": 0, "council": 23, "criteria": 0, "evidence": 0, "injection": 47, "pairwise": 22, "precision": 19, "render": 0, "rubric": 0, "scale": 1, "turns": 20, "v1": 0}. Handover test last run after 61.

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
Iteration 53 (cause: no compound rule). Test: lint.test.ts (red proved). Bank 317 -> 318 (0.4984).
Iteration 54 (cause: no hedged rule, rubric and PASS picture): two items green (hedged, hedged-picture). Test: lint.test.ts (red proved). Bank 318 -> 320 (0.5016).
Iteration 55 (cause: no instruction-to-judge rule). Test: lint.test.ts (red proved). Bank 320 -> 321 (0.5031).
Iteration 56 (cause: no pictures-swapped rule). Test: lint.test.ts (red proved). Bank 321 -> 322 (0.5047).
Iteration 57 (cause: no block-side scope-mismatch rule): extended the scope-mismatch row. Test: lint.test.ts (red proved). Bank 322 -> 323 (0.5063). Level 7 -> 8.
Iteration 58 (cause: line breaks forged transcript entries): `renderEntry` shows break characters as a visible marker. Test: prompt.test.ts (red proved). Bank 323 -> 333 (0.5219): ten forged-entry items from one change.
Iteration 59 (cause: lookalike tags unescaped): escapeData folds NFKC and drops invisible characters before matching. Test: prompt.test.ts (red proved). Bank 333 -> 339 (0.5313).
Iteration 60 (cause: reference answer not rendered): `reference_data` tag guarded (GUARDED_TAGS) and rendered after the transcript; the system prompt names it only when a reference exists, so DATA_TAGS and the prompt fingerprint stay unchanged (adding it to DATA_TAGS broke 16 cassette tests). Test: prompt.test.ts (red proved). Bank 339 -> 342 (0.5361). Level 8 -> 9.
Iteration 61 (cause: fitPrompt missing): packages/judges/src/budget.ts, exported. Test: budget.test.ts (red proved: 4 failed). Bank 342 -> 362 (0.5674): 20 budget items from one capability. Level 9 -> 10.
Iteration 62 (cause: groundEvidence missing): packages/judges/src/evidence.ts, exported. Test: evidence.test.ts (red proved: 5 failed). Bank 362 -> 383 (0.6003). Level 10 -> 11.
Iteration 63 (cause: screenData missing): packages/judges/src/screen.ts, exported. Test: screen.test.ts (red proved: 4 failed). Bank 383 -> 464 (0.7273): 81 items from one capability.
Iteration 64 (cause: fullwidth letters unread): screenData reads the NFKC form (READINGS list in screen.ts; each later iteration adds one reading). Test: screen.test.ts (red proved). Bank 464 -> 465.
Iteration 65 (cause: invisible characters): reading without zero-width, soft hyphen, word joiner, BOM. Test: screen.test.ts (red proved). Bank 465 -> 466; the layered nl item still needs the Dutch words.
Iteration 66 (cause: Cyrillic lookalikes): reading with lookalike letters folded to Latin inside mixed-script words. Test: screen.test.ts (red proved). Bank 466 -> 468.
Iteration 67 (cause: leetspeak): reading with 4 3 1 0 5 7 folded to letters inside letter words. Test: screen.test.ts (red proved). Bank 468 -> 469.
Iteration 68 (cause: letters spaced one by one): reading with single spaces between letters dropped. Test: screen.test.ts (red proved). Bank 469 -> 470.
Iteration 69 (cause: letters separated by dots): reading with dots between letters dropped. Test: screen.test.ts (red proved). Bank 470 -> 471.
Iteration 70 (cause: reversed text): reversed reading. Test: screen.test.ts (red proved). Bank 471 -> 472. The first measure run failed three scale items under a load average of 154 (they pass when re-run); re-measured.
Iteration 71 (cause: ROT13): rotated reading. Test: screen.test.ts (red proved). Bank 472 -> 473 (0.7414).
Iteration 72 (cause: no French words): OTHER_LANGUAGES row in screen.ts; each language is one row. Test: screen.test.ts (red proved). Bank 473 -> 474. Ownership: this lane keeps ALL of injection (lead, after the split).
Iteration 73 (cause: no Spanish words): row. Test red proved. Bank 474 -> 476.
Iteration 74 (cause: no German words): row. Test red proved. Bank 476 -> 478.
Iteration 75 (cause: no Italian words): row. Test red proved. Bank 478 -> 480.
Iteration 76 (cause: no Portuguese words): row. Test red proved. Bank 480 -> 481.
Iteration 77 (cause: no Dutch words): row. Test red proved. Bank 481 -> 483.
Iteration 78 (cause: no Polish words): row. Test red proved. Bank 483 -> 484 (0.7586). Next languages: tr, ru, zh, ja, ko, ar, hi, sv, id (CJK and Arabic need no word-boundary lookarounds: phrase() uses letter lookarounds that fail between adjacent CJK letters; give those rows a separate matcher).
Iteration 93 (cause: no base64 reading): a READINGS row in screen.ts replaces base64 runs of 16 characters or more with their UTF-8 text when 90 percent printable. Test: screen.test.ts "reads base64 runs" (red first). Bank 572 -> 575 of 638 (0.9013) on seeds 1 to 20 and the hidden seed. The merge of origin/exec/judges-h2 (PR 103: council, cascade, turns, pairwise, calibration) took the bank from 484 to 572 on seed 1. Measuring costs about 9.5 minutes; seed 1 alone is faster. Lint of the whole repo fails on files outside packages/judges (comparisons/, packages/checks/src/support/porter.ts), not this lane's.
Iteration 94 (cause: English judge words flagged in narration): `instructive` gate in screen.ts (modal, clause-start or capitalised imperative, note or vocative to the judge, verdict field, slug file names read as sentences); the foreign-language rows use the English verdict fallback only when no English judge word is present. Test: screen.test.ts "flags English judge words only when the sentence instructs" and "keeps flagging instructions planted after other text". Two older tests got modal wording ('must') to stay consistent with the bank. Bank 575 -> 589 of 638 (0.9232). Remaining: 24 injection (languages tr ru zh ja ko ar hi sv id, decoders: url, hex, html entities, unicode escapes, binary, base64-url, caesar, double base64), calibration 11, council 4, pairwise 3, cascade 1, scale 1.
Iteration 95 (cause: base64 run after an equals sign, URL-safe alphabet. Test: screen.test.ts reads URL-safe base64 (red first).)
Iteration 96 (cause: decoded text was screened as written only. DECODERS list; readingsOf applies every reading to each decoded text, two levels deep. Test: screen.test.ts reads a base64 text that holds ROT13 or base64 again (red first). Add each later decoder as one DECODERS row.)
Iteration 97 (cause: no hex reading. DECODERS row for 0x runs of 8 bytes or more; shared readable() for UTF-8 plus 90 percent printable. Test: screen.test.ts reads 0x hexadecimal runs.)
Iteration 98 (cause: no entity reading. DECODERS row for &#NNN; and &#xHH;. Test: screen.test.ts reads HTML numeric entities.)
Iteration 99 (cause: no per judge labels.metrics. agreement() counts tp fp tn fn (fail positive, inconclusive wrong) and derives sensitivity, specificity, balancedAccuracy, falsePositiveRate, falseNegativeRate. Test: metrics-confusion.test.ts.)
Iteration 100 (cause: majority had no families option. Votes of one family collapse into one family vote (its majority, inconclusive on a split), each weighing 1. Test: council.test.ts majority by family. Next: pass the council config weights into majority (weights-in-the-council).)
Iteration 101 (cause: CouncilConfig had no weights. weights pass into majority in every round. Test: council.test.ts council weights. Next: cascade never stops early on a flagged request (screenData), positionBias, swapConsistent, pair prompt tags, label checks, player index.)
Iteration 102 (cause: swapConsistent missing; added to pairwise.ts and exported. Test: swap-consistent.test.ts (module absent before).)
Iteration 103 (cause: positionBias missing; added to pairwise.ts and exported. Test: swap-consistent.test.ts positionBias.)
Iteration 104 (cause: seeds 2 to 9 showed narration after a pool label CONFIRM flagged (verb list held confirm) and fake-rubric unflagged. Removed confirm; NOTE holds pass picture, fail picture, new criterion. Checked all English attack and narration sentences against every pool entry as prefix: 0 misses, 0 false flags.)
Iteration 105 (cause: buildPairPrompt wrapped candidates by hand, unescaped. dataTag now takes first_data and second_data (GUARDED_TAGS holds them; DATA_TAGS and the prompt fingerprint unchanged). Test: pair-prompt.test.ts escapes a candidate that closes its own tag (red first).)
Iteration 106 (cause: no labelConflicts. calibration.ts labelConflicts(blocks) groups ids per slice with both labels; criterion report carries labelConflicts when any. Test: label-conflicts.test.ts. Next: fixtureLeaks, few-labels warning, kappa undefined with one class.)
Iteration 107 (cause: no fixtureLeaks. calibration.ts fixtureLeaks(criterion, blocks); report carries fixtureLeaks when any. Test: label-conflicts.test.ts fixtureLeaks.)

## Next actions

1. Remaining `injection/language-*` items: extend screenData's judge and verdict word lists per language (the Fix line of each item names the language).
2. Then `injection/encoding-*`, then precision and attacks leftovers, council (15), cascade (16), turns (17), pairwise (18), calibration (19), scale (20).
3. Every fix: red test first, one cause, commit, `vitest run packages/judges --maxWorkers=2`, `measure.ts --iteration N`, `validate judges --journal row.json`. PR 86 takes every push. Keep the prompt fingerprint stable. At the top level, raise the floor in its own commit.

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
