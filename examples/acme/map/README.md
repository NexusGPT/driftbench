# The Acme map proposal

Where the Acme sales assistant's behaviour is specified, proposed for a person to approve. Nothing here
counts until it is approved; code enumerates blocks later from the approved entries only.

| File | What it is |
|---|---|
| `proposal.yaml` | the proposal: 46 dimensions (175 values), 34 constraints and 21 phrases, nothing approved |
| `approved.yaml` | the same proposal with every flag set, by `extract approve --all` (approved on the owner's delegation for the fictional demo) |
| `space.yaml` | the space map of the approved axes, by `extract map`: what `driftbench space` reads |
| `tools.yaml` | the five Acme tools as JSON Schema, written from `src/tools.ts` |
| `answers.yaml` | the model's part, written by hand by the extract lane under the answer contract, because no model key was set |

## How it was made

```sh
pnpm driftbench extract --prompt examples/acme/src/policy.ts --prompt examples/acme/README.md \
  --inventory examples/acme/inventory.yaml --tools examples/acme/map/tools.yaml \
  --replay examples/acme/map/answers.yaml --out examples/acme/map/proposal.yaml --force
pnpm driftbench extract approve examples/acme/map/proposal.yaml --all --to examples/acme/map/approved.yaml
pnpm driftbench extract map examples/acme/map/approved.yaml --to examples/acme/map/space.yaml
pnpm driftbench space coverage --map examples/acme/map/space.yaml examples/acme/specs --t 2
```

* Code, without a model, read the inventory and the tools: 14 behaviours, 5 flows, the 8 deviation classes
  the flows require, 2 channels, 3 channel constraints, and the boundary values of every tool argument and
  result whose schema states one. That is 29 dimensions and 86 values.
* The five model sections (stages, rules, personas, data, phrases) came from `answers.yaml`, replayed
  through the same parser and checks a model answer goes through. `produced_by.family` is `lane`, so no
  one mistakes them for a tool run. Each entry says whether code or the model proposed it.
* Every value and constraint quotes the text that justifies it, and code found each quote in its source.

## Axes and details

Each dimension has a role. An axis is a dimension of the space map, crossed with the other axes; a detail
stays in the proposal, and the generator varies it inside a cell as boundary values. Code proposes the
roles: every tool-schema dimension is a detail, and the first dimension of each kind is an axis, the
others details. Here that gives 7 axes (behaviour, deviation, channel, stage, user_type, coverage_result,
workspace_start) and a full grid of 81312 cells, under the 250000 the space commands accept. A person may
flip any role; `extract approve` prints the grid it gives.

The proposal is a valid space map at every step (`toSpaceMap`, then `validateSpaceMap` from
`@driftbench/space`): one stage, deviation and channel dimension each, value ids unique per kind (so tool
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
