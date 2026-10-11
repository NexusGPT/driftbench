# Executor instruction (the static part; `driftbench validate <component> --brief` prepends the live state)

You drive one validator to 100 percent. The validator is `driftbench validate <component>`. 100 percent means every item of every level passes on seeds 1 to 20 and on the hidden seed: `driftbench validate <component> --seeds 1..20 --hidden --items` shows a bank score of 1. You run on Sonnet at medium effort by default, and Opus only after a stuck record; the files below are your whole memory, and the next executor may not be you.

Read first, in this order: `validators/<component>/HANDOVER.md`, the last five rows of `validators/<component>/journal.jsonl`, `validators/<component>/research.md`. Then run the validator once on the handover's seed before you change anything. If the level differs from the handover, that is your first finding: record it.

Each iteration, in this order, once:
1. Run the validator with `--items`. Take the first failing level and its named items, grouped by family.
2. Write one sentence: the component, the cause, the item that proves it.
3. Research when the level equals the previous iteration's level, or when you cannot name a component. One bounded pass: local sources first (the research dossiers, the design notes, the handoffs), then papers, repositories and documentation. At least two sources. Write the research row: question, sources, what others do, what you will try, why. A repeated level needs a different mechanism, named from the research; a second attempt at the same mechanism is not an iteration.
4. Fix one cause. Write the test that reproduces the item, see it red, make it green.
5. Re-run on the same seed, then on seeds 1 to 20 and the hidden seed with `--items --json`. Record the level and every metric before and after, and the bank after: its size, the items passing on every seed, the failing items per family, and the items per family and tier.
6. Commit with the ladder table in the message. Append the journal row with `driftbench validate <component> --journal <row.json>`: `iteration` (0 is the measurement before any fix, 1 to 10 the pilot, then onward), the levels and metrics, `bankSize`, `passing`, `failingByFamily`, `bankByFamilyTier`, `failingCauses` and `failingWithoutCause` copied from the `bank` of the `--items --json` run. Rewrite HANDOVER.md so a stranger can continue from it alone: level per seed, floor, open items, hypotheses tried and why they failed, the next three actions, pitfalls, how to run.

Never: edit the validator's ladder, thresholds, hidden seed, fault family or reference implementations (CI refuses it); delete or weaken a test to pass; make a paid model call; copy anything from a real estate or session into the repository; use em or en dashes in prose; run two fixes in one iteration.

Stop when: 100 percent is reached (every item of every level on seeds 1 to 20 and the hidden seed) (write the final report: the ladder on every seed, the floor to set, what remains fragile); or three iterations pass with no level change (write the stuck record: hypotheses, research, the resisting item, and hand over); or your token budget line is crossed (finish the iteration, rewrite the handover, stop).

Every third iteration, ask for the handover test: a fresh session is started from `driftbench validate <component> --brief --fresh` alone and must reproduce your level within one iteration. If it cannot, the handover is your next item.
