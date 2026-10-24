---
title: Declare and inspect an agent setup
summary: Detect runtime evidence, draft setup policies, preview coverage and prices, and guard against drift without model calls.
commands:
  - doctor
see_also:
  - core-exit-codes
---

## What it is

`driftbench doctor` reads an agent folder through registered readers and proposes `driftbench.setup.yaml`.
Every detected claim carries confidence and file evidence. The draft declares sources, runtime, roles,
custom part types, scope, execution policy, budget and privacy. It never executes estate code or calls a model.

## When to use it

Run it before evaluating an unfamiliar setup. Save and review a draft to make assumptions explicit, then use
`--check` to detect changed, added or removed files. Unknown files always remain visible in coverage.

## Commands and every option

`driftbench doctor [path]` inspects the folder; `path` defaults to `.`.

| Option | Default | Meaning |
|---|---|---|
| `--setup <file>` | `driftbench.setup.yaml` | Declaration relative to the inspected folder. A missing default means detection; an explicitly named missing file is an input error. |
| `--write <file>` | none | Write a private draft relative to the inspected folder. Refuses to overwrite; cannot combine with `--check`. |
| `--check` | false | Require a saved drift baseline; exit 1 on changed, added or removed files, 0 on equality. Never rewrites it. |
| `--json` | false | Print structured claims, coverage, unknowns, skipped inputs, prices, advice and draft. |
| `--help`, `-h` | false | Print command usage. |

## Inputs

A folder and, optionally, a version 1 setup file. Sources declare `id`, `path`, `kind`, `reader`, and optional
deployment `bindings` with runtime, deployed root, deployed path and link/copy method. Source paths resolve
from the setup file's folder. A quoted `~` is literal. Home is never read without an explicit source mapping.
Custom `sources[].types` use that reader's built-ins through the existing loader, including `extends`.
Top-level `types` is shorthand for the project source only. Type names are scoped by source id; an unknown
reader gets no host built-ins. Roles declare aspects as data.

## Outputs and how to read them

Confidence 0.9 identifies a runtime supported by classified reader files. Confidence 1 identifies a verified
link to a mapped source. No runtime evidence yields null, not an invented runtime. Unknown files reduce
coverage. Zero reader inputs means not-run. Paths skipped by scope, privacy, profile ignores, size limits or
reader limitations appear with reasons. Reports contain metadata and hashes, never file bodies.

Local next steps cost $0. A model next step has an unknown price until `budget.pricing` declares rates and
token limits; privacy, call count and the USD cap must also permit it. Doctor makes no paid call. Exit 0 means
inspection completed or drift agrees; 1 means drift; 2 means invalid input. Inspection does not claim full coverage.

## Worked example

Inspect the fictional Acme example with no model call, writing only to the scratch folder.

```sh
driftbench doctor examples/acme --json
```

```text
The JSON lists detected claims, unknown files, skipped inputs, priced next steps and the draft.
```

## Common errors

An unknown setup key, duplicate YAML key, unknown aspect, invalid glob, missing parent type, duplicate
source id, unmapped deployment root, or contradictory never policy rejects the whole setup.
`home not mapped` means no home mapping authorizes a legacy home read. `unmapped symlink` means a link
would leave its mapped source. `reader unavailable` means the declared reader is not registered.
`--check` without a baseline is an input error. An existing `--write` destination is never overwritten.
