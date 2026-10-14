# Shipped judge against Inspect, this lane

Model on every side: claude-haiku-5-5, through `claude -p` with the flags of the judges package or through the Messages API with the same texts (transport counts and attribution are in [the provenance record](../transport.md); raw recordings are restored with [the export script](../README.md)). An unscored or incomplete case counts as wrong.

| Row | Procedure | Judge commit | Correct | 95% interval | Unscored | Calls | USD per 100 cases |
|---|---|---|---|---|---|---|---|
| Grader panel | driftbench default judge, role-separated record, three votes, weighted panel | b7dadb1f5 | 466/480 | 95.2% to 98.3% | 10 | 1546 | 0.13868 |
| Grader panel | Inspect default model_graded_qa template, three votes, majority |  | 480/480 | 99.2% to 100.0% | 0 | 1440 | 0.11364 |
| Model-graded QA | driftbench default judge, role-separated record | b7dadb1f5 | 480/480 | 99.2% to 100.0% | 0 | 482 | 0.04711 |
| Model-graded QA | Inspect default model_graded_qa template |  | 460/480 | 93.7% to 97.3% | 0 | 480 | 0.03469 |
| Model-graded fact | driftbench default judge, role-separated record | b7dadb1f5 | 480/480 | 99.2% to 100.0% | 0 | 482 | 0.04711 |
| Model-graded fact | Inspect default model_graded_fact template |  | 471/480 | 96.5% to 99.0% | 0 | 480 | 0.03267 |

## Primary pooled result: clustered exact test

Post-hoc correction of the pre-registered pooled test: pooling double-counted submissions shared by QA and fact. Keep every copy of an identical submission together under one random sign. The test statistic is the total correctness difference across rows; the two-sided p-value sums permutations at least as extreme in absolute value. Unscored or incomplete cases count as wrong.

| Procedure | Correct | Only ours | Only Inspect | Distinct submissions | Clustered p (primary) | Nominal McNemar p (uncorrected) |
|---|---|---|---|---|---|---|
| driftbench default judge, role-separated record | 1426/1440 against 1411/1440 | 29 | 14 | 960 | 0.07199962 | 0.03153950 |

The pooled lead is not significant at 0.05 (clustered p = 0.07199961598962545). The nominal pre-registered McNemar p = 0.03153949735315109 treated 1,440 row observations as independent pairs, although they contain only 960 distinct submissions. All 480 QA submission texts also occur in fact, with identical split-judge request hashes and recorded answers. All nine fact-only wins are among the 20 QA-only wins. The corrected test is post hoc; the original registration remains unchanged.

The per-row tests are retained as post-hoc analyses (the registration specified descriptive row counts). QA is a significant lead on 480 distinct submissions: 480 against 460, discordance 20/0, exact p = 0.0000019073486328125. Fact is 480 against 471, p = 0.00390625, but reuses the QA submissions and split answers; it is not an independent replication. Panel is 466 against 480, p = 0.0001220703125.

## Paired tests

Exact two-sided McNemar test on the same cases. "Only ours" counts cases the driftbench procedure gets right and Inspect gets wrong.

| Row | Procedure against Inspect | Only ours | Only Inspect | p |
|---|---|---|---|---|
| Grader panel | driftbench default judge, role-separated record, three votes, weighted panel | 0 | 14 | 0.00012207031 |
| Model-graded QA | driftbench default judge, role-separated record | 20 | 0 | 0.0000019073486 |
| Model-graded fact | driftbench default judge, role-separated record | 9 | 0 | 0.00390625 |
