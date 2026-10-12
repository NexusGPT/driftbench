# Gate: the judges bank

The hardness gate of docs/validators.md 12.4 is not met. Owner decision, 2026-10-12: "we've done enough work on validator honestly, let's just start building and iterating". The bank stops growing here, and the numbers below are the recorded bar for the judges validator, ladder version 2.

## The recorded bar

Measured by `pnpm driftbench validate judges --hardness` from `validators/judges/journal.jsonl`. The last row is the pilot's end: the judges package with its ten pilot fixes, where a run on seeds 1 to 20 and the hidden seed gives 259 of 494 items and 77 distinct failing causes. On main's judges package, which merged its own contract work instead of the pilot's fixes, the same run gives 254 of 494 (0.5142) and 82 causes; the next executor starts from there.

| Measure | Value | Gate of 12.4 | Verdict |
|---|---|---|---|
| Bank (deterministic, kept) | 494 items, 15 families, every tier | at least 300, no family under 20 | holds |
| Score at iteration 0 | 0.5020 (248 of 494) | | |
| Score after the pilot | 0.5243 (259 of 494) | at most 0.4 | fails |
| Items fixed per iteration | 1.1 | at least one fixed | holds |
| Forecast | 213.6 iterations (235 failing / 1.1) | at least 100 | holds |
| Distinct failing causes after the pilot | 77 | at least 100 | fails |

For judges, ladder version 2, the bar is this measurement: a score after the pilot of at most 0.53, at least 1 item fixed per iteration, a forecast of at least 100 iterations and at least 77 distinct failing causes. `--hardness` still prints NOT MET, because the frame applies 12.4 as written and this lane does not change it. The audit (12.7) still applies.

## Why it falls short

The package already does most of what the judges page states (its own 107 tests cover the page), so a bank built only on stated needs leaves about half its items passing. Items that no page needs were quarantined (NEEDS.md), and padding the bank to pass the gate was ruled out.

## What changed on the way

* Round 1 quarantined what no page needed: 218 items.
* Round 2 rewrote flagged items to match the pages, added `clients/echoed-short-header-redacted` (an echoed header value under 8 characters is not redacted), and quarantined 25 behaviours no page stated.
* Round 3 (owner decision: "repairing near-JSON"): the judges page now states that near-JSON is repaired and marked `repaired: true`. The six contract items for the repaired forms ask for the reading again, so pilot iterations 2 to 7 count again. The items written for the repair mark, the unescaped quote and reference answers are deferred (`needs.ts`): item work ended before they joined the measured bank.

The journal rows are the recorded pilot rows with the quarantined items dropped; items added after the recording take in every row the verdict HEAD gives. Nothing was re-run (HANDOVER.md).
