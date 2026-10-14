# Hard and fresh held-out results

Candidates are **not yet the shipped default**. Fresh cohort seed: 20261013.

| Row | Hard shipped | Hard candidate | Hard native default | Fresh shipped | Fresh candidate | Fresh native default |
|---|---|---|---|---|---|---|
| Per-criterion rules | 116/120 (95% 91.74% to 98.70%; coverage 120/120; 0 unanswered) | 117/120 (95% 92.91% to 99.15%; coverage 120/120; 0 unanswered) | 120/120 (95% 96.90% to 100.00%; coverage 120/120; 0 unanswered) | 56/60 (95% 84.07% to 97.38%; coverage 60/60; 0 unanswered) | 59/60 (95% 91.14% to 99.71%; coverage 60/60; 0 unanswered) | 60/60 (95% 93.98% to 100.00%; coverage 60/60; 0 unanswered) |
| Verdict vector | 102/120 (95% 77.53% to 90.30%; coverage 120/120; 0 unanswered) | 112/120 (95% 87.39% to 96.58%; coverage 120/120; 0 unanswered) | 120/120 (95% 96.90% to 100.00%; coverage 120/120; 0 unanswered) | 50/60 (95% 71.97% to 90.69%; coverage 60/60; 0 unanswered) | 57/60 (95% 86.30% to 98.29%; coverage 60/60; 0 unanswered) | 60/60 (95% 93.98% to 100.00%; coverage 60/60; 0 unanswered) |
| Simulated user | 116/120 (95% 91.74% to 98.70%; coverage 120/120; 0 unanswered) | 120/120 (95% 96.90% to 100.00%; coverage 120/120; 0 unanswered) | 96/120 (95% 71.96% to 86.18%; coverage 120/120; 0 unanswered) | 60/60 (95% 93.98% to 100.00%; coverage 60/60; 0 unanswered) | 60/60 (95% 93.98% to 100.00%; coverage 60/60; 0 unanswered) | 43/60 (95% 59.23% to 81.49%; coverage 60/60; 0 unanswered) |
| PII full | 108/120 (95% 83.33% to 94.19%; coverage 120/120; 0 unanswered) | 120/120 (95% 96.90% to 100.00%; coverage 120/120; 0 unanswered) | 88/120 (95% 64.79% to 80.43%; coverage 120/120; 0 unanswered) | 55/60 (95% 81.93% to 96.39%; coverage 60/60; 0 unanswered) | 60/60 (95% 93.98% to 100.00%; coverage 60/60; 0 unanswered) | 45/60 (95% 62.77% to 84.22%; coverage 60/60; 0 unanswered) |
| PII enabled scope | 79/90 (95% 79.43% to 93.04%; coverage 90/90; 0 unanswered) | 90/90 (95% 95.91% to 100.00%; coverage 90/90; 0 unanswered) | 88/90 (95% 92.26% to 99.39%; coverage 90/90; 0 unanswered) | 41/46 (95% 76.96% to 95.27%; coverage 46/46; 0 unanswered) | 46/46 (95% 92.29% to 100.00%; coverage 46/46; 0 unanswered) | 45/46 (95% 88.66% to 99.62%; coverage 46/46; 0 unanswered) |
| Injection | 117/120 (95% 92.91% to 99.15%; coverage 120/120; 0 unanswered) | 103/120 (95% 78.48% to 90.96%; coverage 120/120; 2 unanswered) | unmeasured (Azure) | 57/60 (95% 86.30% to 98.29%; coverage 60/60; 0 unanswered) | 51/60 (95% 73.89% to 91.90%; coverage 60/60; 1 unanswered) | unmeasured (Azure) |
| Pairwise | 106/120 (95% 81.37% to 92.92%; coverage 120/120; 0 unanswered) | 120/120 (95% 96.90% to 100.00%; coverage 120/120; 0 unanswered) | 119/120 (95% 95.43% to 99.85%; coverage 120/120; 0 unanswered) | 41/60 (95% 55.77% to 78.69%; coverage 60/60; 0 unanswered) | 60/60 (95% 93.98% to 100.00%; coverage 60/60; 0 unanswered) | 58/60 (95% 88.64% to 99.08%; coverage 60/60; 0 unanswered) |

## PR 115 default at approved commit

The old main contract remains the historical baseline above. PR 115 default is measured from a fresh detached checkout at 8195902dd20c84267f85feba268c17868e00dfbe; replacement depends on CI/merge.

| Cohort | PR 115 default | Audit candidate, not yet shipped | Native default |
|---|---|---|---|
| Hard 120 | 120/120 (95% 96.90% to 100.00%; coverage 120/120; 0 unanswered) | 120/120 (95% 96.90% to 100.00%; coverage 120/120; 0 unanswered) | 119/120 (95% 95.43% to 99.85%; coverage 120/120; 0 unanswered) |
| Frozen fresh 60 | 60/60 (95% 93.98% to 100.00%; coverage 60/60; 0 unanswered) | 60/60 (95% 93.98% to 100.00%; coverage 60/60; 0 unanswered) | 58/60 (95% 88.64% to 99.08%; coverage 60/60; 0 unanswered) |

| Measurement | Model USD per 100 scored units | Attributable USD | Unscored transport cases |
|---|---|---|---|
| judges-ours-primary | 0.08322158 | 0.09986590 | 0 |
| judges-ours-vector | 0.08322158 | 0.09986590 | 0 |
| judges-ours-aggregate | 0.08322158 | 0.09986590 | 0 |
| judges-audit-primary | 0.10277642 | 0.12333170 | 0 |
| judges-audit-vector | 0.10277642 | 0.12333170 | 0 |
| judges-audit-aggregate | 0.10277642 | 0.12333170 | 0 |
| judges-theirs-primary | 0.10321302 | 0.12385562 | 0 |
| judges-theirs-vector | 0.10321302 | 0.12385562 | 0 |
| judges-theirs-aggregate | 0.10321302 | 0.12385562 | 0 |
| simulator-ours | 0.03001917 | 0.03602300 | 0 |
| simulator-checked | 0.05373708 | 0.06448450 | 0 |
| simulator-theirs | 0.02840117 | 0.03408140 | 0 |
| pii-ours | 0.04153883 | 0.04984660 | 0 |
| pii-ours-enabled | 0.05538511 | 0.04984660 | 0 |
| pii-ours-judge-scope | 0.04153883 | 0.04984660 | 0 |
| pii-ours-judge-only-full | 0.04153883 | 0.04984660 | 0 |
| pii-audit | 0.08304417 | 0.09965300 | 0 |
| pii-audit-enabled | 0.11072556 | 0.09965300 | 0 |
| pii-audit-judge-scope | 0.08304417 | 0.09965300 | 0 |
| pii-native | 0.00000000 | 0.00000000 | 0 |
| pii-native-enabled | 0.00000000 | 0.00000000 | 0 |
| injection-ours | 0.04804150 | 0.05764980 | 0 |
| injection-audit | 0.10458408 | 0.12550090 | 0 |
| pairwise-ours | 0.05208127 | 0.06249752 | 0 |
| pairwise-checked | 0.07985354 | 0.09582425 | 0 |
| pairwise-theirs | 0.03921580 | 0.04705896 | 0 |
| judges-ours-heldout-primary | 0.08471533 | 0.05082920 | 0 |
| judges-ours-heldout-vector | 0.08471533 | 0.05082920 | 0 |
| judges-ours-heldout-aggregate | 0.08471533 | 0.05082920 | 0 |
| judges-audit-heldout-primary | 0.10427667 | 0.06256600 | 0 |
| judges-audit-heldout-vector | 0.10427667 | 0.06256600 | 0 |
| judges-audit-heldout-aggregate | 0.10427667 | 0.06256600 | 0 |
| judges-theirs-heldout-primary | 0.10700795 | 0.06420477 | 0 |
| judges-theirs-heldout-vector | 0.10700795 | 0.06420477 | 0 |
| judges-theirs-heldout-aggregate | 0.10700795 | 0.06420477 | 0 |
| simulator-ours-heldout | 0.03036133 | 0.01821680 | 0 |
| simulator-checked-heldout | 0.05560667 | 0.03336400 | 0 |
| simulator-theirs-heldout | 0.03050267 | 0.01830160 | 0 |
| pii-ours-heldout | 0.04489683 | 0.02693810 | 0 |
| pii-ours-heldout-enabled | 0.05856109 | 0.02693810 | 0 |
| pii-ours-heldout-judge-scope | 0.04489683 | 0.02693810 | 0 |
| pii-ours-heldout-judge-only-full | 0.04489683 | 0.02693810 | 0 |
| pii-audit-heldout | 0.09095683 | 0.05457410 | 0 |
| pii-audit-heldout-enabled | 0.11863935 | 0.05457410 | 0 |
| pii-audit-heldout-judge-scope | 0.09095683 | 0.05457410 | 0 |
| pii-native-heldout | 0.00000000 | 0.00000000 | 0 |
| pii-native-heldout-enabled | 0.00000000 | 0.00000000 | 0 |
| injection-ours-heldout | 0.04852650 | 0.02911590 | 0 |
| injection-audit-heldout | 0.11523517 | 0.06914110 | 0 |
| pairwise-ours-heldout | 0.07454233 | 0.04472540 | 0 |
| pairwise-checked-heldout | 0.08509573 | 0.05105744 | 0 |
| pairwise-theirs-heldout | 0.07325517 | 0.04395310 | 0 |
| pairwise-pr115 | 0.08797488 | 0.10556985 | 0 |
| pairwise-pr115-heldout | 0.08890097 | 0.05334058 | 0 |
| judges-pr115-primary | 0.08732167 | 0.10478600 | 0 |
| judges-pr115-vector | 0.08732167 | 0.10478600 | 0 |
| judges-pr115-heldout-primary | 0.08802533 | 0.05281520 | 0 |
| judges-pr115-heldout-vector | 0.08802533 | 0.05281520 | 0 |

New-task recorded invocations: 3411; unique charged spend 1.76119205 USD, including 3 interrupted-call reservations totaling 0.09 USD.
Raw failed CLI invocations: 10. Empty native structured CLI outputs receive one recovery attempt; unrecovered transport cases are unscored, never quality losses.

Prototype judge sets v1/v2/v3 are excluded from accuracy, but all their charges remain. Pairwise hard scores come from the preceding round; their attributable costs are shown but excluded from new-task spend.

Hard sets are the development cohorts. Candidate procedures are frozen before generative held-out calls. Held-out labels and source/fixture hashes are recorded before calls. No held-out tuning occurs. Shared generator families remain correlated; Wilson intervals are descriptive and do not prove population-level superiority. Azure results stay unmeasured without native credentials; no proxy is used.
