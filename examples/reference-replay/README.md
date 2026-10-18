# Offline JudgeBench reference replay

This example replays historical raw model outputs through the public
`withReferenceConsensus`, `judgeRepeated`, `pairwiseRequest`, and `majority` APIs.
It reproduces the recorded reference3 and adaptive results without model calls.
It does not measure the current judge prompt's accuracy.

From the repository root, with the source commit already present locally:

```sh
pnpm exec tsx examples/reference-replay/src/cli.ts --git-ref 1d13e28ccf148047daa4aa9508868a91dd36e803
```

The command only uses `git show` to read the frozen source. It never fetches a
remote, invokes a model command, reads credentials, or writes recordings.
Dependencies must already be installed. No recording copies are committed here.

Alternatively, supply an existing directory containing the four source files
below, preserving their relative paths:

```sh
pnpm exec tsx examples/reference-replay/src/cli.ts --directory /path/to/judge-benchmarks
```

Both modes verify each file's SHA-256 against the frozen commit. A missing file,
changed file, missing recording, changed prompt, or verdict mismatch fails the
command. There is no fallback to a live call.

## Source and observed result

Source: commit `1d13e28ccf148047daa4aa9508868a91dd36e803`, from
`origin/codex/jb-judge`, under `examples/judge-benchmarks/`:

- `recordings/judgebench/haiku.jsonl`: raw route, solve, and judgement outputs.
- `jb-results/final-test-decisions.json`: frozen pair inputs and reference3 expectations.
- `jb-results/test-peer-replay.json`: adaptive expectations.
- `jb-results/final-test-signals.jsonl`: explicit empty-call evidence.

Observed with this example:

| Variant | Official correct pairs | Orders compared | Orders with raw judgements | Recorded unavailable pairs | Live calls |
| --- | --- | --- | --- | --- | --- |
| reference3 | 195/229 | 458 | 456 | 1 | 0 |
| adaptive | 198/229 | 458 | 456 | 1 | 0 |

Each variant reads 1,368 raw judgements. Reference3 reuses 228 blind solves.
Adaptive reads 228 routes and reuses 206 blind solves. Both candidate orders
share the caller's solve cache. The wrapper caches the question-only route.

## What passes through the package

1. Extract each question and candidate pair, without its expected verdict.
2. Preflight the raw recording keys so production solve-failure tolerance cannot
   hide a missing replay input.
3. Wrap a recording-backed `JudgeClient` with `withReferenceConsensus`, using
   `samples: 1`. Adaptive also uses `route: 'auto'` and a question-only `check`.
4. Pass the exact, complete recorded solve into the wrapper. Read three raw
   judgements per order through `judgeRepeated`.
5. Apply public `majority` to decisive votes with their explicit seated count.
   Swap the second order back to the original candidate identities.
6. Compare every computed order against its recorded expectation. Only then use
   labels for scoring: right is +1, wrong is -1, tie is 0; a positive pair sum wins.

Expected final verdicts never enter the client, route, solve, or vote reducer.

## Historical compatibility and limits

- `historical.ts` preserves the old prompt renderer and reference rules. Raw
  records are selected by the hash of the whole historical prompt and model,
  never by metadata labels. It does not claim current prompts share those keys.
- `historical-parser.ts` preserves the old JSON parser while validating answers
  with the public `JudgeAnswer` schema. The current parser repairs additional
  malformed JSON. Using it changes at least the AB verdict of
  `bd6f87f2-cb60-58b3-8b27-4eceab2bfc79` from tie to A.
- The historical reducer ignores abstentions. One decisive vote and two
  inconclusive votes therefore pick that side. Public `majority` with its default
  three-seat quorum would split; this example explicitly seats only decisive votes.
- The historical route parser accepts a leading YES, including bold text and
  trailing prose. The replay adapter converts that recorded decision to the
  public check port's exact YES/NO answer. This is historical compatibility, not
  the default route parser's contract.
- Pair `b7bbea2c-8e83-50be-a385-70d16a0d507c` has no raw calls. Frozen signals
  explicitly record an omitted reference and empty AB/BA judgement arrays. The
  example reduces those empty arrays to ties without fabricating a call, keeping
  the historical 229-pair denominator. That same unavailable pair is included in
  adaptive's expectations; its route and solve cannot be independently replayed.
  It is reported separately. Every other miss is fatal.

## Checks

```sh
pnpm exec vitest run examples/reference-replay/test/replay.test.ts --no-cache --maxWorkers=2
pnpm exec biome check examples/reference-replay
```

Tests cover both routes, exact solve reuse, missing recordings, changed
candidates and expected verdicts, label isolation, historical parsing,
abstention handling, recorded unavailable calls, and official pair scoring.
