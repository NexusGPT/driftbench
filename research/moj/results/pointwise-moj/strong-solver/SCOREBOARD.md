## Blind Verify stronger-solver round (2026-10-13)

Only the solver changes: original SOLVE_SYSTEM, original Jev match question, same question-only solver input, same 600-character reference extraction.
Both new solvers use medium effort. GPT-6.1-sol has no temperature parameter; Sonnet 5.5 runs through the local CLI with prompt caching disabled.
Practice moj-split-v2 only: 46 tuning and 49 validation items. No sealed or reference-guided inputs are used.
Threshold selection maximizes official tuning accuracy with pass recall at least 50 percent; ties use balanced accuracy, then the higher threshold.
The same rule is applied to all three solver arms. Grouped tuning folds diagnose transfer; final thresholds freeze before new validation calls.
Corrected labels only rescore fixed decisions using the eight previously proved contradictions. They never enter fitting.
Validation has been inspected in earlier rounds. These are descriptive comparisons, not a new independent confirmation.

### Official and proof-corrected validation

All rows cover the same 49 items. Values are percentages except calls and USD. Sensitivity is pass recall.

| Arm | Official accuracy | Recall | Balanced | Specificity | Corrected accuracy | Recall | Balanced | Specificity | S2/100 | USD/100 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Luna, frozen 0.5 | 81.6 | 71.4 | 77.4 | 83.3 | 89.8 | 88.9 | 89.4 | 90.0 | 100.0 | 0.047384 |
| Luna, fitted threshold | 77.6 | 71.4 | 75.0 | 78.6 | 85.7 | 88.9 | 86.9 | 85.0 | 100.0 | 0.047384 |
| gpt-6.1-sol, fitted threshold | 69.4 | 71.4 | 70.2 | 69.0 | 77.6 | 88.9 | 81.9 | 75.0 | 100.0 | 0.335770 |
| Sonnet 5.5, fitted threshold | 79.6 | 57.1 | 70.2 | 83.3 | 83.7 | 66.7 | 77.1 | 87.5 | 100.0 | 0.841106 |
| gpt-6.1-sol, fixed 0.5 | 79.6 | 71.4 | 76.2 | 81.0 | 87.8 | 88.9 | 88.2 | 87.5 | 100.0 | 0.335770 |
| Sonnet 5.5, fixed 0.5 | 83.7 | 57.1 | 72.6 | 88.1 | 87.8 | 66.7 | 79.6 | 92.5 | 100.0 | 0.841106 |
| Always fail | 85.7 | 0.0 | 50.0 | 100.0 | 81.6 | 0.0 | 50.0 | 100.0 | 0.0 | 0.000000 |

Corrected validation has 9 pass labels and 40 fail labels, versus 7 and 42 officially. No claim extends beyond the checked label contradictions.
System-1 pricing is unknown and excluded from USD. New-arm USD includes cache-write charges; historical Luna costs retain their recorded accounting.

### Tuning and paired uncertainty

| Solver | Fitted threshold | Tuning accuracy | Grouped OOF accuracy | OOF recall | OOF balanced | Official fitted delta vs always-fail, points [95% paired interval] |
|---|---:|---:|---:|---:|---:|---|
| luna | 0.35 | 67.4 | 65.2 | 50.0 | 59.7 | -8.2 [-22.4, +6.1] |
| sol | 0.17 | 67.4 | 58.7 | 50.0 | 55.6 | -16.3 [-32.7, +0.0] |
| sonnet | 0.27 | 71.7 | 69.6 | 50.0 | 62.5 | -6.1 [-18.4, +6.1] |

The bar is above 85.7 by more than the recorded 3.3-point noise proxy, with nonzero pass recall: at least 44/49 correct.
Paired intervals use 20,000 group bootstrap draws. A noise-proxy crossing alone is not a statistically confirmed advantage.

Neither stronger solver with the tuning-fitted rule clears the official always-fail baseline by more than the noise floor. The primary, tuning-fitted experiment therefore does not meet the official-label bar. Corrected-label scores are sensitivity analysis and do not replace that result. Keep the existing frozen Luna solve-and-compare configuration and stop; the strengthened four-cell residual remains 1/4.

### Cost, replay and unchanged cells

Ten healthy tuning probes per solver precede expansion. Combined probe spend is 0.228685 USD; projected full-run spend is 2.172508 USD.
Actual new-round accounted spend is 1.407844 USD against the 10 USD cap. Concurrency is two across both solvers. Every returned answer is recorded and never resubmitted.
Network-disabled replay reproduces 190 signals from 190 solver answers. Five focused tests pass.
RubricBench 93.5, hard rows 96.3 and Verify-with-reference 98.2 retain their frozen source/config/result hashes.
New solvers have a 16,384-output-token budget safety cap. No answer reaches the cap. All 49 validation comparisons per solver are usable.
One Sonnet tuning answer is lost because the frozen first_object parser selects a literal empty object in prose before the final_answer object. The fit retains that loss; no fix or repeated call changes this run. See [PARSER-DEFECT.md](PARSER-DEFECT.md) for the item id and reproduction.
Replay: `python3 -m moj.verify_strong_solver replay`. Full requests, responses, decisions and spend: `results/pointwise-moj/strong-solver/`.
Rates: [OpenAI standard pricing](https://developers.openai.com/api/docs/pricing), input 2.00, cached read 0.10, cache write 2.50, output 10.00 USD per million; reasoning included in output. Sonnet uses CLI-reported USD.
