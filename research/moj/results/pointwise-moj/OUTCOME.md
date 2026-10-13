# Frozen validation outcome

The candidate fails the promotion target. Residual: 3 of 3 full-coverage benchmark cells.

| Benchmark | Frozen accuracy | Best full-coverage accuracy | Noise floor | Frozen balanced | Sensitivity | Specificity | S2 calls/100 | Known S2 USD/100 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| rubricbench | 91.3 | 93.5 | 3.3 | 91.5 | 87.5 | 95.5 | 45.7 | 0.02049 |
| hardrows | 96.3 | 100.0 | 1.7 | 96.0 | 100.0 | 92.0 | 14.8 | 0.00169 |
| verify | 61.2 | 85.7 | 3.3 | 59.5 | 57.1 | 61.9 | 469.4 | 0.59632 |

## What failed

- Hardrows: two rubric cases pass incorrectly at calibrated confidence 0.928 and 0.979. Their terrain reasoning probabilities are 0.07 and 0.08, so neither escalates. Numeric reasoning repair alone misses these semantic rubric cases.
- RubricBench: the panel and named-type comparison do not improve tuning balanced accuracy. The frozen policy scores below the existing System-1 rows baseline on validation.
- Verify: panel majority and learned mixture lose tuning balanced accuracy. The frozen panel architecture reaches 61.2 percent validation accuracy, below the 85.7 percent constant-fail rule. Its 59.5 percent balanced accuracy also trails the existing MoJ baseline.
- Reference-guided Verify: the frozen evidence route reaches 80.0 percent accuracy and 20.0 percent sensitivity, versus recorded reference-first accuracy 95.5 percent. Treat this as a regression diagnostic.

## Reproduction and stopping

646 collected signals replay from their recordings with zero model calls. The frozen validation report also replays offline. Nine offline contract tests pass.
All requested baseline rows and their population sizes are in SCOREBOARD.md and validation.json. Partial baselines include matched MoJ scores and group-bootstrap delta intervals.
The owner asks this pass to stop now. The designer can use validation-errors.json, tuning ablations, terrain probabilities and calibration maps for the next framing, calibration, tie-band and safety-routing round.

System-2 reserved-plus-known spend: 0.750244 USD of 15 USD. System-1 calls have no budget ceiling; price remains unspecified.
