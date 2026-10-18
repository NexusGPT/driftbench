---
title: Project layout
summary: Where a driftbench project keeps its specs, inventory, map, personas, criteria, labels, config and store, shown on the Acme example.
commands: []
see_also:
  - core-getting-started
  - core-configuration
next:
  - core-exit-codes
---

## What it is

driftbench imposes no folder layout: every command takes its paths as arguments. This topic gives the
layout the Acme example uses, `examples/acme` in the repository, so a new project can copy it and every
help topic's paths read the same way.

## When to use it

* Starting a project: create these folders and files as you need them, not all at once.
* Reading another topic's worked example: find what a path such as `examples/acme/map` holds.

## Commands and every option

None: this topic is about files. The folder `examples/acme`, one entry per kind of file:

| Path | Holds | Written by | Read by |
|---|---|---|---|
| `driftbench.yaml` (here `ci/campaign.yaml`) | the project config: `campaign`, `aggregates`, `scales`, `plugins` | you | `campaign run`, `campaign plan`, `ci`, `report`, `view` |
| `specs/conversations/*.yaml` | conversation specs, one file each | you, `import`, `generate` | `spec validate`, `campaign run`, most commands |
| `specs/tasks/*.yaml` | code-agent task specs | you | the same |
| `inventory.yaml` | behaviours, flows and channels: what coverage measures | you | `spec coverage` |
| `map/` | the map of situations: `proposal.yaml`, `answers.yaml`, `approved.yaml`, `space.yaml` | `extract`, then a person approves | `space`, `generate`, `intake` |
| `reference/` | the reference set of user turns per cell of the approved map | `intake from-interview` | `intake fidelity`, `intake approve` |
| `generated/` | candidate specs and `generate-report.json` | `generate` | `gate`, `pilot plan`, `pilot run` |
| `gated/` | specs that passed the validity gate, the gate report, the holdout | `gate`, `holdout seal` | `select`, `holdout score` |
| `golden/` | the golden set: `golden.json` and its specs | `select` | `campaign run`, `compare`, `ci` |
| `faults/` | planted faults the gate runs candidates against | you, code | `gate --faults` |
| `criteria/` | judged criteria, one YAML each, and their calibration recordings | you | `judge check`, `judge calibrate` |
| `labels/` | hand labels per criterion | you, or the viewer | `judge calibrate`, `view --labels` |
| `personas/` | simulated users, and `recordings/` of their answers | you | `simulate`, `campaign run --driver simulated` |
| `redteam/` | one file per deviation class, D1 to D12, with phrasings | you | the red team commands, see the redteam topics |
| `radius/` | change manifests | you | `radius`, `campaign run --change` |
| `families/` | code-agent task families | you | `family` |
| `pilot/` | pilot reports, where results vary and the noise floor | `pilot run` | `report --pilot`, people |
| `import/` | a CSV, a spreadsheet and the mapping that turns rows into specs | you | `import csv`, `import xlsx` |
| `reports/` | HTML scorecards and JUnit XML | `report` | people, CI |
| `ci/` | the campaign config and a CI workflow | you | `ci` |
| `*.db` (anywhere you choose) | the store: campaigns, runs, cache, datasets, prompts | any command given `--store` | `status`, `report`, `compare`, `view` |

## Inputs

You write: specs, the inventory, criteria, personas, red team phrasings, change manifests, the config. Code
writes the rest from them. Folders that code writes carry a README that says "Do not edit these files by
hand": run the command again instead.

## Outputs and how to read them

Keep the store out of version control: it holds every reply the agent gave, which can be sensitive, and it
grows with every run. Keep reports out too unless you publish them. Commit specs, inventory, map,
criteria, labels, personas and the config.

## Worked example

```sh
driftbench spec validate examples/acme/specs
driftbench spec coverage examples/acme/specs --inventory examples/acme/inventory.yaml # exit 1
```

The first checks every spec under `specs/`. The second reads the inventory beside it and prints which
behaviours each channel covers. It exits 1 on purpose: the Acme inventory keeps known gaps so the matrix
shows missing cells.

```text
Coverage: 4 of 14 behaviours covered, 7 of 10 flow deviations covered.
```

## Common errors

* A spec outside the folders you pass is never read: commands take paths, they do not search the project.
* `SPEC_PARSE` on a file you did not mean as a spec: a folder argument reads every `*.yaml`, `*.yml` and
  `*.spec.json` under it. Keep inventories, maps and criteria outside the spec folders you pass.
* Editing a generated folder by hand: the next run of its command overwrites it.
