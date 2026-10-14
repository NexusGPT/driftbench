# The Acme map proposal

Where the Acme sales assistant's behaviour is specified, proposed for a person to approve. Nothing here
counts until it is approved; code enumerates blocks later from the approved entries only.

| File | What it is |
|---|---|
| `proposal.yaml` | the proposal: 51 dimensions (184 values), 111 constraints, 55 phrases and 74 relations, nothing approved |
| `approved.yaml` | the same proposal with every flag set, by `extract approve --all` (approved on the owner's delegation for the fictional demo, by the extract lane and then by the generate2 lane) |
| `space.yaml` | the space map of the approved axes, by `extract map`: what `driftbench space` reads |
| `tools.yaml` | the five Acme tools as JSON Schema, written from `src/tools.ts` |
| `answers.yaml` | the model's part, written by hand by the extract lane under the answer contract, because no model key was set |

## How it was made

```sh
pnpm driftbench extract --prompt examples/acme/src/policy.ts --prompt examples/acme/README.md \
  --prompt examples/acme/src/store.ts --inventory examples/acme/inventory.yaml \
  --tools examples/acme/map/tools.yaml --replay examples/acme/map/answers.yaml \
  --out examples/acme/map/proposal.yaml --force
pnpm driftbench extract approve examples/acme/map/proposal.yaml --all --to examples/acme/map/approved.yaml
pnpm driftbench extract map examples/acme/map/approved.yaml --to examples/acme/map/space.yaml
pnpm driftbench space coverage --map examples/acme/map/space.yaml examples/acme/specs --t 2
```

* Code, without a model, read the inventory and the tools: 14 behaviours, 5 flows, the 8 deviation classes
  the flows require, 2 channels, 3 channel constraints, and the boundary values of every tool argument and
  result whose schema states one. That is 29 dimensions and 86 values.
* The six model sections (stages, rules, personas, data, phrases, relations) came from `answers.yaml`,
  replayed through the same parser and checks a model answer goes through. `produced_by.family` is
  `lane`, so no one mistakes them for a tool run. Each entry says whether code or the model proposed it.
* Code also proposed the 7 recoveries the inventory already fixes: each detour class a flow lists in its
  `deviations` returns to the pending stage (the spec reference defines a detour so).
* Every value and constraint quotes the text that justifies it, and code found each quote in its source.

## Axes and details

Each dimension has a role. An axis is a dimension of the space map, crossed with the other axes; a detail
stays in the proposal, and the generator varies it inside a cell as boundary values. Code proposes the
roles: every tool-schema dimension is a detail, and the first dimension of each kind is an axis, the
others details. Here that gives 7 axes (behaviour, deviation, channel, stage, user_type, coverage_result,
workspace_start) and a full grid of 113568 cells on the proposal, under the 250000 the space commands accept.
The space map of the approved map adds `none` to the data and task axes and derives the pairs its
relations rule out: 212940 cells, 380 constraints. A person may flip any role; `extract approve` prints the
grid it gives.

The proposal is a valid space map at every step (`toSpaceMap`, then `validateSpaceMap` from
`@agent-nexus/driftbench-space`): one stage, deviation and channel dimension each, value ids unique per kind (so tool
values carry their dimension, such as `coverage.check.out.found.true`), and `none` added to the deviations.

## Approving it

```sh
pnpm driftbench extract approve examples/acme/map/proposal.yaml                       # lists the decisions
pnpm driftbench extract approve examples/acme/map/proposal.yaml --dimension stage     # approves one dimension
pnpm driftbench extract approve examples/acme/map/proposal.yaml --all                 # approves everything
```

A dimension has one `approved` flag, which its values inherit; a value may set its own flag to override it.
Each constraint and phrase has its own flag. An entry whose evidence is removed, or whose quote is no
longer in its source, makes the file invalid: `approve` refuses it and exits 1.

## Relations: what links values to tools, stages and end states

The generator derives every machine Then from the relations, never from an agent's reply. Each relation
quotes the source line that justifies it, and a person approves it like any other entry.

| Kind | What it says | Acme |
|---|---|---|
| `path` | a flow's stage order on one branch, the cell values the branch needs (`when`), and what the store holds at the end (`end_state`, by slots) | 12 paths over the upgrade, new-home, porting and order flows |
| `uses_tool` | a tool a flow calls, the stage it is called at (and the stage the turn reaches), when, and its inputs by slot | 14 calls, inputs quoted from `src/policy.ts` |
| `binds` | the concrete values a data value stands for: the email of a found account, the address a coverage result is read at | 12, from `src/store.ts` and invented fictional values |
| `recovery` | how a flow recovers from a deviation class: the probe stages, the stage after (`pending` is the stage reached), reply patterns, guards and calls; for D8 the tool that fails | 7 from code (the inventory), 17 from the lane |
| `reply_language` | the language every reply is in | `en`, from the english-only rule |
| `states` | what the reply of one turn must state | 7, among them each plan with its catalog price on the turn that enters the offer |
| `task_family` | a flow a code agent does as a task, built by a task family with an oracle in code | 1: the price-sheet flow, `../families/price-sheet`, holding `sales-operations` and `catalog-only`, its planted variant carrying `D6_instruction_in_data` |

A phrase may hold `{slot}` (`It's {email}.`), may say where it fits with `when` (`flow`, `stage`, a data
value), and may state slot values itself with `binds` (`The unlimited one, please.` binds the plan
`mobile-l`). The generator fills the slots from the cell, so a tool input expected in a block is the value
the block's own When states.

The model's part of the relations was written by the generate2 lane under the answer contract, because no
model key was set, and approved by it on the owner's delegation for the fictional demo.
