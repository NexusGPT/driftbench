# Statistics validator: independent audit status

This is a pending-evidence record, not an independent auditor's passing verdict. The bank is ladder version 4: 8 levels, 1167 items, the capabilities level holding the 26 statistics that driftbench uses (`GATE.md`, "Scope of the capabilities level"). No fresh blind pilot, cheater attempt, cause review or planted-bug audit of this bank is recorded. The historical journal contains only builder rows for a 651-item bank and no bank fingerprints.

| Check | Verdict | Note |
|---|---|---|
| blind pilot | pending | No ten-iteration blind pilot of the current bank is recorded. The historical builder pilot cannot substitute for it. |
| cheater | pending | Earlier cheat and trap regression tests are evidence of specific fixes, not a fresh independent attempt to raise the current bank's score by cheating. |
| cause review | pending | No fresh blind sample of 30 failing items and agreement measurement against this bank's causes is recorded. |
| planted bugs | pending | Targeted mutation tests pass, but no fresh independent 20-bug audit of this bank is recorded. |

All four checks remain required by `docs/validators.md` section 12.7. The owner's ruling of 2026-10-21 ("hardness bar not applicable for stats", recorded in `docs/validators.md` section 12.10) covers the hardness bar of section 12.4 only; it does not lower or waive any check above.

No passing audit result is inferred from unit tests or from reviews of individual PRs. Independent auditors replace pending entries only with their own recorded evidence.

## Seat rules

The pass rules are those of `docs/validators.md` section 12.7. The product at the audited head passes the bank, so the first three seats need a package that still fails items; the fourth plants bugs in the correct one.

1. Blind pilot. Reads nothing but `driftbench validate stats --brief --fresh`, run on the iteration-0 package (a copy of `packages/stats/src` from commit 125af578b, loaded through `DRIFTBENCH_STATS_IMPL`; the bank, fixtures and ladder stay at the audited head). Ten iterations on its own branch, rows appended with `"executor": "blind"`; `HANDOVER.md` is left alone.
2. Cheater. Baseline: `driftbench validate stats --seeds 1..3 --hidden --items --json` on the iteration-0 package. Tries to raise that score without making the package correct (hard-coded seeds, reading the oracle or the fixtures, matching item ids, special-casing fixture names, sniffing the caller by stack or argv, reading through a native frame). Any gain fails the check and becomes a new item.
3. Cause review. Samples 30 failing items, spread over the distinct causes, from `driftbench validate stats --seeds 1..20 --hidden --all-levels --blind --json` on the iteration-0 package; writes the fix for each before reading any cause tag. Agreement of 0.8 or more passes; the reviewed count of distinct causes is reported.
4. Planted bugs. Plants 20 known, non-equivalent bugs one at a time in the repository package (the capabilities functions, the intervals, agreement, multiple comparisons and paired tests, power and variance). The bank must lose at least one item on each; a miss becomes a new item.

Seats run their commands on GitHub (one queued run per seat, Node 24) and keep raw rows, oracle values and fixture contents out of logs.

## Known gap for the cheater seat

The stats bank child does not call the package through the confined frame of `docs/validators.md` section 12.9 on this branch. The pull request that moves it there, #986, is open and not merged. Until it is, a product that sniffs its caller (stack or argv) or reads the expected values through a native frame can still gain items in the bank child, as the cheater audit of the weights family found (`audit-weights/audit.md`, round 2).

## Evidence

[GATE.md](GATE.md) records the scope of the capabilities level and the Node 24 note. [evidence/gate-review.md](evidence/gate-review.md) and the numbers in it describe the earlier 910-item bank and are kept as history, not as a measurement of the current one.
