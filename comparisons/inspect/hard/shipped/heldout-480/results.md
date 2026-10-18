# Shipped judge against Inspect, 480 cases per row

Model on every side: claude-haiku-5-5 through `claude -p`, same flags. An unscored or incomplete case counts as wrong.

| Row | Procedure | Correct | 95% interval | Unscored | Calls | USD per 100 cases |
|---|---|---|---|---|---|---|
| Grader panel | driftbench answer-audit (opt-in, this PR) | 480/480 | 99.2% to 100.0% | 0 | 1470 | 0.18757 |
| Grader panel | driftbench default | 436/480 | 87.9% to 93.1% | 26 | 1499 | 0.12922 |
| Grader panel | Inspect default | 475/480 | 97.6% to 99.6% | 0 | 1440 | 0.13116 |
| Model-graded QA | driftbench answer-audit (opt-in, this PR) | 480/480 | 99.2% to 100.0% | 0 | 480 | 0.07522 |
| Model-graded QA | driftbench default | 470/480 | 96.2% to 98.9% | 0 | 480 | 0.06040 |
| Model-graded QA | Inspect default | 461/480 | 93.9% to 97.5% | 0 | 480 | 0.06061 |
| Model-graded fact | driftbench answer-audit (opt-in, this PR) | 478/480 | 98.5% to 99.9% | 0 | 482 | 0.06883 |
| Model-graded fact | driftbench default | 469/480 | 95.9% to 98.7% | 0 | 480 | 0.06051 |
| Model-graded fact | Inspect default | 470/480 | 96.2% to 98.9% | 0 | 480 | 0.05622 |
| Panel, borderline | driftbench answer-audit (opt-in, this PR) | 480/480 | 99.2% to 100.0% | 0 | 1449 | 0.18416 |
| Panel, borderline | driftbench default | 480/480 | 99.2% to 100.0% | 0 | 1440 | 0.11810 |
| Panel, borderline | Inspect default | 480/480 | 99.2% to 100.0% | 0 | 1440 | 0.12085 |

## Paired tests

Exact two-sided McNemar test on the same cases. "Only ours" counts cases the driftbench procedure gets right and Inspect gets wrong.

| Row | Procedure against Inspect | Only ours | Only Inspect | p |
|---|---|---|---|---|
| Grader panel | driftbench answer-audit (opt-in, this PR) | 5 | 0 | 0.0625 |
| Grader panel | driftbench default | 5 | 44 | 0.0000 |
| Model-graded QA | driftbench answer-audit (opt-in, this PR) | 19 | 0 | 0.0000 |
| Model-graded QA | driftbench default | 12 | 3 | 0.0352 |
| Model-graded fact | driftbench answer-audit (opt-in, this PR) | 10 | 2 | 0.0386 |
| Model-graded fact | driftbench default | 5 | 6 | 1.0000 |
| Panel, borderline | driftbench answer-audit (opt-in, this PR) | 0 | 0 | 1.0000 |
| Panel, borderline | driftbench default | 0 | 0 | 1.0000 |

## Pooled over the four rows

All rows together, paired by case. Exact two-sided McNemar test against Inspect.

| Procedure | Correct | Only ours | Only Inspect | p |
|---|---|---|---|---|
| driftbench answer-audit (opt-in, this PR) | 1918/1920 against 1886/1920 | 34 | 2 | 0.0000 |
| driftbench default | 1855/1920 against 1886/1920 | 22 | 53 | 0.0004 |
