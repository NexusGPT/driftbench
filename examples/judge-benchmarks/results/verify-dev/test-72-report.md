# Frozen LongJudge verify TEST confirmation

## Original 72-item TEST result

This is a complete 72-item stratified confirmation on a previously evaluated split. The result is stored at 06:08:52 CEST. All 72 items return valid binary verdicts, with zero missing answers. The source and both audit maps match the freeze.

| Judge, same 72 items | Official accuracy | Official balanced | Audited accuracy | Audited balanced | USD per 100 |
|---|---:|---:|---:|---:|---:|
| Frozen uncertainty cascade | 83.3% (60/72) | 82.1% | 91.7% (66/72) | 94.7% | $0.9670 |
| Inspect, unchanged template | 80.6% (58/72) | 80.4% | 88.9% (64/72) | 93.0% | $0.2280 |

The strict 22-correction audit gives 65/72 (90.3%); it excludes the final-option-policy correction. The primary audit gives two more correct judgments than Inspect on this cohort. This is a point-estimate gain; the sample does not prove a population accuracy above 90%.

| Labels | Raw sample estimate | Raw Wilson 95% interval | Population-weighted estimate | Stratified approximate 95% interval |
|---|---:|---:|---:|---:|
| Official | 83.3% | 73.1 to 90.2% | 83.3% | 59.5 to 94.6% |
| Primary audit, 23 frozen corrections | 91.7% | 83.0 to 96.1% | 91.8% | 67.7 to 97.4% |
| Strict audit, 22 literal corrections | 90.3% | 81.3 to 95.2% | 90.2% | 67.2 to 97.2% |

Configuration execution cost is $0.69622344, including reused replies. New fees are $0.69300114; recorded task spend at this result is $3.53980411. The pass uses 330 required replies, 328 new and 2 replayed. Total elapsed time is 5498.825 seconds. The independent checker passes all protocol, score, interval and cost checks with no model calls.

The population interval combines four Bonferroni-adjusted Wilson intervals and omits finite-population correction. It is conservative and approximate. It does not correct prior TEST exposure or the throughput-dependent choice of sample size. Source artifacts: `test-result.json`, `test-metrics.json`, `test-baseline-cohort-costs.json`, and `final-evidence-checks.json`.

