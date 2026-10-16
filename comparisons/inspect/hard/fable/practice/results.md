# Shipped judge against Inspect, this lane

Model on every side: claude-haiku-5-5, through `claude -p` with the flags of the judges package or through the Messages API with the same texts (transport counts and attribution are in [the provenance record](../transport.md); raw recordings are restored with [the export script](../README.md)). An unscored or incomplete case counts as wrong.

| Row | Procedure | Judge commit | Correct | 95% interval | Unscored | Calls | USD per 100 cases |
|---|---|---|---|---|---|---|---|
| Grader panel | driftbench default judge, role-separated record, three votes, weighted panel | 0a343f5b0 | 120/120 | 96.9% to 100.0% | 0 | 367 | 0.10977 |
| Grader panel | Inspect default model_graded_qa template, three votes, majority |  | 119/120 | 95.4% to 99.9% | 0 | 360 | 0.13296 |
| Model-graded QA | driftbench default judge, role-separated record | 0a343f5b0 | 119/120 | 95.4% to 99.9% | 0 | 121 | 0.05824 |
| Model-graded fact | driftbench default judge, role-separated record | 0a343f5b0 | 119/120 | 95.4% to 99.9% | 0 | 121 | 0.05824 |

## Pooled over available rows

Clustered exact test across the available rows. Keep every copy of an identical submission together under one random sign. The test statistic is the total correctness difference across rows; the two-sided p-value sums permutations at least as extreme in absolute value. Unscored or incomplete cases count as wrong.

| Procedure | Correct | Only ours | Only Inspect | Distinct submissions | Clustered p | McNemar p |
|---|---|---|---|---|---|---|
| driftbench default judge, role-separated record | 120/120 against 119/120 | 1 | 0 | 120 | 1.00000000 | 1.00000000 |

## Paired tests

Exact two-sided McNemar test on the same cases. "Only ours" counts cases the driftbench procedure gets right and Inspect gets wrong.

| Row | Procedure against Inspect | Only ours | Only Inspect | p |
|---|---|---|---|---|
| Grader panel | driftbench default judge, role-separated record, three votes, weighted panel | 1 | 0 | 1.00000000 |
