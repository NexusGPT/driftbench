## Fresh results and measured follow-up overhead

Percentages use both orders. MM macro-averages five categories; writing uses directional exact matches. W/L/T compare unique paired scores against same-model promptfoo.

| Model / benchmark | N | No follow-up | Follow-up | Promptfoo | W | L | T | Exact p |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| gpt-6.1-sol/mm | 92 | 84.000% | 85.667% | 94.333% | 0 | 6 | 86 | 0.03125 |
| gpt-6.1-sol/wp | 80 | 47.500% | 56.250% | 56.250% | 6 | 4 | 70 | 0.753906 |
| gpt-6-luna/mm | 92 | 90.333% | 91.333% | 93.000% | 6 | 5 | 81 | 1 |
| gpt-6-luna/wp | 80 | 61.250% | 61.250% | 62.500% | 11 | 12 | 57 | 1 |
| gemini-3.5-flash-lite/mm | 92 | 82.500% | 83.667% | 85.667% | 7 | 8 | 77 | 1 |
| gemini-3.5-flash-lite/wp | 80 | 68.750% | 73.750% | 66.875% | 24 | 12 | 44 | 0.0652453 |
| claude-haiku-5-5/wp | 50 | 64.000% | 68.000% | 66.000% | 11 | 8 | 31 | 0.647606 |

| Model / benchmark | Ledger ties | Correct resolutions | Extra calls | Extra calls / 100 pairs | Extra USD / 100 pairs |
|---|---:|---:|---:|---:|---:|
| gpt-6.1-sol/mm | 2 | 2 | 2 | 2.17 | 0.010883 |
| gpt-6.1-sol/wp | 14 | 7 | 14 | 17.50 | 0.143178 |
| gpt-6-luna/mm | 2 | 2 | 2 | 2.17 | 0.000664 |
| gpt-6-luna/wp | 0 | 0 | 0 | 0.00 | 0.000000 |
| gemini-3.5-flash-lite/mm | 5 | 4 | 5 | 5.43 | 0.007872 |
| gemini-3.5-flash-lite/wp | 8 | 4 | 8 | 10.00 | 0.014680 |
| claude-haiku-5-5/wp | 2 | 2 | 2 | 4.00 | 0.003443 |

Costs above are the measured marginal follow-up cost, excluding baseline and promptfoo calls. All 33 final ledger ties receive exactly one follow-up; 21 resolve correctly.
Total provider/CLI-reported cost: USD 11.41716177, plus USD 0.162354 held for two unanswered attempts; USD 11.57951577 against the USD 40 cap. Haiku uses 202/400 CLI calls. Supervisor PID 49521 has exited.

MM safety follow-up / promptfoo: Sol 70% / 80%; Luna 90% / 97.5%; Gemini 60% / 67.5%.
No fresh JudgeBench pool remains. The [full results](RESULTS.md) include the frozen hash, dev tables, exact-test power, prompt-clustering limits and receipt audit. The option remains off by default.
