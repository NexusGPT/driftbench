# RubricBench pair-ledger experiment

This directory contains the free replay and model-independent preparation for the RubricBench row.
It contains no new pair-ledger model result.

- `sample434-replay.json` reproduces the historical binary canonical executed judge against promptfoo.
- `sample434-decisions.json` retains both mapped games per pair and missing-answer counts.
- `pool-seal.json` records dataset, item-list, source and recording hashes.
- `test-ids.json` fixes all 790 TEST pairs. Haiku uses a previously evaluated split.
- `development-plan.json` fixes pilot and noise selections, cheaters and fixture eligibility.
- `requirements.json` preserves expert rubric text with caller-owned ids and canonical response hashes.

The historical sample has 105 discordant wins and 72 losses over 868 games.
The design's 80% power approximation requires 2,060 games at alpha=0.05/18.
The full pool supplies 1,580 games. This is a power projection, not a guaranteed outcome.
Canonical games share one judgment. Pair-cluster intervals and pair-sign sensitivity accompany the requested game statistics.
Actual Holm adjustment remains pending the full matrix.

The five small DEV domains use the base judge without an earned seat.
They contain 24 of 790 TEST pairs (3.0379747%): Math 3, gpqa 1, helpful 8, mbpp 8, mmlu-pro 4.
Other domains remain unearned until their fixtures pass. Categories are never merged.

## Reproduce without model calls

```sh
pnpm exec tsx --no-cache examples/judge-benchmarks/src/rubric-ledger-replay.ts
pnpm exec tsx --no-cache examples/judge-benchmarks/src/rubric-ledger-plan.ts
pnpm exec vitest run examples/judge-benchmarks --maxWorkers=2 --no-cache
pnpm exec tsc -p tsconfig.json --noEmit
```

The replay always passes `replayOnly: 'lenient'`; a missing recording counts as an error and cannot trigger a model call.
Downloads, if needed, go into this worktree's ignored `.cache/ledger-rb/data` directory.
Recordings and the executor journal originate from `8c1d1ca707d6505028a4e0db80c937dd6cfaef71` on `origin/codex/rb-judge`.
Package imports are updated for the current repository namespace; historical prompt templates remain unchanged.

## Paid-run gate

The pushed `research/pair-ledger-core` contract and its PR must exist before any contestant call.
Haiku and gpt-6-luna remain pending that integration, source/dialect freeze, validity gates and pilots.
Gemini remains pending billing. The lane cap is USD 20.
Pool hashes are preliminary experiment artifacts, not a claim that the new contestant has been frozen.
