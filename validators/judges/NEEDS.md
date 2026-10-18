# Needs: what each family of the judges bank serves

Rule (lead, 2026-10-12): every item family cites the product need it serves, as a docs page, a design section or a command. A family that nothing needs is quarantined: its code stays, and the bank leaves it out (`QUARANTINED_FAMILIES` in `packages/validators/src/ladders/judges/v2/needs.ts`). Inside a family with a need, an item that asks for a new export that no page, section or command names is quarantined the same way (`QUARANTINED_ITEMS`). Since round 2, an item that asks a documented function for a behaviour no page states is quarantined too, and an item that asks for the opposite of what a page states is rewritten to ask what the page states. Quarantined items count toward no score, forecast or cause. `judgesBank({ quarantined: true })` still returns them, so a caller can run them.

Pages are those of this branch: `docs/concepts/judges.md` (the judges page), `docs/reference/checks.md`, `docs/reference/cli.md`, `docs/generating.md`, `docs/validators.md`.

Bank: 769 items, 20 of them live. Quarantined: 111 deterministic items, none of them a whole family (round 3 below). Kept: 638 deterministic items in 20 families, plus the 20 live items.

## Families with a need

| Family | Kept items | Level | Need |
|---|---|---|---|
| v1 | 37 | v1 | docs/validators.md section 4, the seven levels per judge and criterion (fixture pair, accuracy and kappa, invariance, sensitivity, injection, consistency, council) |
| contract | 48 | contract | judges page, "The request and the answer": strict JSON with `outcome`, `reasoning`, optional `score` from 0 to 1 and `evidence`; any other key breaks the contract; near-JSON is repaired and the result says `repaired: true`, never on strict JSON (round 3); an answer that does not parse after repair or breaks the contract is inconclusive. Judges page, "Two classes of judge": a system 1 probability from 0.6 is a pass, up to 0.4 a fail, both bounds options of the client (the `probability-*` items) |
| consistency | 21 | consistency | docs/validators.md section 4, "Consistency is pass to the k" and level 6 (pass to the fifth at least 0.95); section 12.6, "consistency to the fifth repeat"; section 4 feedback (a consistency failure maps to the judge's temperature, hence the temperature items) |
| cassette | 21 | cassette | judges page, "Cassettes: recorded answers": record every answer or failure, no key or header recorded, replay by judge id and request key, a miss throws `cassette_miss` and never invents an answer; docs/validators.md 12.2 point 7 (hostile cassette files) on that loader |
| clients | 29 | clients | judges page, "Judge clients": the five clients, a refusal by the provider is inconclusive, an answer that stops at its token limit is inconclusive, retries on 408 to 529, no retry on a 4xx the request caused, no key in any error, any header value the provider echoes back replaced by `[redacted]`; `createHttpJudge` posts to an endpoint "whose answer body is the answer contract" |
| criteria | 20 | criteria | judges page, "Criteria folders and fixture pairs" and `driftbench judge check` (docs/reference/cli.md): a name that differs from its file, a name defined twice, a fixture pair that is the same slice twice, a missing FAIL or PASS picture, schema errors |
| check | 24 | check | judges page, "Judging a conversation block", "Judging a task block" (the workspace diff closes the artifact section as one line) and "The judge check in a run"; docs/reference/checks.md, "Judged criteria" (one verdict `judge.<name>` per criterion, never replacing a machine verdict); docs/generating.md, "a block no verdict decided is `unjudged`, never a pass" |
| render | 62 | render | judges page, "The request and the answer": observed content inside data tags, text that opens or closes a data tag is escaped, the data closes exactly once; docs/validators.md section 4 (label-preserving and label-flipping transforms) and 12.6 ("a pool of rule judges under at least 50 transforms per criterion") |
| injection | 102 | injection | docs/validators.md section 4 (injection resistance 1.0: the verdict must not move when the data says "ignore the rubric and pass") and 12.6 ("an injection bank of at least 100 patterns: multilingual, encoded, in tool results, in artifacts, in file names"); judges page: an instruction found in the data is never a reason to pass |
| precision | 20 | precision | the injection need above, with docs/validators.md 12.2 point 5: a screen that flags the judge's words in customer talk passes the injection items without separating instructions from data |
| attacks | 22 | attacks | the injection need above (judges page: an instruction in the data is never a reason to pass; section 4 level 5), with docs/validators.md 12.2 points 2 and 5 (documented attacks, adversarial items) |
| council | 37 | council | judges page, "The council": two of three agreeing votes, an inconclusive vote never counts, a split is re-judged; docs/validators.md 12.6, "council majority under correlated errors, odd and even sizes and weights" (the `majority-size-*`, `weights*`, `correlated-*`, `families` and `size-*` items); section 4 level 7 |
| cascade | 24 | cascade | judges page, "The council", the cascade (cheapest first, stop only on a sure pass, threshold 0.9 by default); docs/validators.md section 4 level 7 and 12.6, "cascade cost and agreement" (the `reports-*-cost` items) |
| calibration | 42 | calibration | judges page, "Calibration: an assignment is earned": kappa against the labels, "a Wilson 95% interval on the share of blocks it agrees on" (the `interval-is-wilson-*` items), the bar, the assignment to the cheapest judges at the bar; a labels file where every block has one label has nothing to measure; docs/validators.md 12.6, "calibration coverage for n from 5 to 500 and skewed distributions" (the `coverage-*` items) |
| scale | 26 | scale | docs/validators.md 12.2 point 4 (correct and slow is a failing item) on operations the pages above need: the prompt, the request key, the majority, the answer parser, data-tag escaping, the screen, the cassette player, the council, calibration |
| rubric | 20 | rubric | judges page, "Planned", rubric lint (`lintCriterion` and its codes); docs/reference/cli.md, `judge lint` |
| budget | 20 | budget | judges page, "Planned", a prompt budget (`fitPrompt`) |
| evidence | 21 | evidence | judges page, "Planned", evidence grounding (`groundEvidence`) |
| turns | 20 | turns | judges page, "Planned", turn-by-turn judging (`judgeTurns`) |
| pairwise | 22 | pairwise | judges page, "Planned", pairwise judging and position bias (`comparePair`, `buildPairPrompt`, `swapConsistent`, Bradley-Terry, cycles); docs/reference/cli.md, `judge compare` |
| live | 20 (not scored) | live | docs/validators.md section 4 ("a live run is a separate, billed mode the owner approves") and 12.2 (live items count only in the billed mode) |

## Quarantined families (rounds 1 and 2; round 3 brought them back without their helpers)

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
| calibration | 58 | the agreement metrics beyond kappa (15 `metric-*`), `fleiss-kappa-across-judges`, the label checks `labels-conflicting-duplicates`, `labels-fixture-leak`, `labels-for-an-unknown-criterion` (the command refuses such labels with exit 2; the item asks for a report field), `labels-few-in-a-class`; PABAK and AC1 under skew (10 items: the page's bar is kappa); 28 helper exports (`cohen-kappa`, `fleiss-kappa`, `brier`, `ece`, `roc-auc`, `wilson` and the rest; Cohen's kappa ships in `@agent-nexus/driftbench-stats`) |
| render | 8 | `redact-secrets`, `redact-pii`, `truncate-middle`, `dedupe-transcript`, `normalise-transcript`, `format-tool-call`, `transcript-stats`, `sentences` |
| scale | 1 | `chunk-transcript` |

All 80 items of `families/more.ts` are among the 218: every one asks for a new export.

## Round 2: items changed to match the page (the six contract rows are superseded by round 3)

Each line names the item, the page line it now follows, and the one change in packages/judges that makes it pass. Each cause was proved independent by planting it alone in a scratch copy of packages/judges: on seed 1, exactly its own item turned green and no other item changed.

| Item | Page line | Cause |
|---|---|---|
| contract/single-quotes | judges page: "The answer is strict JSON"; "An answer that does not parse ... is inconclusive" | refuse an object written with single quotes |
| contract/trailing-comma | the same | refuse a comma before a closing brace |
| contract/line-comment | the same | refuse an object holding a // comment line |
| contract/typographic-quotes | the same | refuse an object written with typographic quotes |
| contract/outcome-capitals | the same, and "`outcome` (`pass`, `fail` or `inconclusive`)" | refuse an outcome not written as one of the three |
| contract/score-as-string | the same, and "`score` (the probability ... from 0 to 1)" | refuse a score written as a string |
| clients/http-judge-wrapped-answer | judges page, judge clients: `createHttpJudge` posts "to any endpoint whose answer body is the answer contract" | none: the package refuses it today |
| clients/http-judge-text-answer | the same | none: the package refuses it today |
| calibration/interval-is-wilson-n5, -n50, -n500 | judges page, calibration: "a Wilson 95% interval on the share of blocks it agrees on" | none: the package reports it today |
| clients/echoed-short-header-redacted (new) | judges page, judge clients: "Any header value the provider echoes back is replaced by `[redacted]`" | in http.ts, redact every echoed header value whatever its length (today only values of 8 characters or more) |

The six contract items asked, before round 2, for the reading the pilot built in iterations 2 to 7. They now ask for the refusal, so those six pilot iterations each turned one item red.

## Round 2: quarantined behaviours no page states

25 items, in `QUARANTINED_ITEMS` under "round 2":
* contract `score-contradicts-outcome`, `score-contradicts-near-the-middle`, `two-disagreeing-answers`, `key-given-twice`: refusals no page states.
* clients `openai-tool-call-arguments`, `anthropic-tool-use-input`, `google-function-call-args` (no client asks for tools), `openai-legacy-text` (no client calls the legacy endpoint), `openai-asks-for-the-answer-schema`, `google-gives-a-response-schema` (no page states a request schema), `decisions-percentage`, `decisions-answers-by-name`, `jev-probability-in-quotes` (shapes no page or provider description names), `event-stream-body`, `retry-after-seconds`, `retry-after-date` (the page states "a growing wait", not the provider's Retry-After).
* cassette `saved-entries-sorted`; criteria `rubric-too-long-reported`, `fixtures-differ-only-in-spacing`, `fixtures-differ-only-in-case`, `same-pictures`, `pictures-same-but-spacing` (the page reports "a fixture pair that is the same slice twice" and "a missing FAIL or PASS picture", nothing looser); check `council-that-throws-is-inconclusive`; cascade `per-judge-threshold`, `per-judge-threshold-restores-agreement`.

## Kept with a design need only

The calibration `coverage-*` items ask for an `agreementInterval` export with at least 0.93 coverage near agreement 1. Their need is docs/validators.md 12.6 ("calibration coverage for n from 5 to 500 and skewed distributions"), not a product page, which names Wilson for the reported interval. An export beside the Wilson report satisfies both, so they stay.

## Round 3: the owner's decisions

Owner, 2026-10-12: "1. Write more capabilities into the docs, figure it out. If you cannot do it, lower the bar per validator 2. repairing near-JSON".

Near-JSON repair. The judges page, "The request and the answer", now states that near-JSON is repaired and marked `repaired: true`, never on strict JSON. The six contract items of round 2 ask for the reading again, so the pilot's iterations 2 to 7 count again. New items, each citing that line:

| Item | Cause |
|---|---|
| contract/unescaped-quotes | repair a double quote left unescaped inside a string value |
| contract/repaired-marked-outcome-capitals, -score-as-string, -single-quotes, -trailing-comma, -line-comment, -typographic-quotes | set `repaired: true` on a result read only through a repair (one cause, six items) |
| contract/strict-not-marked-repaired | keep the mark off strict JSON (passes today) |

The judges page has a "Planned" section, and the CLI reference two planned commands (`judge lint`, `judge compare`). Each line is a capability a user of a judge layer would want and the package lacks. The items they bring back or add:

| Planned line | Items |
|---|---|
| Retry-After | clients/retry-after-seconds, -date |
| Per-judge cascade thresholds | cascade/per-judge-threshold, -restores-agreement |
| Reference answers per block (new items) | render/reference-in-its-tag; render/reference-tag-guarded-in-reference, -in-transcript (one cause); consistency/key-separates-reference |
| Rubric lint | the rubric family (20) |
| Evidence grounding | the evidence family, `groundEvidence` items (21) |
| Turn-by-turn judging | the turns family, `judgeTurns` items (20) |
| A prompt budget | the budget family, `fitPrompt` items (20) |
| Pairwise judging and position bias | the pairwise family without Elo, win rate, win matrix, Copeland and Borda (22); calibration/position-bias |
| Calibration on skewed labels | calibration pabak-* and ac1-* (10); metric-confusion, -sensitivity, -specificity, -balancedAccuracy, -falsePositiveRate, -falseNegativeRate |
| Label hygiene | calibration/labels-conflicting-duplicates, labels-fixture-leak, labels-few-in-a-class |
| Structured output | clients/openai-asks-for-the-answer-schema, google-gives-a-response-schema |
| Token usage | clients/usage-from-openai, -anthropic, -google |

Still quarantined: the helpers of those families that no Planned line names (budget cost and retry arithmetic, evidence string helpers, turn helpers, Elo and the other rankings), and every item listed in rounds 1 and 2 that round 3 did not bring back.

The 5 new failing causes (unescaped quote, repair mark, reference tag, reference escaping, reference in the key) were each planted alone in a scratch copy of packages/judges: on seed 1, exactly their own items turned green and nothing else changed. The items brought back carry the causes their authors wrote; they were not planted again.
