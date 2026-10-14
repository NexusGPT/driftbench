# LongJudgeBench writing preference: driftbench against every peer

Model: claude-haiku-5-5 for every contestant. Unit: game. driftbench and promptfoo rows are the recorded ledger cells; peer rows are new runs on the same sealed items. Rows marked "pointwise grader, higher score wins" score each reply alone with that tool's pointwise grader; the tool has no pairwise grader.

| Contestant | Grader | Score | driftbench minus this | driftbench wins / losses | Exact p | Holm p | Missing | Grader errors | USD |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| driftbench | recorded cell | 61.27% (212/346) |  |  |  |  | 0 |  |  |
| promptfoo | recorded cell | 56.94% (197/346) | +4.34 pts | 49 / 34 | 0.124 | 0.867 | 0 |  |  |
| driftbench-reader-first | recorded cell | 67.63% (234/346) | -6.36 pts | 60 / 82 | 0.0777 |  | 0 |  |  |
| deepeval | ArenaGEval (DeepEval 4.2.8) | 58.38% (202/346) | +2.89 pts | 46 / 36 | 0.32 | 1 | 0 | 0 | 0.4740 |
| inspect | model_graded_qa (inspect_ai 0.3.278), pointwise grader, higher score wins | 11.56% (40/346) | +49.71 pts | 178 / 6 | 4.19e-45 | 9.63e-44 | 0 | 0 | 0.3847 |
| langfuse | Answer Critic (Langfuse 64ba74f9), pointwise grader, higher score wins | 14.45% (50/346) | +46.82 pts | 172 / 10 | 2.96e-39 | 6.51e-38 | 0 | 0 | 0.2047 |
| langwatch | Comparison, swap and reconcile (LangWatch e683dd9e) | 52.60% (182/346) | +8.67 pts | 42 / 12 | 5.21e-05 | 0.000677 | 0 | 0 | 0.3089 |

