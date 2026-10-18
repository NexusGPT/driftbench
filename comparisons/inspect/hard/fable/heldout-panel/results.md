# Shipped judge against Inspect, this lane

Model on every side: claude-haiku-5-5, through `claude -p` with the flags of the judges package or through the Messages API with the same texts (transport counts and attribution are in [the provenance record](../transport.md); raw recordings are restored with [the export script](../README.md)). An unscored or incomplete case counts as wrong.

| Row | Procedure | Judge commit | Correct | 95% interval | Unscored | Calls | USD per 100 cases |
|---|---|---|---|---|---|---|---|
| Grader panel | driftbench default judge, role-separated record, instruction settles nothing, three votes, weighted panel | bdafa0d7a | 479/480 | 98.8% to 100.0% | 0 | 1494 | 0.13491 |
| Grader panel | Inspect default model_graded_qa template, three votes, majority |  | 479/480 | 98.8% to 100.0% | 0 | 1440 | 0.11386 |

## Pooled over available rows

Clustered exact test across the available rows. Keep every copy of an identical submission together under one random sign. The test statistic is the total correctness difference across rows; the two-sided p-value sums permutations at least as extreme in absolute value. Unscored or incomplete cases count as wrong.

| Procedure | Correct | Only ours | Only Inspect | Distinct submissions | Clustered p | McNemar p |
|---|---|---|---|---|---|---|
| driftbench default judge, role-separated record, instruction settles nothing | 479/480 against 479/480 | 1 | 1 | 480 | 1.00000000 | 1.00000000 |

## Practice overlap

The second panel round has 0 exact submission overlaps with panel practice. However, 446 of 480 held-out rows share question text with panel practice, spanning 16 shared distinct questions. These are fresh submissions, not an independent holdout of question texts. The 479/480 against 479/480 result is a tie, with no evidence of a lead.

## Paired tests

Exact two-sided McNemar test on the same cases. "Only ours" counts cases the driftbench procedure gets right and Inspect gets wrong.

| Row | Procedure against Inspect | Only ours | Only Inspect | p |
|---|---|---|---|---|
| Grader panel | driftbench default judge, role-separated record, instruction settles nothing, three votes, weighted panel | 1 | 1 | 1.00000000 |
