# Audit of map ladder version 3, the cutter level (docs/validators.md section 12.7)

An audit helper ran two rounds on 2026-10-18, model-free, on Sonnet. It did not read the map bank, its code, this folder's handover or its journal. Its reports are in [audit-v3](audit-v3/). The verdict lines below are quoted from those reports. The builder writes only the blind pilot and cause review lines, and both are left pending.

| Check | Verdict | Note |
|---|---|---|
| blind pilot | pending | Not run: at iteration 0, six items fail on one cause, and the builder's pilot fixed it in one iteration. |
| cheater | fail | Round 2 at `a7f1ef2b6`, 301 items: 1 of 13 shortcuts keeps 301 of 301 while wrong (ledger ids from file and position only). Round 1 on the first 188 items: 7 of 13. |
| cause review | pending | Not run: one failing cause. |
| planted bugs | fail | Round 2: 10 of 20 bugs lose an item, up from 5 of 20 in round 1. Still silent: fingerprints that drop NFC or lowercase, the lower-case-start merge, URL masking, stacked sibling headings, a whole-fence opaque span, tag-only lines, labels carried on a fingerprint match only, a neighbour copy, the ledger's text floor. |

Owed before section 12.7 holds: an item for each silent bug and for the last shortcut, then a third round.
