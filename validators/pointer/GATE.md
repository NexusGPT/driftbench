# Pointer validator: the lowered bar

Max score gain over the pilot: 0.10
Min forecast: 100
Min distinct failing causes: 100

## Status: NOT MET

The gate does not hold. The forecast bar is not met: the blind pilot of round 3 measured a forecast of 30 iterations against the bar of 100. The audit of section 12.7 is not lowered and its rows are pending or failed until a round passes. Only the score term of section 12.4 is changed here.

## Why the score term is a gain bar

The owner's decision, 2026-10-12, verbatim: "If you cannot do it, lower the bar per validator".

1. The real pointer reader already passes most of the bank before any pilot change. The independent blind pilot of round 3 (audit head b232e2ca1, run 39623363394, `validate pointer --hardness`) measured 0.6586 at iteration 0 (503 of 771 items) and 0.7439 after ten iterations (570 of 771). A score of at most 0.4 after the pilot would need the bank to fail about 60 percent of the items for a reader that passes 66 percent of them on day one. No change to the items can do that without removing items that pass for a reason the pages state.
2. A ceiling set just above the measured score would pass by construction. The term is a gain instead: the pilot may raise the score by at most 0.10 over its ten iterations (post-pilot score minus iteration-0 score). The measured gain was 0.0853. A bank that a fresh builder climbs fast fails it, which is what the 0.4 ceiling was meant to catch. `Max score gain over the pilot` replaces the absolute ceiling in `driftbench validate pointer --hardness` (packages/validators/src/hardness.ts).
3. Items were not added or tuned to bring the score down: items chosen to hit a gate number are the skew the owner asked us to avoid. The forecast of 30 comes from one export (`eventsById`) that turned 56 items green in a single iteration. The bank now holds one item per event kind and a family of items that judge id carry from the ledger bytes alone, so a correct export over a wrong ladder still fails. The forecast and cause bars stand at 100 and stay open until a pilot on the final bank measures them.
