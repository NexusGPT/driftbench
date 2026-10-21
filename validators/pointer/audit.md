# Pointer bank audit status

The bank repairs do not constitute the independent audit in `docs/validators.md` section 12.7. The bank lands after component PR 692. Ten executor iterations and the independent audit run after that component merges.

| Check | Verdict | Note |
|---|---|---|
| blind pilot | pending | Requires merged pointer reader PR 692 and ten executor iterations. |
| cheater | pending | Maintainer empty/constant and targeted mutation regressions are recorded separately; a fresh independent helper still audits the merged component. |
| cause review | pending | Author-declared cause tags and composite exclusions are not a reviewed distinct-fix count. |
| planted bugs | pending | Requires independent mutations of the merged real component. |

The repaired bank's seeds 1–20 plus canonical hidden baseline is **pending PR 692**. This branch's estate package has no pointer-reader namespace. The attempted default-adapter run did not produce a completed baseline and was stopped; no result is inferred from that attempt. The runner now checks availability before starting items and fails clearly when the component cannot load. No substitute reader produces baseline numbers.

The existing `journal.jsonl` preserves the historical seed-1, 402-item measurement at `cf184f5943fd`; it is not a baseline for this repaired 419-item bank. No hardness forecast or merge-gate pass is claimed.

## Seat instructions (run after PR 692 is on release/next)

Each seat is a fresh helper with no tie to the builder. A seat writes only its own verdict row above, in the form of section 12.7, and puts evidence in the journal or in a file it names. Run all commands from the repository root on a branch that contains PR 692 and this bank.

1. Blind pilot seat. Reads nothing but the output of `pnpm exec tsx packages/cli/src/bin.ts validate pointer --brief --fresh` (use the repo's `driftbench` entry point if it differs). Runs ten iterations on its own branch. Each iteration appends a journal row with `executor: blind`. Check with `driftbench validate pointer --hardness --json`.
2. Cheater seat. Gets the scores of `driftbench validate pointer --seeds 1..20 --hidden --all-levels --items --json` as its baseline. Tries to raise the score without making the reader correct (hard-coded seeds, matching on item ids, special-cased fixture names, reading oracles). Any score gain fails the seat; each cheat becomes a new bank item. The reader code under `packages/estate/src/pointer/` is the only file it edits, on a scratch branch.
3. Cause review seat. Samples 30 failing items from `driftbench validate pointer --seeds 1..20 --hidden --all-levels --blind --json`. Writes the fix it would make for each before it opens `validators/pointer/cause-review.json` or any `Fix:` line. Agreement under 0.8 fails the seat. Composite items (declared in `cause-review.json`) are excluded from the sample.
4. Planted bugs seat. Plants 20 known bugs, one at a time, and runs `driftbench validate pointer --seeds 1..3 --hidden --items --json` after each. The bank must lose at least one item per bug. A missed bug becomes a new item. The seat plants the same bugs, one at a time and each reverted before the next, in two readers and measures each with its own run. Real reader: plant in `packages/estate/src/pointer/` and run the command as written. Reference reader (it passes every item, so any item can lose): plant in the matching code of `packages/validators/test/pointer/reference/` and run the same command with `DRIFTBENCH_POINTER_SUT` set to the absolute path of `packages/validators/test/pointer/reference/index.ts` (its default export is the reference reader; without this variable the command binds the real reader and says nothing about the reference). The bank is judged on the reference reader: the verdict counts the bugs that lose no item in the second run. The real reader's count is reported beside it and is not the pass rule, because a real reader that already fails an item cannot lose it again: a bug in code that only failing items cover loses nothing, whatever the bank holds.

The gate reads this file. `driftbench validate pointer --hardness` stays red until all four rows read `pass`.

## Provenance of the two banks

- The first bank (419 items) claims no blind item: all 402 original items are labelled maintainer-repaired and the 17 later ones maintainer-added. The maintainer changed the harness, the runners and the oracles after the blind commit, and every original item runs through changed code, so the bank cannot show which items stayed as written. The blind measure is the separate 340-item bank of PR 759 (the levels `blind-1` to `blind-5`). `CATALOGUE.md` lists the label of every item, and `driftbench validate pointer --items` prints the score of each label apart. The provenance test fails if any item of this bank is labelled blind.
- The second bank (341 items, PR 759, helper record in `packages/validators/src/ladders/pointer/blind/CONTRACT.md`) is registered as the levels `blind-1` to `blind-5`, with the label `blind-bank-759`. Its binding to the reader is `packages/validators/src/ladders/pointer/sut/blind-binding/`, derived from the exports of `packages/estate/src/pointer` and `docs/estate-pointer-reader.md`.
- Against the real reader (seed 1, locked by `packages/validators/test/pointer/blind-binding.test.ts`): 256 items pass, 6 differ from the planted truth, 79 are unsupported. **The 79 unsupported items are gaps of the reader or the binding, not product failures**; each detail names the reason.
  - links (30) and radius (30) with clearance: layer C is not built (design section 14).
  - `group:carry` (9): carry-forward lives inside the ledger step and derives its fingerprints from the text.
  - `reanchor` ambiguous (3): the reader keeps the id on the first match and lists no candidates.
  - `labels:rerecord` (3): the reader emits no `label_flip` diagnostic.
  - `replay` (4): a miss names no field when the set or the labeler differs.
- The 30 privacy items drive the real `pointerScan`: the reader reads the key through its labeler factory (`env` is a getter that asks the harness), sends the request through its own HTTP client (`fetch` is the harness callback), and stores the answer with `Cassette.put`; a replay asks a cassette that reads the harness cache. What the reader stores and plans is returned beside the labels, so the leak check reads it. 24 pass. 6 differ: the scan sends no request for a fence-only or comment-only file (it is opaque), and the contract expects one; that is reader behaviour against the contract. The plan reaching the harness is a character count normalised to the source length, as `blind/CONTRACT.md` allows; the reader's own plan is returned for the leak check. Proof: a mutant of `Cassette.put` that stores the raw request fails the 8 record-mode items; restored, all 24 pass.
- The reader was changed for 12 items (a fence or comment is one unit over all its lines; a cut-digest miss names the Node and ICU versions) and for 2 more (an answer that names another window or set is refused; one that names none is accepted). Two items, `json-prefixed-with-prose` and `json-suffixed-with-prose`, are `spec-changed` (design section 3, rule 1 now reads the one JSON object out of prose or a fence) and plant an acceptance; `two-json-objects` is new and plants a refusal.
- The 6 items that differ are the privacy items of a fence-only or comment-only file: the scan sends no request for it, and the contract expects one.
- The cause reviewer and the cheater treat the 79 as a gap of the reader, not as reader defects.
- The materialization items read the atom predicates from the reader's own `pointerAtoms` output, one for one. A reader that drops every predicate, or sets `reviewRequired` to false, loses the six atom-building items; the binding test proves both, and proves that an opaque-cutter error is counted as an adapter error, which the test requires to be zero.
