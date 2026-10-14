# RubricBench: driftbench against every peer

Model: claude-haiku-5-5 for every contestant. Unit: game. driftbench and promptfoo rows are the recorded ledger cells; peer rows are new runs on the same sealed items. Rows marked "pointwise grader, higher score wins" score each reply alone with that tool's pointwise grader; the tool has no pairwise grader.

Note: a few items stay undecided after three passes because the model refused them (an acceptable-use refusal on biology content). They count as wrong for the contestant, as the recorded driftbench cell does.

| Contestant | Grader | Score | driftbench minus this | driftbench wins / losses | Exact p | Holm p | Missing | Grader errors | USD |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| driftbench | recorded cell | 82.66% (1306/1580) |  |  |  |  | 0 |  |  |
| promptfoo | recorded cell | 75.57% (1194/1580) | +7.09 pts | 221 / 109 | 6.88e-10 | 1.24e-08 | 0 |  |  |
| deepeval | ArenaGEval (DeepEval 4.2.8) | 77.59% (1226/1580) | +5.06 pts | 191 / 111 | 4.85e-06 | 6.79e-05 | 1 | 0 | 1.3583 |
| inspect | model_graded_qa (inspect_ai 0.3.278), pointwise grader, higher score wins | 26.58% (420/1580) | +56.08 pts | 898 / 12 | 1.47e-247 | 3.66e-246 | 0 | 0 | 1.3377 |
| langfuse | Answer Critic (Langfuse 64ba74f9), pointwise grader, higher score wins | 25.06% (396/1580) | +57.59 pts | 930 / 20 | 2.59e-245 | 6.21e-244 | 1 | 10 | 0.8805 |
| langwatch | Comparison, swap and reconcile (LangWatch e683dd9e) | 74.94% (1184/1580) | +7.72 pts | 188 / 66 | 9.45e-15 | 1.8e-13 | 0 | 4 | 1.0240 |

