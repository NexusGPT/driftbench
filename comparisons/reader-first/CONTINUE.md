# Frozen TEST completion

The frozen TEST is complete: 173 pairs, 346 games. Reader-first scores 248/346, length alone 242/346, and features plus length 242/346. Three shorter-reply exceptions gain three pairs and lose none. TEST includes 74 of 173 invalid-evidence length fallbacks. DEV remains 144/180 with 22 of 90 length fallbacks.

The measured judge is frozen at `c50b2dc3f0c6c3e9bc3b82d848fb9bc1a98451c4`. The initial run stops at 109 pairs on a shared session limit. One authorized continuation replays 222 successful calls and makes 124 new calls, completing the remaining 64 pairs. Across DEV and TEST, 526 successful prompt keys are unique. Do not run TEST again or select thresholds from these outcomes.

A formatting-only correction lands after TEST completion. `results/format-only-proof.json` proves that the emitted JavaScript syntax tree is unchanged. The original source and its hash manifest remain available at the frozen commit. The default judge source remains byte-identical to its baseline.

The final comparison report is `docs/comparison/benchmarks/reader-first.md`; per-pair scores, quotes, measurements and decisions are in `results/test.json`. Recorded calls, source manifests, costs, validation and the first-run/continuation receipts remain under this study directory.
