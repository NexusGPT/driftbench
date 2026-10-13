# Planted-truth diagnosis: denominator error and RubricBench requirement drift

## Verify correction

The 06:16 Brussels report counted 45 rejected defects over 95 planned defects while the final 50 judgments were pending. It marked those 50 pairs incomplete. The runner judges all clean twins before defective twins; missing outputs therefore looked like missed defects. Saved final decisions reject 95/95 defects and accept 95/95 clean twins. There are no observed verify misses to explain. Fix reporting by separating pending, invalid, false accept, and rejected outcomes, and show both completion and evaluated-only detection rates. The 52.63-point change is completed evidence, not a judge improvement.

## RubricBench result and top fix

All 17 invalid single-requirement outputs import requirements from the question into the rubric ledger. They introduce 22 extra rows. These are invented scoring rows, although their content comes from real question instructions. None is an unrelated preference. Every extra row awards both candidates 2/2, so the additions do not change the recorded clean winner. All 60 pairs choose the clean candidate.

**Top fix: bind checks to a caller-owned requirement list, with stable IDs, and validate against that exact list.** The current benchmark prompt sends an unnumbered rubric string and lets the model assign sequential IDs. Its parser accepts any number of sequential rows. The experiment wrapper then discards both single-requirement grades unless the array has exactly one row.

- Adopt the production criterion-ledger policy: ignore unknown IDs into diagnostics, require each requested ID exactly once, and compute the verdict from known rows.
- Supply the exact requirement definition with its ID. Keep question context outside the scored requirement list. A model-created integer position is not a stable requirement identity.
- Re-ask once when the required ledger is missing, duplicated, malformed, or fails grounding. If unresolved, preserve inconclusive. This is an existing production behavior, not an observed repair of this bank.
- Keep the frozen baseline unchanged. A changed request contract needs fresh recordings; this investigation makes no model calls.

**Recording-supported gain:** human identification of the intended row recovers correct grades in 16/17 affected pairs, changing strict defect detection from 43/60 (71.67%) to 59/60 (98.33%), a 26.67-point opportunity. This is an offline diagnostic upper target for a scope fix, not measured performance of a new prompt. All clean grades become 60/60. Re-ask success is unmeasured.

Blindly keeping `id=1` recovers only 14 affected defect grades: 57/60 (95.00%). In `rb-bank-025` and `rb-bank-046`, the actual rubric is row 2. In `rb-bank-036`, the actual rubric is row 1 but its numeric score contradicts its evidence. Do not silently turn that evidence into a replacement grade.

## Causes, with counts

| Cause | Pairs | Consequence | Existing mechanism and limit |
|---|---:|---|---|
| Extra question checks appended; requested rubric remains row 1 with correct scores | 14 | Strict wrapper rejects useful grades because the ledger is too long | Caller-owned requirement IDs plus unknown-ID diagnostics can retain only the scored rubric. Legacy positions need verified semantic mapping first. |
| Question check prepended; requested rubric displaced to row 2 | 2 | Keeping row 1 would accept the defect | Scope-bound requirement contract; re-ask an invalid or mismatched contract. Unknown-ID filtering alone cannot repair an old misassigned ID. |
| Extra question check plus numeric score contradicting the correct reasoning | 1 | `rb-bank-036` scores defective A as 2, despite saying 0 | An exact no-comma machine check settles this case. A new consistency gate could request repair. The existing ledger schema does not detect score/prose disagreement. |

| Supplied single requirement | Affected pairs | Invented scoring rows | Extra row count |
|---|---:|---|---:|
| All words in capitals | 2 | One fictional chant about the named subject | 2 |
| No capital letters | 4 | One fictional sentence about the named subject | 4 |
| No commas | 4 | One fictional sentence about the named subject | 4 |
| Exactly four numbers | 5 | Fictional inventory; use the word glimmer | 10 |
| Second paragraph starts with it | 2 | Exactly two fictional paragraphs about the named subject | 2 |
| Total | 17 | All imported from question context | 22 |

The recorded text directly supports scope confusion. For example, the judge explicitly labels an added check "Question requirement" in `rb-bank-015` and `rb-bank-054`. The prompt's instruction to choose weights "from the question and rubric" is a plausible contributor, not an isolated causal finding. No prompt ablation was run.

## Which safeguards apply

- **Requirement ledger validation** addresses the 22 additional scoring rows. The production `parseCriterionLedger` already ignores unknown IDs, rejects missing or duplicate requested IDs, validates evidence, and computes outcomes. Its string-ID, `met` contract differs from this benchmark's numeric-ID, `a`/`b` score contract; this is a design to adapt, not a drop-in parser swap.
- **Evidence quote grounding** verifies that quoted text exists. It does not decide whether a genuine question instruction belongs in the authoritative rubric. It also does not repair a wrong numeric grade. These recordings use free-form contrasting prose in `evidence`, not the production literal-quote contract. In `rb-bank-048`, even the quoted paragraph excerpts change the final period to a comma, so wholesale reuse as grounded quotes is unsafe.
- **Machine checks** can directly enforce these literal constraints: character case, comma absence, numeric count under a stated tokenization rule, and the second paragraph's first word. For `rb-bank-036`, the defective text contains a comma and the clean text does not. The existing bank construction audit already verifies that distinction; promoting an independent check into grading is a new scored method. Do not use planted labels as judge evidence.
- **One re-ask** is available in `singleJudgeCheck` for an invalid criterion ledger. The frozen RubricBench path calls its judge once and has no equivalent repair loop. No recording shows what a repair call would return. A schema-valid but semantically wrong grade needs a separate contradiction or machine-check trigger.

## Every affected item

Scores below map canonical A/B back to clean/defect using the saved `reversed` flag, independently checked against the candidate hashes. Each added-row quote is the judge's exact `evidence` text. "Invented" means outside the supplied single rubric, not absent from the question. Every listed added row scores both candidates 2/2.

| Item | Supplied rubric | True rubric row | Clean / defect score | Invented row IDs | Cause |
|---|---|---:|---|---|---|
| `rb-bank-006` | No commas | 1 | 2 / 0 | 2 | question constraints appended |
| `rb-bank-007` | Exactly four numbers | 1 | 2 / 0 | 2, 3 | question constraints appended |
| `rb-bank-014` | All capitals | 1 | 2 / 0 | 2 | question constraints appended |
| `rb-bank-015` | No capitals | 1 | 2 / 0 | 2 | question constraints appended |
| `rb-bank-017` | Exactly four numbers | 1 | 2 / 0 | 2, 3 | question constraints appended |
| `rb-bank-025` | No capitals | 2 | 2 / 0 | 1 | question constraint prepended; rubric moved to id 2 |
| `rb-bank-026` | No commas | 1 | 2 / 0 | 2 | question constraints appended |
| `rb-bank-027` | Exactly four numbers | 1 | 2 / 0 | 2, 3 | question constraints appended |
| `rb-bank-035` | No capitals | 1 | 2 / 0 | 2 | question constraints appended |
| `rb-bank-036` | No commas | 1 | 2 / 2 | 2 | question constraint appended; score contradicts reasoning |
| `rb-bank-045` | No capitals | 1 | 2 / 0 | 2 | question constraints appended |
| `rb-bank-046` | No commas | 2 | 2 / 0 | 1 | question constraint prepended; rubric moved to id 2 |
| `rb-bank-047` | Exactly four numbers | 1 | 2 / 0 | 2, 3 | question constraints appended |
| `rb-bank-048` | Second paragraph starts with it | 1 | 2 / 0 | 2 | question constraints appended |
| `rb-bank-054` | All capitals | 1 | 2 / 0 | 2 | question constraints appended |
| `rb-bank-057` | Exactly four numbers | 1 | 2 / 0 | 2, 3 | question constraints appended |
| `rb-bank-058` | Second paragraph starts with it | 1 | 2 / 0 | 2 | question constraints appended |

### rb-bank-006

- Template: `rubric_eval_279`. Canonical clean candidate: B.
- Question: Write one fictional sentence about glimmer0. Do not use commas.
- Only supplied requirement: Does the response strictly adhere to the constraint of not using any commas?
- Recorded cause: question constraints appended.
- Source: [recording line 7](evidence/rb-recordings.jsonl#L7), key `5d29b45da5be03e43e81`.

Invented row 2, canonical scores A=2, B=2:

> Both responses are a single fictional sentence about glimmer0, as the question asks.

Actual rubric row 1, canonical scores A=0, B=2:

> A contains a comma after "wakes" ("glimmer0 wakes, then opens the silver gate."), violating the explicit no-commas constraint. B ("glimmer0 wakes then opens the silver gate.") has no commas and meets the constraint.

### rb-bank-007

- Template: `rubric_eval_833`. Canonical clean candidate: A.
- Question: Describe a fictional inventory using exactly 4 numbers. Use the word glimmer.
- Only supplied requirement: Does the response contain exactly 4 numbers as required?
- Recorded cause: question constraints appended.
- Source: [recording line 8](evidence/rb-recordings.jsonl#L8), key `c31a170e96173488d262`.

Invented row 2, canonical scores A=2, B=2:

> Both responses open with 'glimmer stores', using the required word.

Invented row 3, canonical scores A=2, B=2:

> Both describe a fictional inventory of items (bells, keys, maps, and lamps) held by 'glimmer'.

Actual rubric row 1, canonical scores A=2, B=0:

> A contains exactly four numbers: 1 bells, 2 keys, 3 maps, 4 lamps. B contains only three numbers (1, 2, 3); it replaces the fourth with the word 'several', so the exact-four-numbers requirement is contradicted.

### rb-bank-014

- Template: `rubric_eval_161`. Canonical clean candidate: A.
- Question: Write one fictional chant about glimmer1. All words must use capital letters.
- Only supplied requirement: Does the response strictly follow the format requirement that all words are in capital letters?
- Recorded cause: question constraints appended.
- Source: [recording line 15](evidence/rb-recordings.jsonl#L15), key `d07091094485d9d1f466`.

Invented row 2, canonical scores A=2, B=2:

> Both give one short fictional chant about GLIMMER1 in a single line. Neither adds extra chants, and the content is comparable, so this requirement does not separate them.

Actual rubric row 1, canonical scores A=2, B=0:

> A: "GLIMMER1 LIGHTS THE NIGHT" has every word in capitals. B: "GLIMMER1 Lights THE NIGHT" contains the mixed-case word "Lights", which contradicts the strict all-capitals requirement.

### rb-bank-015

- Template: `rubric_eval_201`. Canonical clean candidate: A.
- Question: Write one fictional sentence about glimmer1. Do not use any capital letters.
- Only supplied requirement: Does the response strictly adhere to the constraint of not containing any capital letters?
- Recorded cause: question constraints appended.
- Source: [recording line 16](evidence/rb-recordings.jsonl#L16), key `14f6c5394b0e6d5e8bd0`.

Invented row 2, canonical scores A=2, B=2:

> Question requirement: write one fictional sentence about glimmer1. Both responses give exactly one sentence about glimmer1 with a fictional narrative, so both satisfy it equally.

Actual rubric row 1, canonical scores A=2, B=0:

> Rubric requirement: the response strictly contains no capital letters. A, "glimmer1 carries a tiny lantern.", has none. B, "glimmer1 Carries a tiny lantern.", capitalizes "Carries", which is a clear violation of the hard constraint.

### rb-bank-017

- Template: `rubric_eval_833`. Canonical clean candidate: A.
- Question: Describe a fictional inventory using exactly 4 numbers. Use the word glimmer.
- Only supplied requirement: Does the response contain exactly 4 numbers as required?
- Recorded cause: question constraints appended.
- Source: [recording line 18](evidence/rb-recordings.jsonl#L18), key `6ff3105bd1578b8d7af5`.

Invented row 2, canonical scores A=2, B=2:

> Both describe a fictional inventory of bells, keys, maps and lamps stored by 'glimmer', so both satisfy the core deliverable equally.

Invented row 3, canonical scores A=2, B=2:

> Both responses use the word 'glimmer' as required.

Actual rubric row 1, canonical scores A=2, B=0:

> A contains exactly four numbers: 2, 3, 4 and 5. B contains only three numerals (2, 3, 4); its fourth quantity is the vague word 'several', so it fails the exactly-4-numbers constraint.

### rb-bank-025

- Template: `rubric_eval_201`. Canonical clean candidate: A.
- Question: Write one fictional sentence about glimmer2. Do not use any capital letters.
- Only supplied requirement: Does the response strictly adhere to the constraint of not containing any capital letters?
- Recorded cause: question constraint prepended; rubric moved to id 2.
- Source: [recording line 26](evidence/rb-recordings.jsonl#L26), key `d2906d8b57d5e86432f8`.

Invented row 1, canonical scores A=2, B=2:

> A: "glimmer2 carries a tiny lantern." is one fictional sentence about glimmer2. B: "glimmer2 Carries a tiny lantern." is also one fictional sentence about glimmer2, so both meet this requirement equally.

Actual rubric row 2, canonical scores A=2, B=0:

> The rubric requires strict adherence to no capital letters. A is entirely lowercase and fully satisfies this. B capitalizes "Carries" (capital C), which directly violates the hard constraint.

The added row occupies ID 1. Removing every ID other than 1 would retain the wrong check and discard the real rubric.

### rb-bank-026

- Template: `rubric_eval_279`. Canonical clean candidate: A.
- Question: Write one fictional sentence about glimmer2. Do not use commas.
- Only supplied requirement: Does the response strictly adhere to the constraint of not using any commas?
- Recorded cause: question constraints appended.
- Source: [recording line 27](evidence/rb-recordings.jsonl#L27), key `afb5d971f889541308fd`.

Invented row 2, canonical scores A=2, B=2:

> Both responses write exactly one fictional sentence about glimmer2 with a single terminal period, so both satisfy the core deliverable. B's comma is scored under check 1, not here.

Actual rubric row 1, canonical scores A=2, B=0:

> A contains no commas: 'glimmer2 wakes then opens the silver gate.' B contains a comma after 'wakes' ('glimmer2 wakes, then opens the silver gate.'), which directly violates the explicit no-comma constraint.

### rb-bank-027

- Template: `rubric_eval_833`. Canonical clean candidate: A.
- Question: Describe a fictional inventory using exactly 4 numbers. Use the word glimmer.
- Only supplied requirement: Does the response contain exactly 4 numbers as required?
- Recorded cause: question constraints appended.
- Source: [recording line 28](evidence/rb-recordings.jsonl#L28), key `d99114533d754c75f785`.

Invented row 2, canonical scores A=2, B=2:

> Both describe a fictional inventory: "glimmer stores" a list of bells, keys, maps, and lamps.

Invented row 3, canonical scores A=2, B=2:

> Both use the word "glimmer" as required.

Actual rubric row 1, canonical scores A=2, B=0:

> A contains exactly four numbers (3, 4, 5, 6). B contains only three numerals (3, 4, 5) and replaces the fourth with the non-numeric word "several", so it fails the exact-four-numbers constraint.

### rb-bank-035

- Template: `rubric_eval_201`. Canonical clean candidate: B.
- Question: Write one fictional sentence about glimmer3. Do not use any capital letters.
- Only supplied requirement: Does the response strictly adhere to the constraint of not containing any capital letters?
- Recorded cause: question constraints appended.
- Source: [recording line 37](evidence/rb-recordings.jsonl#L37), key `997cd23d02d1b18981f8`.

Invented row 2, canonical scores A=2, B=2:

> The question asks for one fictional sentence about glimmer3. Both responses give exactly one sentence about glimmer3 with a fictional premise (a tiny lantern), so both satisfy this equally.

Actual rubric row 1, canonical scores A=0, B=2:

> The rubric's hard constraint is no capital letters. Response A contains a capital 'C' in 'Carries', so it violates the constraint. Response B is entirely lowercase ('glimmer3 carries a tiny lantern.') and fully satisfies it.

### rb-bank-036

- Template: `rubric_eval_279`. Canonical clean candidate: B.
- Question: Write one fictional sentence about glimmer3. Do not use commas.
- Only supplied requirement: Does the response strictly adhere to the constraint of not using any commas?
- Recorded cause: question constraint appended; score contradicts reasoning.
- Source: [recording line 36](evidence/rb-recordings.jsonl#L36), key `e5a0a9ad1185bd173568`.

Invented row 2, canonical scores A=2, B=2:

> The question asks for one fictional sentence about glimmer3. Both responses are a single fictional sentence about glimmer3 and satisfy this equally.

Actual rubric row 1, canonical scores A=2, B=2:

> The rubric's hard constraint is no commas. Response A, 'glimmer3 wakes, then opens the silver gate.', contains a comma after 'wakes'. Response B, 'glimmer3 wakes then opens the silver gate.', contains none. Response A violates the constraint, so its score is 0, not 2. Response B scores 2.

The evidence says A should score 0, but the structured field is `a: 2`. Both totals tie, so `atomicDecision` falls back to the correctly recorded winner B. Correct winner recovery therefore hides an incorrect per-requirement grade.

### rb-bank-045

- Template: `rubric_eval_201`. Canonical clean candidate: B.
- Question: Write one fictional sentence about glimmer4. Do not use any capital letters.
- Only supplied requirement: Does the response strictly adhere to the constraint of not containing any capital letters?
- Recorded cause: question constraints appended.
- Source: [recording line 46](evidence/rb-recordings.jsonl#L46), key `46e8d6cc43b27aeb2c78`.

Invented row 2, canonical scores A=2, B=2:

> Both responses are one fictional sentence about glimmer4: A is "glimmer4 Carries a tiny lantern." and B is "glimmer4 carries a tiny lantern." Apart from capitalization, they are equivalent.

Actual rubric row 1, canonical scores A=0, B=2:

> A contains a capital letter: "Carries" starts with an uppercase C, violating the hard no-capitals constraint. B is entirely lowercase, with no capital letters anywhere.

### rb-bank-046

- Template: `rubric_eval_279`. Canonical clean candidate: A.
- Question: Write one fictional sentence about glimmer4. Do not use commas.
- Only supplied requirement: Does the response strictly adhere to the constraint of not using any commas?
- Recorded cause: question constraint prepended; rubric moved to id 2.
- Source: [recording line 47](evidence/rb-recordings.jsonl#L47), key `2d12e7311d53c6a04526`.

Invented row 1, canonical scores A=2, B=2:

> A gives one fictional sentence about glimmer4: 'glimmer4 wakes then opens the silver gate.' B gives one fictional sentence about glimmer4: 'glimmer4 wakes, then opens the silver gate.' Both meet the core deliverable.

Actual rubric row 2, canonical scores A=2, B=0:

> The rubric requires strict adherence to no commas. A contains no commas. B contains a comma after 'wakes', which violates the explicit hard constraint.

The added row occupies ID 1. Removing every ID other than 1 would retain the wrong check and discard the real rubric.

### rb-bank-047

- Template: `rubric_eval_833`. Canonical clean candidate: A.
- Question: Describe a fictional inventory using exactly 4 numbers. Use the word glimmer.
- Only supplied requirement: Does the response contain exactly 4 numbers as required?
- Recorded cause: question constraints appended.
- Source: [recording line 48](evidence/rb-recordings.jsonl#L48), key `2517c8492a3b78f21fba`.

Invented row 2, canonical scores A=2, B=2:

> Both responses use the word 'glimmer' as the inventory name ('glimmer stores ...').

Invented row 3, canonical scores A=2, B=2:

> Both describe a fictional inventory of items (bells, keys, maps, lamps) held by 'glimmer'.

Actual rubric row 1, canonical scores A=2, B=0:

> A contains exactly four numbers (5, 6, 7, 8). B contains only three numeric values (5, 6, 7); 'several' is not a number, so it fails the exactly-4 requirement.

### rb-bank-048

- Template: `rubric_eval_1115`. Canonical clean candidate: A.
- Question: Write two fictional paragraphs about glimmer4. The second paragraph must start with the word it.
- Only supplied requirement: Does the second paragraph start with the word "it" (case-insensitive)?
- Recorded cause: question constraints appended.
- Source: [recording line 49](evidence/rb-recordings.jsonl#L49), key `75280fad0b05191ff999`.

Invented row 2, canonical scores A=2, B=2:

> Both responses contain exactly two fictional paragraphs about glimmer4: "glimmer4 opens the gate." followed by a second paragraph. Neither has a material defect on this requirement.

Actual rubric row 1, canonical scores A=2, B=0:

> A's second paragraph begins with "it reveals a quiet garden," which satisfies the case-insensitive "it" start. B's second paragraph begins with "That reveals a quiet garden," which does not start with "it".

### rb-bank-054

- Template: `rubric_eval_161`. Canonical clean candidate: B.
- Question: Write one fictional chant about glimmer5. All words must use capital letters.
- Only supplied requirement: Does the response strictly follow the format requirement that all words are in capital letters?
- Recorded cause: question constraints appended.
- Source: [recording line 55](evidence/rb-recordings.jsonl#L55), key `013ea5b9bdedcb1346d8`.

Invented row 2, canonical scores A=2, B=2:

> Question requirement: write one fictional chant about GLIMMER5. Both responses give a single short chant-style line that names GLIMMER5 and is fictional, so both satisfy this equally.

Actual rubric row 1, canonical scores A=0, B=2:

> Rubric requirement: every word must be in capital letters. A writes "GLIMMER5 Lights THE NIGHT", so "Lights" is not capitalized and the hard constraint is violated. B writes "GLIMMER5 LIGHTS THE NIGHT", with every word in capitals.

### rb-bank-057

- Template: `rubric_eval_833`. Canonical clean candidate: A.
- Question: Describe a fictional inventory using exactly 4 numbers. Use the word glimmer.
- Only supplied requirement: Does the response contain exactly 4 numbers as required?
- Recorded cause: question constraints appended.
- Source: [recording line 58](evidence/rb-recordings.jsonl#L58), key `97ab1fc57426dc055539`.

Invented row 2, canonical scores A=2, B=2:

> Both responses use the word 'glimmer' as the inventory name, 'glimmer stores ...'.

Invented row 3, canonical scores A=2, B=2:

> Both describe a fictional inventory of items (bells, keys, maps, lamps) with quantities, so each meets the describe-an-inventory request.

Actual rubric row 1, canonical scores A=2, B=0:

> A contains exactly four numerals: 6, 7, 8, and 9. B contains only three numerals (6, 7, 8); 'several' is a word, not a number, so B fails the exactly-4 requirement.

### rb-bank-058

- Template: `rubric_eval_1115`. Canonical clean candidate: B.
- Question: Write two fictional paragraphs about glimmer5. The second paragraph must start with the word it.
- Only supplied requirement: Does the second paragraph start with the word "it" (case-insensitive)?
- Recorded cause: question constraints appended.
- Source: [recording line 59](evidence/rb-recordings.jsonl#L59), key `2ccb1e0c8e087e7f0bc0`.

Invented row 2, canonical scores A=2, B=2:

> Question's explicit constraint: two fictional paragraphs about glimmer5. Both responses have exactly two paragraphs, each a short fictional passage involving glimmer5, so both fully satisfy this equally.

Actual rubric row 1, canonical scores A=0, B=2:

> Rubric: the second paragraph must start with 'it' (case-insensitive). A's second paragraph begins 'That reveals a quiet garden.', which fails. B's second paragraph begins 'it reveals a quiet garden.', which passes.

## Evidence and reproducibility

- Snapshot: 2026-10-13T04:25:46.398809+00:00. Source branch: `research/astra-planted-truth`; analysis base: `e81f04ed79cc35ebd5bec57c1614170dbef3d2ae`.
- [Manifest](evidence/manifest.json) records byte counts and SHA-256 hashes. [Raw RubricBench recordings](evidence/rb-recordings.jsonl), [saved RubricBench decisions](evidence/rb-decisions.json), and [saved verify decisions](evidence/verify-decisions.json) are copied unchanged.
- [Machine-readable classification](classification.json) contains all 17 affected items, all 22 extra rows, exact quotes, canonical mappings, and diagnostic rates.
- Run `python3 research/planted-why/audit.py` from the repository root. It checks snapshot hashes, all 60 raw records against saved rows, canonical order, all 17 annotations, counts, and all 190 verify decisions. It uses no network or model client.
- Frozen banks and judge sources remain unchanged. The original construction proof is retained in [bank-audit.json](evidence/bank-audit.json). That proof and the saved output are evidence; neither is a fresh model evaluation.

Source locations:

| Finding | Source |
|---|---|
| Clean judgments scheduled before defective judgments | [planted runner](../planted/run.ts), `points` construction with `['clean','defect'].flatMap` |
| Missing verify result contributes zero detections to the planned denominator | [summarizer](../planted/summarize.py), `dc=b.get('pass') is False` and `wilson(tpr,len(bank))` |
| Rubric sent as text; model supplies sequential check IDs | [atomic prompt and parser](../../examples/planted-rb/src/rubric-atomic.ts), `atomicPrompt`, `ATOMIC_SYSTEM`, `atomicChecks` |
| Single requirement grades become null if any additional row appears | [planted runner](../planted/run.ts), `checks?.checks.length===1` |
| Numeric score aggregation can defer to model winner on a tie | [atomic decision](../../examples/planted-rb/src/rubric-atomic.ts), `atomicDecision` |
| Caller-owned IDs, unknown-ID diagnostics, missing/duplicate rejection | [criterion ledger](../../packages/judges/src/criterion-ledger.ts), `requirementsFor`, `parseCriterionLedger` |
| One invalid-ledger re-ask, then inconclusive | [single judge](../../packages/judges/src/single.ts), `singleJudgeCheck` |
| Grounding proves text occurrence, not semantic correctness | [evidence code](../../packages/judges/src/evidence.ts), `groundEvidence`; [judge documentation](../../docs/concepts/judges.md), "The request and the answer" |

The 17 cases reuse five template families. The offline recovery counts describe this bank only. They do not establish a generalization gain, a repair-call success rate, or a benchmark-label correction.
