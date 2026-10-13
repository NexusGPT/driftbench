# Validation comparison: moj-split-v2

All headline panel rows use the same 61 unique validation pairs, with 16 low-confidence pairs.
Hardrows uses 30 validation items, with 5 low-confidence items. Verify uses 55 validation items, with 9 low-confidence items.
Accuracy gives half credit to ties. Brackets are 95 percent group-bootstrap intervals, with Wilson intervals for constant binary cells.

| Cohort | Variant | n | Overall accuracy [95%] | Low-confidence accuracy [95%] | Calls / 100 | Low calls / 100 | USD / 100 |
|---|---|---:|---|---|---:|---:|---|
| Panel | recorded-stage1-or-fallback | 61 | 75.4% [65.5, 84.7] | 56.2% [41.2, 71.4] | 200.0 | 200.0 | unknown |
| Panel | panel-majority | 61 | 76.2% [65.6, 86.4] | 59.4% [33.3, 84.4] | 357.4 | 800.0 | unknown total; +$0.2057 panel |
| Panel | panel-weighted | 61 | 68.9% [57.1, 80.3] | 31.2% [11.8, 53.3] | 357.4 | 800.0 | unknown total; +$0.2057 panel |
| Panel | panel-cascade | 61 | 77.9% [67.5, 87.9] | 65.6% [40.0, 89.5] | 337.7 | 725.0 | unknown total; +$0.1985 panel |
| Panel | ledger | 61 | 68.0% [56.6, 79.3] | 28.1% [10.0, 46.4] | unknown | unknown | unknown |
| Panel | promptfoo | 61 | 74.6% [64.5, 84.2] | 59.4% [43.8, 75.0] | 200.0 | 200.0 | unknown |
| hardrows | reference-first | 30 | 96.7% [89.3, 100.0] | 100.0% [56.6, 100.0] | 100.0 | 100.0 | unknown (Jev) |
| hardrows | reference-blind | 30 | 56.7% [40.6, 72.4] | 60.0% [20.0, 100.0] | 100.0 | 100.0 | unknown (Jev) |
| hardrows | ledger | 30 | 100.0% [86.7, 100.0] | 100.0% [56.6, 100.0] | 100.0 | 100.0 | $0.0401 |
| hardrows | promptfoo | 30 | 83.3% [67.9, 96.4] | 0.0% [0.0, 43.4] | 100.0 | 100.0 | $0.0397 |
| hardrows | shipped | 30 | 93.3% [82.8, 100.0] | 60.0% [20.0, 100.0] | 100.0 | 100.0 | $0.0358 |
| verify-with-reference | reference-first | 55 | 95.5% [89.1, 100.0] | 88.9% [66.7, 100.0] | 100.0 | 100.0 | unknown (Jev) |
| verify-with-reference | reference-blind | 55 | 41.8% [29.1, 54.5] | 0.0% [0.0, 29.9] | 100.0 | 100.0 | unknown (Jev) |
| verify-with-reference | ledger | 19 | 84.2% [68.4, 100.0] | n/a | 467.4 | unknown | $0.5601 |
| verify-with-reference | promptfoo | 19 | 89.5% [73.7, 100.0] | n/a | 98.2 | unknown | $0.0741 |

## Verify on the same recorded-baseline items

Only 19 of the 55 validation Verify items have recorded vanilla baselines. The matched rows below use exactly those 19.
None of those 19 belong to the recorded low-confidence subset. The baseline prompts had no reference.

| Variant | n | Accuracy [95%] | Calls / 100 | USD / 100 |
|---|---:|---|---:|---|
| reference-first | 19 | 94.7% [84.2, 100.0] | 100.0 | unknown (Jev) |
| reference-blind | 19 | 57.9% [36.8, 78.9] | 100.0 | unknown (Jev) |
| ledger | 19 | 84.2% [68.4, 100.0] | 467.4 | $0.5601 |
| promptfoo | 19 | 89.5% [73.7, 100.0] | 98.2 | $0.0741 |

## Interpretation

- The panel intervals overlap. The fitted weighted variant is worse on validation; it is retained as a negative result.
- The reference ablations favor supplying the dataset reference on these cohorts. They do not establish a general benchmark-independent effect.
- Two returned panel outputs violate the forced-choice contract. They are retained, never retried, and incomplete panels fail closed.
- Cascade costs are a counterfactual replay of the recorded full panel: the same answers, with unused third-member calls excluded.
- Pairwise baseline cost gaps prevent a complete panel cost comparison. Incremental panel cost is fully recorded. Jev is unpriced, not free.

## Full initial practice population coverage

The matched panel table excludes missing baselines. This table retains those items and uses each row's own available coverage.
A missing recorded stage-1/promptfoo fallback is a routing-coverage failure, not a panel-model error.

| Variant | n | Accuracy [95%] | Missing verdicts |
|---|---:|---|---:|
| recorded-stage1-or-fallback | 81 | 56.8% [46.7, 66.7] | 20 |
| panel-majority | 81 | 57.4% [47.0, 67.9] | 21 |
| panel-weighted | 81 | 51.9% [41.2, 62.7] | 21 |
| panel-cascade | 81 | 58.6% [48.2, 69.1] | 20 |
| ledger | 67 | 70.9% [59.8, 81.3] | 4 |
| promptfoo | 61 | 74.6% [64.5, 84.2] | 0 |

## Accounting and replay

- Panel usage-based estimate: $0.229996.
- Shared accounting, including unknown-cost reservations: $8.634086 of $10.
- Returned submissions: 156 panel and 206 reference. Every actual call returned on submission one.
- Gemini remains paused by the owner; all 52 Gemini answers predate that pause.
- Panel, hardrows and Verify replay reconstruct every decision and metric from saved calls with no network.
- Vanilla Verify has no reference. Its separate reference-guided DEV adapter supplies upstream reference solutions.
- Verify reference ablation evaluates the complete validation half only; its fixed threshold needs no tuning calls.
