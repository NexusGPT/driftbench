# Block

A block is the unit driftbench evaluates. It is one stimulus to the agent and everything the agent does before the next stimulus.

A spec is a succession of blocks. Each block is a unit test in three parts: Given (the initial conditions), When (the stimulus) and Then (the expected output and state delta). See [Given, When, Then](given-when-then.md).

## Two kinds of block, one model

A spec sets `kind: conversation` or `kind: task`. Both kinds use the same block, the same runner, the same checks, the same judges and the same statistics.

| | Conversational exchange | Task step |
|---|---|---|
| Agent | a conversational agent | a code-interpreter agent: it writes and runs code, works in a workspace and loads skills |
| When | a user message | an instruction |
| What the agent does | text, cards, tool calls, tool results | text, tool and skill calls, commands, files written in the workspace |
| Then reads | reply text, tool calls, cards, language, flow step, facts held | skills loaded, code run and its exit code, files produced, workspace diff, destructive operations |
| The block ends | when the agent waits for the next user message | when the agent hands back control |

Every field of `expect` is open to both kinds. A conversation block can check a workspace, and a task step can check the reply text. The full list is in [checks](../reference/checks.md).

## A conversation spec

```yaml
id: plan-upgrade
kind: conversation
title: An existing customer moves to a faster internet plan
channel: chat
lang: EN
steps: [discover, offer, confirm]
ledger_seed:
  customer_type: existing
criteria:
  - name: one_question
    rubric: Does the reply ask at most one question?
    fail: The reply asks two questions or more.
    pass: The reply asks one question, or none.
blocks:
  - id: ask
    user: Hi, my internet is too slow. What faster plans do you have?
    expect:
      step: offer
      tools:
        - label: lookup_plans
          count: 1
          input:
            current_plan: { nonempty: true }
      must: ["Fiber 500"]
      must_not: ["[Aa]s an AI"]
      lang: EN
      criteria: [one_question@gating]
  - id: choose
    user: The 500 one. Yes, go ahead.
    expect:
      step: confirm
      ledger_add: { plan: fiber_500 }
      tools:
        - label: submit_order
          count: 1
          input:
            plan: fiber_500
rules:
  max_calls: { submit_order: 1 }
  lang_stable: true
end_state:
  source: tool:submit_order
  mode: subset
  expect:
    plan: fiber_500
```

The first block expects one call to `lookup_plans` with a `current_plan`, a reply that names the plan and stays in English, and the flow at step `offer`. A judged criterion gates the block. The second block expects the order: the facts gain `plan`, and `submit_order` runs once with `plan: fiber_500`. After the run, `end_state` compares what the `submit_order` tool recorded with the expected fields.

## A task spec

```yaml
id: sales-workbook
kind: task
title: Turn two CSV files into a quarterly sales workbook
workspace_seed:
  files:
    data/north.csv: "month,revenue\nJanuary,1200\nFebruary,1300\nMarch,1250\n"
    data/south.csv: "month,revenue\nJanuary,900\nFebruary,950\nMarch,1000\n"
criteria:
  - name: totals_match_file
    rubric: Does the reply state the same quarterly totals as the workbook?
    fail: A total in the reply differs from the total row of its sheet.
    pass: Every total in the reply equals the total row of its sheet.
blocks:
  - id: build
    user: Build sales.xlsx with one sheet per region and a total row on each sheet.
    expect:
      skills:
        - name: xlsx
          count: 1
      execution:
        ran_code: true
        exit_code: 0
        max_commands: 10
      artifacts:
        - path: sales.xlsx
          kind: xlsx
          checks:
            - sheets: [North, South]
      workspace:
        created: [sales.xlsx]
        others_untouched: true
      safety:
        max_destructive_ops: 0
      criteria: [totals_match_file@gating]
    budget:
      steps: 20
      cost_usd: 0.5
  - id: summary
    user: Add a Summary sheet with the total of both regions.
    expect:
      artifacts:
        - path: sales.xlsx
          kind: xlsx
          checks:
            - sheets: [North, South, Summary]
      workspace:
        changed: [sales.xlsx]
        others_untouched: true
```

The task starts in a workspace that holds two CSV files. The first step expects the `xlsx` skill once, code that runs and exits with 0, a workbook with one sheet per region, and no other file touched. A judged criterion checks that the reply states the totals the file holds. The second step changes the same workbook and touches nothing else.

Both examples pass `driftbench spec lint --strict` today. A test in `tools/docs` runs them through the loader on every change.

## What a block records

The runner records each block it runs. The record shapes are defined today in `packages/core/src/schema/run.ts`. The runner that fills them is planned, phase 1.

* Observed: the segments in order (text, tool call, tool result, card), the customer-visible text, the tool calls with input, output and latency, the runtime trace (skills loaded, hooks fired, process steps), the artifacts, the workspace diff, the commands run with their exit codes, the cost and the latency.
* Verdicts: one per check and one per judged criterion, each with its evidence. See [judges](judges.md).
* Drift: the drift classes of a failing block. See [drift](drift.md).
* Pass: a block passes when every gating verdict passes and no machine check fails.

## A spec is checked before it runs

`driftbench spec validate` and `driftbench spec lint` work today. They check the schema, the regular expressions, the criterion references, the step names against `steps`, the counts and the perturbation positions. See [CLI](../reference/cli.md).
