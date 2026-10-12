model sonnet  source results/sonnet-merged.json
| row | n | ours | theirs | ours-only right | theirs-only right | exact p | undecided ours/theirs |
|---|---|---|---|---|---|---|---|
| turn relevancy | 100 | 99/100 (CI 95-100) | 96/100 (CI 90-98) | 3 | 0 | 0.25 | 0/0 |
| G-Eval strict | 100 | 99/100 (CI 95-100) | 100/100 (CI 96-100) | 0 | 1 | 1.0 | 0/0 |
| DAG | 100 | 99/100 (CI 95-100) | 100/100 (CI 96-100) | 0 | 1 | 1.0 | 0/0 |
| role adherence | 100 | 100/100 (CI 96-100) | 73/100 (CI 64-81) | 27 | 0 | 0.0 | 0/0 |
| conversation completeness | 100 | 100/100 (CI 96-100) | 75/100 (CI 66-82) | 25 | 0 | 0.0 | 0/0 |
| task completion | 100 | 100/100 (CI 96-100) | 42/100 (CI 33-52) | 58 | 0 | 0.0 | 0/0 |
| hallucination | 100 | 100/100 (CI 96-100) | 49/100 (CI 39-59) | 51 | 0 | 0.0 | 0/0 |
| faithfulness | 100 | 100/100 (CI 96-100) | 50/100 (CI 40-60) | 50 | 0 | 0.0 | 0/0 |
| knowledge retention, judged | 100 | 92/100 (CI 85-96) | 83/100 (CI 74-89) | 9 | 0 | 0.0039 | 0/0 |
| knowledge retention, judged (hard set) | 100 | 96/100 (CI 90-98) | 87/100 (CI 79-92) | 13 | 4 | 0.049 | 0/0 |
| tool calls, default (params) | 100 | 100/100 (CI 96-100) | 55/100 (CI 45-64) | 45 | 0 | 0.0 | 0/0 |
| tool calls, default (no params) | 100 | 100/100 (CI 96-100) | 55/100 (CI 45-64) | 45 | 0 | 0.0 | 0/0 |
| tool calls, exact order | 100 | 100/100 (CI 96-100) | 100/100 (CI 96-100) | 0 | 0 | 1.0 | 0/0 |
