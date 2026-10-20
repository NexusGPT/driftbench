# Block parents experiments

**Research note.** This page records three pre-registered experiments on parent links between blocks. H12 is a simulation on the real parent forest of the Acme suite. H13 ran on a live fictional agent. All data is fictional. The scripts, pre-registrations and raw runs are in PR 416 (branch `research/block-parents`, head `1945e8510`).

The experiments cost 6.29 USD at a pessimistic stand-in price, of a 15 USD cap. Each pre-registration was pushed before its data.

## Results

| # | Claim | Verdict | Key numbers |
|---|---|---|---|
| H12a | Parent links recover the root count. | Supported in simulation | The root count is off by 8.4 with grouping, 38.2 with flat links and 50.8 with flat old counting. With no false-red flakes, grouping is exact in 72% of repeats against 6%. |
| H12b | Clustered intervals cover. | Supported in simulation | A naive Wilson interval covers 73.5% on clustered cells. Wilson on the effective sample size covers 91.0%. The hierarchical model covers 95.7% on its 24 cells. At the Acme-shaped cell of 25 trees, the best clustered interval covers 85.6%. |
| H13 | Isolation runs find undeclared parent dependencies. | Supported on a live agent, with limits | Planted positives caught: 8 of 8. Negatives flagged: 0 of 9. Natural edges with a dependency: 53 of 94 (56%). One of 54 repeat runs differed. |

## What the results mean

* **Grouping by the earliest failing ancestor counts roots.** It removes inherited duplicates. It cannot remove independent flakes. A 1% false-red rate leaves about 9 spurious roots in the 923 blocks, with or without grouping. A flaky parent still needs repeated runs.
* **A pass rate over parent-linked trees is clustered by construction.** Naive intervals are far too narrow. At the suite sizes of driftbench, only the hierarchical Beta-Bernoulli model came near 95% in these simulations. This matches Bowyer et al.
* **The isolation check separates a child that needs its stem from one that does not.** On Acme the dependency is almost always the conversation. An order block with no history cannot order. Finer reads of ledger, world and vars were not tested.

## Limits

* H12 is a simulation. The fault model is the author's (detection 0.9, inheritance 1.0 or 0.5, flake 0 or 1%). The sign of the gain holds across the grid. The size does not.
* The H13 agent is a prompt stand-in with the real tools. The scorer checks tools, forbidden tools, `must` and `must_not`. It does not check stage, language or guards.
* H13 sampled 94 of 254 edges to fit the cap. Three deviations from the pre-registration are recorded in the lane: a refused temperature setting, two pilot fixes and one scoring fix for planted negatives.
