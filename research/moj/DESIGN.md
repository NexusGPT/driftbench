# Mixture of Judges (MoJ): design

Written before any paid call. Amendments made after the first probe are in section 11 and are dated.

## 0. Definition

**Mixture of Judges (MoJ)**: a System-1 first pass on every item, then a full judge mixing System-1 and
System-2 models on the items the first pass leaves unsure.

- **System 1**: a fast decision model. It answers a yes or no question with a probability and writes no prose.
  Here: Jev (`POST /v1/systemone`, question type `noul`, answer `answers.<name>.noul` = probability of yes).
- **System 2**: a generative model that reasons in text. Here: `gpt-6-luna`, no temperature parameter.
- In MoJ the System-1 model has two jobs:
  1. **Judge**: the first-pass verdict with its margin.
  2. **Router**: a few cheap decisions on the item's content that pick which expert handles the item and how
     much to spend. This is why the architecture is a mixture: the gate itself is a System-1 model.
- Every System-1 output, verdict and route alike, carries a **confidence**: the model's probability, calibrated
  on the practice split so that 0.9 is right about 9 times in 10.

Owner's words that bind this design:
- "Use System-1 model for this as alternative for judging. I'm almost positive it will outperform when well designed"
- "we need to make it work so that it doesn't worsen our other benchmarks"
- "so the architecture could include a first pass with a system 1 model, then a full judge with mixed system 1 and 2"
- "because you could have routing in system 1 too"
- "with level of confidence, etc."

## 1. What Jev accepts and returns (read from the package, to be confirmed by one probe)

- Request: `{ model, state, questions: { <name>: { type: "noul", instructions: { question, focus } } } }`.
- Answer: `{ model, answers: { <name>: { noul: <probability of yes, 0 to 1> } } }`.
- Routes: gateway (`api-key` header) and direct (`Bearer`). Model default `jev-latest`.
- The package maps the probability with two bounds: pass at 0.6 or more, fail at 0.4 or less, between the two
  inconclusive (`outcomeFromProbability`). The bounds are options (`passAt`, `failAt`).
- The package asks one question per call today (`verdict`). `questions` is a map, so several questions per
  call may work: probe item P2.
- Unknown until probed: input size limit, non-English behaviour, latency, price. Price is not published:
  the report gives calls and latency and says the price is unknown.
- The OpenAI Decisions client exists but an earlier probe got HTTP 404. One cheap probe (P5), else unavailable.

## 2. Experts (the things a route can select)

Each expert returns `pA` = probability that original candidate A is the better one, in 0 to 1, plus its calls.

| id | Expert | Calls per pair | What it does |
|---|---|---|---|
| S1P | System-1 pairwise | 2 S1 | "Is FIRST better than SECOND on <statement>?" asked in both orders. `pA = (p_AB + 1 - p_BA) / 2`. Order bias cancels; `|p_AB + p_BA - 1|` measures the bias; `pA` near 0.5 is a measured tie. |
| S1R | System-1 pointwise rows | K rows x 2 candidates (S1) | One yes or no decision per requirement row and per candidate. The verdict is computed in code: weighted sum of `p_row(A) - p_row(B)`, mapped to `pA` by a fitted logistic. Hard rows carry more weight. |
| S2V | System-2 single verdict | 2 S2 | The promptfoo select-best template, both orders, one integer out. Recorded where it exists. |
| S2L | System-2 pair ledger | 2 to 4 S2 | Our existing judge. Recorded verdicts only, zero new cost. |
| REF | Reference check (mixed) | 1 S2 + 2 S1 | System 2 solves the task once without seeing the candidates and writes a short reference answer. System 1 answers per candidate: "Does this reply reach the same final answer as the reference?" `pA` from the difference. Reasoning is done once by System 2; the comparison is a System-1 decision. |
| MIX-ROWS | Mixed rows | 2 S2 (hard rows) + S1 rows | System 2 scores the hard rows (reasoning, arithmetic, long context); System 1 scores the checkable rows. Rows are routed by row content. Verdict in code. |
| PANEL | Weighted panel | sum of members | Members vote with their `pA`; code combines them with a logistic whose weights are fitted on the practice split. |
| TIEBREAK | System 2 as tie-breaker | S1R + S2V only on conflict | System 2 is called only when the System-1 rows conflict (rows point to different winners with similar weight) or S1P and S1R disagree. |

## 3. Decomposition (once per item type, reused)

- Requirement rows are written once per benchmark item type, never per item.
- JudgeBench and MM-Eval: the rows already frozen by the ledger harnesses are reused verbatim
  (`final_correct`, `format_followed`, `derivation_sound`; `addresses_request`, `correct_claims`,
  `safe_policy`, `language_match`, `clarity`).
- Writing preference: the ledger uses one holistic row (`better_piece`). For S1R one System-2 call writes
  5 rubric statements for the item type "long-form writing request", recorded, then reused for every pair.
- Per-item cost of S1R is therefore System-1 only.
- Each row has a content class: `checkable` (form, language, refusal present, names an element) or `hard`
  (needs reasoning, arithmetic, long context). The class is set by one System-1 decision on the row text, with
  a hand check, and is the basis of MIX-ROWS.

## 4. Stage 1: System-1 first pass, on every item

- S1P on every pair (2 calls). Output: verdict (`A` if `pA > 0.5`), margin `m = |2 pA - 1|`, and a calibrated
  confidence `c = P(verdict correct | m, route features)`.
- Router decisions on the task content (question plus candidates, never a benchmark label). Each is one
  System-1 question with its probability:
  - R1 `needs_reasoning`: answering the request needs multi-step reasoning, arithmetic or code tracing.
  - R2 `safety_case`: the request asks for something harmful, or a candidate refuses.
  - R3 `checkable_answer`: the request has one objectively correct final answer.
  - R4 `subjective_writing`: the request is a creative or stylistic writing task.
  - Code features, zero calls: total characters (long context), candidate similarity ratio (near-identical),
    script of the request (language).
- A route decision with probability between its fitted bounds is "unsure": the item takes the safer, more
  expensive expert for that decision.

## 5. Confidence levels (the control)

| Level | Rule | Path |
|---|---|---|
| High | `c >= hi` and no route flag forbids a System-1 stop | Stop. Stage-1 verdict stands. |
| Middle | `lo <= c < hi` | Add one expert chosen by the route, combine in code. Stop if the combined confidence reaches `hi`. |
| Low | `c < lo`, or a flagged route with an unsure route decision | Full mixed judge (stage 2 variant) or the panel. |

- `hi` and `lo` are fitted on practice data only. The share escalated is a dial: moving `hi` and `lo` traces a
  cost and accuracy curve. Three named points: cheapest, balanced, most accurate.
- The final verdict carries its own confidence (the calibrated probability of the last combination).

## 6. Stage 2 variants (only for items stage 1 leaves unsure)

| id | Variant | System-2 share |
|---|---|---|
| V1 | S2 writes rows once, S1 scores each row (S1R) | none per item |
| V2 | Rows routed by content: S2 on hard rows, S1 on checkable rows (MIX-ROWS); REF when R3 says checkable answer | hard rows only |
| V3 | S1 and S2 both vote, weights fitted (PANEL of S1P, S1R, S2V) | one S2 verdict |
| V4 | S2 only as tie-breaker when S1 rows conflict (TIEBREAK) | conflicts only |
| V0 | Escalate to the recorded full System-2 ledger (S2L) at 10, 20, 30 percent | recorded |

## 7. Three gates compared

1. **No routing**: every item gets the same expert (each expert alone, and "always the full judge").
2. **Margin-only escalation**: stage-1 confidence alone decides who escalates.
3. **System-1 routing**: R1 to R4 plus code features pick the expert; confidence picks the budget.

Reported for each: accuracy, share reaching stage 2, calls per item of each kind, cost saved against
"always the full judge", accuracy lost or gained against it.

**Oracle route**: for each item, the cheapest expert that gets it right, computed from recordings. Routing
accuracy = share of items where the chosen expert is right when the oracle says some expert is right, plus
the share where the chosen expert equals the oracle's cheapest.

## 8. What System 1 cannot do, and the content route around it

| Limit | Content signal | Route |
|---|---|---|
| Multi-step reasoning, arithmetic | R1 high, R3 high | REF (System 2 solves once) or S2 hard rows. Never S1P alone. |
| Long inputs | characters over the fitted bound or over the probed input limit | Pointwise rows per candidate (half the text per call); if still over, System 2. |
| Near-identical candidates | similarity ratio over the fitted bound | S1P margin is tiny by construction: go to REF or S2V. |
| Safety and refusal | R2 high | S1R with the `safe_policy` rows (checkable: "the reply refuses", "the reply gives harmful steps"). |
| Language | script and language of the request | If the probe shows weak non-English behaviour: System 2 for those languages. |

Routes read content only. No rule names a benchmark.

## 9. Calibration

- Raw System-1 probabilities are mapped to confidence with isotonic regression (fallback: Platt) on practice
  data, 5-fold cross-fitted so every reported number is out of fold.
- Reported: calibration curve (bins of confidence against observed accuracy), expected calibration error
  (ECE, 10 equal-width bins), share of items and accuracy per level.
- Frozen thresholds for the sealed run are the ones fitted on all practice pairs.

## 10. Hypotheses and the number that refutes each

Practice pairs, 5-fold out of fold, pair-level accuracy (tie counts half), Wilson 95 percent interval.

| Arm | Hypothesis | Refuted when |
|---|---|---|
| H1 S1P alone | System-1 pairwise matches the System-2 single verdict on writing and chat items | accuracy more than 5 points under S2V on the writing set or the MM set |
| H2 S1P on reasoning | System 1 alone cannot judge reasoning items | S1P within 5 points of S2V on JudgeBench (then the limit in section 8 is wrong) |
| H3 S1R alone | Per-row decisions beat one pairwise decision | S1R accuracy at or under S1P on two of three sets |
| H4 order cancel | Asking both orders removes position bias | mean `p_AB + p_BA - 1` under 0.05 in absolute value (no bias to cancel) or single-order accuracy equal to both-order accuracy |
| H5 calibration | Confidence is usable as a control | out-of-fold ECE over 0.10, or accuracy in the high level not above the low level by 10 points |
| H6 V0 escalation | Escalating the least confident 20 percent to the recorded ledger reaches the ledger's accuracy | accuracy more than 2 points under S2L at 20 percent escalated |
| H7 REF | Reference check beats S2V on checkable-answer items | REF accuracy under S2V on items with R3 high |
| H8 mix variants | A mixed stage 2 (V2 or V3) beats both pure sides | best of V2, V3 at or under max(S1 alone, S2V) on the pooled set |
| H9 System-1 routing | The S1 router beats margin-only at equal System-2 calls | routed accuracy at or under margin-only at the same S2 call share |
| H10 owner's expectation | A well designed System-1 mixture outperforms: at least the accuracy of both baselines (ledger and promptfoo) with fewer System-2 calls per pair than promptfoo's 1 | MoJ balanced point under either baseline by more than the interval half-width on the pooled set, or more than 1 S2 call per pair |

## 11. Probe before the pilot (few calls)

- P1 one fictional pair, both routes: shape, latency.
- P2 two questions in one call.
- P3 input size: a fictional text doubled until refusal or error, up to 64,000 characters.
- P4 non-English: the same fictional pair in German and Chinese.
- P5 OpenAI Decisions: one call; 404 means unavailable.

## 12. Pilot plan

- Practice pairs only, the same pairs for every arm. No sealed pool file is opened.
  - JudgeBench: 68 preparation pairs (pilot 20, noise 30, fixtures 18), GPT-4o responses. The sealed pool is
    the 270 Claude-response pairs: not read.
  - MM-Eval: 50 pairs from the exposed DEV400 (pilot 20, noise 30).
  - Writing preference: 50 pairs (pilot 20, dev 30).
- Baselines: recorded `gpt-6-luna` decisions of the pair ledger and of promptfoo select-best on those pairs.
  Where a recording is missing the baseline is run fresh with the same template and model (promptfoo) or
  reported on the recorded subset only (ledger), and the table says which.
- Every expert runs on every pair and is recorded. Gates and levels are then simulated offline from the
  recordings, so every arm replays at zero cost.
- Pacing: 8 calls at a time. A returned answer is never asked again. A call with no answer is submitted at
  most 3 times. Spend file: `spend-system1.md`. System-2 cap 15 USD.

---

# Amendments after the first probe (2026-10-13, all before any result was read as evidence)

- Name: the architecture is **Mixture of Judges (MoJ)**. Code, configs and folders use `moj` (branch
  `research/system1-judge`, folder `research/moj/`).
- Probe facts (results/probe.json, fictional data): about 0.3 to 0.4 s per call; one call answers several
  questions; 128,000 characters accepted; German, Chinese and Arabic pairs answered in the right direction
  (0.79/0.14, 0.82/0.15, 0.75/0.18); a simple arithmetic check separates 0.78 from 0.09. The OpenAI Decisions
  probe was not repeated: the package client was not needed.
- Practice sets enlarged to JudgeBench 250, MM-Eval 300, writing 300 (first 168 kept as `core`), split v2 by
  prompt group. Pointwise sets (RubricBench, verify, hard rows) were built by a helper on the same core.

## Capability cards (filled from our recordings; literature in research-judges-1/2/3)

| Design | Strong terrain (our accuracy) | Weak terrain | Cost per pair | Known bias | Source |
|---|---|---|---|---|---|
| s1p System-1 pairwise, both orders | subjective writing 70, safety 95, near-identical 91, MM-Eval overall 92 | reasoning 81, JudgeBench 77, code 82 | 2 S1 | first-position bias +0.13 on writing, -0.13 on JudgeBench, cancelled by both orders | ours; arXiv 2609.26550 (decision judge trails 13 to 28 points on math, code, logic) |
| ref reference check (S2 solves once, S1 compares) | checkable answer 89, reasoning 87 | open tasks 49 (no reference exists: carries no verdict) | 1 S2 + 2 S1 | inherits System-2 errors on the reference | ours; 2503.05061 (a correct reference beats a bigger judge) |
| s2v System-2 select-best, both orders | checkable 94, code 95, reasoning 91 | writing 58, long context 54, length gap 70 | 2 S2 | order splits counted as half | ours; reader 3 |
| s2vh same, high effort | JudgeBench 91 (medium 90) | not measured elsewhere | 2 S2, 1.4 times the cost | | ours; 2410.12784 (effort matters on hard pairs) |
| s2l pair ledger (recorded) | JudgeBench 96 | MM-Eval safety (55 on 20 pairs), writing 52 to 61 | 2 to 4 S2 | ties left by the code | reader 3 |
| s1r System-1 pointwise rows | hard rows 97, RubricBench 94 (helper) | writing 61 | 2 S1 | | ours; helper scoreboard |
| s1cf counterfactual (format stripped, cut to same length) | safety 98 | everything else, 46 on writing | 2 S1 | removes the length signal, which carries the writing label | ours |
| adv adversarial objection, debate | JudgeBench core 83 to 100 (adv) | writing 46 to 57, debate below one call everywhere | 2 S2 + 2 S1 | | ours; 2410.12784 (debate 34 on JudgeBench) |
| panel (helper: luna, Haiku, Gemini flash-lite) | low-confidence pairs 66 (cascade) | weighted version 31 on low pairs | up to 8 extra calls on low pairs | | helper COMPARISON.md; 2404.18796 |
| reference-first (helper, pointwise) | hard rows 97, verify with reference 96 | verify without reference 55 | 1 S1 | | helper COMPARISON.md |

## What the pilot showed (details: research/moj/RESULTS.md)

- Best arm `r6-ref-first`: JudgeBench 91.6, MM-Eval 95.7, writing 64.8 at 0.43 to 1.49 System-2 calls per pair,
  against promptfoo 90.4 / 92.8 / 54.8 at 2.00 and our ledger 95.6 (68 pairs) / 55.0 (20) / 57.0 (50).
- H1 supported on MM-Eval and writing (System 1 alone 91.7 and 64.9, at or above the System-2 verdict).
  H2 supported: System 1 alone trails by 13 points on JudgeBench. H4: first-position bias exists (+0.13 and -0.13)
  and both orders cancel it. H5 partly: out-of-fold ECE 0.05 to 0.09; on writing the high level is only 73
  percent right. H6 not testable: ledger recordings cover too few practice pairs. H9 supported: routing (r6)
  beats margin-only (r1) by 2.2 / 3.0 points pooled at fewer System-2 calls (0.93 against 1.04).
  H10 partly refuted: MoJ beats promptfoo on all three with fewer System-2 calls, but does not beat the ledger
  on JudgeBench and does not beat the length rule on writing.
- Gate error (the router's own): route right on 94, 96 and 75 percent of items where some expert is right.
  Rough ground (every design wrong): 51 pairs, MoJ recovers none.
- Writing step back (two rounds without gain): no judge design beats "longer wins" (68.7) there; the label
  carries a length preference (reader 3, research file 2 card 4). The report states that this set does not
  measure judging. The next approach for that cell is a length-aware System-1 feature (length gap as an input
  to the combination), tested on the tuning half only, and it is a preference model, not a judge fix.

## The gate: what could move if MoJ shipped, and the zero-cost check for each

MoJ ships only as an opt-in configuration (`moj`), never as a default, until every recorded floor holds.

| Result that could move | Why | Check by replay at zero cost |
|---|---|---|
| validators/judges ladder (21 seeds, 638 bank items) | MoJ would add a council mode and use `outcomeFromProbability` with fitted bounds | `pnpm driftbench validate judges --seeds 1..20 --hidden --items` against cassettes; no default bound may change |
| Jev route tests and the `system1` council class | MoJ calls the same client with several questions per call | `vitest --maxWorkers=2 packages/judges/test/jev-routes.test.ts` plus a new contract test for multi-question answers |
| Pair-ledger cells (JudgeBench, MM-Eval, writing on gpt-6-luna, Haiku) | none if MoJ is opt-in; any change to `pair-ledger.ts` would | re-score from each ledger worktree's `decisions*.jsonl`; numbers must equal the recorded 235, 88.08, 186 |
| Pointwise sets (RubricBench, verify, hard rows) | MoJ pointwise variants share the policy code | `python3 -m moj.pointwise --offline` reproduces SCOREBOARD.md row by row |
| Campaign and docs examples using `judge_class: system1` | default bounds 0.4 and 0.6 | docs/concepts/judges.md output blocks replayed from cassettes |

## Frozen design for the sealed confirmation run (not run)

- Items: `research/moj/data/sealed-confirmation.json` (JudgeBench 100, MM-Eval 300, writing 300 ids, digests
  inside), prompt-disjoint from practice, never scored by any run. Digests: JudgeBench `27c28916...` (100),
  MM-Eval `1cb85c54...`, writing `59a28939...`. Re-check prompt disjointness at load.
- Arms, all on gpt-6-luna medium effort and Jev `jev-1.13.0` (same System-2 model for every contestant):
  MoJ `configs/r6-ref-first.json` with weights fitted on ALL practice pairs and frozen in a file before the
  first call; promptfoo select-best both orders; our pair ledger as frozen in PR 168; longer wins.
- Settings frozen: boundary hi = lo = 0.8; reasoning terrain = route `needs_reasoning` >= 0.6; writing terrain =
  `subjective_writing` >= 0.6; reference check prompt and question texts as in `moj/experts.py` at the frozen
  commit. No change after the first call.
- Scoring: each benchmark's own rule (JudgeBench: a pair is right only when consistent; MM-Eval and writing:
  tie half). Wilson intervals per arm; paired bootstrap (20,000 draws, by prompt group) for MoJ minus each
  baseline; Holm over the 6 comparisons (3 benchmarks x 2 baselines).
- Rule for a win: MoJ wins a cell when the paired lower bound against the baseline is above 0 after Holm, at
  no more System-2 calls per pair than that baseline. A tie when the interval contains 0. MoJ is called better
  overall only if it wins or ties every cell and wins at least one; on writing a win also requires beating
  longer wins, else the report says the benchmark does not measure judging there.
- Budget: about 1,900 Jev calls and about 1,100 gpt-6-luna calls (about 1 USD); zero Gemini calls (the arm
  uses no Gemini model; a panel arm would need 2 Gemini calls per low-confidence pair, about 160 for 700 pairs).
