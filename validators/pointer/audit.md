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
4. Planted bugs seat. Plants 20 known bugs, one at a time, in `packages/estate/src/pointer/`, and runs `driftbench validate pointer --seeds 1..3 --hidden --items --json` after each. The bank must lose at least one item per bug. A missed bug becomes a new item.

The gate reads this file. `driftbench validate pointer --hardness` stays red until all four rows read `pass`.

## Provenance of the two banks

- The first bank (419 items): 17 are labelled blind, 385 maintainer-repaired and 17 maintainer-added. An item is repaired when the executable text its runner reaches differs from the text at the blind commit: its entry, its spec row (the cause tag aside) and every declaration of its family file or the kit that the entry reaches, resolved with the TypeScript compiler's symbols and printed from the syntax tree without comments or white space. `validators/pointer/blind-record.json` holds the fingerprints at the blind commit, and `packages/validators/test/pointer/provenance.test.ts` fails when a label disagrees with them. The harness renderer (`compose`) gained a record of the units it wrote after the blind commit, and an item that reaches it fails or passes differently for a reader that omits planted units (`ids.ledger-relative-paths`), so every item that reaches the renderer is repaired. The clean blind measure is the separate bank of PR 759. Only the blind items carry the blind record; the other 402 do not.
- The second bank (340 items, PR 759, helper record in `packages/validators/src/ladders/pointer/blind/CONTRACT.md`) is registered as the levels `blind-1` to `blind-5`, with the label `blind-bank-759`. Its reader binding serves only `cut` today; the items of every other operation fail until the reader port serves it. The cause reviewer and the cheater treat those failures as a gap of the binding, not as reader defects.
