# Audit of estate ladder version 2, the ledger level (docs/validators.md section 12.7)

An audit helper ran on 2026-10-18, model-free, on Sonnet. It did not read the estate bank, this folder's handover or its journal. Its report is in [audit-v2](audit-v2/). The cheater and planted-bug verdict lines are quoted from that report. The builder writes only the blind pilot and cause review lines, and both are left pending.

| Check | Verdict | Note |
|---|---|---|
| blind pilot | pending | Not run: at iteration 0, one ledger item fails on one cause, and the builder's pilot fixed it in one iteration. |
| cheater | fail | 3 of 17 shortcuts pass all 62 items while wrong: the window cap ignored, a cassette key of file, window and set only, condition labels never attached. |
| cause review | pending | Not run: one failing cause. |
| planted bugs | fail | 9 of 20 bugs lose an item. Silent: no text floor, labels carried on a context change, short text moved across files, deleted events never counted, no whole-file rerun for a new unit, atomsByUnit ignoring conditions, windows at every heading and over the cap, a replay miss calling the labeler, a weak request key, a gate quote starting at its labelled unit, a case-insensitive fingerprint, offsets losing the byte-order mark. |

Owed before section 12.7 holds: an item for each silent bug and each shortcut, then a second round. Levels 1 to 7 keep the version 1 bar of GATE.md.

## Round 1 findings: items added, and the ones still owed

The builder added 8 items (ledger-scan 22 to 29, ledger-diff 20 to 21; level 8 holds 70 items) for each round 1 finding whose behaviour a page states. Each one's planted bug or shortcut is listed below with the page line it cites. The builder's own measurement against the pilot is in the next section. It is not a verdict: section 12.7 asks a seat that did not build the bank for the verdict, and that second round is still owed.

| Finding | Item | Page line |
|---|---|---|
| B18 replay calls the labeler on a miss | `ledger-scan.replay.no-call-on-miss` | validate-estate-scan: "A scan without `--record` never calls a labeler" |
| B19 request key holds only the wire | `ledger-scan.replay.miss-on-model`, `.miss-on-set` | docs/estate.md: "a changed prompt, set (labels, atom mappings and conditions included), model, labeler, cut or run misses" |
| C15 cassette key of file, window and set only | `ledger-scan.replay.miss-on-model`, `.miss-on-labeler`, `.miss-on-set` | the same line |
| C17 conditions never attached | `ledger-scan.condition.situation` | docs/estate.md: "the text of that unit becomes the `situation` of the target's atom" |
| B15 atomsByUnit ignores the condition units | `ledger-scan.condition.atoms-by-unit`, `.condition.manifest` | authoring-blast-radius: "its atoms say which atom sits on which unit (`fields.unit`, `fields.condition`)" |
| B13 no whole-file fallback for a new unit | `ledger-diff.rerun.new-heading` | authoring-blast-radius: "else under the nearest heading above, else every unit of the file" |

No page states the behaviour of these findings, so they have no item. Each needs the page line named here before an item can cite it.

| Finding | What the product does | The line a page needs |
|---|---|---|
| B01 text floor removed | a unit rewritten to unrelated text with the same neighbours is `new` plus `deleted`, not `changed` | when the ledger follows an edited unit and when it mints a new one (the text floor) |
| B04 labels carry when only the context changed | a label is dropped when a unit's neighbours change | that a label is kept only while the unit's text and its context are unchanged (the page says only "the label set and the labelers") |
| B05 short repeated text moved across files | a short text that is not unique is never followed into another file | how a short repeated text is followed (the exact floor) |
| B07 deleted events never counted | the next-ledger events count deleted units | which counts the scan or `radius ledger` report prints for deleted units |
| B16 windows end at every heading | a window ends at a top-level heading only | where a window starts and ends |
| B17 a window holds size+1 units | a window holds at most `DEFAULT_WINDOW_UNITS` units | the window size |
| C13 window cap ignored | the same | the same |
| B20 gate quote starts at the labelled unit | a two-unit atom quotes from the earlier of its units | the span of an atom built from a label with a target |

## The builder's measurement of the round 1 findings against the new items (not a verdict)

Pilot `exec/estate-ledger-pilot` at 6f7528907 (the fix branch at 110d45b95 merged), seed 1: level 8 is 70 of 70. Each round 1 mutant was planted alone on it, with the round 1 runner's mutation text (`audit-v2/builder-remeasure-round1-findings.txt`):

| Finding | Items lost |
|---|---|
| B13 | 1: ledger-diff.rerun.new-heading |
| B15 | 2: ledger-scan.condition.atoms-by-unit, ledger-scan.condition.manifest |
| B16 | 3: the three condition items (a nested heading ends the window that held the condition beside its rule) |
| B18 | 1: ledger-scan.replay.no-call-on-miss |
| B19 | 2: ledger-scan.replay.miss-on-model, ledger-scan.replay.miss-on-set |
| C15 | 3: the three replay miss items |
| C17 | 3: the three condition items |
| B01, B04, B05, B07, B17, B20, C13 | 0: no page states the behaviour (the table above) |

So on the builder's count, 14 of the 20 round 1 bugs and 16 of the 17 shortcuts now lose an item. The verdicts in the table at the top stay round 1's until a seat that did not build the bank runs round 2. Round 2 of the cheater and the planted bugs, and the blind pilot and the cause review, are owed.

