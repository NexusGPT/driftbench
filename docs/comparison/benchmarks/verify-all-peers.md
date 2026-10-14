# LongJudgeBench verify: driftbench against every peer

Model: claude-haiku-5-5 for every contestant. Unit: item. driftbench and promptfoo rows are the recorded ledger cells; peer rows are new runs on the same sealed items. Rows marked "pointwise grader, higher score wins" score each reply alone with that tool's pointwise grader; the tool has no pairwise grader.

| Contestant | Grader | Score | driftbench minus this | driftbench wins / losses | Exact p | Holm p | Missing | Grader errors | USD |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| driftbench | recorded cell | 74.21% (164/221) |  |  |  |  | 0 |  |  |
| promptfoo | recorded cell | 71.95% (159/221) | +2.26 pts | 19 / 14 | 0.487 | 1 | 0 |  |  |
| deepeval | GEval, threshold 0.5 (DeepEval 4.2.8) | 58.82% (130/221) | +15.38 pts | 44 / 10 | 3.39e-06 | 5.08e-05 | 0 | 30 | 0.2641 |
| inspect | model_graded_qa (inspect_ai 0.3.278) | 73.30% (162/221) | +0.90 pts | 17 / 15 | 0.86 | 1 | 0 | 0 | 0.3456 |
| langfuse | Answer Critic (Langfuse 64ba74f9) | 75.11% (166/221) | -0.90 pts | 13 / 15 | 0.851 | 1 | 0 | 0 | 0.2605 |
| langwatch | LLM-as-a-Judge Boolean (LangWatch e683dd9e) | 73.30% (162/221) | +0.90 pts | 16 / 14 | 0.856 | 1 | 0 | 0 | 0.2842 |

