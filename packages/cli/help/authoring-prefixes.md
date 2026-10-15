---
title: Prefixes and given
summary: '`given.prefix` starts a block in the middle of a conversation without replaying the blocks before it, `given.origin` says where that prefix comes from, and `given.ledger`, `given.world` and `given.vars` set the facts, the world and the runtime variables a block starts from.'
commands:
  - spec validate
  - campaign run
  - import traces
see_also:
  - authoring-blocks
  - authoring-spec-format
  - authoring-perturbations
next:
  - authoring-script-api
---

## What it is

Given is the starting state of a block. A spec sets it in two places:

- `given` at the top of the spec: the default for every block. Keys: `ledger`, `world`, `vars`.
- `given` on a block: the same three keys, plus `prefix` and `origin`.

`prefix` is a list of messages that come before the block: user turns, assistant turns with their tool calls, system or tool messages. With a prefix, a block starts as if that conversation had already happened. You can test the tenth turn of a conversation without writing nine blocks.

`origin` says where the prefix comes from: `authored` (a person wrote it), `recorded` (copied from a real run, its tool calls with the results the tools really returned) or `canonical` (the replay of a spec as written). It is optional, and enters the Given hash only when present.

A fact the agent got from a tool belongs in the prefix as a tool call with its `output`, never only in the assistant's text. A history in prose is a different test: in an experiment on a sales agent, the agent that read an earlier result only in its own prose called the tool again in 332 of 450 runs, against 0 of 450 with the recorded call, and filed the same callback request a second time in all 90 prose runs of the lead blocks. `spec lint` warns with `PREFIX_PROSE_HISTORY` when an assistant message of a prefix states a ledger fact that no recorded call of the prefix holds and the user never said.

`ledger`, `world` and `vars` on a block merge into the running state from that block onwards:

- `ledger`: facts the agent must hold. Keys merge. Later checks (`knowledge_retention`, the ledger check) read them.
- `world.tools`: a forced `result`, `error` or `latency_ms` per tool, from this block on. Tools merge by name.
- `world.store`: a seeded store. Keys merge.
- `world.workspace`: the files a code agent starts from: a folder `from` or inline `files`. A later workspace replaces the earlier one whole.
- `world.fixtures`: free fixtures. Keys merge.
- `vars`: runtime variables such as the clock, the channel or the sender.

How a run uses a prefix depends on the run mode:

- Free-running (mode F) and perturbed (mode P): a block with a prefix closes the open session and opens a new one from the prefix. The blocks after it continue from there, with the agent's real replies.
- Teacher-forced (mode T): every block starts from its own canonical Given. Its history is the latest prefix a block up to it wrote, then for each later block the spec's user message and a canonical assistant message: empty text, and the tool calls the block expects (with the inputs the spec asserts as exact values, and the result or error `world.tools` forces). A block that writes its own prefix starts from that prefix alone.

Whether the agent itself reads the prefix depends on the adapter. Adapters with the `seedPrefix` capability hand the messages to the agent: `function`, `http`, `anthropic`, `openai-agents`, `vercel-ai`, `google`, `langgraph`, `crewai`, `pydantic-ai`, `litellm` and the Claude Code replay adapter. `process`, `nexus` and the live Claude Code adapter do not: the agent itself does not receive the prefix messages as its history, so a prefix there cannot set what the agent remembers. `world.tools` applies only on adapters with the `toolStubs` capability.

An adapter that sends the history to a model sends each tool call of the prefix as that model's own tool call and tool result records, with ids that pair them, never as text. The crewai adapter takes history as text inputs, so with its default inputs it refuses a prefix that holds tool calls rather than let the crew read them as prose.

## When to use it

- Test a late turn of a long conversation in one block.
- Pin the exact history a block starts from, so the block does not depend on how the agent answered earlier.
- Give a code agent a workspace (`world.workspace`), or force a tool to fail from a given block (`world.tools`).
- Read a draft from `import traces`: each observed user turn becomes a block, and the state observed before it becomes that block's `given.prefix`, with `origin: recorded`.
- Mark where a prefix comes from with `origin`, so results of a recorded history and of a written one are never read as the same test.

## Commands and every option

This is a format topic. `spec validate` and `spec lint` check the keys (see authoring-spec-check). `campaign run` uses them; its `--mode T,F,P` option picks the run modes described above (default `F`). `import traces` writes prefixes into the drafts it creates.

## Inputs

### `given` keys

| Key | Where | Type | Meaning |
|---|---|---|---|
| `prefix` | block only | list of messages | The messages before this block. |
| `origin` | block only, with `prefix` | `authored`, `recorded` or `canonical` | Where the prefix comes from. It holds for later blocks until a block writes another prefix. |
| `ledger` | spec or block | mapping | Facts the agent must hold; on a block they merge from that block on. |
| `world` | spec or block | mapping | `tools`, `store`, `workspace`, `fixtures`, see below. |
| `vars` | spec or block | mapping | Runtime variables. |

A `prefix` or an `origin` at the top-level `given` is a schema error: only a block takes them. An `origin` on a block that writes no `prefix` is `GIVEN_ORIGIN_WITHOUT_PREFIX`.

### A message of the prefix

| Key | Type | Required | Meaning |
|---|---|---|---|
| `role` | `user`, `assistant`, `system` or `tool` | yes | Who sent it. |
| `content` | string | yes | The text. Use `''` for an assistant turn that only called tools. |
| `name` | string | no | A sender name. |
| `tool_calls` | list | no | The tool calls the message made. |

### A tool call in a prefix

| Key | Type | Required | Meaning |
|---|---|---|---|
| `label` | non-empty string | yes | The tool name. |
| `id` | string | no | The call id. |
| `input` | any JSON | no | The arguments. |
| `output` | any JSON | no | What the tool returned. An agent that replays its history reads this as the real result. |
| `error` | string | no | The error the tool returned. |

### `world` keys

| Key | Type | Meaning |
|---|---|---|
| `tools` | mapping of tool name to `{ result?, error?, latency_ms? }` | Forced results and errors, from this block on. |
| `store` | mapping | A seeded store. |
| `workspace` | `{ from?, files? }` | `from`: a folder the workspace starts from; `./<path>` is read from the spec's folder, any other relative path from the folder the run starts in. `files`: path to content. |
| `fixtures` | mapping | Free fixtures. |

Top-level shorthands: `ledger_seed` is `given.ledger`, and `workspace_seed` is `given.world.workspace` (a string becomes `{ from: <string> }`). Setting both forms is `SPEC_ALIAS_CONFLICT`.

## Outputs and how to read them

A prefix changes no output format. It changes what the block starts from:

- The resolved Given of each block (prefix, ledger, world, vars, target, and `origin` when the spec states one) is hashed, and the hash enters the block's cache key. Two blocks with the same Given and stimulus share a cache entry. `origin` also changes the spec hash, so results with different origins are never pooled; a spec without it keeps its hashes.
- In a run, the block reports as usual: `✓ <spec> · <target> · <mode> · repeat 0  pass  <n> blocks`, or the failing verdict.
- A ledger contradiction (a block adds a fact with a value that differs from the one the ledger holds) is reported by the ledger check with both values.

## Worked example

`import traces` turns a recorded session into a draft spec: each observed user turn becomes a block, and every block after the first gets the conversation before it as its `given.prefix`, tool calls and their outputs included, and `origin: recorded`. On a recorded Claude Code session of the repository:

```sh
driftbench import traces examples/estates/sessions/clean-build.jsonl --from claude-code --out out/drafts
driftbench spec lint out/drafts
```

```text
$ driftbench import traces examples/estates/sessions/clean-build.jsonl --from claude-code --out out/drafts
Read 1 trace from 1 file (claude-code): 2 turns.
Wrote 1 draft spec to out/drafts, none approved: 2 blocks, no expect yet.
  Personal data redacted: 0 values.
Next: write each block's expect from the agent spec, then driftbench import approve out/drafts --all.
(exit 0)
$ driftbench spec lint out/drafts
✓ out/drafts/draft-claude-code-00000000-0000-4000-8000-000000000001.yaml  draft-claude-code-00000000-0000-4000-8000-000000000001 · 2 blocks · hash c8d713f9cc9d
  ! blocks.0  BLOCK_NO_EXPECTATION  this block checks nothing
  ! blocks.1  BLOCK_NO_EXPECTATION  this block checks nothing
Checked 1 spec: 1 valid, 0 invalid, 2 warnings.
(exit 0)
```

The second block of the draft starts from a prefix of two messages (the start of the file, cut after the fifth tool call):

```text
blocks:
  - user: Add a discount field to the invoice total in src/invoice.ts, then run the tests.
  - user: Thanks. Now show me the diff summary only.
    given:
      prefix:
        - role: user
          content: Add a discount field to the invoice total in src/invoice.ts, then run the tests.
        - role: assistant
          content: |-
            I will load the build skill for the shop first.

            Done. src/invoice.ts now applies the discount, test/invoice.test.ts covers it, and the 12 tests pass.
          tool_calls:
            - id: toolu_clean-build_01
              label: Skill
              input:
                skill: shop-build
              output: "Launching skill: shop-build"
            - id: toolu_clean-build_02
              label: Read
              input:
                file_path: /work/acme-shop/src/invoice.ts
```

The lint warnings are expected: a draft has no `expect` until a person writes it.

### A prefix you write

The plan-upgrade conversation of the Acme example, started at its third turn. The prefix holds the first two turns; the block only checks the choice. Written as `out/authoring-prefixes/resume-at-offer.yaml`:

```yaml file=out/authoring-prefixes/resume-at-offer.yaml
# Fictional data only. The block starts after the offer, without replaying the blocks before it.
id: resume-at-offer
target: { adapter: function, agent: acme-sales }
stages: [identify, offer, recap, order_placed, closing]
ledger_seed: { customer: existing }
blocks:
  - id: choose
    given:
      prefix:
        - role: user
          content: Hi, I'm already an Acme customer and I keep running out of data on my phone.
        - role: assistant
          content: Hi, I'm the Acme Telecom sales assistant. What is the email address on your Acme account?
        - role: user
          content: It's sam.rivera@example.com
        - role: assistant
          content: 'Plans with more data: Acme Mobile M, 40 GB for $25 a month; Acme Mobile L, unlimited data for $35 a month. Which one would you like?'
          tool_calls:
            - label: catalog.search
              input: { category: mobile, customer_email: sam.rivera@example.com }
      ledger: { customer_id: cust-001, current_plan: mobile-s }
    user: The unlimited one, please.
    expect:
      stage: recap
      tools:
        - { label: order.create, count: 0 }
      must: ['CONFIRM']
```

The recorded call has no `output`, so the Acme agent reads the catalog again for that past turn, without recording a new call.

```sh
driftbench spec validate out/authoring-prefixes/resume-at-offer.yaml
driftbench campaign run out/authoring-prefixes/resume-at-offer.yaml --no-cache --mode T,F
```

```text
$ driftbench spec validate out/authoring-prefixes/resume-at-offer.yaml
✓ out/authoring-prefixes/resume-at-offer.yaml  resume-at-offer · 1 block · hash bf920fcd867c
Checked 1 spec: 1 valid, 0 invalid, 0 warnings.
(exit 0)
$ driftbench campaign run out/authoring-prefixes/resume-at-offer.yaml --no-cache --mode T,F
Campaign c-6448f17e9702: 2 cells, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, regex, exact, injection, length, markup, starts_with, finish_reason, json, tool_f1, refusal, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
✓ resume-at-offer · function:acme-sales · T · repeat 0  pass  1 block
✓ resume-at-offer · function:acme-sales · F · repeat 0  pass  1 block
2 cells: 2 pass, 0 fail, 0 failed. Spent $0.00.
The runs are not kept: pass --store <file> to keep them.
(exit 0)
```

Both modes pass: the agent reached `recap` and asked for `CONFIRM` from the prefix alone.

### A history in prose

The same turn, written by a person, with the current plan stated in the assistant's text and no recorded call. Written as `out/authoring-prefixes/prose-history.yaml`:

```yaml file=out/authoring-prefixes/prose-history.yaml
# Fictional data only. The current plan is in the assistant's prose, not in a recorded call.
id: prose-history
target: { adapter: function, agent: acme-sales }
stages: [identify, offer, recap, order_placed, closing]
ledger_seed: { customer: existing }
blocks:
  - id: choose
    given:
      origin: authored
      prefix:
        - role: user
          content: Hi, I'm already an Acme customer and I keep running out of data on my phone.
        - role: assistant
          content: Hi, I'm the Acme Telecom sales assistant. What is the email address on your Acme account?
        - role: user
          content: It's sam.rivera@example.com
        - role: assistant
          content: 'Plans with more data: Acme Mobile M, 40 GB for $25 a month; Acme Mobile L, unlimited data for $35 a month. Your current plan is mobile-s. Which one would you like?'
      ledger: { customer_id: cust-001, current_plan: mobile-s }
    user: The unlimited one, please.
    expect:
      stage: recap
      tools:
        - { label: order.create, count: 0 }
      must: ['CONFIRM']
```

```sh
driftbench spec lint out/authoring-prefixes/prose-history.yaml
```

```text
$ driftbench spec lint out/authoring-prefixes/prose-history.yaml
✓ out/authoring-prefixes/prose-history.yaml  prose-history · 1 block · hash 5fa4e915ada7
  ! blocks.0.given.prefix.3  PREFIX_PROSE_HISTORY  the assistant states current_plan (mobile-s) in prose, which no recorded tool call of the prefix holds and the user never said: the agent may re-call the tool. Record the call with its output in tool_calls
Checked 1 spec: 1 valid, 0 invalid, 1 warning.
(exit 0)
```

The spec is valid; the warning says the history is a different test from a recorded call. Record the call that produced the plan in `tool_calls`, with its `output`, to test what the agent does after a real lookup.

## Common errors

Bad message shapes (`out/authoring-prefixes/bad/bad-prefix.yaml`):

```
$ driftbench spec validate out/authoring-prefixes/bad
✗ out/authoring-prefixes/bad/bad-prefix.yaml
    blocks.0.given.prefix.0.role  SCHEMA_INVALID_VALUE  Invalid option: expected one of "user"|"assistant"|"system"|"tool"
    blocks.0.given.prefix.1.content  SCHEMA_INVALID_TYPE  Invalid input: expected string, missing
    blocks.0.given.prefix.1.tool_calls.0.label  SCHEMA_INVALID_TYPE  Invalid input: expected string, missing
Checked 1 spec: 0 valid, 1 invalid, 0 warnings.
(exit 1)
```

A recorded `output` the agent does not expect. The same spec as the worked example, with `output: { customer: { id: cust-001 } }` on the past `catalog.search` call. The agent replays that output as the real result, loses the plans, and never reaches `recap`:

```
$ driftbench campaign run out/authoring-prefixes/bad/wrong-output.yaml --no-cache
Campaign c-cec97fdc0348: 1 cell, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, regex, exact, injection, length, markup, starts_with, finish_reason, json, tool_f1, refusal, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
✗ resume-wrong-output · function:acme-sales · F · repeat 0  fail  block 0 must.0, block 0 stage.reached
1 cell: 0 pass, 1 fail, 0 failed. Spent $0.00.
The runs are not kept: pass --store <file> to keep them.
(exit 1)
```

| Symptom | Cause | Fix |
|---|---|---|
| `SCHEMA_INVALID_VALUE` on `role` | a role outside the four | `user`, `assistant`, `system` or `tool` |
| `SCHEMA_INVALID_TYPE` on `content` | an assistant turn with tool calls only and no `content` | write `content: ''` |
| `SCHEMA_INVALID_TYPE` on `tool_calls.N.label` | a tool call with no name | add `label` |
| `SCHEMA_UNRECOGNIZED_KEYS` on `given` | `prefix` or `origin` at the top-level `given` | move it to a block's `given` |
| `GIVEN_ORIGIN_WITHOUT_PREFIX` | `origin` on a block with no `prefix` | add the `prefix` it describes, or remove `origin` |
| `PREFIX_PROSE_HISTORY` warning | an assistant message states a ledger fact no recorded call holds | record the call with its `output` in `tool_calls`, or keep the prose on purpose and read the results as a different test |
| a block fails right after a prefix | a recorded `output` with a shape the real tool never returns | copy the output from a real run, or leave `output` out so the agent reads the tool again |
| `crewai: the Given prefix holds N recorded tool call(s)` | a prefix with tool calls on the crewai adapter, whose default inputs pass history as text | write those turns as blocks the crew runs, or pass `inputs` to the adapter |
| the prefix seems ignored | the adapter has no `seedPrefix` capability (`process`, `nexus`, live Claude Code), so the agent does not receive it | write the earlier turns as blocks instead |
| `SPEC_ALIAS_CONFLICT` | `ledger_seed` and `given.ledger` both set | keep one |
