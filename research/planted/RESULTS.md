# Planted truth and noise floor

Status: PARTIAL. Bank pairs measured: verify 95/95 and RubricBench 60/60. Noise triples: verify 16/30 and RubricBench 30/30.

Measured 2026-10-13T04:37:14.380659+00:00. Branch `research/astra-planted-truth`.
Bank freeze commit: `d88113cb33cef242b068e630b176651b97a7e743`. Seed: `astra-planted-truth-2026-10-13-v1`.

| Benchmark | Evaluated pairs | Strict defect detection, TPR (95% Wilson) | Strict clean acceptance, TNR (95% Wilson) | Both twins correct |
|---|---:|---|---|---|
| verify | 95/95 | 95/95 = 100.00% (96.11% to 100.00%) | 95/95 = 100.00% (96.11% to 100.00%) | 95/95 = 100.00% (96.11% to 100.00%) |
| rb | 60/60 | 43/60 = 71.67% (59.23% to 81.49%) | 43/60 = 71.67% (59.23% to 81.49%) | 43/60 = 71.67% (59.23% to 81.49%) |

These are construction-truth measurements. Each bank uses 10 repeated DEV templates. They are not original-benchmark accuracy estimates.
The frozen verify bank contains 91 distinct pairs among 95 rows. Four exact repeats arise from the probability-template parameter cycle. The bank stays frozen; these rows are not silently replaced after judging.
Deduplicated verify TPR: 91/91 = 100.00% (95.95% to 100.00%). Deduplicated TNR: 91/91 = 100.00% (95.95% to 100.00%). RubricBench contains 60 distinct pairs.
Verify has 190 answer judgments from 95 pairs. RubricBench has 60 canonical pair judgments, each evaluating one verbatim objective expert requirement.
Rubric TPR uses a score below full satisfaction on the defective reply. TNR uses full satisfaction on the clean reply. These are correlated within each pair.
RubricBench returns exactly one valid requirement grade on 43/60 pairs. On 17/60, the single-requirement schema is not met. Those outcomes count as unsuccessful in both strict rates, as specified before calls. They are protocol failures, not observed wrong semantic classifications.
Wilson intervals treat generated instances as independent Bernoulli observations. Reused template families limit that assumption and generalization.

RubricBench clean-winner recovery: 60/60 = 100.00% (93.98% to 100.00%).
Conditional on a valid single-requirement output, RubricBench TPR is 43/43 = 100.00% (91.80% to 100.00%) and TNR is 43/43 = 100.00% (91.80% to 100.00%). This conditional view excludes schema failures and does not replace the strict headline.

| Noise cohort | Complete items x repeats | Verdict flips / comparisons | Items with any flip | 95% floor on completed cohort | Extrapolated full-DEV floor | Smallest larger full-DEV gain |
|---|---:|---:|---:|---:|---:|---:|
| verify | 16 x 3 | 2/48 (4.17%) | 1/16 | 10.00% | 4.10% | 4/95 (4.21%) |
| rb | 30 x 3 | 8/90 (8.89%) | 4/30 | 7.54% | 2.19% | 8/357 (2.24%) |

The noise cohorts are restricted DEV samples: 30 of 38 eligible verify math/fictional-logic items, and all 30 eligible RubricBench math/MBPP items.
They do not represent all domains. Full-DEV thresholds extrapolate their estimated within-item variance to N=95 and N=357 respectively.
Valid saved verify judgments per repetition: [28, 16, 17]. Valid saved RubricBench judgments per repetition: [30, 30, 30].
If fewer than 30 triples are complete, the reported noise statistics cover only complete cases. Deadline truncation can favor faster items, so that partial pilot does not satisfy the full requested noise measurement.
All three pair comparisons per item are reported. They are correlated, so the uncertainty calculation resamples items with their repeats together.
Each repetition uses a fresh model-recording namespace. Prompts stay identical. Deterministic code evidence may be reused; model replies are not reused between repeats.
The floor is 1.95996 times sqrt(correctness-disagreement / N), for the difference between two independent one-run DEV accuracies. It is a pilot estimate, not a significance guarantee.
The smallest larger gain rounds this floor upward to the next achievable item count. A real variant comparison still needs a paired test and its own error control.


| Bank | DEV template | Constructed task | Pairs |
|---|---|---|---:|
| verify | `514cb7d27518d395ec9a46c2ae62c9bf_6a8c772c3cbf9a7e26dae82deafbc213` | Bracket closure | 10 |
| verify | `987731fefdee670139b52a3c2cd13b54_63abd6b1489e90a7836c25efd043d174` | Expected marble sum | 10 |
| verify | `2fabe7c11c7747a8d772a0ef0448e9a8_ce122c4fd3633a58d1e4ead1e46a9a01` | Prime factorization | 10 |
| verify | `8dce745bcd66e7dc916e9f3549d8ebc1_4495bceb02b2986125965eb7cb6c2b98` | Distinct tens digits | 10 |
| verify | `74455975cc7822e30f33648e197a1775_ccbe576fccccc23b0bdad67d79075fb2` | Successive discounts | 10 |
| verify | `a11d83cb0b8f07278223b4d659d85643_5518ab7ab0dd13c3c4a7e58909335b50` | Exponents and products | 9 |
| verify | `d39f096bb2596eb7d8955356ef44a14e_cc7a467fa14f91c15dd31328e13f485e` | Parabola locus | 9 |
| verify | `799919e29bafa202e0028952ff76d912_deee86a59cea577b40827ba2735e51f2` | Diagonal inverse | 9 |
| verify | `d29e283a52241c0a9a32224b711237bd_cab7eb980622deaad71cf6fe7e803264` | Unspecified fictional color | 9 |
| verify | `9cf12f34adac95169b15ddc25480ec2c_a7f2414568e73815e19f8370f3aeec89` | Linear equations | 9 |
| rb | `rubric_eval_178` | Frequency dictionary | 6 |
| rb | `rubric_eval_193` | Adjacent tuple pairs | 6 |
| rb | `rubric_eval_644` | Element cubes | 6 |
| rb | `rubric_eval_1051` | Nested integer sum | 6 |
| rb | `rubric_eval_161` | All capitals | 6 |
| rb | `rubric_eval_201` | No capitals | 6 |
| rb | `rubric_eval_279` | No commas | 6 |
| rb | `rubric_eval_833` | Exactly four numbers | 6 |
| rb | `rubric_eval_1115` | Second paragraph prefix | 6 |
| rb | `rubric_eval_49` | Complete code fence | 6 |

These counts expose template reuse. The approved construction changes parameters and one answer component; it does not create 155 independent task families.

- verify: accuracy by repeat 62.50%, 68.75%, 62.50%; correctness flips 4.17%; repeats per item for a 1-point full-DEV floor: 17.
- verify: item-bootstrap 95% interval for the full-DEV floor: 0.00% to 7.11%.
- verify: using the Wilson upper bound on three-repeat accuracy instability gives a conservative pilot guardrail of 8.74%; exceeding it requires 9/95 items. This is an uncertainty sensitivity calculation, not a separate measured improvement.
- rb: accuracy by repeat 83.33%, 86.67%, 83.33%; correctness flips 4.44%; repeats per item for a 1-point full-DEV floor: 5.
- rb: item-bootstrap 95% interval for the full-DEV floor: 0.00% to 3.46%.
- rb: using the Wilson upper bound on three-repeat accuracy instability gives a conservative pilot guardrail of 3.91%; exceeding it requires 14/357 items. This is an uncertainty sensitivity calculation, not a separate measured improvement.

| Experiment | Actual transport calls | Retained new model calls | Final scored-stage requests | Actual recorded USD |
|---|---:|---:|---:|---:|
| rb bank | 60 | 60 | 60 | 0.0296598 |
| verify bank | 576 | 574 | 789 | 0.3808830 |
| rb noise | 90 | 90 | 90 | 0.0932910 |
| verify noise | 295 | 286 | 286 | 0.4105292 |

Total transport attempts: 1021. Recorded spend: USD 0.9143630. Unpriced reserved amount: USD 0.00. Cap: USD 16.00. Peak active model calls: 6.
Last actual model-call start: 2026-10-13T04:34:58.140514+00:00. Calls starting at or after the 06:35 Brussels cutoff: 0.
Observed model identifiers: claude-haiku-5-5. Calls request the haiku alias.

The transport completed 11 attempts without a retained judge recording. This includes calls finishing during transport scheduling restarts. Their spend remains included above.
The initial bank run used two concurrent calls. The owner then raised concurrency to six and the task cap to USD 16. Existing bank predictions were preserved.
Verify noise repeats run in parallel with two call slots each under the shared six-call ceiling. The scheduling restart preserves recorded replies within their own repetition and keeps repetitions separate.
Per-judgment call accounting:
- Verify bank: 576 actual calls across 190 answer judgments, mean 3.032; shared blind-reference cache hits are listed separately in metrics.json.
- RubricBench bank: 60 calls across 60 pairs, mean 1.000 per pair. One canonical comparison provides both requirement grades.
- Verify noise: 61 completed full-cascade judgments used 275 retained calls, mean 4.508 (range 4 to 6). Total paid attempts: 295, including incomplete cascades and restart overhead.
- RubricBench noise: 90 calls across 90 planned pair judgments, mean 1.000.

Final scored-stage requests include cache replay in saved batches. Transport attempts include restart overhead. No attempt is dropped from the spend total.
Verification and limits:
- Independent read-back oracle checks accept all clean copies and reject all planted copies. Python function fixtures include empty inputs, negative values and repeated values.
- No model assigns bank truth. Original benchmark labels are used only to display repeat accuracy, not to construct or select bank labels.
- Source membership is checked with the frozen DEV hash rule. No TEST items are analyzed, judged or changed.
- Frozen prompt and inference files are copied byte-for-byte. Runtime changes concern transport metering and result reporting only.
- Partial, invalid or missing judgments cannot count as successes. Provider billing is authoritative; recorded CLI costs are not an invoice.

Evidence:
- `research/planted/manifest.json`, `bank-verify.json`, `bank-rb.json`, `noise-cohorts.json`: committed pre-call stimuli and seed.
- `research/planted/frozen-sources.json`: frozen judge source hashes.
- `research/planted/audit-bank.py`: independent construction checks.
- `research/planted/results/`: archived model recordings, per-item judgments, program observations, spend meter and progress.
- `research/planted/metrics.json`: exact counts, intervals, family rows, noise triples and call-stage counts.
