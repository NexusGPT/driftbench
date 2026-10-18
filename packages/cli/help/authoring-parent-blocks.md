---
title: Parent blocks and recorded state
summary: Start a block from another block's recorded end state, isolate branches, and read blocked descendants without counting them as failures.
commands:
  - spec validate
  - spec lint
  - campaign run
see_also:
  - authoring-blocks
  - authoring-prefixes
  - authoring-spec-check
  - running-campaign-run
  - running-not-run
  - running-change-carry
  - judging-campaign-rejudge
next:
  - running-not-run
---

## What it is

`parent: <block id>` starts a block from another block's recorded end state in the same spec.
The parent supplies its actual conversation, ledger, world and runtime variables.
This tests a continuation from what the agent did.

Once any block declares `parent`, the whole spec becomes a set of trees in every run mode.
A block without a parent is a root. Each root starts from the spec's defaults.
A child inherits only its ancestors. Siblings receive separate copies of their starting state.
The runner executes dependencies first, even when a parent appears later in the YAML.

Without parent links, the usual sequential F/P and canonical T behavior stays in place.
Parent links do not refer to another spec, a stored campaign or a reusable object registry.

## When to use it

- Several continuations share one opening conversation.
- A later task needs files or facts produced by an earlier task.
- A failed setup should block its descendants while unrelated roots continue.
- You need the actual parent reply and tool results instead of an authored prefix.

## Commands and every option

This is a spec format feature. There is no parent command or parent flag.

| Command | Arguments and options | Default |
|---|---|---|
| `spec validate` | Required `<paths...>` names files or folders. `--json` prints the validation records. | Text output. |
| `spec lint` | Required `<paths...>`. `--json` prints records. `--strict` fails on warnings. `--summaries` checks named-state summaries. `--sections <registries...>` checks prompt-section links. | Text output; optional checks off. |
| `campaign run` | Read the parent-linked spec through `[paths...]`. `--target function:acme-sales` uses the fictional agent. `--mode T,F` runs both modes. `--no-cache` disables observation caching. `--json` prints run records. | Target from the spec, mode F, cache on, text output. |

The complete campaign option list and defaults are in [running-campaign-run](running-campaign-run.md).
Validation options and exit codes are in [authoring-spec-check](authoring-spec-check.md).
No project config key enables parent behavior: the `parent` spec key enables it.

## Inputs

### Parent and state keys

| Key | Type | Meaning |
|---|---|---|
| `blocks[].id` | Non-empty string | Unique within the spec. Children name this id. |
| `blocks[].parent` | Non-empty string, optional | The id of one parent in this spec. Missing ids and cycles are invalid. |
| `blocks[].given.prefix` | Message list, optional | Replaces the inherited conversation, including when the list is empty. |
| `given.ledger`, `blocks[].given.ledger` | Mapping, optional | Facts. Child values replace inherited values with the same key. |
| `blocks[].expect.ledger_add` | Mapping, optional | Facts established by a parent and available to its children. |
| `given.vars`, `blocks[].given.vars` | Mapping, optional | Runtime variables, such as clock or channel. Child values replace inherited values by key. |
| `given.world.store`, `blocks[].given.world.store` | Mapping, optional | Seeded application data. Child values replace inherited values by key. |
| `given.world.tools`, `blocks[].given.world.tools` | Mapping, optional | Forced tool answers. Merge by tool name. |
| `given.world.fixtures`, `blocks[].given.world.fixtures` | Mapping, optional | Free fixtures. Merge by key. |
| `given.world.workspace`, `blocks[].given.world.workspace` | Mapping, optional | Seeded files. A child workspace replaces the entire inherited workspace. |

`vars` and `world.store` are separate inputs. Neither is the SQLite campaign store selected by `--store`.
An adapter decides how it uses runtime variables and seeded application data.
Writing a variable does not set a shell environment variable or substitute text in the stimulus.

The inherited prefix includes the parent's reply and tool calls with their recorded outputs or errors.
A passed parent runs once per run, even when several children share it.
In a selected mode T run, required ancestors replay if no in-run recording exists.
Those ancestors supply state and cost, but add no measured blocks or verdicts.

### Workspace keys

| Key | Type | Meaning |
|---|---|---|
| `world.workspace.from` | Non-empty string, optional | Folder to seed. A `./` path is relative to the spec; other relative paths use the working folder. |
| `world.workspace.files` | Mapping from path to text, optional | Text files to seed. |
| `world.workspace.binary` | Mapping from path to base64, optional | Files to seed byte for byte, including non-text files produced by a parent. |
| `world.workspace.summary` | Non-empty string, optional | Description of the workspace. `spec lint --summaries` checks a folder seed for this description. |

A path cannot appear in both `files` and `binary` in one workspace mapping.
Schema validation checks base64 syntax; it does not prove the target can seed that file.

An adapter with mutable private state exports it through `snapshotGiven` and restores it when opening the child.
Such parent runs bypass the observation cache. A sandbox must export its changed workspace too.
Without that export capability, a child is `not_run` with kind `unsupported`.
An export failure makes the child `not_run` with kind `setup_failed`; its descendants are blocked.
The child also needs an adapter that can seed the inherited history.

The process adapter copies regular files into each child's own sandbox.
Text goes into `files`; other content goes into `binary`.
It skips `.git`, `node_modules`, empty folders and file modes.
A link inside the workspace becomes a plain copy. A link outside the workspace fails export.
The process adapter's `exportMaxBytes` limits the total export, with a default of 50 MB.

## Outputs and how to read them

`campaign run --json` exposes these fields in each cell's `blocks` list:

| Field | Meaning |
|---|---|
| `blockId` | The authored id of this block. |
| `index` | The block's position in the recorded run. |
| `status` | `not_run` or `blocked` on an unmeasured block. A measured block normally omits it and uses `pass`. |
| `blocked.by` | The direct parent that did not pass. |
| `blocked.root` | The original failed or unrun ancestor. |
| `blocked.reason` | An explanation, when available. |
| `notRun` | `kind`, `layer`, `check`, `expected` and `got` explain a refused setup. |

Stored `RunResult` records also retain these fields. The campaign CLI JSON summary does not expose them:

| Field | Meaning |
|---|---|
| `blocks[].parent` | The authored parent id, when present. |
| `blocks[].specIndex` | The authored position retained in a parent-linked run. |
| `blockRerun.reason` | Names ancestors replayed for state rather than measured, when applicable. |

A failed, unrun or blocked parent blocks its children. They receive no agent call and have no verdicts.
Independent roots continue. Reports group blocked descendants by the original cause.
Pass rates exclude `not_run` and `blocked` and show their counts separately.

`campaign run` exits 1 if a measured block fails. That failure takes precedence over blocked descendants.
It exits 3 when nothing fails but a block is unmeasured, and 0 when all measured results pass with no unmeasured blocks.
Invalid command inputs exit 2. Validation rejects invalid parent graphs before the agent runs.

A change that reaches a parent also reaches its descendants in every mode.
Partial `--block-reruns` requires a full tree replay for a parent-linked spec.
`campaign rejudge` also refuses the independent-block reuse proof for such a spec; run the tree again.

## Worked example

All data is fictional. The built-in Acme sales agent makes no model calls.
The `identify` parent has two independent children. A separate root starts a fresh conversation.

```yaml file=parents/pass.yaml
id: acme-help-parent-pass
target: { adapter: function, agent: acme-sales }
given:
  vars: { channel: web }
blocks:
  - id: identify
    user: Hi, I am already an Acme customer and I keep running out of data on my phone.
    expect:
      must: ['email address']
  - id: offer-web
    parent: identify
    user: sam.rivera@example.com
    expect:
      must: ['Acme Mobile M']
      tools: [{ label: catalog.search, count: 1 }]
  - id: offer-phone
    parent: identify
    given:
      vars: { channel: phone }
    user: sam.rivera@example.com
    expect:
      must: ['Acme Mobile M']
      tools: [{ label: catalog.search, count: 1 }]
  - id: independent
    user: Hi, I am already an Acme customer and I keep running out of data on my phone.
    expect:
      must: ['email address']
```

```sh
driftbench spec validate parents/pass.yaml
driftbench spec lint parents/pass.yaml --strict
driftbench campaign run parents/pass.yaml --mode T,F --no-cache
```

The next spec deliberately requires an impossible reply from its parent.
The child is blocked, but the independent root still runs.

```yaml file=parents/blocked.yaml
id: acme-help-parent-blocked
target: { adapter: function, agent: acme-sales }
blocks:
  - id: identify
    user: Hi, I am already an Acme customer and I keep running out of data on my phone.
    expect:
      exact: ACME-IMPOSSIBLE-REPLY
  - id: offer
    parent: identify
    user: sam.rivera@example.com
    expect:
      must: ['Acme Mobile M']
  - id: independent
    user: Hi, I am already an Acme customer and I keep running out of data on my phone.
    expect:
      must: ['email address']
```

```sh
driftbench campaign run parents/blocked.yaml --mode T --no-cache --json # exit 1
```

The JSON records the failed `identify`, the blocked `offer` and the passing `independent` block.
For `offer`, both `blocked.by` and `blocked.root` name `identify`.
The blocked record has `pass: false` and an empty `verdicts` list.

This file validates a binary seed. `AAEC` represents the three bytes 0, 1 and 2.
Validation does not run the agent or claim it can read this binary format.

```yaml file=parents/binary.yaml
id: acme-help-binary
given:
  world:
    workspace:
      files: { note.txt: Fictional Acme fixture }
      binary: { sample.bin: AAEC }
blocks:
  - user: Inspect the supplied files.
    expect:
      must: [Acme]
```

```sh
driftbench spec validate parents/binary.yaml
```

```text
Checked 1 spec: 1 valid, 0 invalid, 0 warnings.
```

These invalid fixtures show the three structural errors without running an agent.

```yaml file=parents/missing.yaml
id: acme-help-parent-missing
blocks:
  - id: child
    parent: absent
    user: Continue the Acme order.
    expect: { must: [Acme] }
```

```yaml file=parents/cycle.yaml
id: acme-help-parent-cycle
blocks:
  - id: first
    parent: second
    user: Begin the Acme order.
    expect: { must: [Acme] }
  - id: second
    parent: first
    user: Continue the Acme order.
    expect: { must: [Acme] }
```

```yaml file=parents/path-twice.yaml
id: acme-help-workspace-path-twice
given:
  world:
    workspace:
      files: { sample.bin: Acme }
      binary: { sample.bin: AAEC }
blocks:
  - user: Inspect the Acme fixture.
    expect: { must: [Acme] }
```

```sh
driftbench spec validate parents/missing.yaml --json # exit 1
driftbench spec validate parents/cycle.yaml --json # exit 1
driftbench spec validate parents/path-twice.yaml --json # exit 1
```

Their error records use `PARENT_MISSING`, `PARENT_CYCLE` and `WORKSPACE_PATH_TWICE`, respectively.
Each record includes the offending spec path and a message explaining the problem.

## Common errors

| Error or result | Cause | Fix |
|---|---|---|
| `PARENT_MISSING` | The `parent` id does not name a block in this spec. | Add the parent or correct its id. |
| `PARENT_CYCLE` | Parent links form a cycle, including a self-reference. | Remove the cycle. A parent chain must reach a root. |
| `DUPLICATE_BLOCK_ID` | Two blocks share an id. | Give each block a unique id and update its children. |
| `WORKSPACE_PATH_TWICE` | One workspace path is present in both `files` and `binary`. | Keep the path in one mapping. |
| `SCHEMA_INVALID_FORMAT` | A `binary` value is not valid base64. | Encode the bytes as base64. |
| `blocked` | The direct parent failed, was not run or was blocked. | Fix the block named by `blocked.root`, then rerun. |
| `not_run`, kind `unsupported` | The adapter cannot seed history or export a sandbox parent state. | Use an adapter that supports the required state. |
| `not_run`, kind `setup_failed`, check `parent snapshot` | The parent state export failed. | Read `notRun.got` and fix the failed export, such as an oversized workspace. |
| `parent-linked blocks require a full tree replay` | Partial carry cannot prove this dependent tree reusable. | Run the complete spec. |

Parent validation errors exit 1 from `spec validate` or `spec lint`.
They describe invalid inputs, not an agent failure.
