# Decoder-only replay

Status: complete Haiku/Luna replay gate passes with zero breaks on all 28 sets. Gemini is not recorded. See [the complete gate table](complete-gate.md).

The candidate nulls ungrounded evidence strings and retains met. It does not relax source-addressed spans. The prompt and fingerprint remain unchanged (`398673b792c1`).

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
| bench-archived/fresh-rubric/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/fresh-reference/haiku | 192 | 184 | 185 | 1 | 0 | recorded |
| bench-archived/fresh-reference/gpt-6-luna | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/fresh-reference/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/map-rubric/haiku | 156 | 156 | 156 | 0 | 0 | recorded |
| bench-archived/map-rubric/gpt-6-luna | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/map-rubric/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/map-reference/haiku | 180 | 171 | 173 | 2 | 0 | recorded |
| bench-archived/map-reference/gpt-6-luna | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/map-reference/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/hard-rubric/haiku | 120 | 118 | 118 | 0 | 0 | recorded |
| bench-archived/hard-rubric/gpt-6-luna | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/hard-rubric/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/hard-factuality/haiku | 120 | 115 | 117 | 2 | 0 | recorded |
| bench-archived/hard-factuality/gpt-6-luna | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/hard-factuality/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/hard-pii/haiku | 120 | 119 | 120 | 1 | 0 | recorded |
| bench-archived/hard-pii/gpt-6-luna | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/hard-pii/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/hard-goal/haiku | 120 | 111 | 116 | 5 | 0 | recorded |
| bench-archived/hard-goal/gpt-6-luna | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/hard-goal/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/heldout-rubric/haiku | 72 | 71 | 71 | 0 | 0 | recorded |
| bench-archived/heldout-rubric/gpt-6-luna | 4 | 0 | 0 | 0 | 0 | partial recording |
| bench-archived/heldout-rubric/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/heldout-factuality/haiku | 47 | 37 | 37 | 0 | 0 | partial recording |
| bench-archived/heldout-factuality/gpt-6-luna | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/heldout-factuality/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/heldout-pii/haiku | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/heldout-pii/gpt-6-luna | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/heldout-pii/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/heldout-goal/haiku | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/heldout-goal/gpt-6-luna | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/heldout-goal/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/planted-verify/haiku | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/planted-verify/gpt-6-luna | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/planted-verify/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/planted-rubric/haiku | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/planted-rubric/gpt-6-luna | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/planted-rubric/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-current/fresh-rubric/haiku | 192 | 188 | 188 | 0 | 0 | recorded |
| bench-current/fresh-rubric/gpt-6-luna | 192 | 191 | 191 | 0 | 0 | recorded |
| bench-current/fresh-rubric/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-current/fresh-reference/haiku | 192 | 189 | 189 | 0 | 0 | recorded |
| bench-current/fresh-reference/gpt-6-luna | 192 | 140 | 140 | 0 | 0 | recorded |
| bench-current/fresh-reference/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-current/map-rubric/haiku | 156 | 156 | 156 | 0 | 0 | recorded |
| bench-current/map-rubric/gpt-6-luna | 156 | 156 | 156 | 0 | 0 | recorded |
| bench-current/map-rubric/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-current/map-reference/haiku | 180 | 168 | 168 | 0 | 0 | recorded |
| bench-current/map-reference/gpt-6-luna | 180 | 145 | 145 | 0 | 0 | recorded |
| bench-current/map-reference/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-current/hard-rubric/haiku | 120 | 117 | 117 | 0 | 0 | recorded |
| bench-current/hard-rubric/gpt-6-luna | 120 | 120 | 120 | 0 | 0 | recorded |
| bench-current/hard-rubric/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-current/hard-factuality/haiku | 120 | 104 | 104 | 0 | 0 | recorded |
| bench-current/hard-factuality/gpt-6-luna | 120 | 100 | 100 | 0 | 0 | recorded |
| bench-current/hard-factuality/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-current/hard-pii/haiku | 120 | 118 | 118 | 0 | 0 | recorded |
| bench-current/hard-pii/gpt-6-luna | 120 | 114 | 114 | 0 | 0 | recorded |
| bench-current/hard-pii/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-current/hard-goal/haiku | 120 | 106 | 106 | 0 | 0 | recorded |
| bench-current/hard-goal/gpt-6-luna | 120 | 97 | 97 | 0 | 0 | recorded |
| bench-current/hard-goal/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-current/heldout-rubric/haiku | 72 | 71 | 71 | 0 | 0 | recorded |
| bench-current/heldout-rubric/gpt-6-luna | 72 | 71 | 71 | 0 | 0 | recorded |
| bench-current/heldout-rubric/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-current/heldout-factuality/haiku | 72 | 55 | 55 | 0 | 0 | recorded |
| bench-current/heldout-factuality/gpt-6-luna | 72 | 63 | 63 | 0 | 0 | recorded |
| bench-current/heldout-factuality/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-current/heldout-pii/haiku | 72 | 72 | 72 | 0 | 0 | recorded |
| bench-current/heldout-pii/gpt-6-luna | 72 | 68 | 68 | 0 | 0 | recorded |
| bench-current/heldout-pii/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-current/heldout-goal/haiku | 72 | 65 | 65 | 0 | 0 | recorded |
| bench-current/heldout-goal/gpt-6-luna | 72 | 61 | 61 | 0 | 0 | recorded |
| bench-current/heldout-goal/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-current/planted-verify/haiku | 190 | 189 | 189 | 0 | 0 | recorded |
| bench-current/planted-verify/gpt-6-luna | 190 | 187 | 187 | 0 | 0 | recorded |
| bench-current/planted-verify/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-current/planted-rubric/haiku | 120 | 117 | 117 | 0 | 0 | recorded |
| bench-current/planted-rubric/gpt-6-luna | 120 | 120 | 120 | 0 | 0 | recorded |
| bench-current/planted-rubric/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | not recorded |

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

`CRITERION_DECODER_VERSION` is 2. `JudgeRequest.criterionDecoderVersion: 1` selects the historical strict parser. New default-ledger cassette entries and keys carry version 2; historical unversioned entries keep their old key and strict decoding. Legacy, system1 and explicit assessment keys stay unchanged. Grounding diagnostics are output-only and never enter the provider schema.

## Refreshed recording snapshot

- The source-alias investigation supplies additional PR 172 recordings. This decoder independently replays all 3,727 recorded rows in that frozen snapshot: 38 fixes and zero breaks across 32 recorded or partially recorded sets.
- Long remains 229/240 and short 240/240. Current hard-factuality remains 104/120; source aliases are separate.
- The refreshed recorded test passes 33 tests. Missing sets remain not recorded; partial sets do not establish a complete slice pass.
- After merging main `54b0f904`, 100 focused tests across 7 files pass, including escalation compatibility. The scope codemod changes zero files; all 12 immutable file hashes remain unchanged.
- Reproduce an imported snapshot with `pnpm exec tsx research/default-decoder-ungrounded/refresh-recordings.mts <recorded-inputs.json.gz>`.

## Main integration after PR 185

- Merged main `98d82dcf0929e647d6c51f688419e53133a9f8e9`, including the upstream escalation union fix. This draft adds no escalation changes.
- `node tools/rename-scope.mjs` changes zero files. The focused post-merge run passes 153 tests across 10 files, including all frozen decoder rows, pointwise fact-ledger replay, escalation, cassettes and legacy goldens.
- All 11 legacy file and fixture hashes still match the initial manifest. Main changed `prompt.ts` to add pointwise fact-ledger routing; this draft's file is byte-identical to main. The default prompt fingerprint remains `398673b792c1`.
- Frozen replay counts remain 38 fixes and zero breaks across 3,727 rows. The draft gate and missing-slice labels remain in force.

## Complete benchmark gate

The [complete per-set table](complete-gate.md) covers all 28 current recordings at `d25cc282013bcb170d7bd6e0c4ab0fdc6c4fa85d`. The focused run passes 80 tests in 4 files. Gemini is not recorded. The earlier integration snapshots above remain historical evidence.
