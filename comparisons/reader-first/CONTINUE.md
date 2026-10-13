# Continue the frozen TEST after the outage

The owner authorizes an interrupted TEST continuation after the network outage. The saved partial run covers 109/173 pairs: reader-first 142/218 games, length 136/218, with 42 length fallbacks. It stops on a shared session limit reporting a 06:40 reset. There are 64 remaining pairs, with four single-order responses already cached. Do not change any file named in `results/freeze.json` before the continuation. The frozen judge commit is `c50b2dc3f0c6c3e9bc3b82d848fb9bc1a98451c4`. Thresholds stay judgeMargin 4, minFailures 1, featureMargin 5. DEV includes 22 of 90 length fallbacks.

Run from this branch in its owned worktree after connectivity returns. Set SPEND_LEDGER to the existing accounting file. The original completion target is 07:45 Brussels; this continuation stops new calls at 07:40. At most six calls run concurrently. The remaining budget is USD 20 minus returned charges and the recorded uncertainty reserve.

```sh
TMPDIR="$PWD/.reader-first/tmp" DRIFTBENCH_BENCH_CACHE="$PWD/.reader-first/cache" node --import tsx comparisons/reader-first/src/study.ts --phase test --resume --call-deadline 2026-10-13T05:40:00Z --ledger "$SPEND_LEDGER" > .reader-first/test-resume.log 2>&1
```

The source hashes must match the freeze. Exact prior prompts replay without cost. `test-started.json` remains the first-run receipt; `test-resumes.jsonl` appends the continuation receipt. A complete TEST cannot run again. A pair counts only after both orders return; a cached single order also replays. Never choose thresholds from TEST outcomes.

After the process ends, inspect `results/test.json` for all 173 pairs and 346 games. If incomplete, preserve and label the exact count. Update the report using `node --import tsx comparisons/reader-first/src/report.ts <the owner's scratch report path>` and append actual new spend only. Keep the historical full-split baseline rows distinct from any partial result.

Run the privacy guard before staging recordings. Public benchmark contact strings already have narrowly scoped guard annotations; new quoted contacts need the same source check and annotation while retaining exact evidence text. Do not rewrite the JSONL file while the model process is running.

After full TEST completion, apply the single Biome whitespace correction in `packages/judges/src/reader-first-features.ts`, rerun its fixture tests and the default source proof, and update verification/report notes. The frozen measured source stays available at its commit; do not rewrite the freeze record. The current formatter issue is one long `sentenceKeys` expression; no behavior change is needed. The PR remains a draft until these checks and the final report are updated. Push this branch and mark PR 157 ready when the remaining work is verified.

The owner subsequently authorizes immediate continuation after the 06:40 session reset, at six concurrent calls until the network drops. The same freeze applies. If another interruption occurs, read the newest test.json count and resume with cached calls after connectivity returns.
