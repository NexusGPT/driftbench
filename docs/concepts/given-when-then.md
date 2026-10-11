# Given, When, Then

Every block is written in three parts.

* Given: the initial conditions. The conversation so far, the facts established, the state of the world, the runtime variables.
* When: the stimulus. A user message, an instruction, several messages at once, or an injected deviation.
* Then: the expected output and state delta, under `expect`.

The same three parts hold for a conversational exchange and for a task step. See [block](block.md).

## Given

A spec sets Given in two places.

* `given` at the top of the spec: defaults for every block. It holds `ledger`, `world` and `vars`.
* `given` on a block: overrides for that block. It can also hold `prefix`, the messages that come before the block.

| Part | What it holds | Example |
|---|---|---|
| `prefix` | the messages before this block, with their tool calls | the greeting and the questions already answered |
| `ledger` | the facts the agent must hold | `customer_type: existing` |
| `world.tools` | a forced result, error or latency per tool, from this block on | `lookup_plans: { error: timeout }` |
| `world.store` | a seeded store | an account record |
| `world.workspace` | the files the agent starts from: a folder (`from`) or inline `files` | two CSV files |
| `world.fixtures` | free fixtures | a price table |
| `vars` | runtime variables | the clock, the channel, the sender |

The facts grow block by block: `ledger_add` in a block's `expect` adds the facts that block establishes. The contradiction check reads them (planned, phase 3).

A block's `prefix` lets it start in the middle of a conversation without replaying the blocks before it. Teacher-forced mode starts each block from such a prefix. See [run modes](run-modes.md).

For a task step, Given includes the workspace. The runner takes a snapshot of it before the step and a diff after (planned, phase 1).

The runner resolves Given into one record per block: the prefix, the ledger, the world, the vars, the target agent and a hash of all of them. The hash keys the cache. The record shape (`ResolvedGiven`) is defined today; the runner that fills it is planned, phase 1.

## When

| Form | Meaning |
|---|---|
| `user: <message>` | one user message, or one instruction to a task agent |
| `burst: [<message>, <message>]` | two or more messages that arrive together |
| `when: { injection: { class, user } }` | a deviation written into the blocks, with its class |

`user` and `burst` can sit on the block itself; the loader moves them under `when`. A block takes exactly one of `user`, `burst` and `when`.

A perturbation inserts a deviation before a chosen block at run time, in perturbed mode only, without editing the blocks. See [recovery](recovery.md).

## Then

`expect` holds the expected output and state delta. Every field is optional. A block with no `expect` checks nothing, and `spec lint` warns about it.

| Family | Fields |
|---|---|
| Stage and facts | `stage`, `ledger_add` |
| Text | `must`, `must_not`, `lang` |
| Tools, skills and guards | `tools`, `tool_order`, `skills`, `guards` |
| Channel | `cards` |
| Code and files | `execution`, `artifacts`, `workspace` |
| Safety | `safety` |
| Judged | `criteria` |

A block can also carry a `budget` for steps, cost and latency. Rules for the whole spec sit in `rules`, and the expected end state of the world in `end_state`. Each field, and the check that reads it, is in [checks](../reference/checks.md).

## One block of each kind

A conversational exchange. Given: the facts so far. When: the customer's choice. Then: the stage reached, a new fact and one tool call.

```yaml
- id: choose
  given:
    ledger: { customer_type: existing }
  user: The 500 one. Yes, go ahead.
  expect:
    stage: confirm
    ledger_add: { plan: fiber_500 }
    tools:
      - label: submit_order
        count: 1
        input: { plan: fiber_500 }
```

A task step. Given: a workspace that already holds the workbook. When: the instruction. Then: the workbook gains a sheet, and no other file changes.

```yaml
- id: summary
  given:
    world:
      workspace: { from: fixtures/after-build }
  user: Add a Summary sheet with the total of both regions.
  expect:
    artifacts:
      - path: sales.xlsx
        checks:
          - sheets: [North, South, Summary]
    workspace:
      changed: [sales.xlsx]
      others_untouched: true
```

Every field is listed with its type in the [spec reference](../reference/spec.md).
