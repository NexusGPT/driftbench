# Two-step pointwise validation

Both arms use the same validation entries. Percentages except calls and USD.

| Benchmark | Arm | n | Accuracy | Balanced | Sensitivity | Specificity | S2 calls/100 | Known S2 USD/100 |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| rubricbench | Frozen single threshold | 46 | 91.3 | 91.5 | 87.5 | 95.5 | 45.7 | 0.020494 |
| rubricbench | Two-step | 46 | 88.0 | 88.2 | 85.4 | 90.9 | 26.1 | 0.006659 |
| hardrows | Frozen single threshold | 54 | 96.3 | 96.0 | 100.0 | 92.0 | 7.4 | 0.000619 |
| hardrows | Two-step | 54 | 92.6 | 92.0 | 100.0 | 84.0 | 0.0 | 0.000000 |
| verify | Frozen single threshold | 49 | 69.4 | 70.2 | 71.4 | 69.0 | 295.9 | 0.282956 |
| verify | Two-step | 49 | 79.6 | 76.2 | 71.4 | 81.0 | 151.0 | 0.075139 |
| verify-with-reference | Frozen single threshold | 55 | 87.3 | 68.9 | 40.0 | 97.8 | 29.1 | 0.020393 |
| verify-with-reference | Two-step | 55 | 98.2 | 98.9 | 100.0 | 97.8 | 0.0 | 0.000000 |

Primary residual: 3 of 3. Reference-guided Verify remains separate from that residual.
Known USD excludes System-1 pricing. The new candidate uses gpt-6-luna only; the historical single-threshold baseline retains its recorded mixed panel.
Full baseline coverage, noise proxies and ceiling-tie targets follow ../v3/validation.json.
