# The Acme map proposal

Where the Acme sales assistant's behaviour is specified, proposed for a person to approve. Nothing here
counts until it is approved; code enumerates blocks later from the approved entries only.

| File | What it is |
|---|---|
| `proposal.yaml` | the proposal: 46 dimensions, 175 values, 34 constraints and 21 phrases, every entry `approved: false` |
| `tools.yaml` | the five Acme tools as JSON Schema, written from `src/tools.ts` |
| `answers.yaml` | the model's part, written by hand by the extract lane under the answer contract, because no model key was set |

## How it was made

```sh
pnpm driftbench extract --prompt examples/acme/src/policy.ts --prompt examples/acme/README.md \
  --inventory examples/acme/inventory.yaml --tools examples/acme/map/tools.yaml \
  --replay examples/acme/map/answers.yaml --out examples/acme/map/proposal.yaml --force
```

* Code, without a model, read the inventory and the tools: 14 behaviours, 5 flows, the 8 deviation classes
  the flows require, 2 channels, 3 channel constraints, and the boundary values of every tool argument and
  result whose schema states one. That is 29 dimensions and 86 values.
* The five model sections (stages, rules, personas, data, phrases) came from `answers.yaml`, replayed
  through the same parser and checks a model answer goes through. `produced_by.family` is `lane`, so no
  one mistakes them for a tool run.
* Every value and constraint quotes the text that justifies it, and code found each quote in its source.

## Approving it

```sh
pnpm driftbench extract approve examples/acme/map/proposal.yaml        # lists what is not approved
pnpm driftbench extract approve examples/acme/map/proposal.yaml --all  # approves every entry
```

Approve an entry by setting `approved: true` in `proposal.yaml`. An entry whose evidence is removed, or
whose quote is no longer in its source, makes the file invalid: `approve` refuses it and exits 1.
