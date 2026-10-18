# Audit of system ladder version 6 (docs/validators.md section 12.7)

Three audit helpers ran on 2026-10-18, model-free, on Sonnet. None read the system bank, its fixtures, this folder's handover or its journal. They audited levels 12 and 13, the 319 items version 6 adds. Their reports are in [audit-v6](audit-v6/). The verdict lines below are quoted from those reports. Only the blind pilot line is written by the builder: it puts the helper's measured numbers into the verdict form.

| Check | Verdict | Note |
|---|---|---|
| blind pilot | pass | Fresh executor, bank items only: 281 to 319 of 319 in 5 iterations, 7.6 items fixed per iteration, against the builder's 6.3. The builder pilot is not 1.5 times slower. The forecast stays 0. |
| cheater | fail | Re-audit at `1e2f321ce`: 9 of 10 cheats still gained, stacked 365 to 403 of 413. They keyed on fixture names (blocks `b0`..`bN`, the perturbation `p-bank`) and on the process arguments. `6fb7176cb` draws those names from the seed, runs every check with neutral arguments and holds the help items to the documented options; no third audit has run on it. The first round had 7 of 8 cheats gaining. |
| cause review | pass | 38 of 38 agree. The review finds 5 distinct causes, where the builder tagged 6: the mode P position and the specIndex items share one change. |
| planted bugs | pass | Re-audit at `1e2f321ce`, after the 94 audit items: 20 of 20 bugs lost at least one item (26 of 28 with the extras). The first round at `ec004befd` had 13 of 20. |

Done after the first round: each cheat and missed bug became items (94, `620e70874`); after the re-audit, the remaining cheat routes were closed (`6fb7176cb`). Owed: a third cheater round on `6fb7176cb` or later.
