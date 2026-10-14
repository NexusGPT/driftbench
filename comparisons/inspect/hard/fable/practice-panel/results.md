# Shipped judge against Inspect, this lane

Model on every side: claude-haiku-5-5, through `claude -p` with the flags of the judges package or through the Messages API with the same texts (each recorded call names its transport). An unscored or incomplete case counts as wrong.

| Row | Procedure | Judge commit | Correct | 95% interval | Unscored | Calls | USD per 100 cases |
|---|---|---|---|---|---|---|---|
| Grader panel | driftbench default judge, role-separated record, three votes, weighted panel | 6b879c8ac | 237/240 | 96.4% to 99.6% | 0 | 747 | 0.13464 |
| Grader panel | driftbench default judge, role-separated record, instruction settles nothing, three votes, weighted panel | 6b879c8ac | 239/240 | 97.7% to 99.9% | 0 | 744 | 0.13461 |
| Grader panel | Inspect default model_graded_qa template, three votes, majority |  | 240/240 | 98.4% to 100.0% | 0 | 720 | 0.11395 |

## Paired tests

Exact two-sided McNemar test on the same cases. "Only ours" counts cases the driftbench procedure gets right and Inspect gets wrong.

| Row | Procedure against Inspect | Only ours | Only Inspect | p |
|---|---|---|---|---|
| Grader panel | driftbench default judge, role-separated record, three votes, weighted panel | 0 | 3 | 0.2500 |
| Grader panel | driftbench default judge, role-separated record, instruction settles nothing, three votes, weighted panel | 0 | 1 | 1.0000 |

## Pooled over the four rows

All rows together, paired by case. Exact two-sided McNemar test against Inspect.

| Procedure | Correct | Only ours | Only Inspect | p |
|---|---|---|---|---|
| driftbench default judge, role-separated record | 237/240 against 240/240 | 0 | 3 | 0.2500 |
| driftbench default judge, role-separated record, instruction settles nothing | 239/240 against 240/240 | 0 | 1 | 1.0000 |
