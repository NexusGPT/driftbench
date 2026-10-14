# Verify: corrected v5 confirmation and historical comparison

## Primary v5 result

The verify candidate's primary result uses the 536 confirmation items whose normalized question text appears
in neither practice nor DEV. The original 544-item split leaked 8 practice questions and reused 32 practice
call references. The frozen manifest and decisions are preserved; the full result is a sensitivity analysis.
Scores are percent correct.

| Verify v5 analysis | driftbench-v5 | promptfoo | DeepEval | Inspect | Langfuse | LangWatch |
|---|---:|---:|---:|---:|---:|---:|
| Primary, 536 items without practice/DEV question overlap | 78.73 | 76.87 | 60.26 | 76.49 | 75.75 | 75.19 |
| Sensitivity, original 544 items including overlap | 78.86 | 77.21 | 60.85 | 76.84 | 75.92 | 75.18 |
| LJB TEST, 221 items | 76.02 | 75.57 | 58.82 | 73.30 | 75.11 | 73.30 |

Each row gives v5 one significant win over DeepEval and four ties after exact paired tests with Holm over
five peers. These are separate analyses from the historical 25-comparison table below. The exclusion is a
post-review correction using recorded decisions, with no new model calls. [Full results and exclusions](../../../examples/verify-lead/RESULTS.md).

## Historical LongJudgeBench comparison (PR 351)

Model: claude-haiku-5-5 for every contestant. Unit: item. driftbench and promptfoo rows are the recorded ledger cells; peer rows are new runs on the same sealed items. Rows marked "pointwise grader, higher score wins" score each reply alone with that tool's pointwise grader; the tool has no pairwise grader.

| Contestant | Grader | Score | driftbench minus this | driftbench wins / losses | Exact p | Holm p | Missing | Grader errors | USD |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| driftbench | recorded cell | 74.21% (164/221) |  |  |  |  | 0 |  |  |
| promptfoo | recorded cell | 71.95% (159/221) | +2.26 pts | 19 / 14 | 0.487 | 1 | 0 |  |  |
| deepeval | GEval, threshold 0.5 (DeepEval 4.2.8) | 58.82% (130/221) | +15.38 pts | 44 / 10 | 3.39e-06 | 5.08e-05 | 0 | 30 | 0.2641 |
| inspect | model_graded_qa (inspect_ai 0.3.278) | 73.30% (162/221) | +0.90 pts | 17 / 15 | 0.86 | 1 | 0 | 0 | 0.3456 |
| langfuse | Answer Critic (Langfuse 64ba74f9) | 75.11% (166/221) | -0.90 pts | 13 / 15 | 0.851 | 1 | 0 | 0 | 0.2605 |
| langwatch | LLM-as-a-Judge Boolean (LangWatch e683dd9e) | 73.30% (162/221) | +0.90 pts | 16 / 14 | 0.856 | 1 | 0 | 0 | 0.2842 |

