# Pointer validator: the lowered bar

Max score after the pilot: 0.75
Min forecast: 100
Min distinct failing causes: 100

## Why

The owner's decision, 2026-10-12, verbatim: "If you cannot do it, lower the bar per validator".

1. Only the first term of section 12.4 is lowered. The forecast bar (at least 100) and the cause bar (at least 100) stand. The audit of section 12.7 is not lowered.
2. The real pointer reader already passes most of the bank before any pilot change. The independent blind pilot of round 3 (audit head b232e2ca1, run 39623363394, `validate pointer --hardness`) measured 0.6586 at iteration 0 (503 of 771 items) and 0.7439 after ten iterations (570 of 771). A score of at most 0.4 after the pilot would need the bank to fail about 60 percent of the items for a reader that passes 66 percent of them on day one. No change to the items can do that without removing items that pass for a reason the pages state.
3. The bar is set just above the measured score after the pilot. It guards against a bank that gets easier, not against a reader that gets better.
4. Items were not added or tuned to bring the score down: items chosen to hit a gate number are the skew the owner asked us to avoid. The forecast of the same pilot was 30 against the bar of 100, because one export (`eventsById`) turned 56 items green in a single iteration; the bank now holds one item per event kind and a family of items that judge id carry from the ledger bytes alone, so a correct export over a wrong ladder still fails. The forecast and cause bars are kept and remain open until a pilot on the final bank measures them.
