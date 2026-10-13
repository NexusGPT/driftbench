# Pointwise fact ledger: public API replay

The opt-in pointwise fact ledger reproduces the frozen candidate through the public
`@agent-nexus/driftbench-judges` API. No paid or network calls run.

| Slice | Semantic correct | Strict correct | Changed | Pass to inconclusive | Fail to inconclusive |
|---|---:|---:|---:|---:|---:|
| Fresh | 192/192 | 74/192 | 118 | 57 | 61 |
| Map | 178/180 | 77/180 | 101 | 43 | 58 |

All 219 changes are abstentions. There are no pass/fail reversals. The two wrong
map verdicts remain wrong under strict mode. Inconclusive counts as incorrect.

## Reproduce

From the repository root, after `pnpm install --frozen-lockfile`:

```sh
pnpm exec tsx comparisons/langfuse/pointwise-fact-ledger/replay.ts
pnpm exec vitest run packages/judges/test/pointwise-fact-replay.test.ts
```

The script checks the committed [report](replay.json), including every case and
its transition. `--write` regenerates that report locally without model calls.
The regular CI suite runs the replay test.

## Provenance and limits

The fixture is [pointwise-fact-ledger.json](../../../packages/judges/test/fixtures/pointwise-fact-ledger.json).
Source branch `research/astra-hard-fresh`, commit
`89425c88b12e5fd7516ed9cdbf6d37b9b0261595` supplies:

* `comparisons/astra-hard/langfuse-reference-cases.json` and `candidates/calls.jsonl`: all 192 Langfuse candidate rows.
* `comparisons/astra-hard/map/langfuse-reference-cases.json` and `calls.jsonl`: all 180 Langfuse candidate rows.

The fixture preserves the raw response, user prompt, label, family and original
request digest for every selected row. It records the SHA-256 of each source file.
The system prompt is [audit.txt](../hard/audit.txt), copied verbatim, including its
trailing newline. SHA-256: `5ab527bec76758641fcfd13ebe7c576486ae145fb2cce183a25d9b2838621ca8`.
The recorded model is `claude-haiku-5-5`.

For each imported response, `buildPrompt` must reproduce the original system and
user bytes and SHA-256 before `playerClient` can replay it. Both parser modes use
the same prompt and original response. This is a parser replay of a frozen model
measurement, not a new model run or a claim that strict mode improves accuracy.
The rows use fictional offers and planted labels. There is no semantic rewriting,
quote repair or relabelling to make strict mode score better.

The F3 semantic parser trusts the model's factual judgments. Strict mode adds quote
presence checks, which reject many valid paraphrases. Neither mode mechanically
proves complete requested-fact coverage or the truth of a model's status.
The [public API guide](../../../docs/concepts/judges.md#pointwise-fact-ledger-against-a-trusted-reference)
explains the options and limitations.
