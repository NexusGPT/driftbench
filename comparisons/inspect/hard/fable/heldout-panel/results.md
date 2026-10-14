# Shipped judge against Inspect, this lane

Model on every side: claude-haiku-5-5, through `claude -p` with the flags of the judges package or through the Messages API with the same texts (each recorded call names its transport). An unscored or incomplete case counts as wrong.

| Row | Procedure | Judge commit | Correct | 95% interval | Unscored | Calls | USD per 100 cases |
|---|---|---|---|---|---|---|---|
| Grader panel | driftbench default judge, role-separated record, instruction settles nothing, three votes, weighted panel | bdafa0d7a | 479/480 | 98.8% to 100.0% | 0 | 1494 | 0.13491 |
| Grader panel | Inspect default model_graded_qa template, three votes, majority |  | 479/480 | 98.8% to 100.0% | 0 | 1440 | 0.11386 |

## Paired tests

Exact two-sided McNemar test on the same cases. "Only ours" counts cases the driftbench procedure gets right and Inspect gets wrong.

| Row | Procedure against Inspect | Only ours | Only Inspect | p |
|---|---|---|---|---|
| Grader panel | driftbench default judge, role-separated record, instruction settles nothing, three votes, weighted panel | 1 | 1 | 1.0000 |

## Pooled over the four rows

All rows together, paired by case. Exact two-sided McNemar test against Inspect.

| Procedure | Correct | Only ours | Only Inspect | p |
|---|---|---|---|---|
| driftbench default judge, role-separated record, instruction settles nothing | 479/480 against 479/480 | 1 | 1 | 1.0000 |
