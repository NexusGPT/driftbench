# Fresh held-out run, frozen at ec68f96f

Model on every side: claude-haiku-5-5 through `claude -p`, same flags. An unscored or incomplete case counts as wrong.

| Row | Procedure | Correct | 95% interval | Unscored | Calls | USD per 100 cases |
|---|---|---|---|---|---|---|
| Grader panel | driftbench answer-audit (opt-in, this PR) | 60/60 | 94.0% to 100.0% | 0 | 180 | 0.18327 |
| Grader panel | driftbench default | 55/60 | 81.9% to 96.4% | 2 | 183 | 0.12375 |
| Grader panel | Inspect default | 59/60 | 91.1% to 99.7% | 0 | 180 | 0.13166 |
| Model-graded QA | driftbench answer-audit (opt-in, this PR) | 60/60 | 94.0% to 100.0% | 0 | 60 | 0.07581 |
| Model-graded QA | driftbench default | 59/60 | 91.1% to 99.7% | 0 | 60 | 0.06423 |
| Model-graded QA | Inspect default | 57/60 | 86.3% to 98.3% | 0 | 60 | 0.06158 |
| Model-graded fact | driftbench answer-audit (opt-in, this PR) | 60/60 | 94.0% to 100.0% | 0 | 60 | 0.06863 |
| Model-graded fact | driftbench default | 59/60 | 91.1% to 99.7% | 0 | 60 | 0.06423 |
| Model-graded fact | Inspect default | 58/60 | 88.6% to 99.1% | 0 | 60 | 0.05696 |
| Panel, borderline | driftbench answer-audit (opt-in, this PR) | 60/60 | 94.0% to 100.0% | 0 | 180 | 0.17487 |
| Panel, borderline | driftbench default | 60/60 | 94.0% to 100.0% | 0 | 180 | 0.11782 |
| Panel, borderline | Inspect default | 60/60 | 94.0% to 100.0% | 0 | 180 | 0.12079 |

## Paired tests

Exact two-sided McNemar test on the same cases. "Only ours" counts cases the driftbench procedure gets right and Inspect gets wrong.

| Row | Procedure against Inspect | Only ours | Only Inspect | p |
|---|---|---|---|---|
| Grader panel | driftbench answer-audit (opt-in, this PR) | 1 | 0 | 1.0000 |
| Grader panel | driftbench default | 1 | 5 | 0.2188 |
| Model-graded QA | driftbench answer-audit (opt-in, this PR) | 3 | 0 | 0.2500 |
| Model-graded QA | driftbench default | 2 | 0 | 0.5000 |
| Model-graded fact | driftbench answer-audit (opt-in, this PR) | 2 | 0 | 0.5000 |
| Model-graded fact | driftbench default | 1 | 0 | 1.0000 |
| Panel, borderline | driftbench answer-audit (opt-in, this PR) | 0 | 0 | 1.0000 |
| Panel, borderline | driftbench default | 0 | 0 | 1.0000 |

## Pooled over the four rows

All rows together, paired by case. Exact two-sided McNemar test against Inspect.

| Procedure | Correct | Only ours | Only Inspect | p |
|---|---|---|---|---|
| driftbench answer-audit (opt-in, this PR) | 240/240 against 234/240 | 6 | 0 | 0.0313 |
| driftbench default | 233/240 against 234/240 | 4 | 5 | 1.0000 |
