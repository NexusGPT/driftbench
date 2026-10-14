# Help topics: the contract

The files in this folder are the topics `driftbench help` prints. The loader reads every file named
`<area>-<slug>.md` here when the command runs, so a topic added later shows up in the index with no code
change. This file is not a topic and is never printed.

This contract is frozen. Every lane that writes topics follows it as written.

## File name

`<area>-<slug>.md`, all lower case, letters, digits and hyphens. The topic id is the file name without
`.md`, such as `core-getting-started`. A reader asks for it with `driftbench help core-getting-started`.

The areas, in the order the index lists them:

| Area | Covers |
|---|---|
| `core` | getting started, global options, configuration and environment, project layout, exit codes, reading help |
| `authoring` | writing specs, maps, inventories, generation, import |
| `running` | campaigns, smoke, replay, perturb, simulate, families, pilot |
| `judging` | judges, criteria, the council, labels, the review queue |
| `results` | reports, compare, ci, monitor, view, select, holdout, radius |
| `validate` | the validator ladders and the gate |
| `redteam` | attack and the red team packs |

## Front matter

Each topic starts with YAML front matter between two `---` lines:

```yaml
---
title: Getting started
summary: Install driftbench and run it on the Acme example with no model call.
commands:
  - spec validate
  - campaign run
see_also:
  - core-project-layout
---
```

| Key | Holds |
|---|---|
| `title` | the topic name, a few words |
| `summary` | one line; the index prints it beside the topic id |
| `commands` | the driftbench commands the topic covers, each as its path without `driftbench`, such as `campaign run` or `estate unit`. Every runnable command must appear in at least one topic. A test fails on a path that names no command |
| `see_also` | topic ids, such as `core-exit-codes`. A test fails on an id with no file |

## Body

No top-level heading: the printer writes the title and the summary. Then these sections, each a `##`
heading spelled exactly as here, in this order, all present:

1. `## What it is`
2. `## When to use it`
3. `## Commands and every option`: every option of every command in `commands`, with its default
4. `## Inputs`
5. `## Outputs and how to read them`
6. `## Worked example`
7. `## Common errors`

Subsections (`###`) are free inside a section.

## Worked example

The worked example runs on the Acme example with no model call, or names the recording it replays. A test
runs it:

* Every fenced block with the info string `sh` inside `## Worked example` holds commands. Each line that
  starts with `driftbench ` is run, in order, through the CLI in one scratch folder per topic. Blank lines
  and lines starting with `#` are skipped. A line ending with `\` continues on the next line.
* The scratch folder holds `examples` and `packages` as links to the repository's own folders. Read from
  them; write only to new paths in the scratch folder itself, such as `--store acme.db` or `--out out`.
* A command must exit 0, unless its line ends with `# exit <n>`, such as `# exit 1`; then it must exit n.
* Show what a command prints in a separate fenced block with the info string `text`. It is not compared.
* A command that would call a paid model has no place in a worked example.

## Style

Plain text for an agent with no other context: say that each capability exists and exactly how to use it.
No em or en dashes. No slogans. Fictional data only: emails at example.com, no real names of clients.
