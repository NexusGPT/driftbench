# Variables bank audit status

The bank is not merge-ready under docs/validators.md §12.7. These are pending independent gates, not builder-issued passes. The real components must land first (integration dependencies PR 692 and PR 706), then the bank can be integrated and piloted against their real adapter. The measured empty default adapter baseline cannot stand in for that pilot.

| Required independent audit | Status | Evidence / next owner action |
|---|---|---|
| Blind executor pilot, ten iterations | pending | Real component integration and adapter mapping first; no executor iteration is claimed by the bank repair. |
| Cheater audit | pending | Builder tests reject the constant empty implementation and targeted mutants; an independent helper must attempt new cheats. |
| Cause audit, thirty sampled failures | pending | 141 candidate labels are metadata, not 141 independently proved repairs. An independent helper must regroup by actual fixes. |
| Blind planted failures, at least twenty | pending | Independent helper must plant implementation defects after real components are integrated. |

## Measured baseline

`baseline.ts` imports the actual default adapter directly and runs every item at seeds 1–20 plus the canonical hidden seed derived from the measured commit. The latest measured row in `journal.jsonl` gives its source hash, date and per-seed results. The measured HEAD identifies the canonical hidden seed through `hiddenSeed(root)` in `packages/validators/src/seeds.ts`. The older journal row and `evidence/reference-and-mutants.json` are historical reports whose external reference/mutant code is not reproducible here; they do not establish an audit pass.

## Builder repair evidence

`test/variables/empty-bank.test.ts` requires zero credited items, including subprocesses. `positive-checks.test.ts` retains the 51 positive-witness cases, nine nonempty mutants and four local-correct/child-empty cases. `contract.test.ts` covers the corrected source/file provenance distinction, valid IDs with accented titles, normalized quote acceptance, case/punctuation rejection, and the two separate granularity defects. These test helpers are deliberately limited witnesses, not full product implementations or independent auditors.

## Cause-count correction

`cause-changes.json` lists every old → new label by unchanged item ID. Absent and inexact quotes share the same normalized-findability cause. Mixed good/bad values test preservation of good siblings; the all-bad variant separately identifies empty-variable cleanup. Existing rejection checks remain in both. Multi-line and Unicode labels now name the normalization required by the existing product document. No differently worded candidate label is asserted to require an independent implementation fix.

All remaining candidate labels need the independent thirty-failure audit and actual executor repair evidence. The minimum of one hundred independent fixes and the ten-iteration hardness forecast are unverified, not inferred from stem or label counts.
