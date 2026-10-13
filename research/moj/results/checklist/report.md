# Checklist validation

| Variant | Benchmark | Accuracy [95% CI] | n | S1 calls/100 | S1 s/pair | S2 calls/100 | S2 USD/100 | Short | Missing | Strict accuracy |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| checklist-low-batch-equal | judgebench | 81.5 [63.3, 91.8] | 27 | 200.000 | 0.770 | 100.000 | 0.034 | 0 | 0 | 81.481 |
| checklist-low-batch-equal | mmeval | 87.0 [67.9, 95.5] | 23 | 200.000 | 0.781 | 100.000 | 0.021 | 0 | 0 | 86.957 |
| checklist-low-batch-equal | writing | 60.7 [42.4, 76.4] | 28 | 200.000 | 0.922 | 82.143 | 0.018 | 0 | 0 | 60.714 |
| checklist-low-batch-writer | judgebench | 81.5 [63.3, 91.8] | 27 | 200.000 | 0.770 | 100.000 | 0.034 | 0 | 0 | 81.481 |
| checklist-low-batch-writer | mmeval | 87.0 [67.9, 95.5] | 23 | 200.000 | 0.781 | 100.000 | 0.021 | 0 | 0 | 86.957 |
| checklist-low-batch-writer | writing | 60.7 [42.4, 76.4] | 28 | 200.000 | 0.922 | 82.143 | 0.018 | 0 | 0 | 60.714 |
| checklist-low-single-equal | judgebench | 79.6 [61.3, 90.6] | 27 | 1600.000 | 6.509 | 100.000 | 0.034 | 0 | 0 | 79.630 |
| checklist-low-single-equal | mmeval | 91.3 [73.2, 97.6] | 23 | 1913.043 | 7.543 | 100.000 | 0.021 | 0 | 0 | 91.304 |
| checklist-low-single-equal | writing | 60.7 [42.4, 76.4] | 28 | 2928.571 | 14.570 | 82.143 | 0.018 | 0 | 0 | 60.714 |
| checklist-low-single-writer | judgebench | 79.6 [61.3, 90.6] | 27 | 1600.000 | 6.509 | 100.000 | 0.034 | 0 | 0 | 79.630 |
| checklist-low-single-writer | mmeval | 91.3 [73.2, 97.6] | 23 | 1913.043 | 7.543 | 100.000 | 0.021 | 0 | 0 | 91.304 |
| checklist-low-single-writer | writing | 60.7 [42.4, 76.4] | 28 | 2928.571 | 14.570 | 82.143 | 0.018 | 0 | 0 | 60.714 |
| checklist-medium-batch-equal | judgebench | 72.2 [53.4, 85.5] | 27 | 200.000 | 0.841 | 100.000 | 0.062 | 0 | 0 | 72.222 |
| checklist-medium-batch-equal | mmeval | 82.6 [62.9, 93.0] | 23 | 200.000 | 0.787 | 100.000 | 0.038 | 0 | 0 | 82.609 |
| checklist-medium-batch-equal | writing | 53.6 [35.8, 70.5] | 28 | 200.000 | 0.879 | 85.714 | 0.034 | 0 | 0 | 53.571 |
| checklist-medium-batch-writer | judgebench | 75.9 [57.3, 88.1] | 27 | 200.000 | 0.841 | 100.000 | 0.062 | 0 | 0 | 75.926 |
| checklist-medium-batch-writer | mmeval | 82.6 [62.9, 93.0] | 23 | 200.000 | 0.787 | 100.000 | 0.038 | 0 | 0 | 82.609 |
| checklist-medium-batch-writer | writing | 57.1 [39.1, 73.5] | 28 | 200.000 | 0.879 | 85.714 | 0.034 | 0 | 0 | 57.143 |
| checklist-medium-single-equal | judgebench | 70.4 [51.5, 84.1] | 27 | 1644.444 | 6.804 | 100.000 | 0.062 | 0 | 0 | 70.370 |
| checklist-medium-single-equal | mmeval | 82.6 [62.9, 93.0] | 23 | 2121.739 | 8.884 | 100.000 | 0.038 | 0 | 0 | 82.609 |
| checklist-medium-single-equal | writing | 53.6 [35.8, 70.5] | 28 | 3060.714 | 14.849 | 85.714 | 0.034 | 0 | 0 | 53.571 |
| checklist-medium-single-writer | judgebench | 74.1 [55.3, 86.8] | 27 | 1644.444 | 6.804 | 100.000 | 0.062 | 0 | 0 | 74.074 |
| checklist-medium-single-writer | mmeval | 82.6 [62.9, 93.0] | 23 | 2121.739 | 8.884 | 100.000 | 0.038 | 0 | 0 | 82.609 |
| checklist-medium-single-writer | writing | 53.6 [35.8, 70.5] | 28 | 3060.714 | 14.849 | 85.714 | 0.034 | 0 | 0 | 53.571 |
| ledger | judgebench | 94.4 [79.1, 98.7] | 27 | 0.000 | unknown | 207.407 | unknown | n/a | n/a | n/a |
| ledger | mmeval | 72.7 [43.4, 90.3] | 11 | 0.000 | unknown | unknown | unknown | n/a | n/a | n/a |
| ledger | writing | 57.1 [39.1, 73.5] | 28 | 0.000 | unknown | 225.000 | 0.256 | n/a | n/a | n/a |
| promptfoo | judgebench | 97.4 [79.1, 99.7] | 19 | 0.000 | unknown | 200.000 | unknown | n/a | n/a | n/a |
| promptfoo | mmeval | 90.9 [62.3, 98.4] | 11 | 0.000 | unknown | 200.000 | unknown | n/a | n/a | n/a |
| promptfoo | writing | 55.4 [37.4, 72.0] | 28 | 0.000 | unknown | 200.000 | 0.148 | n/a | n/a | n/a |

Tuning-selected variant: `checklist-medium-single-equal`.

S1 has no published tariff. S2 cost uses the harness token-price constants and recorded usage.
S1 latency is the sum of returned call durations per pair, not end-to-end parallel wall time.
Cold cohort submissions including retries are shown. Duplicate prompts share generation; weights reuse ticks.
JSON also reports logical S1 calls and incremental validation S2 cost after the tuning cache.
Warm checklist reuse makes incremental S2 calls and USD zero. Full exact replay makes all calls zero.
Headline uses short checklists as returned. Strict accuracy instead abstains on fewer than four boxes.
Missing checklist/tick answers still abstain for half credit and remain in the denominator.
Baseline games use the harness fractional tie/order scoring. Missing baseline cost stays unknown.
Intervals are descriptive Wilson intervals under the harness convention; no multiple-comparison correction.
pA is a bounded score margin, not an empirically calibrated win probability.

## Short-checklist sensitivity

| Variant | Benchmark | Half | Short pairs | As-returned accuracy | Strict abstention accuracy |
|---|---|---|---:|---:|---:|
| checklist-low-batch-equal | judgebench | tune | 3 | 100.0 | 50.0 |
| checklist-low-batch-writer | judgebench | tune | 3 | 100.0 | 50.0 |
| checklist-low-single-equal | judgebench | tune | 3 | 100.0 | 50.0 |
| checklist-low-single-writer | judgebench | tune | 3 | 100.0 | 50.0 |

## Matched baseline subsets

| Variant | Benchmark | Baseline | Matched pairs | Checklist accuracy [95% CI] | Baseline accuracy [95% CI] |
|---|---|---|---:|---:|---:|
| checklist-low-batch-equal | judgebench | ledger | 27 | 81.5 [63.3, 91.8] | 94.4 [79.1, 98.7] |
| checklist-low-batch-equal | judgebench | promptfoo | 19 | 89.5 [68.6, 97.1] | 97.4 [79.1, 99.7] |
| checklist-low-batch-equal | mmeval | ledger | 11 | 90.9 [62.3, 98.4] | 72.7 [43.4, 90.3] |
| checklist-low-batch-equal | mmeval | promptfoo | 11 | 90.9 [62.3, 98.4] | 90.9 [62.3, 98.4] |
| checklist-low-batch-equal | writing | ledger | 28 | 60.7 [42.4, 76.4] | 57.1 [39.1, 73.5] |
| checklist-low-batch-equal | writing | promptfoo | 28 | 60.7 [42.4, 76.4] | 55.4 [37.4, 72.0] |
| checklist-low-batch-writer | judgebench | ledger | 27 | 81.5 [63.3, 91.8] | 94.4 [79.1, 98.7] |
| checklist-low-batch-writer | judgebench | promptfoo | 19 | 89.5 [68.6, 97.1] | 97.4 [79.1, 99.7] |
| checklist-low-batch-writer | mmeval | ledger | 11 | 90.9 [62.3, 98.4] | 72.7 [43.4, 90.3] |
| checklist-low-batch-writer | mmeval | promptfoo | 11 | 90.9 [62.3, 98.4] | 90.9 [62.3, 98.4] |
| checklist-low-batch-writer | writing | ledger | 28 | 60.7 [42.4, 76.4] | 57.1 [39.1, 73.5] |
| checklist-low-batch-writer | writing | promptfoo | 28 | 60.7 [42.4, 76.4] | 55.4 [37.4, 72.0] |
| checklist-low-single-equal | judgebench | ledger | 27 | 79.6 [61.3, 90.6] | 94.4 [79.1, 98.7] |
| checklist-low-single-equal | judgebench | promptfoo | 19 | 84.2 [62.4, 94.5] | 97.4 [79.1, 99.7] |
| checklist-low-single-equal | mmeval | ledger | 11 | 90.9 [62.3, 98.4] | 72.7 [43.4, 90.3] |
| checklist-low-single-equal | mmeval | promptfoo | 11 | 90.9 [62.3, 98.4] | 90.9 [62.3, 98.4] |
| checklist-low-single-equal | writing | ledger | 28 | 60.7 [42.4, 76.4] | 57.1 [39.1, 73.5] |
| checklist-low-single-equal | writing | promptfoo | 28 | 60.7 [42.4, 76.4] | 55.4 [37.4, 72.0] |
| checklist-low-single-writer | judgebench | ledger | 27 | 79.6 [61.3, 90.6] | 94.4 [79.1, 98.7] |
| checklist-low-single-writer | judgebench | promptfoo | 19 | 84.2 [62.4, 94.5] | 97.4 [79.1, 99.7] |
| checklist-low-single-writer | mmeval | ledger | 11 | 90.9 [62.3, 98.4] | 72.7 [43.4, 90.3] |
| checklist-low-single-writer | mmeval | promptfoo | 11 | 90.9 [62.3, 98.4] | 90.9 [62.3, 98.4] |
| checklist-low-single-writer | writing | ledger | 28 | 60.7 [42.4, 76.4] | 57.1 [39.1, 73.5] |
| checklist-low-single-writer | writing | promptfoo | 28 | 60.7 [42.4, 76.4] | 55.4 [37.4, 72.0] |
| checklist-medium-batch-equal | judgebench | ledger | 27 | 72.2 [53.4, 85.5] | 94.4 [79.1, 98.7] |
| checklist-medium-batch-equal | judgebench | promptfoo | 19 | 68.4 [46.0, 84.6] | 97.4 [79.1, 99.7] |
| checklist-medium-batch-equal | mmeval | ledger | 11 | 81.8 [52.3, 94.9] | 72.7 [43.4, 90.3] |
| checklist-medium-batch-equal | mmeval | promptfoo | 11 | 81.8 [52.3, 94.9] | 90.9 [62.3, 98.4] |
| checklist-medium-batch-equal | writing | ledger | 28 | 53.6 [35.8, 70.5] | 57.1 [39.1, 73.5] |
| checklist-medium-batch-equal | writing | promptfoo | 28 | 53.6 [35.8, 70.5] | 55.4 [37.4, 72.0] |
| checklist-medium-batch-writer | judgebench | ledger | 27 | 75.9 [57.3, 88.1] | 94.4 [79.1, 98.7] |
| checklist-medium-batch-writer | judgebench | promptfoo | 19 | 73.7 [51.2, 88.2] | 97.4 [79.1, 99.7] |
| checklist-medium-batch-writer | mmeval | ledger | 11 | 81.8 [52.3, 94.9] | 72.7 [43.4, 90.3] |
| checklist-medium-batch-writer | mmeval | promptfoo | 11 | 81.8 [52.3, 94.9] | 90.9 [62.3, 98.4] |
| checklist-medium-batch-writer | writing | ledger | 28 | 57.1 [39.1, 73.5] | 57.1 [39.1, 73.5] |
| checklist-medium-batch-writer | writing | promptfoo | 28 | 57.1 [39.1, 73.5] | 55.4 [37.4, 72.0] |
| checklist-medium-single-equal | judgebench | ledger | 27 | 70.4 [51.5, 84.1] | 94.4 [79.1, 98.7] |
| checklist-medium-single-equal | judgebench | promptfoo | 19 | 68.4 [46.0, 84.6] | 97.4 [79.1, 99.7] |
| checklist-medium-single-equal | mmeval | ledger | 11 | 81.8 [52.3, 94.9] | 72.7 [43.4, 90.3] |
| checklist-medium-single-equal | mmeval | promptfoo | 11 | 81.8 [52.3, 94.9] | 90.9 [62.3, 98.4] |
| checklist-medium-single-equal | writing | ledger | 28 | 53.6 [35.8, 70.5] | 57.1 [39.1, 73.5] |
| checklist-medium-single-equal | writing | promptfoo | 28 | 53.6 [35.8, 70.5] | 55.4 [37.4, 72.0] |
| checklist-medium-single-writer | judgebench | ledger | 27 | 74.1 [55.3, 86.8] | 94.4 [79.1, 98.7] |
| checklist-medium-single-writer | judgebench | promptfoo | 19 | 73.7 [51.2, 88.2] | 97.4 [79.1, 99.7] |
| checklist-medium-single-writer | mmeval | ledger | 11 | 81.8 [52.3, 94.9] | 72.7 [43.4, 90.3] |
| checklist-medium-single-writer | mmeval | promptfoo | 11 | 81.8 [52.3, 94.9] | 90.9 [62.3, 98.4] |
| checklist-medium-single-writer | writing | ledger | 28 | 53.6 [35.8, 70.5] | 57.1 [39.1, 73.5] |
| checklist-medium-single-writer | writing | promptfoo | 28 | 53.6 [35.8, 70.5] | 55.4 [37.4, 72.0] |
