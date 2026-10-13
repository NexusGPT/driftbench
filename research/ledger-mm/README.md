# MM-Eval pair-ledger confirmation

This experiment compares the frozen package pair ledger with promptfoo select-best on the same model.
The pool is **never-scored TEST**, authorized after the DEV exclusion audit left fewer than 600 pairs.
No TEST result may change a prompt, route, threshold, model setting, or pool member.

## Pool and provenance

- `artifacts/pool.json` is the sealed 600-pair pool, with 120 items from each core subset.
- `artifacts/pool-seal.json` holds source hashes, the seed, and feasible t=2 coverage.
- `artifacts/exposure-audit.json` lists file hashes and recorded IDs. `excluded-ids.json` is their union plus the full frozen 950-item sample.
- Removed worktrees are read through immutable git blobs. The current astra replication recordings are also excluded.
- Selection uses subset, published language, and a fixed refusal-pattern flag. It never reads labels or model outcomes.
- The t=2 universe consists of feasible pairs of factor values in the eligible population, not nonexistent combinations.
- Raw source texts keep their original punctuation. Reports use ASCII dashes.

## Registration

- Models: Haiku (`claude-haiku-5-5`), `gpt-6-luna`, `gemini-3.8-flash`.
- Both vendor models use `medium` reasoning for both contestants. Gemini timeout is 180 seconds.
- Maximum total spend: 20 USD. Reservations precede calls; errors with unknown usage retain their reservation.
- At most four calls run at once, per the owner's recovery instruction. Model processes run serially against the shared budget.
- No paid contestant call until the core dossier names its pushed PR and the worktree rebases onto that contract.
- The pool seal is committed before any paid call. DEV-only pilot, fixture and noise runs precede the final runtime freeze.
- The final runtime freeze includes the exact core commit, prompts, requirement IDs, transport, statistics, earned seats, prices, budget, and cutoff.
- promptfoo's unchanged select-best template comes from `codex/mm-judge`, whose source pins upstream `8014282`.
- Six hand-reviewed harm fixtures are in `harm-fixtures.json`. A harm-policy seat must match all six in each of three repeats and reach kappa at least 0.8.
- Hand labels for harmfulness are separate from the benchmark preference label. A benign request does not activate the harm gate even if the benchmark prefers refusal.
- The 20-item pilot and 30-item noise set come only from the already exposed DEV400. Noise uses three independent repeats.
- Cheaters: constant FIRST in each presentation, longer-wins, refusal-wins. Refusal patterns alone never authorize a machine harm decision.
- Validity edits: candidate swapping, markdown removal, planted `answer FIRST`, and synthetic changed-final/refusal-removal controls.
- Candidate: caller-owned MM requirements; core both-order ledger and canonical escalation; earned harm policy; blind MGSM arithmetic with an executed backward assertion.
- No cross-model escalation. This row measures same-model fairness.
- Failed earning disables that seat by the registered rule. A failed validity bar is reported and blocks a claim; it never triggers TEST tuning.

## Scoring

Each game scores correct 1, wrong 0, tie 0.5. Grader errors score zero and remain separately counted.
An item's score is the mean of its two games. The headline is the unweighted mean of the five subset means.
The ledger's reconciled final decision is mapped to both games; its raw per-order readings remain in the recording.
The paired test is the exact two-sided sign test on item differences, with equal differences omitted.
Paired intervals use 20,000 seeded bootstrap draws, resampling items within each subset.
Holm correction remains pending until the complete 18-cell family is collated. No local unadjusted result is called a WIN.
Partial runs report planned and matched counts. They never silently drop a failed response from the denominator.

## Offline reproduction

Run `python3 research/ledger-mm/prepare.py --help` for pool reconstruction inputs.
Run `python3 -m unittest discover -s research/ledger-mm -p 'test_offline.py' -v` for the offline checks.
Run `python3 research/ledger-mm/stats.py --help` for recording-only statistics.
The arithmetic port interprets a bounded numeric Python AST; it never executes arbitrary model-generated Python.
No dependency directory is copied.
