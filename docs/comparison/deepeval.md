# DeepEval: comparison

Measured 2026-10-13 with pinned `deepeval==4.2.8` and Haiku through the same serial `claude -p` path.
Native templates and extraction stages run unchanged. Prompts, privacy-redacted answers, model usage and costs are recorded.

The candidate is **not yet the shipped default**. It uses evidence checks and a computed final verdict. Production judges remain unchanged.
The result column reports candidate ordering on clarified hard v3. The tables below also show the shipped judge and fresh held-out results.
The shipped baseline uses the frozen judge snapshot from base commit 12801e1b9b9ae4d9c1bfb4ae6789bb70f1abd57c.

| Capability | Result | Basis | Example | Reproduce |
|---|---|---|---|---|
| Turn relevancy, judged | ahead | measured head-to-head, candidate | 2026-10-13: candidate 120/120 vs default 62/120; fresh held-out 69/72 vs 36/72 (ahead). | `.venv/bin/python comparisons/deepeval/hard/run.py --sets relevancy --variant audit --tag replay-relevancy` |
| G-Eval, strict | ahead | measured head-to-head, candidate | 2026-10-13: candidate 120/120 vs default 119/120; fresh held-out 69/72 vs 70/72 (behind). | `.venv/bin/python comparisons/deepeval/hard/run.py --sets relevancy --variant audit --tag replay-relevancy` |
| DAG, one judgement node | ahead | measured head-to-head, candidate | 2026-10-13: candidate 120/120 vs default 114/120; fresh held-out 69/72 vs 65/72 (ahead). | `.venv/bin/python comparisons/deepeval/hard/run.py --sets relevancy --variant audit --tag replay-relevancy` |
| Role adherence | ahead | measured head-to-head, candidate | 2026-10-13: candidate 118/120 vs default 98/120; fresh held-out 69/72 vs 63/72 (ahead). | `.venv/bin/python comparisons/deepeval/hard/run.py --sets role --variant audit --tag replay-role` |
| Conversation completeness | ahead | measured head-to-head, candidate | 2026-10-13: candidate 120/120 vs default 76/120; fresh held-out 72/72 vs 46/72 (ahead). | `.venv/bin/python comparisons/deepeval/hard/run.py --sets completeness --variant audit --tag replay-completeness` |
| Task completion, matching receipt | ahead | measured head-to-head, candidate | 2026-10-13: candidate 120/120 vs default 119/120; fresh held-out 71/72 vs 72/72 (behind). | `.venv/bin/python comparisons/deepeval/hard/run.py --sets task --evidence receipt --variant audit --tag replay-task-receipts` |
| Hallucination | ahead | measured head-to-head, candidate | 2026-10-13: candidate 120/120 vs default 60/120; fresh held-out 72/72 vs 36/72 (ahead). | `.venv/bin/python comparisons/deepeval/hard/run.py --sets grounding --variant audit --tag replay-grounding` |
| Faithfulness | ahead | measured head-to-head, candidate | 2026-10-13: candidate 120/120 vs default 60/120; fresh held-out 72/72 vs 36/72 (ahead). | `.venv/bin/python comparisons/deepeval/hard/run.py --sets grounding --variant audit --tag replay-grounding` |
| Knowledge retention, judged | ahead | measured head-to-head, candidate | 2026-10-13: candidate 120/120 vs default 115/120; fresh held-out 71/72 vs 69/72 (ahead). | `.venv/bin/python comparisons/deepeval/hard/run.py --sets knowledge --variant audit --tag replay-knowledge` |
| Turn relevancy, key-term floor | limit | compared against their docs or code. Limit: DeepEval has no comparator here (judge only), and a project rule decides it: advisory with a judge, gating without one. | No example recorded in the evidence. | packages/checks/test/relevancy.test.ts |
| Knowledge retention, ask check | limit | compared against their docs or code. Limit: DeepEval has no comparator here (judge only), and a project rule decides it: advisory with a judge, gating without one. | No example recorded in the evidence. | packages/checks/test/knowledge_retention.test.ts |
| Tool correctness, default | ahead | measured head-to-head | No example recorded in the evidence. | see comparisons/deepeval/README.md: `npx tsx comparisons/deepeval/tools/tools_ours.mts` and `.venv-deepeval/bin/python comparisons/deepeval/tools/tools_deepeval.py` |
| Tool correctness, exact order: accuracy | equal | measured head-to-head | No example recorded in the evidence. | see comparisons/deepeval/README.md: `npx tsx comparisons/deepeval/tools/tools_ours.mts` and `.venv-deepeval/bin/python comparisons/deepeval/tools/tools_deepeval.py` |
| Tool correctness, exact order: diagnosis | ahead | compared against their docs or code | Ours names the call, its position and the argument that differs. DeepEval gives a score only. | Not reproducible from the repository: the measurement is a local script outside it. |

## Fresh rows: G-Eval strict and powered knowledge retention

Measured 2026-10-14. The README chart reads these rows from `comparisons/deepeval/lead/fresh-scores.json`. G-Eval strict uses 480 fresh cases (seed 20261114, 20 pairs per family). Knowledge retention uses a separate 1,272-case confirmation (seed 20261214, 53 pairs per family). Both sets use the unchanged public generator and were frozen before calls.

| Row | driftbench | DeepEval default | Only driftbench right | Only DeepEval right | Exact paired p | Holm (2 rows) |
|---|---|---|---|---|---|---|
| G-Eval strict, opt-in setting `response-relevance` | 474/480 (97.3 to 99.43%) | 451/480 (91.46 to 95.76%) | 29 | 6 | 0.00012 | 0.00023 |
| Knowledge retention, shipped judge | 1270/1272 (99.43 to 99.96%) | 1272/1272 (99.7 to 100%) | 0 | 0 | 1 | 1 |

Knowledge retention is **level**: both tools are at the ceiling on observed verdicts from this generator. Two driftbench responses remain inconclusive because their evidence references are invalid. These missing answers are excluded from the paired test, which has 1,270 complete pairs, zero discordances and exact p = 1. The chart counts correct answers out of all 1,272 scheduled cases; its nominal 95% Wilson intervals describe correct-answer yield. Level does not establish equivalence.

Before the authorized timeout recovery, driftbench had 1,269 correct, zero incorrect and three missing answers; DeepEval had 1,227 correct, zero incorrect and 45 missing. After recovery, the counts are 1,270 / 0 / 2 and 1,272 / 0 / 0 respectively. A timeout is a missing answer, never a verdict.

The confirmation retains seven completed CLI cases and finishes through the Anthropic Messages API using `claude-haiku-5-5` on both sides. The 30-case transport check agrees on 30/30 comparable driftbench verdicts and 27/27 DeepEval verdicts; three earlier DeepEval answers were missing. Prompts, judge settings and pinned DeepEval metrics stay frozen. The API main pass uses concurrency 16; the post-main timeout pass uses concurrency 3. See the [powered confirmation report](../../comparisons/deepeval/lead/power/REPORT.md) for transport differences, power, retries and costs, and the [480-case pilot method](../../comparisons/deepeval/lead/README.md) for G-Eval strict and the earlier retention result.

## Shipped judge, candidate and default

Each cell shows correct cases and a nominal 95% Wilson interval. Hard has 120 cases per row; fresh held-out has 72.
The task row in this table uses conversation-only evidence. Its matching-receipt condition appears in the next table.

| Row | Hard shipped | Hard candidate | Hard default | Held-out shipped | Held-out candidate | Held-out default |
|---|---|---|---|---|---|---|
| turn relevancy | 99/120 (74.72 to 88.26%; 84 distinct inputs) | 120/120 (96.9 to 100%; 84 distinct inputs) | 62/120 (42.81 to 60.42%; 84 distinct inputs) | 65/72 (81.26 to 95.21%; 72 distinct inputs) | 69/72 (88.45 to 98.57%; 72 distinct inputs) | 36/72 (38.75 to 61.25%; 72 distinct inputs) |
| G-Eval strict | 99/120 (74.72 to 88.26%; 84 distinct inputs) | 120/120 (96.9 to 100%; 84 distinct inputs) | 119/120 (95.43 to 99.85%; 84 distinct inputs) | 65/72 (81.26 to 95.21%; 72 distinct inputs) | 69/72 (88.45 to 98.57%; 72 distinct inputs) | 70/72 (90.43 to 99.23%; 72 distinct inputs) |
| DAG | 99/120 (74.72 to 88.26%; 84 distinct inputs) | 120/120 (96.9 to 100%; 84 distinct inputs) | 114/120 (89.52 to 97.69%; 84 distinct inputs) | 65/72 (81.26 to 95.21%; 72 distinct inputs) | 69/72 (88.45 to 98.57%; 72 distinct inputs) | 65/72 (81.26 to 95.21%; 72 distinct inputs) |
| role adherence | 118/120 (94.13 to 99.54%; 40 distinct inputs) | 118/120 (94.13 to 99.54%; 40 distinct inputs) | 98/120 (73.8 to 87.57%; 40 distinct inputs) | 72/72 (94.93 to 100%; 72 distinct inputs) | 69/72 (88.45 to 98.57%; 72 distinct inputs) | 63/72 (77.92 to 93.28%; 72 distinct inputs) |
| conversation completeness | 115/120 (90.62 to 98.21%; 84 distinct inputs) | 120/120 (96.9 to 100%; 84 distinct inputs) | 76/120 (54.42 to 71.42%; 84 distinct inputs) | 70/72 (90.43 to 99.23%; 60 distinct inputs) | 72/72 (94.93 to 100%; 60 distinct inputs) | 46/72 (52.35 to 74.02%; 60 distinct inputs) |
| task completion | 118/120 (94.13 to 99.54%; 90 distinct inputs) | 120/120 (96.9 to 100%; 90 distinct inputs) | 91/120 (67.45 to 82.61%; 90 distinct inputs) | 72/72 (94.93 to 100%; 54 distinct inputs) | 69/72 (88.45 to 98.57%; 54 distinct inputs) | 44/72 (49.56 to 71.53%; 54 distinct inputs) |
| hallucination | 119/120 (95.43 to 99.85%; 75 distinct inputs) | 120/120 (96.9 to 100%; 75 distinct inputs) | 60/120 (41.19 to 58.81%; 75 distinct inputs) | 71/72 (92.54 to 99.75%; 45 distinct inputs) | 72/72 (94.93 to 100%; 45 distinct inputs) | 36/72 (38.75 to 61.25%; 45 distinct inputs) |
| faithfulness | 119/120 (95.43 to 99.85%; 75 distinct inputs) | 120/120 (96.9 to 100%; 75 distinct inputs) | 60/120 (41.19 to 58.81%; 75 distinct inputs) | 71/72 (92.54 to 99.75%; 45 distinct inputs) | 72/72 (94.93 to 100%; 45 distinct inputs) | 36/72 (38.75 to 61.25%; 45 distinct inputs) |
| knowledge retention | 110/120 (85.34 to 95.41%; 120 distinct inputs) | 120/120 (96.9 to 100%; 120 distinct inputs) | 115/120 (90.62 to 98.21%; 120 distinct inputs) | 68/72 (86.57 to 97.82%; 72 distinct inputs) | 71/72 (92.54 to 99.75%; 72 distinct inputs) | 69/72 (88.45 to 98.57%; 72 distinct inputs) |

| Row | Hard candidate paired p | Held-out candidate paired p | Hard default at threshold 1 | Held-out default at threshold 1 | Unparsed S/C/D, hard / held-out |
|---|---|---|---|---|---|
| turn relevancy | 6.93889e-18 | 3.60887e-08 | 62/120 | 36/72 | 0/0/0 / 0/0/0 |
| G-Eval strict | 1 | 1 | 119/120 | 70/72 | 0/0/0 / 0/0/0 |
| DAG | 0.03125 | 0.34375 | 114/120 | 65/72 | 0/0/0 / 0/0/0 |
| role adherence | 1.09673e-05 | 0.109375 | 98/120 | 63/72 | 1/1/0 / 0/2/0 |
| conversation completeness | 1.13687e-13 | 2.98023e-08 | 115/120 | 66/72 | 0/0/0 / 0/0/0 |
| task completion | 3.72529e-09 | 4.17233e-07 | 68/120 | 36/72 | 0/0/0 / 0/0/0 |
| hallucination | 1.73472e-18 | 2.91038e-11 | 105/120 | 65/72 | 0/0/0 / 1/0/0 |
| faithfulness | 1.73472e-18 | 2.91038e-11 | 105/120 | 63/72 | 0/0/0 / 1/0/0 |
| knowledge retention | 0.0625 | 0.5 | 115/120 | 69/72 | 3/0/0 / 3/0/0 |

## Additional fresh seed and pooled results

Seed 20261020 adds five pairs per family for task and grounding only. Labels and prompts are frozen before calls; the candidate stays unchanged.
Additional counts are 120 per row. Pooled counts combine the original 72 and additional 120, giving 192 entries per row.
The additional candidate has 90 distinct task inputs and 75 grounding inputs. All are new relative to hard and original held-out inputs.
Pooled candidate inputs are 144 for task and 120 for grounding. Every interval carries its side-specific distinct-input count.
For multi-stage defaults, that count means unique ordered input-stage sequences. Repeated cases share one evaluation; nominal intervals remain descriptive.

| Row | Additional shipped | Additional candidate | Additional default | Pooled shipped | Pooled candidate | Pooled default |
|---|---|---|---|---|---|---|
| task completion | 120/120 (96.9 to 100%; 90 distinct inputs) | 113/120 (88.45 to 97.15%; 90 distinct inputs) | 86/120 (63.03 to 78.96%; 90 distinct inputs) | 192/192 (98.04 to 100.0%; 144 distinct inputs) | 182/192 (90.68 to 97.15%; 144 distinct inputs) | 130/192 (60.8 to 73.92%; 144 distinct inputs) |
| hallucination | 120/120 (96.9 to 100%; 75 distinct inputs) | 120/120 (96.9 to 100%; 75 distinct inputs) | 60/120 (41.19 to 58.81%; 75 distinct inputs) | 191/192 (97.11 to 99.91%; 120 distinct inputs) | 192/192 (98.04 to 100.0%; 120 distinct inputs) | 96/192 (43.0 to 57.0%; 120 distinct inputs) |
| faithfulness | 120/120 (96.9 to 100%; 75 distinct inputs) | 120/120 (96.9 to 100%; 75 distinct inputs) | 60/120 (41.19 to 58.81%; 75 distinct inputs) | 191/192 (97.11 to 99.91%; 120 distinct inputs) | 192/192 (98.04 to 100.0%; 120 distinct inputs) | 96/192 (43.0 to 57.0%; 120 distinct inputs) |

| Row | Additional paired p | Pooled paired p | Additional unparsed S/C/D | Pooled unparsed S/C/D |
|---|---|---|---|---|
| task completion | 1.40117e-06 | 9.0845e-13 | 0/1/0 | 0/1/0 |
| hallucination | 1.73472e-18 | 2.52435e-29 | 0/0/0 | 1/0/0 |
| faithfulness | 1.73472e-18 | 2.52435e-29 | 0/0/0 | 1/0/0 |

The additional conversation task candidate has six target-identification misses: `task-move-0-a`, `task-move-3-a`, `task-refund-0-a`, `task-move-4-a`, `task-refund-4-a`, `task-move-2-a`.

These misses add an explicit target-name requirement to completed actions. A separate invalid-envelope miss occurs on task-refund-3-a. No answer or label is repaired.

| Additional condition | Row | Case | Gold | Candidate failure |
|---|---|---|---|---|
| conversation | task completion | task-move-0-a | True | Adds an explicit target-identification requirement beyond the construction label |
| conversation | task completion | task-move-3-a | True | Adds an explicit target-identification requirement beyond the construction label |
| conversation | task completion | task-refund-0-a | True | Adds an explicit target-identification requirement beyond the construction label |
| conversation | task completion | task-move-4-a | True | Adds an explicit target-identification requirement beyond the construction label |
| conversation | task completion | task-refund-4-a | True | Adds an explicit target-identification requirement beyond the construction label |
| conversation | task completion | task-refund-3-a | True | Missing or empty audit checks |
| conversation | task completion | task-move-2-a | True | Adds an explicit target-identification requirement beyond the construction label |

Ahead, equal and behind show observed ordering. A one-case lead with a large paired p-value does not establish superiority.
Cases share templates and some recordings. Independence assumptions do not fully hold, so intervals do not prove general customer-language performance.
Held-out uses seed 20261019 and the same generator, with fresh contexts and values. Hard uses seed 20261012.
Labels are fixed before calls. Candidate selection uses hard v1/v2/v3 only; its source and corpora are frozen before held-out scoring.

| Set | Hard entries / unique candidate inputs | Held-out entries / unique candidate inputs |
|---|---|---|
| relevancy | 120 / 84 | 72 / 72 |
| role | 120 / 40 | 72 / 72 |
| completeness | 120 / 84 | 72 / 60 |
| task | 120 / 90 | 72 / 54 |
| grounding | 120 / 75 | 72 / 45 |
| knowledge | 120 / 120 | 72 / 72 |

Case counts are nominal entries. Positive controls repeat across families, with consistent labels and shared recordings. Every held-out candidate input is new relative to hard.

## Task completion with equal evidence

The 06:30 cutoff limits additional matching-receipt comparison to 0 common observed cases. Pooled receipt counts use only that same subset for every contestant. Full baseline results and the incomplete candidate recording remain preserved.

The additional receipt baseline is shipped 120/120 and default 118/120 over 90 distinct inputs. One default case is a completed-task miss; another is unparsed at the cutoff. Additional receipt candidate scoring is unrun.

| Task evidence | Shipped (95% CI) | Candidate (95% CI) | Default (95% CI) | Default passes completed / fails incomplete | Default at threshold 1 |
|---|---|---|---|---|---|
| Hard conversation | 118/120 (94.13 to 99.54%; 90 distinct inputs) | 120/120 (96.9 to 100%; 90 distinct inputs) | 91/120 (67.45 to 82.61%; 90 distinct inputs) | 32/60 / 59/60 | 68/120 |
| Hard matching receipt | 120/120 (96.9 to 100%; 90 distinct inputs) | 120/120 (96.9 to 100%; 90 distinct inputs) | 119/120 (95.43 to 99.85%; 90 distinct inputs) | 60/60 / 59/60 | 87/120 |
| Held-out conversation | 72/72 (94.93 to 100%; 54 distinct inputs) | 69/72 (88.45 to 98.57%; 54 distinct inputs) | 44/72 (49.56 to 71.53%; 54 distinct inputs) | 9/36 / 35/36 | 36/72 |
| Held-out matching receipt | 72/72 (94.93 to 100%; 54 distinct inputs) | 71/72 (92.54 to 99.75%; 54 distinct inputs) | 72/72 (94.93 to 100%; 54 distinct inputs) | 36/36 / 36/36 | 36/72 |
| Additional conversation | 120/120 (96.9 to 100%; 90 distinct inputs) | 113/120 (88.45 to 97.15%; 90 distinct inputs) | 86/120 (63.03 to 78.96%; 90 distinct inputs) | 26/60 / 60/60 | 60/120 |
| Additional matching receipt | not measured (0 distinct inputs) | not measured (0 distinct inputs) | not measured (0 distinct inputs) | not measured | not measured |
| Pooled conversation | 192/192 (98.04 to 100.0%; 144 distinct inputs) | 182/192 (90.68 to 97.15%; 144 distinct inputs) | 130/192 (60.8 to 73.92%; 144 distinct inputs) | 35/96 / 95/96 | 96/192 |
| Pooled matching receipt | 72/72 (94.93 to 100%; 54 distinct inputs) | 71/72 (92.54 to 99.75%; 54 distinct inputs) | 72/72 (94.93 to 100%; 54 distinct inputs) | 36/36 / 36/36 | 36/72 |

| Additional receipt baseline | Shipped | Default | Candidate |
|---|---|---|---|
| All available baseline cases | 120/120 (96.9 to 100%; 90 distinct inputs) | 118/120 (94.13 to 99.54%; 90 distinct inputs) | See common-subset table above |

Native completed-task passes on hard: 32/60 without receipts, 60/60 with receipts. Accuracy gains/losses: 29/1; paired p=5.7742e-08.
Native completed-task passes on held-out: 9/36 without receipts, 36/36 with receipts. Accuracy gains/losses: 28/0; paired p=7.45058e-09.
No common observed cases for the additional receipt comparison before the cutoff.
Native completed-task passes on pooled: 9/36 without receipts, 36/36 with receipts. Accuracy gains/losses: 28/0; paired p=7.45058e-09.

On original held-out matching receipts, shipped and default both score 72/72; candidate scores 71/72 because one completed transfer fails its extra target-name requirement.
The conversations and labels remain unchanged. Both sides receive a matching fictional tool receipt for the reported result.
The receipt copies result text without reading labels. Pending, drafted and incomplete results remain so. No real action executes.
The shipped judge sees a tool call and result, the candidate sees the identical receipt object, and the default receives native tools_called.
Without receipts, the native task judge can reject claimed completion because no tool proves it. This is an evidence-policy mismatch.

## Corpus versions and shared parsing

| Row | Original v1 shipped / candidate / default | Corrected v2 shipped / candidate / default | Clarified v3 shipped / candidate / default |
|---|---|---|---|
| turn relevancy | 99 / 120 / 62 of 120 | 99 / 120 / 62 of 120 | 99 / 120 / 62 of 120 |
| G-Eval strict | 99 / 120 / 119 of 120 | 99 / 120 / 119 of 120 | 99 / 120 / 119 of 120 |
| DAG | 99 / 120 / 114 of 120 | 99 / 120 / 114 of 120 | 99 / 120 / 114 of 120 |
| role adherence | 113 / 113 / 78 of 120 | 118 / 118 / 98 of 120 | 118 / 118 / 98 of 120 |
| conversation completeness | 115 / 120 / 76 of 120 | 115 / 120 / 76 of 120 | 115 / 120 / 76 of 120 |
| task completion | 118 / 120 / 91 of 120 | 118 / 120 / 91 of 120 | 118 / 120 / 91 of 120 |
| hallucination | 120 / 115 / 60 of 120 | 120 / 115 / 60 of 120 | 119 / 120 / 60 of 120 |
| faithfulness | 120 / 115 / 60 of 120 | 120 / 115 / 60 of 120 | 119 / 120 / 60 of 120 |
| knowledge retention | 110 / 120 / 115 of 120 | 110 / 120 / 115 of 120 | 110 / 120 / 115 of 120 |

Original v1 remains preserved. Corrected v2 changes only 60 role user contexts to include the unrelated request their replies address.
Clarified v3 also corrects grounding sources: both labels in the negation family explicitly exclude all included routers and discounts, and source text records lead-reference ownership.
V2 positive replies broadened no loyalty discount and no free router into no router or discount. The candidate is right to flag that broader claim, despite the original positive construction label.
The owner approves source clarification with labels and replies unchanged. The unrun held-out set is regenerated with the same seed before its first call.
All versions and their recordings remain available. The source changes are recorded in corpus-history.json.
Six original candidate knowledge answers invent an operator identifier absent from the supplied conversations. Public copies replace it with [redacted-operator-email].
Private originals remain outside the repository. Labels and scores remain unchanged. Recording chunks are lossless and smaller than 8 MiB.
Those invented details remain model errors. Correct classification does not establish faithful evidence.
Additional held-out answers with operator identifiers redacted: 2.
A shared parser wraps valid singleton verdict and check objects into lists. It changes no decision and applies to every contestant.
The role default template shows a singleton object despite declaring a list. Raw pre-normalization results remain in baseline-v1-first.json.

## Policies and historical limits

Default thresholds remain 0.5. Some metrics accept partial completion or partial agreement; our criterion requires every active request or claim.
Hallucination tests contradictions, and faithfulness permits unsupported claims as borderline. These policy differences affect the measured scores.
The native role judge can reject an in-role disclaimer for not helping choose a plan. Our role criterion tests boundaries and permits plain in-role statements.
Threshold-1 counts reuse native scores without another model call. They are a sensitivity check, not the default contestant.
The inherited manual faithfulness runner discards the native claims object and omits truth extraction and guidance. Its historical result is not native-quality evidence.
The inherited hallucination calculation uses the older contradiction direction. This pinned native metric scores agreement, where higher is better.
G-Eval keeps the inherited strict steps. DAG keeps the inherited one-node graph. Reason-only extra calls are disabled; decision prompts stay unchanged.
Both sides use CLI JSON output instead of the native OpenAI structured-output transport. The default OpenAI judge model is not compared.
The generated families do not establish performance on unseen real customer language. No repeated-sample variance is measured.
The held-out candidate misses three positive callback cases because it demands a literal number, while the construction accepts the relative identification the number you supplied.
One check notes that no supplied number occurs in the transcript. This interpretation limit is retained in the labels and scores; no held-out answer tunes the candidate.
The original held-out task candidate rejects three completed cases because the result sentence does not repeat the target name already supplied by user context. These errors remain unrepaired.
The candidate also regresses against the shipped role judge, 69/72 versus 72/72. Two invalid check envelopes and an extra price-source requirement remain unrepaired.

## Reproduce from recordings

From the repository root, install the pinned Python dependency and run without --record. Missing recordings stop without billing.

```sh
python3 -m venv .venv
.venv/bin/pip install deepeval==4.2.8
.venv/bin/python comparisons/deepeval/hard/run.py --corpus v3 --tag replay-v3
.venv/bin/python comparisons/deepeval/hard/run.py --corpus v3 --variant audit --tag replay-audit-v3
.venv/bin/python comparisons/deepeval/hard/run.py --corpus heldout --tag replay-heldout
.venv/bin/python comparisons/deepeval/hard/run.py --corpus heldout --variant audit --tag replay-audit-heldout
.venv/bin/python comparisons/deepeval/hard/run-additional.py --tag replay-additional
.venv/bin/python comparisons/deepeval/hard/run-additional.py --variant audit --tag replay-additional-audit
python3 comparisons/deepeval/hard/score.py comparisons/deepeval/hard/audit-v3.json
python3 comparisons/deepeval/hard/score.py comparisons/deepeval/hard/audit-heldout.json
.venv/bin/python comparisons/deepeval/hard/run.py --sets task --evidence receipt --tag replay-task-receipts
.venv/bin/python comparisons/deepeval/hard/run.py --corpus heldout --sets task --evidence receipt --tag replay-task-receipts-heldout
pnpm exec vitest run --config comparisons/deepeval/hard/vitest.config.ts --maxWorkers=2
```

Evidence, generators, candidate source, source hashes and per-corpus replay commands are in `comparisons/deepeval/hard/README.md`.
The older 100-case results remain in `comparisons/deepeval/results/tally-haiku-final.md`. They are historical measurements, not the hardened baseline.
