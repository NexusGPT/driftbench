# Transport provenance

The partitioned call archive contains 10,549 calls: **1,138 CLI, 9,411 API, and 0 unknown** after metadata restoration. No answer, prompt, timestamp, usage, cost, request hash, or other existing field changes.

## Evidence and attribution

The historical `run.mts` at commit `910da11f90c0bab7d525033d0010f890cc38f701` documents missing transport as a CLI call. Its CLI result object omits `transport`; its Messages API result adds `transport: 'api'`. Every previously unmarked call also contains CLI camelCase usage (`inputTokens`, `outputTokens`) rather than API snake_case usage (`input_tokens`, `output_tokens`).

The original run-log excerpts are:

```text
fable-confirm.log
transport cli concurrency 3
verified 15 frozen files
=== split qa 12:57:44

fable-confirm2.log
transport api concurrency 16
verified 15 frozen files
=== split qa 13:08:58
```

These log clocks are local, not UTC. The recorded call timestamps bound the observed transition: the last unmarked CLI completion is **2026-10-14T11:08:46.399Z**; the first explicitly marked API completion is **2026-10-14T11:09:02.778Z**. This interval bounds observed completions, not an asserted exact process-switch instant.

The exporter only attributes an unmarked CLI call within the observed CLI range, **2026-10-14T07:24:33.757Z through 2026-10-14T11:08:46.399Z**, when its usage schema also matches CLI. An unmarked call in the observed API range, **2026-10-14T11:09:02.778Z through 2026-10-14T11:48:20.586Z**, requires API usage. Missing evidence, a conflicting schema, or a timestamp outside those ranges produces `unknown`. Existing transport marks are retained.

| Previously unmarked group | CLI calls |
| --- | ---: |
| Practice QA split | 121 |
| Practice panel, ours | 468 |
| Practice panel, Inspect | 360 |
| Held-out QA split, also reused by fact | 189 |
| Total | 1,138 |

The first three groups total **949 practice calls**. The **189 confirmation CLI calls are shared by QA and fact**, not 189 new calls for each row. Their timestamp range is 2026-10-14T10:58:13.877Z through 2026-10-14T11:08:46.399Z. All 1,138 formerly unmarked calls have non-null CLI usage and no recorded error. All occur in `calls/part-0000.jsonl`.

## Source-log fingerprints

The original logs were inspected from the operator's run scratchpad. They are not needed to reconstruct the archive; the pinned source recordings and manifest are sufficient. Fingerprints identify the exact supporting logs without including operator paths.

| Log | SHA-256 |
| --- | --- |
| `fable-confirm.log` | `f24ed6dab215e3a1b99640276fafddee6eecdd0e62b6d9a335823c1a6286627f` |
| `fable-confirm2.log` | `19578075541337d347423aaa61a8ec70e8f5568d3be609a7249fab17fbd30792` |
| `fable-practice.log` | `9bd80749a5e96688437d1cc18169f71b29da1f04230611dc5958083135c65fdc` |
| `fable-practice2.log` | `4203f51ce4358af2fd4221e9fa608a7d29bd96fe634e71cbdac469896511645c` |
| `fable-practice3.log` | `17a7bca7a29017c9426fcdd55a16ca9513afcd3e5bf56fddfe8ae76a934677aa` |
| `fable-practice4.log` | `8defb9e2d8179b6f7d4477ddfcac9d0e44ec36197360ca8caee8c356ac6f09dd` |
