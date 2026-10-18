# JudgeBench: driftbench against every peer

Model: claude-haiku-5-5 for every contestant. Unit: pair (official pair-net). driftbench and promptfoo rows are the recorded ledger cells; peer rows are new runs on the same sealed items. Rows marked "pointwise grader, higher score wins" score each reply alone with that tool's pointwise grader; the tool has no pairwise grader.

| Contestant | Grader | Score | driftbench minus this | driftbench wins / losses | Exact p | Holm p | Missing | Grader errors | USD |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| driftbench | recorded cell | 88.89% (240/270) |  |  |  |  | 0 |  |  |
| promptfoo | recorded cell | 82.96% (224/270) | +5.93 pts | 27 / 11 | 0.0139 | 0.125 | 0 |  |  |
| deepeval | ArenaGEval (DeepEval 4.2.8) | 86.30% (233/270) | +2.59 pts | 15 / 8 | 0.21 | 1 | 0 | 0 | 0.4575 |
| inspect | model_graded_qa (inspect_ai 0.3.278), pointwise grader, higher score wins | 80.00% (216/270) | +8.89 pts | 31 / 7 | 0.000116 | 0.00128 | 0 | 0 | 0.5264 |
| langfuse | Answer Critic (Langfuse 64ba74f9), pointwise grader, higher score wins | 74.81% (202/270) | +14.07 pts | 47 / 9 | 2.57e-07 | 4.37e-06 | 0 | 0 | 0.3638 |
| langwatch | Comparison, swap and reconcile (LangWatch e683dd9e) | 83.70% (226/270) | +5.19 pts | 23 / 9 | 0.0201 | 0.16 | 0 | 2 | 0.4228 |

