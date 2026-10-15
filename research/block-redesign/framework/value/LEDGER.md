# Ledger: lane fw-value (cap 12 USD, stop at 10.8 USD)

Computed by `src/ledger.py` from `data/usage.jsonl`: each paid call's provider usage fields times the prices in `src/common.py` (the prices are listed in PREREG.md). Calls that errored before returning usage cost nothing and are not listed.

<!-- table -->
| Batch | Model | Calls | Input tokens | Cached input | Output tokens | USD | Cumulative USD |
|---|---|---|---|---|---|---|---|
| tiny-labels | gpt-6.1-sol | 3 | 9715 | 0 | 197 | 0.0214 | 0.0214 |
| tiny-labels | gemini-3.6-flash | 3 | 10651 | 0 | 338 | 0.0093 | 0.0307 |
| hf7-gpt-6-luna | gpt-6-luna | 59 | 9878 | 0 | 3557 | 0.0028 | 0.0334 |
| hf7-gemini-3.6-flash | gemini-3.6-flash | 60 | 10719 | 0 | 2655 | 0.0180 | 0.0514 |
| hf8-classifier | gpt-6-luna | 4 | 1456 | 0 | 439 | 0.0004 | 0.0518 |
| hf9-target_a-base1 | claude-haiku-5-5 | 12 | 43979 | 27056 | 899 | 0.0028 | 0.0545 |

Total: 0.0545 USD of 12 (stop line 10.8).
<!-- /table -->

## Tiny sample and projection (written before scaling)

Measured on the tiny samples (rows `tiny-labels`, the first 4 HF7 items per model, 4 HF8 classifications, 4 agent runs):

| Unit | Measured USD per unit | Units left | Projected USD |
|---|---|---|---|
| HF5 label, gpt-6.1-sol | 0.0071 | 256 | 1.82 |
| HF5 label, gemini-3.6-flash | 0.0031 | 256 | 0.79 |
| HF7 judgment, gpt-6-luna (both designs) | 0.00006 | 1488 | 0.09 |
| HF7 judgment, gemini-3.6-flash (both designs) | 0.00037 | 1488 | 0.56, x1.5 for the comparison calls negatives need: 0.85 |
| HF8 reply classification, gpt-6-luna | 0.00009 | 178 | 0.02 |
| HF5 rung 3, gpt-6-luna | about 0.00006 per call | about 100 calls | 0.01 |
| HF9 agent run, claude-haiku-5-5 | 0.00069 | 1697 | 1.17 |

Projected lane total: about 4.8 USD, under the 10.8 USD stop line. No fallback from PREREG is needed. No code or prompt changed after the tiny samples, so their answers stay in the data.
