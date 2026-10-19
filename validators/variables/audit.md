# Variables bank audit status

The bank is not merge-ready under docs/validators.md §12.7. These are pending independent gates, not builder-issued passes. The real components must land first (integration dependencies PR 692 and PR 706), then the bank can be integrated and piloted against their real adapter. The measured empty default adapter baseline cannot stand in for that pilot.

| Required independent audit | Status | Evidence / next owner action |
|---|---|---|
| blind pilot | pending | Ten executor iterations after real component integration and adapter mapping; no executor iteration is claimed by the bank repair. |
| cheater | pending | Builder tests reject the constant empty implementation, targeted mutants, and the call-order and request-hash cheats of the second bank's review (`call-cheats.test.ts`); an independent helper must attempt new cheats. |
| cause review | pending | The candidate labels are an upper bound on the number of distinct repairs, not a count of them: one defect fails several stems (an ignored impossible pair loses stems of the counter, planner and strength families; a wrong edge sample loses many boundary stems) and some stems bundle two fixes. The measured number will be lower. An independent helper must sample thirty failures and regroup by actual fixes. |
| planted bugs | pending | Independent helper must plant at least twenty implementation defects after real components are integrated. |

## Measured baseline

`baseline.ts` imports the actual default adapter directly and runs every item at seeds 1–20 plus the canonical hidden seed derived from the measured commit. `evidence/baseline.json` gives its source hash, date and per-seed results; the single active `journal.jsonl` row is the schema-validated iteration-0 projection. The measured HEAD identifies the canonical hidden seed through `hiddenSeed(root)` in `packages/validators/src/seeds.ts`. The archived `evidence/journal-historical.jsonl` and `evidence/reference-and-mutants.json` are historical reports whose external reference/mutant code is not reproducible here; they do not establish an audit pass.

## Builder repair evidence

`test/variables/empty-bank.test.ts` requires zero credited items, including subprocesses. `positive-checks.test.ts` retains the 51 positive-witness cases, nine nonempty mutants and four local-correct/child-empty cases. `contract.test.ts` covers the corrected source/file provenance distinction, valid IDs with accented titles, normalized quote acceptance, case/punctuation rejection, and the two separate granularity defects. These test helpers are deliberately limited witnesses, not full product implementations or independent auditors.

## Cause-count correction

`cause-changes.json` lists every old → new label by unchanged item ID. Absent and inexact quotes share the same normalized-findability cause. Mixed good/bad values test preservation of good siblings; the all-bad variant separately identifies empty-variable cleanup. Existing rejection checks remain in both. Multi-line and Unicode labels now name the normalization required by the existing product document. No differently worded candidate label is asserted to require an independent implementation fix.

All remaining candidate labels need the independent thirty-failure audit and actual executor repair evidence. The minimum of one hundred independent fixes and the ten-iteration hardness forecast are unverified, not inferred from stem or label counts.

The all-bad item still checks rejection of every invalid value before empty-variable cleanup. C142 names the cleanup hypothesis, not a certified atomic fix; those rejection prerequisites remain composite checks for the independent cause review.

## Rules of the page

Every stem names the rules of `docs/variables.md` it checks (the Page line of each stem in `CATALOGUE.md`, from `bank/manifest/docs.ts`), and the page lists the rules of each family in its section Rules by bank family. `test/variables/docs-anchors.test.ts` fails when a stem has no rule, cites a rule the page lacks, or cites a rule outside its family row. Where the bank is stricter than the file format, the page now says so: a reader writes three distinct samples for a numeric edge (R3), and a reader-produced value carries provenance (R1) while the file loader only advises (Provenance). The equality, inequality and range stems rest on R3.

## Merge of the second bank (PR 762)

The second blind bank (330 items, 66 cause labels, a request and reply port over `validateVariableStore`, `verifyVariableQuotes` and `planV2`) is merged into this one; the PR is closed as superseded. The bank is one ladder named `variables`, now at version 2, with one port (`VariablesImpl`, which gained `validate` and `quotes`) and one `audit.md`.

Counts of the merged bank: see `CATALOGUE.md` section 1 (items, stems, candidate cause labels). The labels are an upper bound, as above: the originals of the second bank were 66 labels, and many of them name a fix that a stem of this bank already had (the table below shows where each family went).

| Second-bank family | Where it went |
|---|---|
| sources (6) | `sources.file.provenance-shape`, with two variants more (zero total, blank owner words) |
| quotes (6) | `quotes.verify.folded-forms`, `quotes.verify.exact-forms`, plus `not-found` and `unreadable-file`; each in twelve scenes of its own |
| values (6) | `values.file.references` (14 variants); approval inheritance is `values.unapproved-not-planned.approved-value-in-unapproved-variable` |
| boundaries (6) | `boundaries.file.sides` |
| weights (6) | `weights.file.validity`; normalization and zero share are `weights.plan-shares` |
| impossible-pairs (6) | pair and indirect-unreachable are `impossible.rows-avoid-pairs` and `impossible.forced-out-value`; one value, three values, an unapproved combination and a combination naming a variable no axis joins are `impossible.general-forbid` |
| strength (6) | own triples, own quartets, shared axes and detail exclusion are the stems `strength.rule-at-three`, `strength.axes-at-two` and `strength.others-at-one`. Conditional membership (a `when` or `unless` joining a rule) and ledger identity are NOT folded: they are how the planner reads rules from a store file, and this port gives the planner rules already read. They belong to an adapter item once the planner reads a file store |
| seed-rows (6) | partial, full and duplicate sessions are `seeds.partial-rows-credit`, `seeds.new-rows-for-missing` and `seeds.lead-the-plan.duplicate-seeds`; forbidden, unknown and unapproved entries are `seeds.kept-with-warnings`; a budget below the seed count is `budget.below-seed-count` |
| budget-order (6) | already in `budget.prefix-of-full-plan` and `budget.new-rows-common-first` |
| counter (6) | the layer counts of a plan are checked in `strength.report-matches-counter`; the counts of the `coverage` function have their own family |
| scale (6) | widths of hundreds of variables, wide seeds and large sources are the `scale.*` stems, `seeds.many-seeds` and `quotes.large-files` |

Call-order and request-guess cheats. `test/variables/call-cheats.test.ts` plays them against every file-format item (`validate` and `quotes`): a cheat that knows the class of every answer and is handed the right payload for it, and that chooses the class only by the position of the call (every period 1 to 8, every offset, a global or a per-item counter, the best pattern for the item) or by a hash of the request (each of the eight words of its SHA-256). Every item makes at least 18 different requests and runs them in a seeded order that the test certifies against every period; all of these cheats pass 0 items, and the same cheat given the class of each answer passes every item, so a failure means the order did its work. The plan and counter items are not class guesses: they need a computed plan or count, so the empty implementation, which also passes 0 items (`empty-bank.test.ts`), is their cheat test.

Soundness. A reference implementation that is outside the repository passes every item on seeds 1, 2, 3, 7, 20 and 820020691. Forty-nine planted defects in `validate`, `quotes` and `plan` each lose at least one item of the merged stems (`evidence/merged-bank.json`). The reference is not committed, because it would give the builder the answer.

## Quote items and adapters with memory

The review of the second bank found that an adapter which reads requests and remembers earlier ones passed 11.1 percent of its quote items (73 of 660 attempts): the request for the missing file carried the altered quote, so a present-file request with the same quote was the altered one. The floor the second bank stated for a guess from the request alone, 3 to the minus 12 per item, was wrong: a missing file is answered from the file list, a fact of the request, so only the requests with a present file are coin flips.

How the quote items of this bank avoid it, and what they measure:

- Each scene asks five requests, each with a store, an agent, a sentence and a file of its own; no quote, agent or path is shared between two requests of an item.
- What is right lives in the relation between a quote and its file. A quote that looks altered is found when the file holds that very text, and a whole-looking quote is not found when the file holds the altered text, so neither the look of the quote nor the look of the file decides. Every file also holds a decoy line.
- Six shapes of sentence replace the one sentence of the first design, whose shape alone told found from not found.
- Every item makes 48 or more requests whose file is present, so the file-list-plus-coin adapter passes an item with chance 2 to the minus 48 at most. The test asserts the 40-request floor.

`test/variables/quote-leaks.test.ts` keeps seven adapters as zero-score regressions on 22 seeds (1 to 20, 820020691 and 360920726): the scene-pairing adapter of the review (written for this port), a quote seen with an absent file is the altered one, the length of the quote, a look-alike of an earlier quote, a near-identical quote in the same store, the shape of the quote, and the file list plus a coin. All pass 0 items. Run against the first design of these items, the shape adapter passed 154 of 308 attempts (50 percent) and was the leak that this redesign closed; the scene-pairing adapter could not pair the first design, whose requests had separate agents, and passes 0 on both.

Not covered: an adapter built on the generator of this bank, which learns its sentences, is not a cue-only adapter and is out of scope here, as it was for the second bank.
