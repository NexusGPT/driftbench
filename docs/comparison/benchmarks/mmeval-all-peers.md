# MM-Eval: driftbench against every peer

Model: claude-haiku-5-5 for every contestant. Unit: item, macro over five subsets. driftbench and promptfoo rows are the recorded ledger cells; peer rows are new runs on the same sealed items. Rows marked "pointwise grader, higher score wins" score each reply alone with that tool's pointwise grader; the tool has no pairwise grader.

Note: a few items stay undecided after three passes because the model refused them (an acceptable-use refusal on biology content). They count as wrong for the contestant, as the recorded driftbench cell does.

## Cohort: primary

| Contestant | Grader | Score | driftbench minus this | driftbench wins / losses | Exact p | Holm p | Missing | Grader errors | USD |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| driftbench | recorded cell | 88.86% (n=591) |  |  |  |  | 0 |  |  |
| promptfoo | recorded cell | 86.45% (n=591) | +2.41 pts | 71 / 35 | 0.000606 | 0.00606 | 0 |  |  |
| deepeval | ArenaGEval (DeepEval 4.2.8) | 84.09% (n=591) | +4.77 pts | 83 / 30 | 6.31e-07 | 1.01e-05 | 3 | 0 | 1.0437 |
| inspect | model_graded_qa (inspect_ai 0.3.278), pointwise grader, higher score wins | 75.36% (n=591) | +13.51 pts | 202 / 47 | 4.48e-24 | 8.96e-23 | 7 | 0 | 0.8229 |
| langfuse | Answer Critic (Langfuse 64ba74f9), pointwise grader, higher score wins | 73.45% (n=591) | +15.41 pts | 218 / 43 | 2.34e-29 | 4.92e-28 | 6 | 2 | 0.4622 |
| langwatch | Comparison, swap and reconcile (LangWatch e683dd9e) | 83.87% (n=591) | +4.99 pts | 47 / 15 | 5.78e-05 | 0.000693 | 7 | 2 | 0.6708 |

## Cohort: all

| Contestant | Grader | Score | driftbench minus this | driftbench wins / losses | Exact p | Holm p | Missing | Grader errors | USD |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| driftbench | recorded cell | 87.67% (n=600) |  |  |  |  | 0 |  |  |
| promptfoo | recorded cell | 85.50% (n=600) | +2.17 pts | 71 / 37 | 0.00138 |  | 0 |  |  |
| deepeval | ArenaGEval (DeepEval 4.2.8) | 83.92% (n=600) | +3.75 pts | 83 / 36 | 1.96e-05 |  | 3 | 0 | 1.0437 |
| inspect | model_graded_qa (inspect_ai 0.3.278), pointwise grader, higher score wins | 74.67% (n=600) | +13.00 pts | 202 / 50 | 7.68e-23 |  | 7 | 0 | 0.8229 |
| langfuse | Answer Critic (Langfuse 64ba74f9), pointwise grader, higher score wins | 72.75% (n=600) | +14.92 pts | 218 / 46 | 5.94e-28 |  | 6 | 2 | 0.4622 |
| langwatch | Comparison, swap and reconcile (LangWatch e683dd9e) | 83.00% (n=600) | +4.67 pts | 47 / 17 | 0.000227 |  | 7 | 2 | 0.6708 |

