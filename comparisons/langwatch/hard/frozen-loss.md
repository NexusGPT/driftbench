# Frozen original losses and baseline scores

Historical criterion measurements use the confirmed defective adapter: a mixed-role trace is collapsed into an agent entry. Their original scores and raw answers remain unchanged, but they do not isolate pure judge quality. Corrected adapter v2 uses only new preregistered seeds20261019 and20261020; no historical criterion result is replaced. Nested role-like context text remains literal.

The original frozen procedures are not retuned. PR115 and new candidates remain separate studies.

| Metric | Hard old shipped | Hard audit candidate | Hard native | Fresh old shipped | Fresh audit candidate | Fresh native |
|---|---|---|---|---|---|---|
| judges-primary | 116/120 | 117/120 | 120/120 | 56/60 | 59/60 | 60/60 |
| judges-vector | 102/120 | 112/120 | 120/120 | 50/60 | 57/60 | 60/60 |
| simulator | 116/120 | 120/120 | 96/120 | 60/60 | 60/60 | 43/60 |
| pii | 108/120 | 120/120 | 88/120 | 55/60 | 60/60 | 45/60 |
| pii-enabled | 79/90 | 90/90 | 88/90 | 41/46 | 46/46 | 45/46 |
| injection | 117/120 | 103/120 | unmeasured, Azure | 57/60 | 51/60 | unmeasured, Azure |
| pairwise | 106/120 | 120/120 | 119/120 | 41/60 | 60/60 | 58/60 |

PII uses the explicitly configured component baseline; default-disabled entity misses and enabled-scope native scores remain separate. Costs and Wilson intervals appear in the full summary. The native criterion ceiling does not erase the other contestants' losses.
