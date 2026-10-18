# Audit of estate ladder version 2, the ledger level (docs/validators.md section 12.7)

An audit helper ran on 2026-10-18, model-free, on Sonnet. It did not read the estate bank, this folder's handover or its journal. Its report is in [audit-v2](audit-v2/). The cheater and planted-bug verdict lines are quoted from that report. The builder writes only the blind pilot and cause review lines, and both are left pending.

| Check | Verdict | Note |
|---|---|---|
| blind pilot | pending | Not run: at iteration 0, one ledger item fails on one cause, and the builder's pilot fixed it in one iteration. |
| cheater | fail | 3 of 17 shortcuts pass all 62 items while wrong: the window cap ignored, a cassette key of file, window and set only, condition labels never attached. |
| cause review | pending | Not run: one failing cause. |
| planted bugs | fail | 9 of 20 bugs lose an item. Silent: no text floor, labels carried on a context change, short text moved across files, deleted events never counted, no whole-file rerun for a new unit, atomsByUnit ignoring conditions, windows at every heading and over the cap, a replay miss calling the labeler, a weak request key, a gate quote starting at its labelled unit, a case-insensitive fingerprint, offsets losing the byte-order mark. |

Owed before section 12.7 holds: an item for each silent bug and each shortcut, then a second round. Levels 1 to 7 keep the version 1 bar of GATE.md.
