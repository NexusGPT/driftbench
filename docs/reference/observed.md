# Observation schema reference

The [`Observed` schema](https://github.com/achammah/driftbench/blob/main/packages/core/src/schema/run.ts) records what an adapter returns for one block. Its keys are camelCase. Unknown keys are errors.

## History normalization

`Observed.historyNormalizations` is an optional array of `HistoryNormalization` records. It describes differences between the neutral session history and the model input. It does not change the agent's reply, verdicts, Given, or original history.

| Field | Type | Meaning |
|---|---|---|
| `wire` | nonempty string | The wire that omits the turn: `anthropic` or `google` for the built-in serializers. |
| `historyIndex` | nonnegative integer | The zero-based index in the session history sent for this block, including system messages and the current stimulus. |
| `role` | `system`, `user`, `assistant`, or `tool` | The original role, before a free tool note becomes user text. |
| `kind` | `omitted-empty-turn` | The turn has empty text and no assistant tool calls. The wire omits it without adding placeholder text. |

The field is absent when no turn is omitted. A tool-only assistant turn still carries its tool calls and is not an omitted turn. Whitespace is text and is not omitted.

Both HTML block views and JUnit `system-out` show one summary line per block, such as `3 empty turns not sent on anthropic`, including on passing blocks. A block with more than one wire lists each wire's count on the same line. The observation and JSON drilldown retain every original role and history index. The read-back contract remains exact for every turn the wire carries; an omitted nonempty turn fails the contract.

This optional field has no default. Observations without it retain their serialized bytes and hashes; existing bundles and committed examples are unchanged. Adapter versions stay unchanged because the model-request bytes are unchanged. Cached observations recorded before this change carry no normalization note until they are rerun.
