# Research: judges v3 labellers

## Contract and capability sources

Question: which judge-quality checks also apply to a fixed-set text labeller?

Sources read: `docs/validators.md` in full, the existing judges ladder's
`HANDOVER.md`, `GATE.md`, `NEEDS.md` and `research.md`, and
`origin/feat/estate-pointer-reader-design:docs/estate-pointer-reader.md` (PR 692).
The pointer-reader design motivates a common port for system-1, system-2 and
stacked classification. This change implements a generic port, not that reader.

The new bank adds explicit abstention accounting, an implicit `none` class,
exact near-miss label identity, changed label sets, ordering and length
transforms, untrusted label instructions, repeatability and cache identity.
Integer interval specifications generate fictional text and gold labels without
word lists. Six structural variants per family run across five complexity tiers.
Tier replication increases class count and batch size; it does not create a new
independent failure cause.

## Independent extensions before the final pilot

The independent scorer breaker exposes an empty label set accepted by hashing;
the implementation now rejects it. The independent cheater exposes a call-index
cycle that passes four interleaved replay items. A red regression records those
passes. The generator now shuffles its balanced or deliberately skewed category
schedule before rendering text. Pair identities and replay repetition remain
intact. Final audit results are in `audit.md`.

The mutation audit tests the actual bank with independently compiled source
copies. It includes raw-agreement substitution for kappa, wrong chance
marginals, abstention/invalid denominators, negative and degenerate kappa,
and omitted identity fields. No production defect is planted for the pilot.

## Pair-aware position-cycle counterexample

The reviewer supplies `labels[Math.floor(callIndex++ / 2) % labels.length].name`.
Before the fix, agreement/conjunction/tier-1 at seed 10 and
agreement/direct/tier-1 at seed 18 both report 36/40 raw agreement and kappa
0.8. The regression observes both passes before the generator changes.

Source: the reviewer's counterexample and the red regression log. The previous
shuffle is insufficient: a seed can still produce a predictable ordering.
The generator now rejects schedules that admit block periods 1 through 8 at
any phase. The regression independently checks the actual predictions. All
38 bank tests pass at the corrected source checkpoint. The independent cheat
audit also checks any passing item on any seed, closing an aggregate-only
assertion that missed these seed-specific passes.

The replacement pilot starts from an unimplemented scoring/replay module,
not the finished scorer. Its executors use failure feedback only, as the
owner explicitly requests; they do not consume the earlier research or code.

## Expansion after the first stub pilot

The first genuine stub pilot reaches 300/300 after two source-changing rounds
in both independent executions. It stops before round 3 when the owner requests
more scoring capabilities. The snapshots and measured results are retained in
`history/two-repair-stub/`; they are excluded from the expanded forecast.

The owner's requested capabilities become 34 additional checks: multinomial
kappa confidence intervals, binary PABAK, ordinal weighted kappa, nominal
Krippendorff alpha with missing ratings, imbalanced class confusion and ratios,
selective coverage and accuracy, explicit mappings across label vocabularies,
kappa precision planning, and exact fixed-margin permutation tests. Their
mathematical contract and primary sources are in [ADVANCED.md](ADVANCED.md).

The scoring author and bank author are separate. The bank uses finite-difference
variance, pairwise coincidence sums, normalized ordinal distances and exhaustive
small permutations as independent references. Validation cases include positive
controls, so throwing on every input cannot satisfy them. Every statistical
item also requires a seeded text-classification anchor, preserving cheat rejection.

The author groups the added checks under 33 repair causes. A second CI case
tests unequal marginals and confidence levels but shares the first case's
variance calculation. Item count and authored tags alone do not establish
hardness; the expanded stub pilot and independent cause review provide that
measurement.

## Expanded one-cause pilot measurement

Both isolated executors complete ten source-changing rounds from zero, ending
at 327/334 and level 3. Their average gain is 32.7 items per round; the linear
remaining-item forecast is 7/32.7 = 0.214067278287. Shared scoring/replay
foundations account for the initial 300 items. The two remaining API stubs are
exact permutation testing and sample planning, both present in production.

A preceding broad implementation experiment reaches 334/334 in one repair
but bundles independent APIs. It is archived and excluded, never reconstructed
into intermediate fixes. The valid executors choose one observed capability
per round and retain complete algorithms. During alpha implementation the
public `pairable` field is clarified to mean retained ratings; both receive
the identical clarification before measuring. The initial public contract is
retained in `evidence/contracts/ADVANCED-initial.md`.

Independent final cause review covers all seven failures. Its two inferred
capability groups are not certified implementation root causes. The original
hardness remains unmet; GATE.md records the provisional delivery thresholds
only after this measurement.
