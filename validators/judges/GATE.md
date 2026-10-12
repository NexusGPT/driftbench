# Gate: the judges bank

The hardness gate of docs/validators.md 12.4 fails on one of its four conditions, by 0.0075. Owner decision, 2026-10-12: "Write more capabilities into the docs, figure it out. If you cannot do it, lower the bar per validator". This file records the numbers after round 3 (NEEDS.md) and the lowered bar for judges.

## The numbers

Measured by `pnpm driftbench validate judges --hardness` from `validators/judges/journal.jsonl`. A run of HEAD on seeds 1 to 20 and the hidden seed gives the same last row: 260 of 638 items, 150 distinct failing causes.

| Measure | Value | Gate of 12.4 | Verdict |
|---|---|---|---|
| Bank (deterministic, kept) | 638 items, 20 families, every tier | at least 300, no family under 20 | holds |
| Score at iteration 0 | 0.3903 (249 of 638) | | |
| Score after the pilot | 0.4075 (260 of 638) | at most 0.4 | fails |
| Items fixed per iteration | 1.1 | at least one fixed | holds |
| Forecast | 343.6 iterations (378 failing / 1.1) | at least 100 | holds |
| Distinct failing causes after the pilot | 150 | at least 100 | holds |

The score would meet 0.4 with 12 more failing items (260 / 0.4 = 650). The pages state no further capability that the package lacks and that a user would want, so adding 12 items to cross the line would be padding.

## The lowered bar for judges

For the judges validator, ladder version 2, the score after the pilot may be at most **0.41**. The other three conditions keep their 12.4 values: at least one item fixed per pilot iteration, a forecast of at least 100 iterations, at least 100 distinct failing causes. On that bar the measurement holds: 0.4075, 1.1, 343.6, 150.

Why 0.41 and not another number: it is the smallest bar, to two decimals, that the honest measurement meets. The condition exists so that a bank is not already mostly passing when the climb starts. Here 378 of 638 items fail after the pilot, with 150 independent causes and a forecast above 300 iterations, which is the hardness 12.4 asks for.

`--hardness` still prints NOT MET: the frame applies 12.4 as written, and this lane does not change the frame's gate. This bar is the owner's per-validator decision, recorded here, and the audit (12.7) still applies in full.

## How the bank got here

* Round 1 quarantined what no page needed: 218 items.
* Round 2 rewrote flagged items to match the pages and quarantined 25 behaviours no page stated. The gate then failed on the score, the items fixed, the forecast and the causes.
* Round 3 followed the owner's two decisions. The judges page now states near-JSON repair, so the pilot's iterations 2 to 7 count again, and a "Planned" section, with two planned commands in the CLI reference, states capabilities a user would want and the package lacks. The families those lines need came back, without their helpers, and 12 new items were added on the repair mark, unescaped quotes and reference answers.
* Each new failing cause was planted alone in a scratch copy of packages/judges: on seed 1, exactly its own items turned green and nothing else changed.

The journal rows are the recorded pilot rows with the quarantined items dropped. Items new since the recording take in every row the verdict HEAD gives, since the pilot never touched their code. Nothing was re-run (validators/judges/HANDOVER.md).
