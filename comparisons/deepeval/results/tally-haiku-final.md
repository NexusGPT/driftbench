model haiku  source results/haiku-cassette.json
| row | n | ours | theirs | ours-only right | theirs-only right | exact p | undecided ours/theirs |
|---|---|---|---|---|---|---|---|
| turn relevancy | 100 | 96/100 (CI 90-98) | 81/100 (CI 72-87) | 16 | 1 | 0.0003 | 0/0 |
| G-Eval strict | 100 | 96/100 (CI 90-98) | 95/100 (CI 89-98) | 4 | 3 | 1.0 | 0/3 |
| DAG | 100 | 96/100 (CI 90-98) | 94/100 (CI 88-97) | 2 | 0 | 0.5 | 0/0 |
| role adherence | 100 | 100/100 (CI 96-100) | 74/100 (CI 65-82) | 26 | 0 | 0.0 | 0/0 |
| conversation completeness | 100 | 96/100 (CI 90-98) | 79/100 (CI 70-86) | 21 | 4 | 0.0009 | 0/0 |
| task completion | 100 | 100/100 (CI 96-100) | 63/100 (CI 53-72) | 37 | 0 | 0.0 | 0/0 |
| hallucination | 100 | 100/100 (CI 96-100) | 53/100 (CI 43-62) | 47 | 0 | 0.0 | 0/0 |
| faithfulness | 100 | 100/100 (CI 96-100) | 50/100 (CI 40-60) | 50 | 0 | 0.0 | 0/0 |
| knowledge retention, judged | 100 | 91/100 (CI 84-95) | 90/100 (CI 83-94) | 10 | 9 | 1.0 | 0/0 |
| knowledge retention, judged (hard set) | 100 | 92/100 (CI 85-96) | 87/100 (CI 79-92) | 13 | 8 | 0.3833 | 0/0 |
| tool calls, default (params) | 100 | 100/100 (CI 96-100) | 55/100 (CI 45-64) | 45 | 0 | 0.0 | 0/0 |
| tool calls, default (no params) | 100 | 100/100 (CI 96-100) | 55/100 (CI 45-64) | 45 | 0 | 0.0 | 0/0 |
| tool calls, exact order | 100 | 100/100 (CI 96-100) | 100/100 (CI 96-100) | 0 | 0 | 1.0 | 0/0 |
