# Shipped judge against Inspect, this lane

Model on every side: claude-haiku-5-5, through `claude -p` with the flags of the judges package or through the Messages API with the same texts (each recorded call names its transport). An unscored or incomplete case counts as wrong.

| Row | Procedure | Judge commit | Correct | 95% interval | Unscored | Calls | USD per 100 cases |
|---|---|---|---|---|---|---|---|
| Grader panel | driftbench default judge, role-separated record, three votes, weighted panel | b7dadb1f5 | 466/480 | 95.2% to 98.3% | 10 | 1546 | 0.13868 |
| Grader panel | Inspect default model_graded_qa template, three votes, majority |  | 480/480 | 99.2% to 100.0% | 0 | 1440 | 0.11364 |
| Model-graded QA | driftbench default judge, role-separated record | b7dadb1f5 | 480/480 | 99.2% to 100.0% | 0 | 482 | 0.04711 |
| Model-graded QA | Inspect default model_graded_qa template |  | 460/480 | 93.7% to 97.3% | 0 | 480 | 0.03469 |
| Model-graded fact | driftbench default judge, role-separated record | b7dadb1f5 | 480/480 | 99.2% to 100.0% | 0 | 482 | 0.04711 |
| Model-graded fact | Inspect default model_graded_fact template |  | 471/480 | 96.5% to 99.0% | 0 | 480 | 0.03267 |

## Paired tests

Exact two-sided McNemar test on the same cases. "Only ours" counts cases the driftbench procedure gets right and Inspect gets wrong.

| Row | Procedure against Inspect | Only ours | Only Inspect | p |
|---|---|---|---|---|
| Grader panel | driftbench default judge, role-separated record, three votes, weighted panel | 0 | 14 | 0.0001 |
| Model-graded QA | driftbench default judge, role-separated record | 20 | 0 | 0.0000 |
| Model-graded fact | driftbench default judge, role-separated record | 9 | 0 | 0.0039 |

## Pooled over the four rows

All rows together, paired by case. Exact two-sided McNemar test against Inspect.

| Procedure | Correct | Only ours | Only Inspect | p |
|---|---|---|---|---|
| driftbench default judge, role-separated record | 1426/1440 against 1411/1440 | 29 | 14 | 0.0315 |
