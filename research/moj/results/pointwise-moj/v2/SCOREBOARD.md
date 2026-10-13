# Pointwise MoJ validation

Frozen configuration: `configs/pw-router-v2-frozen.json`. Owner-prescribed two fixes; no validation selection or threshold search.

All values are percentages except counts and USD. Sensitivity/specificity on RubricBench mean A/B recall after the fixed swap.

| Benchmark | Arm | n | Accuracy | Balanced | Sensitivity | Specificity | S2 calls/100 | Known USD/100 |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| rubricbench | MoJ | 46 | 91.3 | 91.5 | 87.5 | 95.5 | 45.7 | 0.0205 |
| rubricbench | pw-router-v1 | 46 | 91.3 | 91.5 | 87.5 | 95.5 | 45.7 | 0.0205 |
| rubricbench | pw_whole | 46 | 90.2 | 90.2 | 89.6 | 90.9 | 0.0 | 0.0000 |
| rubricbench | pw-s1-whole | 46 | 90.2 | 90.2 | 89.6 | 90.9 | 0.0 | 0.0000 |
| rubricbench | pw-s1-rows | 46 | 93.5 | 93.8 | 87.5 | 100.0 | 0.0 | 0.0000 |
| rubricbench | pw-moj-luna | 46 | 93.5 | 93.6 | 91.7 | 95.5 | 43.5 | 0.0151 |
| rubricbench | pw-moj-mix | 46 | 91.3 | 91.3 | 91.7 | 90.9 | 126.1 | 0.2656 |
| rubricbench | pw_ledger | 22 | 84.1 | 84.6 | 79.2 | 90.0 | 213.6 | n/a |
| rubricbench | pw_seat | 26 | 98.1 | 98.1 | 100.0 | 96.2 | 100.0 | n/a |
| rubricbench | pw_promptfoo | 5 | 80.0 | 83.3 | 100.0 | 66.7 | 200.0 | n/a |
| rubricbench | pw_s2v_luna | 46 | 88.0 | 88.2 | 85.4 | 90.9 | 200.0 | 0.0437 |
| rubricbench | pw_s2v_gemini | 42 | 77.4 | 77.3 | 75.0 | 79.5 | 200.0 | 0.6905 |
| rubricbench | pw_s2v_haiku | 46 | 80.4 | 80.2 | 85.4 | 75.0 | 200.0 | 0.1305 |
| rubricbench | length | 46 | 39.1 | 38.8 | 45.8 | 31.8 | 0.0 | 0.0000 |
| rubricbench | first | 46 | 50.0 | 50.0 | 50.0 | 50.0 | 0.0 | 0.0000 |
| hardrows | MoJ | 54 | 92.6 | 92.0 | 100.0 | 84.0 | 3.7 | 0.0002 |
| hardrows | pw-router-v1 | 54 | 96.3 | 96.0 | 100.0 | 92.0 | 14.8 | 0.0017 |
| hardrows | pw_whole | 54 | 92.6 | 92.0 | 100.0 | 84.0 | 0.0 | 0.0000 |
| hardrows | pw-s1-whole | 54 | 94.4 | 94.0 | 100.0 | 88.0 | 0.0 | 0.0000 |
| hardrows | pw-s1-rows | 54 | 97.2 | 97.1 | 98.3 | 96.0 | 0.0 | 0.0000 |
| hardrows | pw-moj-luna | 54 | 98.1 | 98.0 | 100.0 | 96.0 | 14.8 | 0.0015 |
| hardrows | pw-moj-mix | 54 | 98.1 | 98.0 | 100.0 | 96.0 | 29.6 | 0.0169 |
| hardrows | pw_ledger | 54 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 0.0389 |
| hardrows | pw_shipped | 54 | 96.3 | 96.6 | 93.1 | 100.0 | 100.0 | 0.0343 |
| hardrows | pw_promptfoo | 54 | 88.9 | 89.7 | 79.3 | 100.0 | 100.0 | 0.0344 |
| hardrows | pw_s2v_luna | 54 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 0.0091 |
| hardrows | pw_s2v_gemini | 54 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 0.1501 |
| hardrows | pw_s2v_haiku | 54 | 92.6 | 93.1 | 86.2 | 100.0 | 100.0 | 0.0328 |
| hardrows | const_fail | 54 | 46.3 | 50.0 | 0.0 | 100.0 | 0.0 | 0.0000 |
| hardrows | const_pass | 54 | 53.7 | 50.0 | 100.0 | 0.0 | 0.0 | 0.0000 |
| verify | MoJ | 49 | 81.6 | 77.4 | 71.4 | 83.3 | 100.0 | 0.0474 |
| verify | pw-router-v1 | 49 | 61.2 | 59.5 | 57.1 | 61.9 | 469.4 | 0.5963 |
| verify | pw_whole | 49 | 55.1 | 50.0 | 42.9 | 57.1 | 0.0 | 0.0000 |
| verify | pw_ref_luna | 49 | 81.6 | 77.4 | 71.4 | 83.3 | 100.0 | 0.0474 |
| verify | pw-s1-whole | 49 | 60.2 | 44.0 | 21.4 | 66.7 | 0.0 | 0.0000 |
| verify | pw-s1-rows | 49 | 55.1 | 50.0 | 42.9 | 57.1 | 0.0 | 0.0000 |
| verify | pw-moj-luna | 49 | 73.5 | 78.6 | 85.7 | 71.4 | 118.4 | 0.0546 |
| verify | pw-moj-mix | 49 | 71.4 | 77.4 | 85.7 | 69.0 | 159.2 | 0.1659 |
| verify | pw_ledger | 17 | 82.4 | 68.3 | 50.0 | 86.7 | 465.9 | 0.5564 |
| verify | pw_promptfoo | 17 | 70.6 | 61.7 | 50.0 | 73.3 | 97.1 | 0.0743 |
| verify | pw_s2v_luna | 44 | 77.3 | 74.9 | 71.4 | 78.4 | 100.0 | 0.0636 |
| verify | pw_s2v_gemini | 49 | 83.7 | 78.6 | 71.4 | 85.7 | 100.0 | 0.7121 |
| verify | pw_s2v_haiku | 49 | 69.4 | 70.2 | 71.4 | 69.0 | 100.0 | 0.1592 |
| verify | const_fail | 49 | 85.7 | 50.0 | 0.0 | 100.0 | 0.0 | 0.0000 |
| verify | const_pass | 49 | 14.3 | 50.0 | 100.0 | 0.0 | 0.0 | 0.0000 |
| verify-with-reference | MoJ | 55 | 96.4 | 93.9 | 90.0 | 97.8 | 0.0 | 0.0000 |
| verify-with-reference | pw-router-v1 | 55 | 80.0 | 56.7 | 20.0 | 93.3 | 87.3 | 0.0663 |
| verify-with-reference | pw_whole | 55 | 96.4 | 93.9 | 90.0 | 97.8 | 0.0 | 0.0000 |
| verify-with-reference | pw-s1-whole | 55 | 96.4 | 93.9 | 90.0 | 97.8 | 0.0 | 0.0000 |
| verify-with-reference | pw-s1-rows | 55 | 80.0 | 87.8 | 100.0 | 75.6 | 0.0 | 0.0000 |
| verify-with-reference | pw-moj-luna | 55 | 81.8 | 85.0 | 90.0 | 80.0 | 10.9 | 0.0097 |
| verify-with-reference | pw-moj-mix | 55 | 81.8 | 85.0 | 90.0 | 80.0 | 10.9 | 0.0097 |
| verify-with-reference | reference-first-recorded | 55 | 95.5 | 93.3 | 90.0 | 96.7 | 0.0 | 0.0000 |
| verify-with-reference | pw_s2v_luna | 45 | 77.8 | 47.3 | 0.0 | 94.6 | 100.0 | 0.0691 |
| verify-with-reference | const_fail | 55 | 81.8 | 50.0 | 0.0 | 100.0 | 0.0 | 0.0000 |
| verify-with-reference | const_pass | 55 | 18.2 | 50.0 | 100.0 | 0.0 | 0.0 | 0.0000 |

Primary residual: 3 of 3 benchmarks.

Noise floors are inherited recorded repeat ranges from moj/noise.py, not a fresh router-specific noise measurement. Returned answers are never requested again.
The primary residual uses full-coverage baselines. Every partial baseline uses matched validation IDs and is reported separately. The domain-seat subset target is a tie within noise at fewer System-2 calls.
Historical Gemini 3.8 results are baselines only; all new Gemini calls use gemini-3.5-flash-lite.
Known USD excludes System-1 pricing, which the harness does not publish. Gemini uses the inherited conservative rate estimate, not an invoice.
Verify with reference is a separate diagnostic. Its split differs from vanilla Verify and it is excluded from fitting and the primary residual.
