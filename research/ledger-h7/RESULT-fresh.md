# H7 fresh sample: result

Pre-registration: `PREREG-fresh.md` (commit `81fb93054`). Code under measurement: the head of PR 961, `967d16707932e68514daf651a1c12acc9ce36b9d` (tool-name links of PR 960, frozen rerun marks). Run once on 2026-10-20.

| | Value |
|---|---|
| Mutants drawn | 300 (30 sections x 5 negate x 5 rephrase) |
| Left out by the validity gate and the duplicate rule | 26 (listed in `h7-mutants-fresh.json`, `gate_failed`) |
| Measured (n) | 274 |
| With a confirmed flipped block | 82 |
| Misses | 0 |
| Wilson 95% upper bound of 0 / 274 | 1.38% |
| Mean selection ratio | 0.574 |
| Cost | 8.52 USD (stop was 9.50) |

**The bar (Wilson upper bound at or below 5%) is met on the fresh sample.**

Read it with its price and its limits:

* The selection runs 57% of the blocks, against 23% for the declared links alone.
* Without the frozen marks (links of PR 960 only), the same sample misses 7 of 274, upper bound 5.18%, ratio 0.498: the marks (`p1` fails at baseline; `of1`, `of2`, `pl3` fragile) carry the result.
* The marks were learned on the 290 of the second sample, the tool-name rule was designed on the 90, 110 and 290; the 274 were not used for either. One suite (the Acme stand-in, 30 sections, 37 blocks) and one agent model: the result does not say the procedure generalizes to another suite.
* The unit (ledger) selection of PR 830 does not read the marks yet.

Cost: generator 0.06, suite runs and confirmations 8.46 (16,065 + 447 conversation runs, 0 errors).
