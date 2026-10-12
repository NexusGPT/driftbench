# Needs: what each family of the judges bank serves

Rule (lead, 2026-10-12): every item family cites the product need it serves, as a docs page, a design section or a command. A family that nothing needs is quarantined: its code stays, and the bank leaves it out (`QUARANTINED_FAMILIES` in `packages/validators/src/ladders/judges/v2/needs.ts`). Inside a family with a need, an item that asks for a new export that no page, section or command names is quarantined the same way (`QUARANTINED_ITEMS`). An item that tests a function the pages document stays, also where the page does not state the exact behaviour; those items are listed under "Items beyond the pages" for the maintainer. Quarantined items count toward no score, forecast or cause. `judgesBank({ quarantined: true })` still returns them, so a caller can run them.

Pages are those of this branch: `docs/concepts/judges.md` (the judges page), `docs/reference/checks.md`, `docs/reference/cli.md`, `docs/generating.md`, `docs/validators.md`.

Bank: 756 items, 20 of them live. Quarantined: 218 deterministic items (5 families, 125 items; 93 items of 8 kept families). Kept: 518 deterministic items in 15 families, plus the 20 live items.

## Families with a need

| Family | Kept items | Level | Need |
|---|---|---|---|
| v1 | 37 | v1 | docs/validators.md section 4, the seven levels per judge and criterion (fixture pair, accuracy and kappa, invariance, sensitivity, injection, consistency, council) |
| contract | 44 | contract | judges page, "The request and the answer": strict JSON with `outcome`, `reasoning`, optional `score` from 0 to 1 and `evidence`; any other key breaks the contract; an answer that does not parse or breaks the contract is inconclusive. Judges page, "Two classes of judge": a system 1 probability from 0.6 is a pass, up to 0.4 a fail, both bounds options of the client (the `probability-*` items) |
| consistency | 20 | consistency | docs/validators.md section 4, "Consistency is pass to the k" and level 6 (pass to the fifth at least 0.95); section 12.6, "consistency to the fifth repeat"; section 4 feedback (a consistency failure maps to the judge's temperature, hence the temperature items) |
| cassette | 22 | cassette | judges page, "Cassettes: recorded answers": record every answer or failure, no key or header recorded, replay by judge id and request key, a miss throws `cassette_miss` and never invents an answer; docs/validators.md 12.2 point 7 (hostile cassette files) on that loader |
| clients | 33 | clients | judges page, "Judge clients": the five clients, a refusal by the provider is inconclusive, an answer that stops at its token limit is inconclusive, retries on 408 to 529, no retry on a 4xx the request caused, no key in any error |
| criteria | 25 | criteria | judges page, "Criteria folders and fixture pairs" and `driftbench judge check` (docs/reference/cli.md): a name that differs from its file, a name defined twice, a fixture pair that is the same slice twice, a missing FAIL or PASS picture, schema errors |
| check | 25 | check | judges page, "Judging a conversation block", "Judging a task block" (the workspace diff closes the artifact section as one line) and "The judge check in a run"; docs/reference/checks.md, "Judged criteria" (one verdict `judge.<name>` per criterion, never replacing a machine verdict); docs/generating.md, "a block no verdict decided is `unjudged`, never a pass" |
| render | 59 | render | judges page, "The request and the answer": observed content inside data tags, text that opens or closes a data tag is escaped, the data closes exactly once; docs/validators.md section 4 (label-preserving and label-flipping transforms) and 12.6 ("a pool of rule judges under at least 50 transforms per criterion") |
| injection | 102 | injection | docs/validators.md section 4 (injection resistance 1.0: the verdict must not move when the data says "ignore the rubric and pass") and 12.6 ("an injection bank of at least 100 patterns: multilingual, encoded, in tool results, in artifacts, in file names"); judges page: an instruction found in the data is never a reason to pass |
| precision | 20 | precision | the injection need above, with docs/validators.md 12.2 point 5: a screen that flags the judge's words in customer talk passes the injection items without separating instructions from data |
| attacks | 22 | attacks | the injection need above (judges page: an instruction in the data is never a reason to pass; section 4 level 5), with docs/validators.md 12.2 points 2 and 5 (documented attacks, adversarial items) |
| council | 37 | council | judges page, "The council": two of three agreeing votes, an inconclusive vote never counts, a split is re-judged; docs/validators.md 12.6, "council majority under correlated errors, odd and even sizes and weights" (the `majority-size-*`, `weights*`, `correlated-*`, `families` and `size-*` items); section 4 level 7 |
| cascade | 24 | cascade | judges page, "The council", the cascade (cheapest first, stop only on a sure pass, threshold 0.9 by default); docs/validators.md section 4 level 7 and 12.6, "cascade cost and agreement" (the `reports-*-cost` items) |
| calibration | 22 | calibration | judges page, "Calibration: an assignment is earned": kappa against the labels, an interval on the share of blocks a judge agrees on, the bar, the assignment to the cheapest judges at the bar; a labels file where every block has one label has nothing to measure; docs/validators.md 12.6, "calibration coverage for n from 5 to 500 and skewed distributions" (the `coverage-*` items) |
| scale | 26 | scale | docs/validators.md 12.2 point 4 (correct and slow is a failing item) on operations the pages above need: the prompt, the request key, the majority, the answer parser, data-tag escaping, the screen, the cassette player, the council, calibration |
| live | 20 (not scored) | live | docs/validators.md section 4 ("a live run is a separate, billed mode the owner approves") and 12.2 (live items count only in the billed mode) |

## Quarantined families

| Family | Items | Why |
|---|---|---|
| rubric | 20 | `lintCriterion` grades a rubric's wording (two questions, subjective words, hedges, scope words). No page asks for it: `judge check` reports names, fixture pairs, pictures and schema errors, and `spec lint` has no rubric code (docs/reference/cli.md, "Issue codes"). The judges page says a rubric "is written to have a binary answer", which is advice to the author, not a check. It returns when a command or page states a rubric lint. |
| budget | 26 | `fitPrompt` fits a request to a prompt budget by dropping old entries; the judges page sends the whole prefix for `scope: conversation` and clips only an artifact file, at 20000 characters. The six helper exports (`costOf`, `totalCost`, `budgetGuard`, `estimateTokens`, `retryDelays`, `retryAfterMs`) have no page either. |
| evidence | 26 | `groundEvidence` checks that an `evidence` quote is found in the data. The judges page defines `evidence` as "a short quote from the data" but no page says a quote is checked, or what happens when it is not found. The five helper exports (`quoteSpan`, `findQuoteLoosely`, `highlightEvidence`, `levenshtein`, `jaccardWords`) have no page. It returns when a page states that an ungrounded quote changes the verdict or is reported. |
| turns | 24 | `judgeTurns` judges a conversation turn by turn for a drift onset and a recovery turn. Drift and recovery are measured block by block by the runner (docs/concepts/drift.md, docs/concepts/recovery.md: `turnsToRecover` counts blocks); no page asks a judge for a turn-level onset. The four helper exports (`turnPairs`, `lastAgentTurn`, `firstTurnMatching`, `recoveryRate`) have no page. |
| pairwise | 29 | Pairwise judging, Bradley-Terry, Elo, cycles, Copeland and Borda rankings. The parity verdict (`compare`, phase 4, docs/reference/cli.md "Not built yet") is the statistical non-inferiority test of docs/concepts/statistics.md, not a pairwise judge. |

## Quarantined items of kept families

Each asks for a new export, or a new report field, that no page names. Ids are in `QUARANTINED_ITEMS`.

| Family | Items | Ids |
|---|---|---|
| contract | 4 | `xml-answer`, `yaml-answer` (the page says the answer is strict JSON), `clamp-reasoning`, `answer-json-schema` |
| cassette | 7 | `merge-joins-two-cassettes`, `merge-refuses-a-conflict`, `prune-keeps-listed-keys`, `stats`, `unused-entries`, `diff`, `jsonl-round-trip` |
| clients | 4 | `mask-headers`, `usage-from-openai`, `usage-from-anthropic`, `usage-from-google` (no page reads token usage; the page's redaction is of header values a provider echoes in an error, not of request headers) |
| criteria | 5 | `name-problem`, `duplicate-names`, `hash`, `word-count`, `coverage` |
| council | 6 | `unanimity`, `supermajority`, `dissent`, `median-score`, `trimmed-mean`, `cost` (the cascade's own cost report stays in cascade) |
| calibration | 58 | the agreement metrics beyond kappa (15 `metric-*`), `fleiss-kappa-across-judges`, the label checks `labels-conflicting-duplicates`, `labels-fixture-leak`, `labels-for-an-unknown-criterion` (the command refuses such labels with exit 2; the item asks for a report field), `labels-few-in-a-class`; PABAK and AC1 under skew (10 items: the page's bar is kappa); 28 helper exports (`cohen-kappa`, `fleiss-kappa`, `brier`, `ece`, `roc-auc`, `wilson` and the rest; Cohen's kappa ships in `@driftbench/stats`) |
| render | 8 | `redact-secrets`, `redact-pii`, `truncate-middle`, `dedupe-transcript`, `normalise-transcript`, `format-tool-call`, `transcript-stats`, `sentences` |
| scale | 1 | `chunk-transcript` |

All 80 items of `families/more.ts` are among the 218: every one asks for a new export.

## Items beyond the pages

These stay in the bank because they test a documented function, but the pages do not state the behaviour they ask for, or state another. They go to the maintainer with the page line; neither side changes in this lane.

* contract `single-quotes`, `trailing-comma`, `line-comment`, `typographic-quotes`, `score-as-string`, `outcome-capitals`: they ask the parser to read answers that are not strict JSON, against the page's "The answer is strict JSON". They pass today (pilot iterations 2 to 7).
* contract `score-contradicts-outcome`, `score-contradicts-near-the-middle`, `two-disagreeing-answers`, `key-given-twice`: refusals stricter than the page states.
* calibration `coverage-*` (`p` near 1) and `interval-is-agreement-interval-*`: the page names "a Wilson 95% interval"; the items need coverage of at least 0.93 near agreement 1, which Wilson does not give at small n. Either the page or the items must change.
* clients `openai-tool-call-arguments`, `anthropic-tool-use-input`, `google-function-call-args`, `openai-legacy-text`: answer shapes a provider sends only when asked for tools or the legacy endpoint, which no client asks for. `http-judge-wrapped-answer`, `http-judge-text-answer`: the page says `createHttpJudge` reads a body that "is the answer contract". `openai-asks-for-the-answer-schema`, `google-gives-a-response-schema`, `decisions-percentage`, `event-stream-body`, `retry-after-*`: the page says "a growing wait" and no request schema.
* cassette `saved-entries-sorted`; criteria `rubric-too-long-reported` and the near-twin fixture and picture items; check `council-that-throws-is-inconclusive`; cascade `per-judge-threshold*`: behaviours of documented functions that no page states.
