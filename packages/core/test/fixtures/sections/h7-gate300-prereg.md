# Pre-registration: the verified-link gate on 300 new mutants of the H7 suite

Registered 2026-10-20, before any pair mutant of this study ran and before the verdicts of the single-section mutants were read. Fictional Acme data only.

## Question

Does selection by the verified links of the Acme sales prompt keep the 95% Wilson upper bound of the share of violating mutants at or below 5%, on 300 mutants none of which verified a link, two-section mutants included? The gate of this PR scored 4 of 110 (upper bound 9.0%) on the live rerun; this study fixes a larger size and runs once.

## Size, fixed now

300 mutants: 240 single-section and 60 two-section (the 110 of the rerun were 90 and 20). No mutant is added, dropped or replaced after the verdicts are read. A mutant whose runs did not complete counts as a violation-unknown and is listed; it is not dropped silently.

## Draw

- Singles: the 287 mutants with status `ok` in `m300/manifest.json` of the second-sample generation (negate and rephrase, five per section and operator, seed base 20261020). The ids are sorted as text; `random.Random(20261020).sample(ids, 240)`. Their stage-1 and confirmation verdicts are read from that run; this study spends nothing on them.
- Pairs: `random.Random(20261021)`; draw two distinct local sections, sorted; refuse a pair already run by the rerun (seed 20261018) or already drawn; repeat to 60. Each section takes the body of one of its `ok` negate variants of `m300` that was not drawn as a single; when it has none, any `ok` negate variant of it, chosen by the same generator. The mutant prompt replaces both section bodies.

## Exclusions (owner condition)

No mutant of the original 110 (the 90 single-section and 20 two-section mutants of the rerun, and the H7 mutants) and no mutant a link was tuned on may enter the 300: a drawn mutant whose id is in those lists, whose prompt text equals one of theirs, or whose section and body a link write-in used, is refused. The draw then continues with the next seed (20261022, 20261023, ...) for the replacement; each refusal and each seed used is recorded in the report.

## Runs

claude-haiku-5-5, the research runner and checks of the H7 suite (19 conversations, 37 blocks). A pair: 3 suite runs, then 3 confirmation runs of each conversation holding a candidate block. Baseline: the 6 stored baseline suite runs of H7. Stop: the study stops at 10 USD total; the projection (about 2 USD) is printed first.

## Kill and violation

- A block is killed by a mutant when it flips against the baseline verdict in at least 2 of 3 suite runs and again in at least 2 of 3 confirmation runs. The flaky blocks `af1` and `d1` and blocks with no stable baseline verdict never count.
- Selection runs on the verified links alone (links verified by the H7 run, plus the single-section misses of the rerun written in as verified links), with forward closure, as `selectionGate` does. A mutant violates when it kills a block that selection of its sections leaves out.
- The gate is scored by `selectionGate` under its own run id. The links come from the H7 run and the rerun; none from this study.

## Pass rule

Pass: 95% Wilson upper bound of violating mutants over the 300 at or below 5%. With 300 mutants that is at most 7 violating mutants (7 gives 4.74%, 8 gives 5.17%). Anything else fails. Both outcomes are reported with the violating mutants, the pairs apart from the singles, and the spend.

## Reported whatever the result

The count and Wilson upper bound over all 300, over the singles and over the pairs; each violating mutant with the blocks it killed that selection skipped; the mean selection ratio; the spend of this study.
