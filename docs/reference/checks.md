# Checks

A check reads one part of what the agent did and returns a verdict with its evidence: the text that matched or is missing, the call, the diff. A report never says fail without the fact.

The spec side exists today: every field on this page is validated by `driftbench spec validate`. The checks that read the fields are planned: machine checks in phase 1, judged criteria in phase 2, the stage classifier and the ledger check in phase 3.

The checks read the agent's runtime through four concepts: tools, skills, guards and stages. See [block](../concepts/block.md#tools-skills-guards-and-stages).

Every check belongs to one family, whether it reads a reply or a workbook: one package, one verdict shape, one mutation test per check (break the target, see the check fail, restore). A machine check that fails is final; no judge overturns it. Which check gives which drift class is on the [drift](../concepts/drift.md) page.

## Fields of `expect`

Every field is optional and open to both kinds of block.

| Field | What it checks | Phase |
|---|---|---|
| `stage` | the stage the agent reaches in the block, against the spec's `stages` | 3 |
| `ledger_add` | the facts the block establishes; they join the ledger that the contradiction check reads | 3 |
| `tools` | each expected tool call: `label`, `count`, and assertions on its `input` | 1 |
| `tool_order` | how the expected tools line up with the observed calls: `exact`, `in_order` or `any_order` | 1 |
| `skills` | each expected skill: `name` and `count` | 1 |
| `guards` | each expected guard: `name`, an optional `verdict`, and `count` | 1 |
| `execution` | whether code ran (`ran_code`), the expected `exit_code`, and the most commands allowed (`max_commands`) | 1 |
| `artifacts` | each file the block must produce: `path`, `kind`, and `checks` on its content | 1 |
| `workspace` | the paths the block `created`, `changed` and `deleted`, and `others_untouched` | 1 |
| `safety` | at most `max_destructive_ops` destructive operations, and a confirmation before each operation in `confirm_before` | 1 |
| `must` | regular expressions the customer-visible text must match | 1 |
| `must_not` | regular expressions the customer-visible text must not match | 1 |
| `lang` | the language of the reply | 1 |
| `cards` | each expected card: `name` and `count` | 1 |
| `criteria` | judged criteria by name; `name@gating` gates the block | 2 |

Outside `expect`, the same family reads a block's `budget`, the spec's `rules` and the spec's `end_state`. They follow below.

## Tools, skills and guards

A tool expectation names the tool by `label`. `count` is an exact number, or `{ min, max }` with either bound; `count: 0` means the call must not happen. `input` maps argument names to assertions.

```yaml
- user: The 500 one. Yes, go ahead.
  expect:
    tools:
      - label: check_eligibility
        count: { min: 1 }
      - label: submit_order
        count: 1
        input:
          plan: fiber_500
          email: { regex: "@example\\.com$" }
          coupon: { absent: true }
    tool_order: in_order
```

`tool_order` uses the three match types of the Google ADK trajectory evaluator ([google/adk-python](https://github.com/google/adk-python), read 2026-10-11):

* `exact`: the observed calls match the expected calls, with no extra and no missing call.
* `in_order`: the expected calls appear in this order; other calls may sit between them.
* `any_order`: the expected calls appear, in any order.

`skills` checks the skills the agent loads, by `name` and `count`. It does not check their order today; checking the order of skills is planned, with no phase assigned yet.

`guards` checks the guards that fired during the block. A guard is a runtime check with a verdict. Each entry names the guard. `verdict` narrows the entry to one verdict, as the runtime reports it; without `verdict`, the entry counts every firing of the guard. `count` works as for tools, so `count: 0` means the guard must not fire, or must not give that verdict.

```yaml
- user: Clean the workspace and keep only the final report.
  expect:
    guards:
      - name: workspace_boundary
        verdict: deny
        count: 0
    workspace:
      deleted: [draft.xlsx]
```

The tool, skill and guard checks are planned, phase 1. The tool check also reports argument accuracy, the share of expected arguments that matched, without gating on it.

## Assertions on values

Tool `input` and `end_state.expect` assert values with these forms. Patterns compile as JavaScript regular expressions with the `m` flag.

| Form | Passes when the value |
|---|---|
| a bare string, number, boolean or `null` | is equal to it |
| `{ exact: <value> }` | is exactly this JSON value |
| `{ regex: <pattern> }` | matches the pattern |
| `{ contains: <text> }` | contains the text |
| `{ one_of: [<value>, ...] }` | is one of the listed values |
| `{ nonempty: true }` | is present and not empty |
| `{ absent: true }` | is absent |
| `{ subset: { ... } }` | holds at least these keys with these values |

## Text and language

* `must` and `must_not` hold regular expressions over the customer-visible text, read per segment and concatenated. The same pattern cannot sit in both lists.
* `lang` is the expected language of the reply, such as `EN`, `FR` or `NL`. A language detector reads each text segment.
* `rules.lang_stable: true` asks for the same language across all blocks.

Planned, phase 1.

## Cards

`cards` names the message cards a channel may send, with a `count` for each. `rules.one_message_per_turn: true` asks for one message per block: no duplicate text segment, and a card sent once. Planned, phase 1.

## Code, files and workspace

These fields read what a code-interpreter agent does. They work in any block.

```yaml
- user: Build sales.xlsx with one sheet per region and a total row on each sheet.
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
      confirm_before: [delete]
```

* `execution`: `ran_code: true` requires the block to run code, and `ran_code: false` forbids it. `exit_code` is the expected exit code of the last command. `max_commands` is the most commands the block may run. Command output is captured and bounded.
* `artifacts`: each entry names a file by `path`, an optional `kind` (`xlsx`, `docx`, `pptx`, `pdf`, `csv`, `json`, `text`, `code`) and `checks` on its content. A check is a mapping whose key names it, such as `{ sheets: [North, South] }`. The reader opens the file itself; a check never trusts the agent's description of it.
* `workspace`: the runner takes a snapshot of the workspace (file list and hashes) before the block and a diff after. `created`, `changed` and `deleted` list the paths expected in each set. `others_untouched: true` fails the block when any other path changed.
* `safety`: destructive or irreversible operations (delete, overwrite, send, pay, push) are flagged unless the block confirms them. `max_destructive_ops` caps them, and `confirm_before` lists the operations that need a confirmation first.

The execution, artifact, workspace and safety checks are planned, phase 1, with the sandbox that holds the workspace. The artifact readers are planned, phase 1 too:

| Kind | The reader exposes |
|---|---|
| `xlsx` | sheets, cells, formulas, totals |
| `docx` | headings, required sections, tables |
| `pptx` | slide count, titles, text |
| `pdf` | text |
| `code` | test runs |

The names of the checks for each kind are fixed when the readers ship.

## Judged criteria

`criteria` names criteria the spec defines, or criteria from a shared catalogue. `gating: true` on a definition gates every reference to it, and `name@gating` gates that one reference; a fail of a gating criterion fails the block. Judges, the council and calibration are on the [judges](../concepts/judges.md) page.

## Stage and facts

* `stage` is checked by the stage classifier against the catalogue in `stages`. A name missing from `stages` is an error today (`STAGE_UNKNOWN`).
* `ledger_add` adds facts to the ledger. The ledger check asks whether a later block contradicts one of them.

Both checks are planned, phase 3.

## Budget

`budget` on a block caps `steps` (the agent's steps in the block), `cost_usd` and `latency_ms`. The budget check is planned, phase 1; it reads cost and latency per segment from the adapter.

## Rules for the whole spec

| Field | What it checks |
|---|---|
| `max_calls` | the most calls per tool across the run; 0 forbids the tool |
| `forbidden_tools` | tools that must never be called |
| `lang_stable` | the reply language stays the same across blocks |
| `one_message_per_turn` | one message per block: no duplicate text segment, a card sent once |
| `custom` | reserved for checks that users register, planned, phase 1 |

The rule checks are planned, phase 1. A block that expects a tool the rules forbid is already an error today (`TOOL_FORBIDDEN_EXPECTED`).

## End state

`end_state` compares the state of the world after the run with what the spec expects. It is one mapping, a list of them, or `none`. `none` asserts that nothing was submitted. A spec with no `end_state` has no end-state check.

* `source` names where the adapter reads the state, such as `tool:submit_order` for the payload that tool recorded.
* `mode` is `subset` or `exact`.
* `expect` maps fields to [assertions](#assertions-on-values).

The check prints a diff field by field. Planned, phase 1.

## Checks with no field of their own

All planned, phase 1.

* `pii`: patterns of personal data per locale (identity numbers, bank accounts, phone numbers, email addresses) and the echo of fields that must not be repeated. How a spec configures it is not fixed yet.
* `schema_strict`: tool inputs are checked against strict schemas, so an invented parameter is a schema violation.
* `custom`: a TypeScript function `(ctx) => Verdict`, registered by name. `rules.custom` is reserved for these checks.

## The runtime battery

The runtime battery checks what an agent's runtime does around the model, through the same concepts: skills, guards and stages. Its test types are checks of the same family: guard replay with negative controls, the skill loading gate, the order of stages, measured judge checks on captured scenes, mutation tests that must fail first, a speed budget per guard, and the register of the final reply. A transcript adapter turns a recorded agent session into blocks with these runtime fields, and a pytest adapter runs an existing Python test suite and reads its JUnit output as verdicts. Planned, phase 4.

Every field and its type are listed in the [spec reference](spec.md).
