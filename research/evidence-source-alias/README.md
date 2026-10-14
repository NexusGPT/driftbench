# Input-source alias replay

Status: complete Haiku/Luna replay gate passes with zero breaks on all 28 sets. Gemini 3.8 Flash was dropped by the owner and is not recorded. See [the complete gate table](complete-gate.md).

The decoder resolves a bare declared input path or reference/given/artifact to the single declared input only when that canonical source is absent. It still requires the quote to ground in that input. Two inputs disable aliasing; explicit input.<path> addresses remain valid. Populated canonical sources and transcript addresses retain priority.

This branch is independent of the string-only decoder PR. String evidence remains strict. Prompt bytes and fingerprint (`398673b792c1`) are unchanged.

Red-first: 5 failures and 15 passes before the source change. Complete-gate validation: 87 focused tests pass across 4 files, including negative quote tests for every alias, two-input ambiguity, the 1,028-entry legacy replay and goldens. Earlier broader runs are recorded below.

Replay snapshot: 2026-10-13T10:10:51.283Z. Recordings pinned to PR 172 commit `d25cc282013bcb170d7bd6e0c4ab0fdc6c4fa85d`. New model calls: 0. Cost: USD 0.

| Set | Rows | Strict correct | Alias correct | Fixes | Breaks | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| long | 240 | 205 | 205 | 0 | 0 | recorded |
| short | 240 | 238 | 238 | 0 | 0 | recorded |
| pointwise-regressions | 28 | 27 | 27 | 0 | 0 | recorded |
| pointwise-framed | 28 | 27 | 27 | 0 | 0 | recorded |
| multi-span | 8 | 8 | 8 | 0 | 0 | recorded |
| rendered-evidence | 6 | 5 | 5 | 0 | 0 | recorded |
| bench-archived/fresh-rubric/haiku | 192 | 186 | 186 | 0 | 0 | recorded |
| bench-archived/fresh-rubric/gpt-6-luna | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/fresh-rubric/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | dropped by the owner |
| bench-archived/fresh-reference/haiku | 192 | 184 | 184 | 0 | 0 | recorded |
| bench-archived/fresh-reference/gpt-6-luna | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/fresh-reference/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | dropped by the owner |
| bench-archived/map-rubric/haiku | 156 | 156 | 156 | 0 | 0 | recorded |
| bench-archived/map-rubric/gpt-6-luna | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/map-rubric/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | dropped by the owner |
| bench-archived/map-reference/haiku | 180 | 171 | 171 | 0 | 0 | recorded |
| bench-archived/map-reference/gpt-6-luna | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/map-reference/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | dropped by the owner |
| bench-archived/hard-rubric/haiku | 120 | 118 | 118 | 0 | 0 | recorded |
| bench-archived/hard-rubric/gpt-6-luna | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/hard-rubric/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | dropped by the owner |
| bench-archived/hard-factuality/haiku | 120 | 115 | 115 | 0 | 0 | recorded |
| bench-archived/hard-factuality/gpt-6-luna | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/hard-factuality/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | dropped by the owner |
| bench-archived/hard-pii/haiku | 120 | 119 | 119 | 0 | 0 | recorded |
| bench-archived/hard-pii/gpt-6-luna | 0 | n/a | n/a | n/a | n/a | not recorded |
| bench-archived/hard-pii/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | dropped by the owner |
| bench-archived/hard-goal/haiku | 120 | 111 | 111 | 0 | 0 | recorded |
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
| bench-current/map-reference/haiku | 180 | 168 | 173 | 5 | 0 | recorded |
| bench-current/map-reference/gpt-6-luna | 180 | 145 | 145 | 0 | 0 | recorded |
| bench-current/map-reference/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | dropped by the owner |
| bench-current/hard-rubric/haiku | 120 | 117 | 117 | 0 | 0 | recorded |
| bench-current/hard-rubric/gpt-6-luna | 120 | 120 | 120 | 0 | 0 | recorded |
| bench-current/hard-rubric/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | dropped by the owner |
| bench-current/hard-factuality/haiku | 120 | 104 | 119 | 15 | 0 | recorded |
| bench-current/hard-factuality/gpt-6-luna | 120 | 100 | 101 | 1 | 0 | recorded |
| bench-current/hard-factuality/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | dropped by the owner |
| bench-current/hard-pii/haiku | 120 | 118 | 118 | 0 | 0 | recorded |
| bench-current/hard-pii/gpt-6-luna | 120 | 114 | 114 | 0 | 0 | recorded |
| bench-current/hard-pii/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | dropped by the owner |
| bench-current/hard-goal/haiku | 120 | 106 | 106 | 0 | 0 | recorded |
| bench-current/hard-goal/gpt-6-luna | 120 | 97 | 101 | 4 | 0 | recorded |
| bench-current/hard-goal/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | dropped by the owner |
| bench-current/heldout-rubric/haiku | 72 | 71 | 71 | 0 | 0 | recorded |
| bench-current/heldout-rubric/gpt-6-luna | 72 | 71 | 71 | 0 | 0 | recorded |
| bench-current/heldout-rubric/gemini-3.8-flash | 0 | n/a | n/a | n/a | n/a | dropped by the owner |
| bench-current/heldout-factuality/haiku | 72 | 55 | 71 | 16 | 0 | recorded |
| bench-current/heldout-factuality/gpt-6-luna | 72 | 63 | 64 | 1 | 0 | recorded |
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

The aliases recover 42 correct outcomes. Haiku gains 15 hard-factuality, 16 heldout-factuality and 5 map-reference cases. Luna gains 1 hard-factuality, 1 heldout-factuality and 4 hard-goal cases. All other measured cells have zero fixes; every measured cell has zero breaks. The long and short cohorts remain 205/240 and 238/240 because this PR does not change string-evidence rejection.

## Reproduce

`pnpm exec vitest run packages/judges/test/evidence-source-alias-recorded.test.ts --maxWorkers=1` replays the frozen fixture with no network.

`research/evidence-source-alias/replay.mts` rebuilds the snapshot from the decoder PR fixture and committed PR 172 recordings. It executes the actual parser from base `54b0f9046da2171314d742bcdbfa743f7fd53206` before comparing the candidate. Archived and current prompt recordings are kept as separate cohorts. The four archived Luna transport errors remain failures and are not decoder evidence.

## Limits

This change validates where the quote occurs, not the correctness of met. A remaining hard-factuality semantic error is still counted as wrong. Alias recovery is intentionally limited to exactly one input and the listed names; it does not guess basenames, search all sources or override supplied canonical data.

## Main integration after PR 185

- Merged main `98d82dcf0929e647d6c51f688419e53133a9f8e9`, including the upstream escalation union fix. This draft adds no escalation changes.
- `node tools/rename-scope.mjs` changes zero files. The focused post-merge run passes 165 tests across 11 files, including all frozen alias rows, negative grounding cases, pointwise fact-ledger replay, escalation, cassettes and legacy goldens.
- All 11 legacy file and fixture hashes still match the initial manifest. Main changed `prompt.ts` to add pointwise fact-ledger routing; this draft's file is byte-identical to main. The default prompt fingerprint remains `398673b792c1`.
- Frozen replay counts remain 36 fixes and zero breaks across 3,727 rows. The draft gate and missing-slice labels remain in force.

## Complete benchmark gate

The [complete per-set table](complete-gate.md) covers all 28 current recordings at `d25cc282013bcb170d7bd6e0c4ab0fdc6c4fa85d`. The focused run passes 87 tests in 4 files. Gemini 3.8 Flash was dropped by the owner and is not recorded. The earlier integration snapshots above remain historical evidence.

Rebuild with `pnpm exec tsx research/evidence-source-alias/replay.mts d25cc282013bcb170d7bd6e0c4ab0fdc6c4fa85d`. This requires that commit in the local Git object store and the decoder fixture for historical cohorts.

The donor fixture is read from this repo (`packages/judges/test/fixtures/criterion-decoder-recordings.json.gz`), not a sibling worktree. A rebuild on current main reports more fixes than the committed `results.json` (62 against 42 over 5,469 rows, zero breaks), because main now contains the source-alias grounding that the committed snapshot predates. The committed `results.json` stays the frozen snapshot.
