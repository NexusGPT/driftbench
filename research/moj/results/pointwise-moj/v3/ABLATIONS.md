# Prespecified changes and ablations

Validation is report-only. Each row adds one hypothesis; v3 is the final owner-requested freeze.

| Arm | Benchmark | Accuracy | Balanced | Sensitivity | Specificity | S2 calls/100 | Known S2 USD/100 |
|---|---|---:|---:|---:|---:|---:|---:|
| v1 frozen | rubricbench | 91.3 | 91.5 | 87.5 | 95.5 | 45.7 | 0.020494 |
| v1 frozen | hardrows | 96.3 | 96.0 | 100.0 | 92.0 | 14.8 | 0.001693 |
| v1 frozen | verify | 61.2 | 59.5 | 57.1 | 61.9 | 469.4 | 0.596319 |
| v1 frozen | verify-with-reference | 80.0 | 56.7 | 20.0 | 93.3 | 87.3 | 0.066335 |
| v2 supplied terminal | rubricbench | 91.3 | 91.5 | 87.5 | 95.5 | 45.7 | 0.020494 |
| v2 supplied terminal | hardrows | 92.6 | 92.0 | 100.0 | 84.0 | 3.7 | 0.000219 |
| v2 supplied terminal | verify | 61.2 | 59.5 | 57.1 | 61.9 | 469.4 | 0.596319 |
| v2 supplied terminal | verify-with-reference | 96.4 | 93.9 | 90.0 | 97.8 | 0.0 | 0.000000 |
| v2 plus generated terminal | rubricbench | 91.3 | 91.5 | 87.5 | 95.5 | 45.7 | 0.020494 |
| v2 plus generated terminal | hardrows | 92.6 | 92.0 | 100.0 | 84.0 | 3.7 | 0.000219 |
| v2 plus generated terminal | verify | 81.6 | 77.4 | 71.4 | 83.3 | 100.0 | 0.047384 |
| v2 plus generated terminal | verify-with-reference | 96.4 | 93.9 | 90.0 | 97.8 | 0.0 | 0.000000 |
| v3 tuning confidence gate | rubricbench | 91.3 | 91.5 | 87.5 | 95.5 | 45.7 | 0.020494 |
| v3 tuning confidence gate | hardrows | 96.3 | 96.0 | 100.0 | 92.0 | 7.4 | 0.000619 |
| v3 tuning confidence gate | verify | 69.4 | 70.2 | 71.4 | 69.0 | 295.9 | 0.282956 |
| v3 tuning confidence gate | verify-with-reference | 87.3 | 68.9 | 40.0 | 97.8 | 29.1 | 0.020393 |

v2 reproduces the two designer results, but unconditional supplied-reference authority regresses hard rows.
v3 fits one common threshold on primary tuning data. Calibrated confidence must be at least 0.6; otherwise the reference decision enters the existing escalation and panel route.
Reference-free items always begin with pw_ref_luna. Neither pw_rows nor pw_whole may judge unsupported correctness, even below the terminal threshold.
The threshold improves conditional tuning mean balanced accuracy from 78.98 to 80.18 percent. Only the new expert-confidence maps are cross-fitted; inherited routing maps stay frozen.
The validation result restores hard rows but loses part of both Verify gains. No validation result selects another threshold or an exception.
Verify with reference stays diagnostic, outside fitting and the primary residual. Its groups differ from vanilla Verify; overlapping IDs across modes are disclosed in validation.json.
