# Decoder-only replay

Status: complete Haiku/Luna replay gate passes with zero breaks on all 28 sets. Gemini 3.8 Flash was dropped by the owner and is not recorded. See [the complete gate table](complete-gate.md).

Decoder version 2 is opt-in (`criterionDecoderVersion: 2`); the default stays strict version 1. Version 2 nulls ungrounded evidence strings and retains met. It does not relax source-addressed spans. The prompt and fingerprint remain unchanged (`398673b792c1`).

Red-first: 7 failures and 6 passes before implementation. Complete-gate validation: 80 focused tests pass across 4 files, including the unchanged 1,028-entry legacy cassette test and golden tests. Earlier broader runs are recorded below.

Replay snapshot: 2026-10-13T10:11:28.557Z. Recordings pinned to PR 172 commit `d25cc282013bcb170d7bd6e0c4ab0fdc6c4fa85d`. New model calls: 0. Cost: USD 0.

| Recorded set | Rows | Strict correct | Candidate correct | Fixes | Breaks | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| long | 240 | 205 | 229 | 24 | 0 | recorded |
| short | 240 | 238 | 240 | 2 | 0 | recorded |
| pointwise-regressions | 28 | 27 | 27 | 0 | 0 | recorded |
| pointwise-framed | 28 | 27 | 28 | 1 | 0 | recorded |
| multi-span | 8 | 8 | 8 | 0 | 0 | recorded |
| rendered-evidence | 6 | 5 | 5 | 0 | 0 | recorded |
| bench-archived/fresh-rubric/haiku | 192 | 186 | 186 | 0 | 0 | recorded |
| bench-archived/fresh-rubric/gpt-6-luna | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/fresh-rubric/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | dropped by the owner |
| bench-archived/fresh-reference/haiku | 192 | 184 | 185 | 1 | 0 | recorded |
| bench-archived/fresh-reference/gpt-6-luna | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/fresh-reference/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | dropped by the owner |
| bench-archived/map-rubric/haiku | 156 | 156 | 156 | 0 | 0 | recorded |
| bench-archived/map-rubric/gpt-6-luna | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/map-rubric/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | dropped by the owner |
| bench-archived/map-reference/haiku | 180 | 171 | 173 | 2 | 0 | recorded |
| bench-archived/map-reference/gpt-6-luna | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/map-reference/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | dropped by the owner |
| bench-archived/hard-rubric/haiku | 120 | 118 | 118 | 0 | 0 | recorded |
| bench-archived/hard-rubric/gpt-6-luna | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/hard-rubric/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | dropped by the owner |
| bench-archived/hard-factuality/haiku | 120 | 115 | 117 | 2 | 0 | recorded |
| bench-archived/hard-factuality/gpt-6-luna | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/hard-factuality/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | dropped by the owner |
| bench-archived/hard-pii/haiku | 120 | 119 | 120 | 1 | 0 | recorded |
| bench-archived/hard-pii/gpt-6-luna | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/hard-pii/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | dropped by the owner |
| bench-archived/hard-goal/haiku | 120 | 111 | 116 | 5 | 0 | recorded |
| bench-archived/hard-goal/gpt-6-luna | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/hard-goal/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | dropped by the owner |
| bench-archived/heldout-rubric/haiku | 72 | 71 | 71 | 0 | 0 | recorded |
| bench-archived/heldout-rubric/gpt-6-luna | 4 | 0 | 0 | 0 | 0 | partial recording |
| bench-archived/heldout-rubric/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | dropped by the owner |
| bench-archived/heldout-factuality/haiku | 47 | 37 | 37 | 0 | 0 | partial recording |
| bench-archived/heldout-factuality/gpt-6-luna | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/heldout-factuality/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | dropped by the owner |
| bench-archived/heldout-pii/haiku | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/heldout-pii/gpt-6-luna | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/heldout-pii/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | dropped by the owner |
| bench-archived/heldout-goal/haiku | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/heldout-goal/gpt-6-luna | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/heldout-goal/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | dropped by the owner |
| bench-archived/planted-verify/haiku | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/planted-verify/gpt-6-luna | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/planted-verify/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | dropped by the owner |
| bench-archived/planted-rubric/haiku | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/planted-rubric/gpt-6-luna | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/planted-rubric/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | dropped by the owner |
| bench-current/fresh-rubric/haiku | 192 | 188 | 188 | 0 | 0 | recorded |
| bench-current/fresh-rubric/gpt-6-luna | 192 | 191 | 191 | 0 | 0 | recorded |
| bench-current/fresh-rubric/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | dropped by the owner |
| bench-current/fresh-reference/haiku | 192 | 189 | 189 | 0 | 0 | recorded |
| bench-current/fresh-reference/gpt-6-luna | 192 | 140 | 140 | 0 | 0 | recorded |
| bench-current/fresh-reference/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | dropped by the owner |
| bench-current/map-rubric/haiku | 156 | 156 | 156 | 0 | 0 | recorded |
| bench-current/map-rubric/gpt-6-luna | 156 | 156 | 156 | 0 | 0 | recorded |
| bench-current/map-rubric/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | dropped by the owner |
| bench-current/map-reference/haiku | 180 | 173 | 173 | 0 | 0 | recorded |
| bench-current/map-reference/gpt-6-luna | 180 | 145 | 145 | 0 | 0 | recorded |
| bench-current/map-reference/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | dropped by the owner |
| bench-current/hard-rubric/haiku | 120 | 117 | 117 | 0 | 0 | recorded |
| bench-current/hard-rubric/gpt-6-luna | 120 | 120 | 120 | 0 | 0 | recorded |
| bench-current/hard-rubric/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | dropped by the owner |
| bench-current/hard-factuality/haiku | 120 | 119 | 119 | 0 | 0 | recorded |
| bench-current/hard-factuality/gpt-6-luna | 120 | 101 | 101 | 0 | 0 | recorded |
| bench-current/hard-factuality/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | dropped by the owner |
| bench-current/hard-pii/haiku | 120 | 118 | 118 | 0 | 0 | recorded |
| bench-current/hard-pii/gpt-6-luna | 120 | 114 | 114 | 0 | 0 | recorded |
| bench-current/hard-pii/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | dropped by the owner |
| bench-current/hard-goal/haiku | 120 | 106 | 106 | 0 | 0 | recorded |
| bench-current/hard-goal/gpt-6-luna | 120 | 101 | 101 | 0 | 0 | recorded |
| bench-current/hard-goal/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | dropped by the owner |
| bench-current/heldout-rubric/haiku | 72 | 71 | 71 | 0 | 0 | recorded |
| bench-current/heldout-rubric/gpt-6-luna | 72 | 71 | 71 | 0 | 0 | recorded |
| bench-current/heldout-rubric/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | dropped by the owner |
| bench-current/heldout-factuality/haiku | 72 | 71 | 71 | 0 | 0 | recorded |
| bench-current/heldout-factuality/gpt-6-luna | 72 | 64 | 64 | 0 | 0 | recorded |
| bench-current/heldout-factuality/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | dropped by the owner |
| bench-current/heldout-pii/haiku | 72 | 72 | 72 | 0 | 0 | recorded |
| bench-current/heldout-pii/gpt-6-luna | 72 | 68 | 68 | 0 | 0 | recorded |
| bench-current/heldout-pii/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | dropped by the owner |
| bench-current/heldout-goal/haiku | 72 | 65 | 65 | 0 | 0 | recorded |
| bench-current/heldout-goal/gpt-6-luna | 72 | 61 | 61 | 0 | 0 | recorded |
| bench-current/heldout-goal/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | dropped by the owner |
| bench-current/planted-verify/haiku | 190 | 189 | 189 | 0 | 0 | recorded |
| bench-current/planted-verify/gpt-6-luna | 190 | 187 | 187 | 0 | 0 | recorded |
| bench-current/planted-verify/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | dropped by the owner |
| bench-current/planted-rubric/haiku | 120 | 117 | 117 | 0 | 0 | recorded |
| bench-current/planted-rubric/gpt-6-luna | 120 | 120 | 120 | 0 | 0 | recorded |
| bench-current/planted-rubric/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | dropped by the owner |

Archived PR 172 recordings use the previous prompt. Current recordings use `398673b792c1`. These are separate cohorts. Partial recordings prove only the listed rows. Missing model/slice cells are not passes.

## Separate input-source alias experiment

On current hard-factuality/Haiku, the string-only decoder stays at 104/120 (0 fixes, 0 breaks). The separate alias change in PR 184 reaches 119/120 (15 fixes, 0 breaks). That change is not included here.

## Reproduction and provenance

- Run `pnpm exec vitest run packages/judges/test/criterion-decoder-recorded.test.ts --maxWorkers=1` for the self-contained, network-free snapshot replay.
- `replay.mts` collects the original git recordings and the read-only PR 172 recordings from the sibling bench-frame worktree. It requires those sources locally. It verifies public production output against a source-patched simulation of the pinned main parser.
- The frozen LangWatch source is `73939d09686bd7d214acc6dfcc74b831d1ed991d`; the strict package base is `2c4982ca599b479c6c36b947352c51aac21bbebc`.
- Every LangWatch call is joined by its request SHA. The CLI flag/user hash and trusted transcript frame are checked before replay.
- `results.json` carries per-row outcomes and source hashes. `packages/judges/test/fixtures/criterion-decoder-recordings.json.gz` retains requests, labels and raw responses without modification.
- All 11 legacy parser/prompt/test, golden and source cassette files compare byte-for-byte to the original base. Default `prompt.ts` is byte-identical to merged main; its pointwise fact-ledger routing came from PR 163.

## Decoder compatibility

`CRITERION_DECODER_VERSION` is 1, the strict parser, and stays the default. `JudgeRequest.criterionDecoderVersion: 2` (or a client's `criterionDecoderVersion: 2`) opts into the new decoder. Only version 2 requests and cassette entries carry the field, so default request bodies, keys and cassette entries are byte-identical to main. A player infers version 2 from a cassette that records it. Legacy, system1 and explicit assessment keys stay unchanged. Grounding diagnostics are output-only and never enter the provider schema.

## Refreshed recording snapshot

- The source-alias investigation supplies additional PR 172 recordings. This decoder independently replays all 3,727 recorded rows in that frozen snapshot: 38 fixes and zero breaks (34 on current main, see the correction below) across 32 recorded or partially recorded sets.
- Long remains 229/240 and short 240/240. Current hard-factuality remains 104/120; source aliases are separate.
- The refreshed recorded test passes 33 tests. Missing sets remain not recorded; partial sets do not establish a complete slice pass.
- After merging main `54b0f904`, 100 focused tests across 7 files pass, including escalation compatibility. The scope codemod changes zero files; all 12 immutable file hashes remain unchanged.
- Reproduce an imported snapshot with `pnpm exec tsx research/default-decoder-ungrounded/refresh-recordings.mts <recorded-inputs.json.gz>`.

## Main integration after PR 185

- Merged main `98d82dcf0929e647d6c51f688419e53133a9f8e9`, including the upstream escalation union fix. This draft adds no escalation changes.
- `node tools/rename-scope.mjs` changes zero files. The focused post-merge run passes 153 tests across 10 files, including all frozen decoder rows, pointwise fact-ledger replay, escalation, cassettes and legacy goldens.
- All 11 legacy file and fixture hashes still match the initial manifest. Main changed `prompt.ts` to add pointwise fact-ledger routing; this draft's file is byte-identical to main. The default prompt fingerprint remains `398673b792c1`.
- Frozen replay counts were 38 fixes and zero breaks across 3,727 rows (34 on current main, see the correction below). The draft gate and missing-slice labels remain in force.

## Complete benchmark gate

The [complete per-set table](complete-gate.md) covers all 28 current recordings at `d25cc282013bcb170d7bd6e0c4ab0fdc6c4fa85d`. The focused run passes 80 tests in 4 files. Gemini 3.8 Flash was dropped by the owner and is not recorded. The earlier integration snapshots above remain historical evidence.

## Main integration after PRs 157, 179, 184, 185 and 191

- Merged main `eb3e7a98`. Main's frozen tests pin the default request key, the chat-client request keys and the strict rejection of all 1,422 decoration quotes. Version 2 as the default broke all three, so version 2 is now opt-in and the default is the unchanged strict decoder.
- Main's source-alias grounding (PR 184) now parses 43 bench-current rows that the PR 172 recordings stored as unparsed. Both decoders read those rows identically, so this PR still changes 0 of them. `rebase-fixture.mts` re-reads the committed fixture with zero model calls and records each moved row in `results.json` under `baselineMovedOnMain`.
- Current totals: Haiku 1751/1798, gpt-6-luna 1639/1798. Decoder version 2: 0 fixes and 0 breaks on all 28 current sets. Historical sets kept 38 fixes and 0 breaks in the frozen snapshot (34 on current main, see the correction below).

## Rebuilding the snapshot

`replay.mts` rebuilds the fixture and `results.json` from the original git recordings. It passes `criterionDecoderVersion: 2` for the candidate and `1` for the baseline, because the package default is version 1. Regenerating overwrites the committed fixture and `results.json` with a new snapshot, so run it only to refresh the evidence. `rebase-fixture.mts` re-reads the committed fixture and needs no other input. `tools/research-replay.test.ts` pins both decoder versions in CI.

The archived-cohort recordings that `replay.mts` reads are committed under `inputs/pre-main-recordings`. The current-cohort recordings come from commit `d25cc282013bcb170d7bd6e0c4ab0fdc6c4fa85d`, passed as a checkout in `BENCH_FRAME`. The `research replays` CI job (`tools/research-replay-ci.sh`, full history) runs both replays and fails on any assertion or break. It discards the regenerated snapshots: the committed ones are frozen, and their unit tests carry the 63 rows that later changes on main moved. A rebase of the committed fixture on today's main moves 20 more baseline rows than the 43 already recorded.

## Correction: 34 fixes on current main, not 38

A rebuild of `replay.mts` on current main (commit `925e1408f`, recordings at `d25cc282013bcb170d7bd6e0c4ab0fdc6c4fa85d`, 0 model calls) gives 34 fixes and 0 breaks over the same 5,469 rows in 90 summaries. The committed snapshot says 38. The 4 missing fixes are all in `bench-archived/hard-goal/haiku`, which drops from 5 fixes to 1: main now grounds source aliases in the strict decoder, so those 4 rows are already correct before this decoder runs. The research claim is therefore 34 fixes and 0 breaks on current main. The committed snapshot and its tests stay frozen at 38; the rebuild also writes one extra variant summary and different top-level keys. It drops `packageBase`, `recordingCommit`, `snapshotSha256` and `baselineMovedOnMain`, and adds `sourceCommit`, `packageCommit`, `packageSourceHashes`, `candidateSourceHash`, `variants` and `aliasRows`. The `research replays` CI job runs the rebuild and fails on any break.
