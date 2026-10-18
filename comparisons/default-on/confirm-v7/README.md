# default-on-v7 held-out verify confirmation (preregistered)

`PREREGISTRATION.json` fixes the population (536 VerifyBench-Hard items, manifest sha256), the product (commit 6f9cebbc8, policy default-on-v7), the recorded peer files, the analysis (exact paired test per peer, Holm across the five peers, the section 4.5 conditions) and the budget. It was committed before the first model call of the run.

The pool was used once before, on 2026-10-14, to confirm the benchmark-only verify-lead v5 candidate. No default-on tuning or diagnosis touched it.

`build_confirm_manifest.py` rebuilds the manifest from the pinned public source and the frozen split files of `origin/feat/verify-lead`.
