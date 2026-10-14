# H4 pre-registration: the gate keeps invalid realisations at or below 2%

Written 2026-10-15, before any paid call. The shared setup in `../README.md` binds this file.

## Hypothesis (section 5, verbatim)
| # | Claim | Experiment | Metric | Falsified if |
|---|---|---|---|---|
| H4 | The gate keeps invalid realisations at or below 2%. | 300 realisations through the gate; 20 planted bad ones; 50-item human audit. | Planted catch rate; audited false-accept rate. | Fewer than 19 of 20 caught, or false accepts above 2%. |

## Design
- The 300 realisations are the 300 planned rows of the H1 design: 10 blocks times 30 rows. Rows per block: a strength-2 covering array (planner seed `1000 + 10 * b`, best of 5 seeds) extended to 30 rows by greedy 3-way gain (seed `1005 + 10 * b`), where b is the block number 1 to 10. Each row is realised by `gpt-6-luna` and gated; up to 6 candidates per row. Call seeds: the first 8 hex digits of sha256(`h1|<block>|<row>|<attempt>`).
- The 20 planted bad realisations are in `planted.json`, committed with this file: 5 swapped digits, 5 flipped negations, 5 second ids, 5 missing items, spread over 8 blocks. They go through every stage of the gate except the two axis stages (they carry no planner row), with the block's seed plus its accepted H1 set as the near-duplicate reference, and are never added to any accepted set. A planted item is caught when at least one stage rejects it. All stages run on every planted item, so the report shows which stages catch it.
- The audit: 50 accepted generated realisations of the H1 design, drawn uniformly without replacement with a seeded generator (mulberry32, seed 4004) after generation ends.

## The audit is not a human audit
Section 5 asks for a 50-item human audit. No human labeller is available in this lane. Change, written before data: two non-human labels per item.
1. My own reading (the lane agent, Claude Opus 5.5) of every one of the 50 items, written to `audit-mine.json` BEFORE the second labeller runs.
2. `gpt-6.1-sol` at reasoning effort high, given the rubric below, the assistant's last reply, the seed and the candidate, blind to the gate's verdicts and to my labels.

An item is invalid when either label says invalid (the union, the stricter reading). Both label sets and their agreement are reported. RESULTS.md says plainly that this was not a human audit.

Validity rubric. A realisation is invalid when, read as the customer's next message after the assistant's last reply, it:
- (a) changes, drops or adds a slot value (a phone, email, street address or plan; formatting such as case, spacing or a standard abbreviation is not a change);
- (b) changes the request, or adds or removes a constraint;
- (c) is not a plausible reply in that place; or
- (d) is so garbled that a competent human assistant could not act on it exactly as on the seed.
Style that misses its planner row (a "formal" text that reads casual) is not invalidity; it is axis conformance, reported separately.

## Metrics and verdict
- Planted catch rate: caught / 20.
- Audited false-accept rate: invalid / 50, with a Wilson 95% interval.
- Falsified if fewer than 19 of 20 planted items are caught, or if the false-accept rate is above 2%, which at n = 50 means 2 or more invalid items. SUPPORTED otherwise.
- Descriptive, not part of the verdict: acceptance rate per stage and per block, candidates per accepted row, rows dropped, post-gate 2-way and 3-way coverage of the accepted rows, and the surface Vendi score (character 1- to 4-gram cosine kernel) of each block's accepted set as a share of its size.

## Models, sample, stop
- Generation and gate: `gpt-6-luna`, reasoning effort low, default temperature (0 is rejected), JSON output. Audit labeller: `gpt-6.1-sol`, effort high.
- Sample: 300 planned rows, 20 planted, 50 audited.
- Tiny sample first: rows 0 to 2 of 2 blocks end to end; USD per row measured and the total re-projected in `../LEDGER.md` before scaling.
- Stop: the lane guard (36 USD). Expected H4 cost well under 2 USD.
