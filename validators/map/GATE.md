# Map validator: the lowered bar

Max score after the pilot: 0.42

## Why

The owner's decision, verbatim: "Write more capabilities into the docs, figure it out. If you cannot do it, lower the bar per validator".

1. Every family of the bank now cites a product page (`NEEDS.md`). The 17 long-quote items no page needs are quarantined.
2. generating.md now plans the capabilities users need that `extract` lacks: declared roles, what a rule and a value state, more relations, every prompt style, long prompts, and a map that depends only on what the prompt says. The roles items count again because that section needs them.
3. Measured on that bank (578 items, replay of lane/v-map 848a52aa): 0.3841 at iteration 0 and 0.4100 after the ten pilot fixes. That is above the 0.4 of section 12.4.
4. I did not add items to bring the score down. Items chosen to hit a gate number are the skew the owner asked us to avoid.

So the bar for this validator is 0.42, the measured 0.41 rounded up to the next hundredth. The other gates of section 12.4 are unchanged:

| Measure | Bar | Measured |
|---|---|---|
| Score after the pilot | at most 0.42 (lowered from 0.4) | 0.4100 |
| Forecast | at least 100 iterations | 227.3 |
| Distinct failing causes after the pilot | at least 100 | 114 |
| Audit (section 12.7) | four checks pass | absent |

`driftbench validate map --hardness` reads the line `Max score after the pilot: <n>` from this file. Only a value above 0.4 and under 0.5 is taken (`parseGate` in `packages/validators/src/hardness.ts`).
