model haiku
| row | n | ours (CI) | theirs (CI) | ours-only right | theirs-only right | exact p | undecided ours/theirs |
|---|---|---|---|---|---|---|---|
| hard: turn relevancy | 100 | 97/100 (CI 92-99) | 51/100 (CI 41-61) | 46 | 0 | 0.0 | 0/0 |
| hard: G-Eval strict | 100 | 97/100 (CI 92-99) | 100/100 (CI 96-100) | 0 | 3 | 0.25 | 0/0 |
| hard: DAG | 100 | 97/100 (CI 92-99) | 99/100 (CI 95-100) | 1 | 3 | 0.625 | 0/0 |
| held-out: turn relevancy | 100 | 97/100 (CI 92-99) | 52/100 (CI 42-62) | 45 | 0 | 0.0 | 0/0 |
| held-out: G-Eval strict | 100 | 97/100 (CI 92-99) | 100/100 (CI 96-100) | 0 | 3 | 0.25 | 0/0 |
| held-out: DAG | 100 | 97/100 (CI 92-99) | 98/100 (CI 93-99) | 1 | 2 | 1.0 | 0/0 |
| held-out, variant rubric: vs G-Eval strict | 100 | 96/100 (CI 90-98) | 100/100 (CI 96-100) | 0 | 4 | 0.125 | 0/0 |
| held-out, variant rubric: vs DAG | 100 | 96/100 (CI 90-98) | 98/100 (CI 93-99) | 1 | 3 | 0.625 | 0/0 |

model sonnet
| row | n | ours (CI) | theirs (CI) | ours-only right | theirs-only right | exact p | undecided ours/theirs |
|---|---|---|---|---|---|---|---|
| hard: turn relevancy | 100 | 96/100 (CI 90-98) | 51/100 (CI 41-61) | 45 | 0 | 0.0 | 0/0 |
| hard: G-Eval strict | 100 | 96/100 (CI 90-98) | 95/100 (CI 89-98) | 5 | 4 | 1.0 | 0/0 |
| hard: DAG | 100 | 96/100 (CI 90-98) | 97/100 (CI 92-99) | 1 | 2 | 1.0 | 0/0 |
| held-out: turn relevancy | 100 | 97/100 (CI 92-99) | 51/100 (CI 41-61) | 46 | 0 | 0.0 | 0/0 |
| held-out: G-Eval strict | 100 | 97/100 (CI 92-99) | 97/100 (CI 92-99) | 3 | 3 | 1.0 | 0/0 |
| held-out: DAG | 100 | 97/100 (CI 92-99) | 96/100 (CI 90-98) | 3 | 2 | 1.0 | 0/0 |
| held-out, variant rubric: vs G-Eval strict | 100 | 100/100 (CI 96-100) | 97/100 (CI 92-99) | 3 | 0 | 0.25 | 0/0 |
| held-out, variant rubric: vs DAG | 100 | 100/100 (CI 96-100) | 96/100 (CI 90-98) | 4 | 0 | 0.125 | 0/0 |
