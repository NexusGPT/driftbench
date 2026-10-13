# LongJudge verify confirmation

- The pool contains all 221 TEST items from `verify_bench_hard.jsonl`.
- This is a previously evaluated split. It is not an unseen holdout.
- The 23-correction audit map is unchanged. Official labels remain the primary endpoint.
- The frozen uncertainty cascade comes from `codex/verify-judge`, head `f13242f2`, freeze `558d75de`.
- Haiku and gpt-6-luna await the core contract PR. Gemini remains pending because billing is blocked.

## Evidence

`evidence/seal.json` records pool, audit, source and recording-inventory hashes.
`evidence/recording-inventory.json` enumerates every inspected recording file.
`evidence/cells.json` holds the official and audited cell table, including pending cells.
`evidence/offline-checks.json` records the offline verification results.
All source files under `../judge-benchmarks/src` remain byte-identical to the frozen branch.
The local TypeScript config resolves their historical package aliases without changing source.

## Frozen analysis

- Unit: one item. Unparsed and missing verdicts count as wrong, with coverage reported separately.
- Single accuracy intervals use Wilson. The paired difference uses a seeded request-cluster bootstrap.
- Discordant items use exact two-sided McNemar. Official and audited tables use the same predictions.
- Holm adjustment waits for the complete prespecified 18-cell family. No local win claim substitutes for it.
- Constant-pass and constant-fail baselines are deterministic. Fresh noise-floor measurements remain pending.

## Run gate and budget

No paid call is authorized until the pushed core contract PR appears in the core dossier.
The runtime freeze must bind that PR, commit, reasoning settings, dialect transport, prices and runner hashes.
The fixed settings are inherited from the core contract without tuning on these items.
The runner admits only Haiku and gpt-6-luna and uses six concurrent calls.
The lane-wide cap is 25 USD, including pilots and validation calls.
The transport reserves in-flight costs atomically across both models and all phases.
Failed calls with unknown charges retain their reservation and halt new work for review.
The last-call cutoff is fixed in the runtime freeze before the first call.
No content-driven retry or outcome-driven item selection is permitted.
Pilot items are the first 20 DEV ids in lexical order and do not belong to TEST.
The pool is committed before the pilot; the final runtime freeze follows the cost pilot without judge tuning.

## Offline commands

```sh
node_modules/.bin/tsx --tsconfig examples/ledger-verify/tsconfig.json examples/ledger-verify/offline.ts 2>&1
python3 -m unittest discover -s examples/ledger-verify -p test_stats.py -v 2>&1
python3 examples/ledger-verify/stats.py 2>&1
```

`run.ts` fails closed when the runtime freeze or pushed core PR is absent.
Its exclusive start marker prevents accidentally repeating a paid cell.
`--replay-only` never starts a provider command.
Dependencies are linked to existing installations. No `node_modules` tree is copied.
