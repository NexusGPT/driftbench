## Expanded TEST confirmation

The final complete nested cohort contains 102 of 221 TEST items. It includes the original 72 unchanged predictions and 30 additional items. No judge, prompt, threshold, tool or audit-map changes follow the accepted 04:37 freeze. This remains a confirmation on a previously evaluated split.

| Judge, same 102 items | Official accuracy | Official balanced | Audited accuracy | Audited balanced | USD per 100 |
|---|---:|---:|---:|---:|---:|
| Frozen uncertainty cascade | 79.4% (81/102) | 74.7% | 91.2% (93/102) | 91.2% | $0.9958 |
| Inspect, unchanged template | 74.5% (76/102) | 68.1% | 86.3% (88/102) | 85.0% | $0.2312 |

| Labels | Raw sample estimate | Raw Wilson 95% interval | Population-weighted estimate | Stratified approximate 95% interval |
|---|---:|---:|---:|---:|
| Official | 79.4% | 70.6% to 86.1% | 79.3% | 59.1% to 91.9% |
| Primary audit, 23 corrections | 91.2% | 84.1% to 95.3% | 91.2% | 71.4% to 97.2% |
| Strict audit, 22 literal corrections | 90.2% | 82.9% to 94.6% | 90.1% | 70.8% to 97.1% |

Configuration execution cost is $1.01574277 for 102 items, including reused replies. Additional expansion fees are $0.31703663 for 139 new replies. Total newly recorded TEST fees are $1.01003777. Recorded task spend is $3.85684074, below the authorized $16 cap; unpriced interrupted calls remain excluded from this receipt-based total.

The original 72-item result remains separately reported. Expansion size uses only throughput and cost, with a 20% time margin and 90-second buffer. The approximate population interval combines four Bonferroni Wilson intervals without finite-population correction. It does not remove prior split exposure or throughput-dependent sample-size limitations. The historical 12 Oct reference3 score is 74.2% official across all 221 TEST items; that full-split score has a different denominator from this sample.

Source artifacts: `test-expanded-complete-result.json`, `test-expanded-metrics.json`, `test-expanded-comparison.json`, `test-expanded-inspect-replay.json` and `test-expanded-evidence-checks.json`. Inspect replay creates zero new model calls. All frozen hashes match.
