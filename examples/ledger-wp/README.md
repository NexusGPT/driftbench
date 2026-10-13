# Sealed writing comparison

This research row compares the core pair ledger and the exact promptfoo select-best template on fresh WritingPreferenceBench pairs. A separate exploratory row measures the opt-in reader-first judge from PR 157 at `c50b2dc3`. It retains its length-aware fallback. See `PROVENANCE.md` before interpreting scores.

## Reproduce without model calls

```sh
python3 examples/ledger-wp/test_analysis.py
TMPDIR="$PWD/examples/ledger-wp/runtime" node --import tsx --test examples/ledger-wp/harness.test.ts
TMPDIR="$PWD/examples/ledger-wp/runtime" node --import tsx examples/ledger-wp/harness.ts --cheaters
python3 examples/ledger-wp/stats.py
python3 examples/ledger-wp/phase_report.py
```

Runtime dependencies can be linked to an existing installation. Do not copy `node_modules`. The `node --import tsx` entry point avoids the CLI's Unix-socket path limit in deeply nested worktrees. Runtime files stay under this directory's ignored `runtime/` folder.

## Paid run gate

Every call requires `freeze.json`, a pushed core PR and source hashes matching the freeze. The pool seals have independent pre-call commits. Haiku and `gpt-6-luna` are authorized; Gemini stays pending billing. The process reserves cost before every submission and retains uncertain spend. The whole lane cap is 15 USD, including pilots, repetitions, errors and unfinished items.

Keys are loaded only inside an invoking command. They never appear in command output, source, recordings or the dossier. One runner owns the shared spend ledger; do not launch two runner processes against these result files. Its internal workers share reservations safely.

Run `--phase pilot`, review the cost projection, then `--phase dev`. Dev uses independent recording keys for three repeats. A failed validity criterion stays visible; no source or parser tuning follows the freeze. Record the disposition before running `--phase test`. Test follows the sealed hash order. Cap exhaustion stops submissions and reports partial coverage without selecting by score.

## Scoring

Both order games are normalized to the original candidate labels. Promptfoo's games are independent readings. Pair-ledger reconciliation and reader-first each produce one pair decision; that decision appears in both scored games. Raw ordered readings remain in the decision details. Request-cluster intervals account for dependence across both games and repeated requests.

Unparsed promptfoo or pair-ledger decisions score wrong. Reader-first preserves its frozen length fallback even if a rubric ballot is invalid; invalid ballots are counted explicitly. This behavioral difference is part of its separate row, not a silent repair.

`results/cells.json` supplies the collator's per-model scores and discordant counts. `results/decisions.jsonl` retains every complete pair decision. `results/calls.jsonl` retains every returned model answer. `results/spend.jsonl` contains reservations and settlements; a reservation without settlement remains uncertain spend.
