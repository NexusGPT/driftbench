# Development pool 1: the earlier held-out sets, seed 20261013

Model on every side: claude-haiku-5-5 through `claude -p`, same flags. An unscored or incomplete case counts as wrong.

| Row | Procedure | Correct | 95% interval | Unscored | Calls | USD per 100 cases |
|---|---|---|---|---|---|---|
| Grader panel | driftbench answer-audit (opt-in, this PR) | 60/60 | 94.0% to 100.0% | 0 | 185 | 0.18996 |
| Grader panel | driftbench default | 57/60 | 86.3% to 98.3% | 2 | 190 | 0.13013 |
| Grader panel | Inspect default | 59/60 | 91.1% to 99.7% | 0 | 180 | 0.13815 |
| Model-graded QA | driftbench answer-audit (opt-in, this PR) | 60/60 | 94.0% to 100.0% | 0 | 60 | 0.07386 |
| Model-graded QA | driftbench default | 58/60 | 88.6% to 99.1% | 1 | 60 | 0.06130 |
| Model-graded QA | Inspect default | 57/60 | 86.3% to 98.3% | 0 | 60 | 0.06229 |
| Model-graded fact | driftbench answer-audit (opt-in, this PR) | 60/60 | 94.0% to 100.0% | 0 | 60 | 0.06830 |
| Model-graded fact | driftbench default | 58/60 | 88.6% to 99.1% | 1 | 60 | 0.06130 |
| Model-graded fact | Inspect default | 59/60 | 91.1% to 99.7% | 0 | 60 | 0.05958 |
| Panel, borderline | driftbench answer-audit (opt-in, this PR) | 60/60 | 94.0% to 100.0% | 0 | 180 | 0.17727 |
| Panel, borderline | driftbench default | 60/60 | 94.0% to 100.0% | 0 | 180 | 0.11037 |
| Panel, borderline | Inspect default | 60/60 | 94.0% to 100.0% | 0 | 180 | 0.12479 |

## Paired tests

Exact two-sided McNemar test on the same cases. "Only ours" counts cases the driftbench procedure gets right and Inspect gets wrong.

| Row | Procedure against Inspect | Only ours | Only Inspect | p |
|---|---|---|---|---|
| Grader panel | driftbench answer-audit (opt-in, this PR) | 1 | 0 | 1.0000 |
| Grader panel | driftbench default | 1 | 3 | 0.6250 |
| Model-graded QA | driftbench answer-audit (opt-in, this PR) | 3 | 0 | 0.2500 |
| Model-graded QA | driftbench default | 2 | 1 | 1.0000 |
| Model-graded fact | driftbench answer-audit (opt-in, this PR) | 1 | 0 | 1.0000 |
| Model-graded fact | driftbench default | 0 | 1 | 1.0000 |
| Panel, borderline | driftbench answer-audit (opt-in, this PR) | 0 | 0 | 1.0000 |
| Panel, borderline | driftbench default | 0 | 0 | 1.0000 |

## Pooled over the four rows

All rows together, paired by case. Exact two-sided McNemar test against Inspect.

| Procedure | Correct | Only ours | Only Inspect | p |
|---|---|---|---|---|
| driftbench answer-audit (opt-in, this PR) | 240/240 against 235/240 | 5 | 0 | 0.0625 |
| driftbench default | 233/240 against 235/240 | 3 | 5 | 0.7266 |
