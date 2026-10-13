# Hard and held-out grading results

Measured 2026-10-13T03:53:22.038Z. Model: claude-haiku-5-5. Each procedure runs once per set. Each runner permits two calls. Two controllers overlap before an exclusive runner lock is added, exceeding the global two-call limit; every submitted reply and cost is retained. Subsequent runners serialize before loading reservations. Partial rows state completed coverage and have no superiority verdict. Shipped/default panel procedures and three-vote candidates use three sequential votes. The adaptive prefix consumes only through its first conclusive ledger. Unscored results count against the full denominator.

## qa

| Procedure | Hard correct / completed (120 requested) | Held-out correct / completed (60 requested) | Hard 95% CI | Held-out 95% CI | Hard unscored | Held-out unscored | Hard USD / 100 | Held-out USD / 100 |
|---|---|---|---|---|---|---|---|---|
| Shipped baseline | 111/120 | 48/60 | 86.4 to 96.0% | 68.2 to 88.2% | 0 | 5 | 0.04450 | 0.04762 |
| Inspect default | 115/120 | 57/60 | 90.6 to 98.2% | 86.3 to 98.3% | 0 | 0 | 0.05867 | 0.06229 |
| Candidate: not yet the shipped default | 119/120 | 60/60 | 95.4 to 99.9% | 94.0 to 100.0% | 1 | 0 | 0.08023 | 0.08896 |
| PR 115 default (under review) | 114/120 | 44/60 | 89.5 to 97.7% | 61.0 to 82.9% | 5 | 6 | 0.04931 | 0.06238 |

Candidate result: hard ahead on accuracy; held-out ahead on accuracy.

## fact

| Procedure | Hard correct / completed (120 requested) | Held-out correct / completed (60 requested) | Hard 95% CI | Held-out 95% CI | Hard unscored | Held-out unscored | Hard USD / 100 | Held-out USD / 100 |
|---|---|---|---|---|---|---|---|---|
| Shipped baseline | 111/120 | 48/60 | 86.4 to 96.0% | 68.2 to 88.2% | 0 | 5 | 0.04450 | 0.04762 |
| Inspect default | 120/120 | 59/60 | 96.9 to 100.0% | 91.1 to 99.7% | 0 | 0 | 0.05557 | 0.05958 |
| Candidate: not yet the shipped default | 119/120 | 60/60 | 95.4 to 99.9% | 94.0 to 100.0% | 1 | 0 | 0.08023 | 0.08896 |
| PR 115 default (under review) | 114/120 | 44/60 | 89.5 to 97.7% | 61.0 to 82.9% | 5 | 6 | 0.04931 | 0.06238 |

Candidate result: hard behind on accuracy; held-out ahead on accuracy.

## panel

| Procedure | Hard correct / completed (120 requested) | Held-out correct / completed (60 requested) | Hard 95% CI | Held-out 95% CI | Hard unscored | Held-out unscored | Hard USD / 100 | Held-out USD / 100 |
|---|---|---|---|---|---|---|---|---|
| Shipped baseline | 115/120 | 59/60 | 90.6 to 98.2% | 91.1 to 99.7% | 0 | 0 | 0.07094 | 0.07591 |
| Inspect default | 120/120 | 59/60 | 96.9 to 100.0% | 91.1 to 99.7% | 0 | 0 | 0.13238 | 0.13815 |
| Candidate: not yet the shipped default | 104/120 | 54/60 | 79.4 to 91.6% | 79.9 to 95.3% | 16 | 6 | 0.22809 | 0.24762 |

Candidate result: hard behind on accuracy; held-out behind on accuracy.

## borderline

| Procedure | Hard correct / completed (120 requested) | Held-out correct / completed (60 requested) | Hard 95% CI | Held-out 95% CI | Hard unscored | Held-out unscored | Hard USD / 100 | Held-out USD / 100 |
|---|---|---|---|---|---|---|---|---|
| Shipped baseline | 113/120 | 49/60 | 88.4 to 97.1% | 70.1 to 89.4% | 0 | 3 | 0.06856 | 0.07827 |
| Inspect default | 120/120 | 60/60 | 96.9 to 100.0% | 94.0 to 100.0% | 0 | 0 | 0.12110 | 0.12479 |
| Candidate: not yet the shipped default | 120/120 | 60/60 | 96.9 to 100.0% | 94.0 to 100.0% | 0 | 0 | 0.20982 | 0.22381 |

Candidate result: hard equal accuracy; held-out equal accuracy.

## Candidate with decoded quotes

This candidate is not yet the shipped default. These fresh sets have their own frozen seeds.

### panel

| Procedure | Hard correct / completed | Fresh held-out correct / completed | Hard 95% CI | Held-out 95% CI | Hard unscored | Held-out unscored | Hard USD/100 | Held-out USD/100 |
|---|---|---|---|---|---|---|---|---|
| Shipped baseline | 115/120 | 60/60 | 90.6 to 98.2% | 94.0 to 100.0% | 0 | 0 | 0.07094 | 0.07457 |
| Candidate with decoded quotes | 117/120 | 58/60 | 92.9 to 99.1% | 88.6 to 99.1% | 2 | 2 | 0.22809 | 0.24603 |
| Inspect default | 120/120 | 60/60 | 96.9 to 100.0% | 94.0 to 100.0% | 0 | 0 | 0.13238 | 0.13486 |

Result: hard behind on accuracy; held-out behind on accuracy.

### borderline

| Procedure | Hard correct / completed | Fresh held-out correct / completed | Hard 95% CI | Held-out 95% CI | Hard unscored | Held-out unscored | Hard USD/100 | Held-out USD/100 |
|---|---|---|---|---|---|---|---|---|
| Shipped baseline | 113/120 | 53/60 | 88.4 to 97.1% | 77.8 to 94.2% | 0 | 3 | 0.06856 | 0.07870 |
| Candidate with decoded quotes | 120/120 | 60/60 | 96.9 to 100.0% | 94.0 to 100.0% | 0 | 0 | 0.20982 | 0.22527 |
| Inspect default | 120/120 | 60/60 | 96.9 to 100.0% | 94.0 to 100.0% | 0 | 0 | 0.12110 | 0.12520 |

Result: hard equal accuracy; held-out equal accuracy.

## Candidate with explicit scope rules

This candidate is not yet the shipped default. These fresh sets have their own frozen seeds.

### qa

| Procedure | Hard correct / completed | Fresh held-out correct / completed | Hard 95% CI | Held-out 95% CI | Hard unscored | Held-out unscored | Hard USD/100 | Held-out USD/100 |
|---|---|---|---|---|---|---|---|---|
| Shipped baseline | 111/120 | 51/60 | 86.4 to 96.0% | 73.9 to 91.9% | 0 | 4 | 0.04450 | 0.04797 |
| Candidate with explicit scope rules | 119/120 | 60/60 | 95.4 to 99.9% | 94.0 to 100.0% | 1 | 0 | 0.06078 | 0.06646 |
| Inspect default | 115/120 | 57/60 | 90.6 to 98.2% | 86.3 to 98.3% | 0 | 0 | 0.05867 | 0.06237 |

Result: hard ahead on accuracy; held-out ahead on accuracy.

### fact

| Procedure | Hard correct / completed | Fresh held-out correct / completed | Hard 95% CI | Held-out 95% CI | Hard unscored | Held-out unscored | Hard USD/100 | Held-out USD/100 |
|---|---|---|---|---|---|---|---|---|
| Shipped baseline | 111/120 | 51/60 | 86.4 to 96.0% | 73.9 to 91.9% | 0 | 4 | 0.04450 | 0.04797 |
| Candidate with explicit scope rules | 119/120 | 60/60 | 95.4 to 99.9% | 94.0 to 100.0% | 1 | 0 | 0.06078 | 0.06646 |
| Inspect default | 120/120 | 60/60 | 96.9 to 100.0% | 94.0 to 100.0% | 0 | 0 | 0.05557 | 0.05901 |

Result: hard behind on accuracy; held-out equal accuracy.

### panel

| Procedure | Hard correct / completed | Fresh held-out correct / completed | Hard 95% CI | Held-out 95% CI | Hard unscored | Held-out unscored | Hard USD/100 | Held-out USD/100 |
|---|---|---|---|---|---|---|---|---|
| Shipped baseline | 115/120 | 60/60 | 90.6 to 98.2% | 94.0 to 100.0% | 0 | 0 | 0.07094 | 0.07319 |
| Candidate with explicit scope rules | 120/120 | 59/60 | 96.9 to 100.0% | 91.1 to 99.7% | 0 | 1 | 0.14949 | 0.14991 |
| Inspect default | 120/120 | 59/60 | 96.9 to 100.0% | 91.1 to 99.7% | 0 | 0 | 0.13238 | 0.13544 |

Result: hard equal accuracy; held-out equal accuracy.

### borderline

| Procedure | Hard correct / completed | Fresh held-out correct / completed | Hard 95% CI | Held-out 95% CI | Hard unscored | Held-out unscored | Hard USD/100 | Held-out USD/100 |
|---|---|---|---|---|---|---|---|---|
| Shipped baseline | 113/120 | 56/60 | 88.4 to 97.1% | 84.1 to 97.4% | 0 | 3 | 0.06856 | 0.07884 |
| Candidate with explicit scope rules | 120/120 | 60/60 | 96.9 to 100.0% | 94.0 to 100.0% | 0 | 0 | 0.14872 | 0.15971 |
| Inspect default | 120/120 | 60/60 | 96.9 to 100.0% | 94.0 to 100.0% | 0 | 0 | 0.12110 | 0.12418 |

Result: hard equal accuracy; held-out equal accuracy.

## Adaptive ledger prefix

This candidate is not yet the shipped default. These fresh sets have their own frozen seeds.

### qa

| Procedure | Hard correct / completed | Fresh held-out correct / completed | Hard 95% CI | Held-out 95% CI | Hard unscored | Held-out unscored | Hard USD/100 | Held-out USD/100 |
|---|---|---|---|---|---|---|---|---|
| Shipped baseline | 111/120 | 51/60 | 86.4 to 96.0% | 73.9 to 91.9% | 0 | 4 | 0.04450 | 0.04797 |
| Adaptive ledger prefix | 119/120 | 60/60 | 95.4 to 99.9% | 94.0 to 100.0% | 1 | 0 | 0.06078 | 0.06646 |
| Inspect default | 115/120 | 57/60 | 90.6 to 98.2% | 86.3 to 98.3% | 0 | 0 | 0.05867 | 0.06237 |

Result: hard ahead on accuracy; held-out ahead on accuracy.

### fact

| Procedure | Hard correct / completed | Fresh held-out correct / completed | Hard 95% CI | Held-out 95% CI | Hard unscored | Held-out unscored | Hard USD/100 | Held-out USD/100 |
|---|---|---|---|---|---|---|---|---|
| Shipped baseline | 111/120 | 51/60 | 86.4 to 96.0% | 73.9 to 91.9% | 0 | 4 | 0.04450 | 0.04797 |
| Adaptive ledger prefix | 119/120 | 60/60 | 95.4 to 99.9% | 94.0 to 100.0% | 1 | 0 | 0.06078 | 0.06646 |
| Inspect default | 120/120 | 60/60 | 96.9 to 100.0% | 94.0 to 100.0% | 0 | 0 | 0.05557 | 0.05901 |

Result: hard behind on accuracy; held-out equal accuracy.

### panel

| Procedure | Hard correct / completed | Fresh held-out correct / completed | Hard 95% CI | Held-out 95% CI | Hard unscored | Held-out unscored | Hard USD/100 | Held-out USD/100 |
|---|---|---|---|---|---|---|---|---|
| Shipped baseline | 115/120 | 60/60 | 90.6 to 98.2% | 94.0 to 100.0% | 0 | 0 | 0.07094 | 0.07319 |
| Adaptive ledger prefix | 120/120 | 60/60 | 96.9 to 100.0% | 94.0 to 100.0% | 0 | 0 | 0.06863 | 0.06645 |
| Inspect default | 120/120 | 59/60 | 96.9 to 100.0% | 91.1 to 99.7% | 0 | 0 | 0.13238 | 0.13544 |

Result: hard equal accuracy, ahead on cost; held-out ahead on accuracy.

### borderline

| Procedure | Hard correct / completed | Fresh held-out correct / completed | Hard 95% CI | Held-out 95% CI | Hard unscored | Held-out unscored | Hard USD/100 | Held-out USD/100 |
|---|---|---|---|---|---|---|---|---|
| Shipped baseline | 113/120 | 56/60 | 88.4 to 97.1% | 84.1 to 97.4% | 0 | 3 | 0.06856 | 0.07884 |
| Adaptive ledger prefix | 120/120 | 60/60 | 96.9 to 100.0% | 94.0 to 100.0% | 0 | 0 | 0.06722 | 0.07207 |
| Inspect default | 120/120 | 60/60 | 96.9 to 100.0% | 94.0 to 100.0% | 0 | 0 | 0.12110 | 0.12418 |

Result: hard equal accuracy, ahead on cost; held-out equal accuracy, ahead on cost.

## Compact ledger with bounded retry

This candidate is not yet the shipped default. These fresh sets have their own frozen seeds.

### qa

| Procedure | Hard correct / completed | Fresh held-out correct / completed | Hard 95% CI | Held-out 95% CI | Hard unscored | Held-out unscored | Hard USD/100 | Held-out USD/100 |
|---|---|---|---|---|---|---|---|---|
| Shipped baseline | 111/120 | 52/60 | 86.4 to 96.0% | 75.8 to 93.1% | 0 | 3 | 0.04450 | 0.04853 |
| Compact ledger with bounded retry | 120/120 | 60/60 | 96.9 to 100.0% | 94.0 to 100.0% | 0 | 0 | 0.05695 | 0.06153 |
| Inspect default | 115/120 | 57/60 | 90.6 to 98.2% | 86.3 to 98.3% | 0 | 0 | 0.05867 | 0.06295 |

Result: hard ahead on accuracy; held-out ahead on accuracy.

### fact

| Procedure | Hard correct / completed | Fresh held-out correct / completed | Hard 95% CI | Held-out 95% CI | Hard unscored | Held-out unscored | Hard USD/100 | Held-out USD/100 |
|---|---|---|---|---|---|---|---|---|
| Shipped baseline | 111/120 | 52/60 | 86.4 to 96.0% | 75.8 to 93.1% | 0 | 3 | 0.04450 | 0.04853 |
| Compact ledger with bounded retry | 120/120 | 60/60 | 96.9 to 100.0% | 94.0 to 100.0% | 0 | 0 | 0.05695 | 0.06153 |
| Inspect default | 120/120 | 59/60 | 96.9 to 100.0% | 91.1 to 99.7% | 0 | 0 | 0.05557 | 0.05935 |

Result: hard equal accuracy; held-out ahead on accuracy.

Unique recorded calls: 7611. Reported spend: 3.81136334 USD. Conservative reserved spend: 3.83136334 USD, including 1 interrupted attempt reserved at its full cap. Costs per 100 items are logical procedure costs; shared QA/fact recordings are billed once.

The baseline remains 111/120 on the identical factual cases. The candidate is not yet the shipped default. PR 115 default (under review) is measured at 1270e1cb1eb324b2f3efbca816aa43fbcb092ae6 with only criterion and transcript supplied. No custom system, requirements, assessment, reference or legacy override is used. Zero model calls use the rejected a52e41e3 commit.

Held-out seed 20261013 uses the same construction functions, new bindings and shuffled template choices. Its labels and candidate hashes were frozen before runs in heldout-freeze.json. No candidate changes follow held-out results. Template-related cases limit the meaning of Wilson intervals; these intervals are descriptive, not a proof of population superiority. Equal-weight panels and strict majority agree on identical votes.
