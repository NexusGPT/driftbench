# Sealed writing comparison

This research row compares the core pair ledger and the exact promptfoo select-best template on fresh WritingPreferenceBench pairs. A separate exploratory row measures the opt-in reader-first judge from PR 157 at `c50b2dc3`. It retains its length-aware fallback. See `PROVENANCE.md` before interpreting scores.

## Final status

All retained model cells have completed TEST. Sonnet and GPT-6.1 results are in `results/frontier-final-summary.md`; earlier cells are in `results/report.md`.

Gemini 3.8: dropped by the owner on 13 Oct 2026, partial data kept, not reported as a score. Flash Lite stays the Gemini result. No Gemini 3.8 resumption is authorized or scheduled. The reset watcher stays disarmed. `results/gemini-3.8-owner-drop.json` supersedes all earlier resumption permissions and request estimates below. Raw recordings, costs and holds remain unchanged. No paid calls remain.

## Reproduce without model calls

```sh
python3 examples/ledger-wp/test_analysis.py
TMPDIR="$PWD/examples/ledger-wp/runtime" node --import tsx --test examples/ledger-wp/harness.test.ts
TMPDIR="$PWD/examples/ledger-wp/runtime" node --import tsx examples/ledger-wp/harness.ts --cheaters
python3 examples/ledger-wp/stats.py
python3 examples/ledger-wp/phase_report.py
python3 examples/ledger-wp/owner-disposition.py
```

Runtime dependencies can be linked to an existing installation. Do not copy `node_modules`. The `node --import tsx` entry point avoids the CLI's Unix-socket path limit in deeply nested worktrees. Runtime files stay under this directory's ignored `runtime/` folder.

## Historical paid run gate

These instructions document the completed run. They do not authorize new calls. Frozen report generators reproduce historical rows; apply `owner-disposition.py` last to retain the owner's withdrawal in current tables.

Every call requires `freeze.json`, a pushed core PR and source hashes matching the freeze. The pool seals have independent pre-call commits. Haiku, `gpt-6-luna`, and `gemini-3.8-flash` are authorized. The owner confirms Gemini billing and names `openai.key` and `gemini-driftbench.key`; no other key file is used. The process reserves cost before every submission and retains uncertain spend. The whole lane cap is 35 USD, including pilots, repetitions, errors and unfinished items.

Keys are loaded only inside an invoking command. They never appear in command output, source, recordings or the dossier. One runner owns the shared spend ledger; do not launch two runner processes against these result files. Its internal workers share reservations safely. The latest runtime amendment runs all models side by side: gpt-6-luna has eight plain HTTP calls, Gemini two, and Haiku two. Transport timeouts stay at 300 seconds. Only transport failures may retry. HTTP 429 allows three retries after the initial submission, waiting 60, 120 and 240 seconds; other transport failures allow three submissions total. Returned model answers never receive transport retries. Exhausted Gemini recovery parks only its own queue. The frozen core schema re-ask stays enabled and its cost and frequency are reported per model.

`python3 examples/ledger-wp/run_remaining.py` resumes the three independent model queues in one process. Within each model, fixtures, validity, development and test stay sequential, with sealed item order inside each phase. The earlier `run_schedule.py` handoff is retired. The last-call cutoff is 16:00 UTC on 2026-10-13.

The later daily quota amendment parks Gemini on 13 October with 56 development comparisons and 519 test comparisons missing. Missing-only Gemini resumption is authorized after 2026-10-14 00:00 UTC or an explicit owner amendment. Gemini alone has a 2026-10-14 12:00 UTC last-call cutoff. Its first missing call probes alone before concurrency two. Existing attempt counts stay fixed; elapsed backoff time is credited. `resume_after_reset.py` watches the named parked driver, waits for its verified push and the reset, then starts one Gemini runner and its terminal verifier. It retires if another run replaces its target.

The owner confirms a Gemini top-up after the credit hold. The first missing sealed call runs alone as the probe; a returned answer opens the two-call queue. Cached answers are reused, including malformed content. HTTP 402 stops all Gemini calls without retry; only holds tied to observed HTTP 402 rejections are released. The freeze also names two Luna development calls authorized for one additional three-submission recovery cycle after the recorded connectivity probe. Both recover on their first fresh submission.

Run `--phase pilot`, review the cost projection, then `--phase dev`. Dev uses independent recording keys for three repeats. A failed validity criterion stays visible; no source or parser tuning follows the freeze. Record the disposition before running `--phase test`. Test follows the sealed hash order. Cap exhaustion stops submissions and reports partial coverage without selecting by score.

## Scoring

Both order games are normalized to the original candidate labels. Promptfoo's games are independent readings. Pair-ledger reconciliation and reader-first each produce one pair decision; that decision appears in both scored games. Raw ordered readings remain in the decision details. Request-cluster intervals account for dependence across both games and repeated requests.

Unparsed promptfoo or pair-ledger decisions score wrong. Reader-first preserves its frozen length fallback even if a rubric ballot is invalid; invalid ballots are counted explicitly. This behavioral difference is part of its separate row, not a silent repair.

`results/cells.json` supplies the collator's per-model scores and discordant counts. `results/decisions.jsonl` retains every complete pair decision. `results/calls.jsonl` retains every returned model answer. `results/spend.jsonl` contains reservations and settlements; a reservation without settlement remains uncertain spend.
