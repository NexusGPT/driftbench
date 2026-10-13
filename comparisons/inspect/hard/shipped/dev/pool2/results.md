# Development pool 2: the scoped sets

Model on every side: claude-haiku-5-5 through `claude -p`, same flags. An unscored or incomplete case counts as wrong.

| Row | Procedure | Correct | 95% interval | Unscored | Calls | USD per 100 cases |
|---|---|---|---|---|---|---|
| Grader panel | driftbench answer-audit (opt-in, this PR) | 60/60 | 94.0% to 100.0% | 0 | 182 | 0.18106 |
| Grader panel | Inspect default | 59/60 | 91.1% to 99.7% | 0 | 180 | 0.13544 |
| Model-graded QA | driftbench answer-audit (opt-in, this PR) | 60/60 | 94.0% to 100.0% | 0 | 60 | 0.07510 |
| Model-graded QA | Inspect default | 57/60 | 86.3% to 98.3% | 0 | 60 | 0.06237 |
| Model-graded fact | driftbench answer-audit (opt-in, this PR) | 60/60 | 94.0% to 100.0% | 0 | 60 | 0.06931 |
| Model-graded fact | Inspect default | 60/60 | 94.0% to 100.0% | 0 | 60 | 0.05901 |
| Panel, borderline | driftbench answer-audit (opt-in, this PR) | 60/60 | 94.0% to 100.0% | 0 | 180 | 0.18070 |
| Panel, borderline | Inspect default | 60/60 | 94.0% to 100.0% | 0 | 180 | 0.12418 |

## Paired tests

Exact two-sided McNemar test on the same cases. "Only ours" counts cases the driftbench procedure gets right and Inspect gets wrong.

| Row | Procedure against Inspect | Only ours | Only Inspect | p |
|---|---|---|---|---|
| Grader panel | driftbench answer-audit (opt-in, this PR) | 1 | 0 | 1.0000 |
| Model-graded QA | driftbench answer-audit (opt-in, this PR) | 3 | 0 | 0.2500 |
| Model-graded fact | driftbench answer-audit (opt-in, this PR) | 0 | 0 | 1.0000 |
| Panel, borderline | driftbench answer-audit (opt-in, this PR) | 0 | 0 | 1.0000 |

## Pooled over the four rows

All rows together, paired by case. Exact two-sided McNemar test against Inspect.

| Procedure | Correct | Only ours | Only Inspect | p |
|---|---|---|---|---|
| driftbench answer-audit (opt-in, this PR) | 240/240 against 236/240 | 4 | 0 | 0.1250 |
