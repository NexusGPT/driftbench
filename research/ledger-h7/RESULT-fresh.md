# H7 fresh sample: result

Pre-registration: `PREREG-fresh.md` (commit `81fb93054`). Code under measurement: the head of PR 961, `967d16707932e68514daf651a1c12acc9ce36b9d` (tool-name links of PR 960, frozen rerun marks). Run once on 2026-10-20.

| | Value |
|---|---|
| Mutants drawn | 300 (30 sections x 5 negate x 5 rephrase) |
| Left out after their tries | 26 (listed in `h7-mutants-fresh.json`, `gate_failed`): 21 `negate`, 5 `rephrase` |
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

Cost: generator 0.06, suite runs and confirmations 8.46 (16,065 conversation runs, of which 447 are confirmation runs; 0 errors). The sum of the per-call usage, by variant, is in `cost-fresh.json` (no key, no request body); total 8.5175 USD.

## The 26 left out, and the operators

* Gate reason: all 26 failed the same rule, the duplicate rule of the PREREG ("a body already drawn for the same section and operator in this sample, a body of the 90, or the section text of any of the 290"). None failed the validity gate of the 90. Each had its 6 tries (the seed and 5 retries, 156 failed tries in all: 126 `negate`, 30 `rephrase`) and every try gave a text already used. The seeded generator gives the same body again for a short rule, so the sections with short bodies lost the most.
* The sample holds 129 measured negations, not the planned 150, and 145 measured rephrasings, not 150.
* Worst case: had all 26 left-out mutants missed, the rate would be 26 of 300, 8.7%. They were never measured, and the PREREG fixed the rule that leaves them out before the run.

| Operator | Measured | With a confirmed flip | Misses | Wilson 95% upper bound |
|---|---|---|---|---|
| `negate` | 129 | 79 | 0 | 2.89% |
| `rephrase` | 145 | 3 | 0 | 2.58% |
| both | 274 | 82 | 0 | 1.38% |

The `rephrase` upper bound says little: only 3 of its mutants flipped a block, so the safety claim there rests on 3 cases. The `negate` row carries the claim.

**Claim.** The bar is met for the population the PREREG defined: single-section mutants, `negate` and `rephrase`, that the generator could draw as new texts (the gate-valid, non-duplicate population). It does not cover a mutant the generator could not draw anew.
