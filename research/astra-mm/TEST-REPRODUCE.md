# Sealed TEST confirmation

The selection and candidate were committed at `2154225b`, before any TEST calls. `test-seal.json` lists all 1,212 IDs and hashes the sample, exclusions, frozen configuration and request bank. The request bank was generated with gpt-6-luna at low. It is the same candidate as the independent 1,052-item DEV run.

This is a census of every remaining never-scored eligible TEST item. The 950-item original sample, the ledger-mm 600-item confirmation pool, and all prior recorded exposure IDs from that lane's audit are excluded. The fixed seed randomizes order within each subset, followed by proportional interleaving. All eligible items are selected, preserving exact subset proportions. No labels or outcomes enter selection.

## Offline scoring

From the owned worktree, after all saved calls are complete:

```sh
/Users/assem/Documents/GitHub/driftbench/node_modules/.bin/tsx --tsconfig research/astra-mm/tsconfig.json research/astra-mm/decisions.mts test 2>&1
python3 research/astra-mm/paired.py test 2>&1
/Users/assem/Documents/GitHub/driftbench/node_modules/.bin/tsx --tsconfig research/astra-mm/tsconfig.json research/astra-mm/audit-base.mts test 2>&1
python3 research/astra-mm/report_test.py 2>&1
```

The estimator is unchanged: equal mean of five subset means, paired bootstrap within subset, 20,000 draws, numpy default_rng seed 20261013, percentile 95% interval. Confirmatory reporting includes every sealed item, with no missing panel imputation. Provider-refused base decisions score zero and can be recovered by a decisive panel, exactly as on DEV.

## Calls and recovery

`base-resume.mts` skips completed item decisions and replays every saved prompt hash. New TEST Haiku receipts live in `test-haiku.jsonl`; provider-refusal costs and hashes live in `test-refusals.jsonl`. Both receipts and item decisions are flushed to disk before continuing. An in-flight key map prevents identical requests from being dispatched twice.

`run_cascade.py test 1 --non-gemini` dispatches the OpenAI and Jev seats. `run_cascade.py test 2 --gemini-only` dispatches only Gemini, at 180 seconds with one retry. The same hash-keyed `test-calls.jsonl` serves all panel workers. Call attempts, including failures, are retained separately. All successful receipts and derived decisions are append-only during inference. No successful key is repeated on resume.

Four atomic filesystem slots in `tmp/call-slots` cap total calls across the four Haiku workers and all panel workers. Gemini has only two worker threads. The initial three-worker Haiku process was drained after 82 items without killing any model call; the shared-slot scheduler then resumed its saved receipts. `scheduler-addendum.json` records that operational change. Frozen prompts and six source hashes did not change. After the plugin crash at 119 completed base items, the owner reduced the total cap to four. All former slot owners were verified absent before stale slots were cleared. New runners are detached from the plugin. The six unreceived in-flight calls and their unknown remote charges are recorded in `crash-resume-addendum.json`.

Before restarting a stopped process, verify that its in-flight calls have exited. Remove a stale slot only after checking that its recorded owner PID is no longer running. Never launch two base runners concurrently, and never exceed four shared slots. An explicit owner pause stops all new calls; an owner resume reuses all saved hashes.

The budget guard values observed OpenAI and Gemini tokens at the registered rates and includes imported Haiku costs conservatively. The base stage separately caps measured Haiku receipts at 8 USD. Only measured Haiku, OpenAI and Gemini spend count toward the owner's 30 USD cap. Jev token usage is reported separately, price not published.
