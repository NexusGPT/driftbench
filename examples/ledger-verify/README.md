# LongJudge verify confirmation

- The pool contains all 221 TEST items from `verify_bench_hard.jsonl`.
- This is a previously evaluated split. It is not an unseen holdout.
- The 23-correction audit map is unchanged. Official labels remain the primary endpoint.
- The frozen uncertainty cascade comes from `codex/verify-judge`, head `f13242f2`, freeze `558d75de`.
- Haiku, gpt-6-luna and gemini-3.8-flash use the pushed core contract PR 168.

## Evidence

`evidence/seal.json` records pool, audit, source and recording-inventory hashes.
`evidence/recording-inventory.json` enumerates every inspected recording file.
`evidence/cells.json` holds the official and audited cell table, including pending cells.
`evidence/offline-checks.json` records the offline verification results.
Cascade prompts and parsers remain byte-identical to the frozen branch. The call wrapper records terminal transport failures and an outer timeout override in execution-amendment.json; the added shim comes from PR 168.
The local TypeScript config resolves their historical package aliases without changing source.

## Frozen analysis

- Unit: one item. Unparsed and missing verdicts count as wrong, with coverage reported separately.
- Single accuracy intervals use Wilson. The paired difference uses a seeded request-cluster bootstrap.
- Discordant items use exact two-sided McNemar. Official and audited tables use the same predictions.
- Holm adjustment waits for the complete prespecified 18-cell family. No local win claim substitutes for it.
- Constant-pass and constant-fail baselines are deterministic. Fresh noise-floor measurements are reported separately.

## Run gate and budget

No paid call is authorized until the pushed core contract PR appears in the core dossier.
The runtime freeze must bind that PR, commit, reasoning settings, dialect transport, prices and runner hashes.
The fixed settings are inherited from the core contract without tuning on these items.
The runtime pacing amendment permits eight gpt-6-luna HTTP calls, two Gemini calls and two native Haiku calls concurrently. Atomic slots enforce each model limit; the earlier global four-call limit is retired.
The lane-wide cap is 40 USD, including pilots and validation calls.
The transport reserves in-flight costs atomically across all three models and all phases.
Failed calls with unknown charges retain their reservation; terminal missing outputs stay separate from judge answers.
The owner removes the earlier operational cutoff and requires all 379 evaluation units per model unless the 40 USD cap is reached. This comprises 20 pilot, 48 mutation, 90 noise and 221 TEST items.
No content-driven retry or outcome-driven item selection is permitted.
Pilot items are the first 20 DEV ids in lexical order and do not belong to TEST.
Both pool and runtime are committed before the pilot. Pilot measurements cannot change the judge.

## Offline commands

```sh
node_modules/.bin/tsx --tsconfig examples/ledger-verify/tsconfig.json examples/ledger-verify/offline.ts 2>&1
python3 -m unittest discover -s examples/ledger-verify -p test_stats.py -v 2>&1
```

`stats.py` holds the frozen scoring functions. Do not run it as a script: its `main` rewrites `evidence/cells.json` in the older three-model format. The current `evidence/cells.json` comes from the finalizer chain (`summarize.py`, then the per-cell finalizers and `merge-new-cell-reports.py`), which also needs the paid-run receipts. The two commands above never write to the committed evidence.

`run.ts` fails closed when the runtime freeze or pushed core PR is absent.
Its exclusive start marker prevents accidentally repeating a paid cell.
`--replay-only` never starts a provider command.
Dependencies are linked to existing installations. No `node_modules` tree is copied.

All three resumed models use 300-second timeouts after owner-authorized recovery. Partial pilot reports and earlier runtime manifests remain preserved. No returned answer is retried.

HTTP 429 has no judge answer: wait 60, 120 and 240 seconds, then retain a pending transport state. Each actual provider attempt has a 300-second timeout. The outer wrapper allows queueing and backoff.

HTTP 402 is a billing rejection with no completion. It releases only that request's reservation and stops the model run. Missing-only recovery waits for prepaid credit replenishment; cached model answers are never retried.
