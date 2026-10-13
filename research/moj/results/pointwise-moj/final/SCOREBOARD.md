# Frozen pointwise practice comparison

Percentages except calls and known System-2 USD. System-1 price is unknown. Partial baselines use matched entries.
New arms use gpt-6-luna. Historical mixed, Gemini and Haiku baselines are retained as context, not same-model contestants.

| Benchmark | Arm | n | Accuracy | Balanced | Recall | Specificity | S2/100 | USD/100 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| rubricbench | Frozen MoJ | 46 | 93.5 | 93.8 | 87.5 | 100.0 | 0.0 | 0.000000 |
| rubricbench | pw-router-v1 | 46 | 91.3 | 91.5 | 87.5 | 95.5 | 45.7 | 0.020494 |
| rubricbench | pw_whole | 46 | 90.2 | 90.2 | 89.6 | 90.9 | 0.0 | 0.000000 |
| rubricbench | pw-s1-whole | 46 | 90.2 | 90.2 | 89.6 | 90.9 | 0.0 | 0.000000 |
| rubricbench | pw-s1-rows | 46 | 93.5 | 93.8 | 87.5 | 100.0 | 0.0 | 0.000000 |
| rubricbench | pw-moj-luna | 46 | 93.5 | 93.6 | 91.7 | 95.5 | 43.5 | 0.015109 |
| rubricbench | pw-moj-mix | 46 | 91.3 | 91.3 | 91.7 | 90.9 | 126.1 | 0.265633 |
| rubricbench | pw_ledger | 22 | 84.1 | 84.6 | 79.2 | 90.0 | 213.6 | 0.000000 |
| rubricbench | MoJ matched to pw_ledger | 22 | 86.4 | 87.5 | 75.0 | 100.0 | 0.0 | 0.000000 |
| rubricbench | pw_seat | 26 | 98.1 | 98.1 | 100.0 | 96.2 | 100.0 | 0.000000 |
| rubricbench | MoJ matched to pw_seat | 26 | 100.0 | 100.0 | 100.0 | 100.0 | 0.0 | 0.000000 |
| rubricbench | pw_promptfoo | 5 | 80.0 | 83.3 | 100.0 | 66.7 | 200.0 | 0.000000 |
| rubricbench | MoJ matched to pw_promptfoo | 5 | 100.0 | 100.0 | 100.0 | 100.0 | 0.0 | 0.000000 |
| rubricbench | pw_s2v_luna | 46 | 88.0 | 88.2 | 85.4 | 90.9 | 200.0 | 0.043711 |
| rubricbench | pw_s2v_gemini | 42 | 77.4 | 77.3 | 75.0 | 79.5 | 200.0 | 0.690519 |
| rubricbench | MoJ matched to pw_s2v_gemini | 42 | 92.9 | 92.5 | 85.0 | 100.0 | 0.0 | 0.000000 |
| rubricbench | pw_s2v_haiku | 46 | 80.4 | 80.2 | 85.4 | 75.0 | 200.0 | 0.130528 |
| rubricbench | length | 46 | 39.1 | 38.8 | 45.8 | 31.8 | 0.0 | 0.000000 |
| rubricbench | first | 46 | 50.0 | 50.0 | 50.0 | 50.0 | 0.0 | 0.000000 |
| hardrows | Frozen MoJ | 54 | 96.3 | 96.0 | 100.0 | 92.0 | 55.6 | 0.006124 |
| hardrows | pw-router-v1 | 54 | 96.3 | 96.0 | 100.0 | 92.0 | 14.8 | 0.001693 |
| hardrows | pw_whole | 54 | 92.6 | 92.0 | 100.0 | 84.0 | 0.0 | 0.000000 |
| hardrows | pw-s1-whole | 54 | 94.4 | 94.0 | 100.0 | 88.0 | 0.0 | 0.000000 |
| hardrows | pw-s1-rows | 54 | 97.2 | 97.1 | 98.3 | 96.0 | 0.0 | 0.000000 |
| hardrows | pw-moj-luna | 54 | 98.1 | 98.0 | 100.0 | 96.0 | 14.8 | 0.001489 |
| hardrows | pw-moj-mix | 54 | 98.1 | 98.0 | 100.0 | 96.0 | 29.6 | 0.016887 |
| hardrows | pw_ledger | 54 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 0.038929 |
| hardrows | pw_shipped | 54 | 96.3 | 96.6 | 93.1 | 100.0 | 100.0 | 0.034296 |
| hardrows | pw_promptfoo | 54 | 88.9 | 89.7 | 79.3 | 100.0 | 100.0 | 0.034356 |
| hardrows | pw_s2v_luna | 54 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 0.009096 |
| hardrows | pw_s2v_gemini | 54 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 0.150059 |
| hardrows | pw_s2v_haiku | 54 | 92.6 | 93.1 | 86.2 | 100.0 | 100.0 | 0.032800 |
| hardrows | const_fail | 54 | 46.3 | 50.0 | 0.0 | 100.0 | 0.0 | 0.000000 |
| hardrows | const_pass | 54 | 53.7 | 50.0 | 100.0 | 0.0 | 0.0 | 0.000000 |
| verify | Frozen MoJ | 49 | 81.6 | 77.4 | 71.4 | 83.3 | 100.0 | 0.047384 |
| verify | pw-router-v1 | 49 | 61.2 | 59.5 | 57.1 | 61.9 | 469.4 | 0.596319 |
| verify | pw_whole | 49 | 55.1 | 50.0 | 42.9 | 57.1 | 0.0 | 0.000000 |
| verify | pw_ref_luna | 49 | 81.6 | 77.4 | 71.4 | 83.3 | 100.0 | 0.047384 |
| verify | pw-s1-whole | 49 | 60.2 | 44.0 | 21.4 | 66.7 | 0.0 | 0.000000 |
| verify | pw-s1-rows | 49 | 55.1 | 50.0 | 42.9 | 57.1 | 0.0 | 0.000000 |
| verify | pw-moj-luna | 49 | 73.5 | 78.6 | 85.7 | 71.4 | 118.4 | 0.054618 |
| verify | pw-moj-mix | 49 | 71.4 | 77.4 | 85.7 | 69.0 | 159.2 | 0.165929 |
| verify | pw_ledger | 17 | 82.4 | 68.3 | 50.0 | 86.7 | 465.9 | 0.556429 |
| verify | MoJ matched to pw_ledger | 17 | 88.2 | 71.7 | 50.0 | 93.3 | 100.0 | 0.079212 |
| verify | pw_promptfoo | 17 | 70.6 | 61.7 | 50.0 | 73.3 | 97.1 | 0.074253 |
| verify | MoJ matched to pw_promptfoo | 17 | 88.2 | 71.7 | 50.0 | 93.3 | 100.0 | 0.079212 |
| verify | pw_s2v_luna | 44 | 77.3 | 74.9 | 71.4 | 78.4 | 100.0 | 0.063595 |
| verify | MoJ matched to pw_s2v_luna | 44 | 81.8 | 77.6 | 71.4 | 83.8 | 100.0 | 0.047577 |
| verify | pw_s2v_gemini | 49 | 83.7 | 78.6 | 71.4 | 85.7 | 100.0 | 0.712100 |
| verify | pw_s2v_haiku | 49 | 69.4 | 70.2 | 71.4 | 69.0 | 100.0 | 0.159237 |
| verify | const_fail | 49 | 85.7 | 50.0 | 0.0 | 100.0 | 0.0 | 0.000000 |
| verify | const_pass | 49 | 14.3 | 50.0 | 100.0 | 0.0 | 0.0 | 0.000000 |
| verify-with-reference | Frozen MoJ | 55 | 98.2 | 98.9 | 100.0 | 97.8 | 1.8 | 0.000633 |
| verify-with-reference | pw-router-v1 | 55 | 80.0 | 56.7 | 20.0 | 93.3 | 87.3 | 0.066335 |
| verify-with-reference | pw_whole | 55 | 96.4 | 93.9 | 90.0 | 97.8 | 0.0 | 0.000000 |
| verify-with-reference | pw-s1-whole | 55 | 96.4 | 93.9 | 90.0 | 97.8 | 0.0 | 0.000000 |
| verify-with-reference | pw-s1-rows | 55 | 80.0 | 87.8 | 100.0 | 75.6 | 0.0 | 0.000000 |
| verify-with-reference | pw-moj-luna | 55 | 81.8 | 85.0 | 90.0 | 80.0 | 10.9 | 0.009742 |
| verify-with-reference | pw-moj-mix | 55 | 81.8 | 85.0 | 90.0 | 80.0 | 10.9 | 0.009742 |
| verify-with-reference | reference-first-recorded | 55 | 95.5 | 93.3 | 90.0 | 96.7 | 0.0 | 0.000000 |
| verify-with-reference | pw_s2v_luna | 45 | 77.8 | 47.3 | 0.0 | 94.6 | 100.0 | 0.069113 |
| verify-with-reference | MoJ matched to pw_s2v_luna | 45 | 97.8 | 98.6 | 100.0 | 97.3 | 2.2 | 0.000773 |
| verify-with-reference | const_fail | 55 | 81.8 | 50.0 | 0.0 | 100.0 | 0.0 | 0.000000 |
| verify-with-reference | const_pass | 55 | 18.2 | 50.0 | 100.0 | 0.0 | 0.0 | 0.000000 |

Primary full-coverage residual: 3/3. Previous four-cell retention residual: 0/4. Strengthened owner bar: 1/4.
Hard rows do not tie the 100% ceiling inside the 1.7-point noise proxy. RubricBench ties its best full-coverage baseline; blind Verify remains below always-fail.
Noise proxies and matched paired intervals are recorded in validation.json. All official labels remain unchanged.
