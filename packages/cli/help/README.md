# Help topics: the contract

The files in this folder are the topics `driftbench help` prints. The loader reads every file named
`<area>-<slug>.md` here when the command runs, so a topic added later shows up in the index with no code
change. This file is not a topic and is never printed. `OVERVIEW.md` is not a topic either: `driftbench help`
prints it first, then the topic list. It names every top-level command, grouped by task; a test fails when
a command is missing from it.

This contract is frozen. Every lane that writes topics follows it as written. Changes after the first
commit are additive only, and listed under "Changes" at the end.

## File name

`<area>-<slug>.md`, all lower case, letters, digits and hyphens. The topic id is the file name without
`.md`, such as `core-getting-started`. A reader asks for it with `driftbench help core-getting-started`.

The areas, in the order the index lists them:

| Area | Covers |
|---|---|
| `core` | getting started, global options, configuration and environment, project layout, exit codes, reading help |
| `recipes` | goal-first walkthroughs that chain real commands end to end, each on Acme; their own sections, below |
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
next:
  - core-reading-help
---
```

| Key | Holds |
|---|---|
| `title` | the topic name, a few words |
| `summary` | one line; the index prints it beside the topic id |
| `commands` | the driftbench commands the topic covers, each as its path without `driftbench`, such as `campaign run` or `estate unit`. Every runnable command must appear in at least one topic. A test fails on a path that names no command |
| `see_also` | topic ids, such as `core-exit-codes`. A test fails on an id with no file |
| `next` | optional: the topic ids to read after this one. The printer ends every topic with a `Next:` line; without the key it names the topic that follows in the index. A test fails on an id with no file |

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

A recipe, area `recipes`, has these sections instead, in this order: `## Goal`, `## Before you start`,
`## Steps`, `## What you have at the end`, `## When a step fails`. Its `## Steps` holds the commands, run as
a worked example is run (below). Its `commands` list every command it runs.

## Worked example

A recipe's `## Steps` runs the same way as a topic's `## Worked example`.

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
* A step that is not a driftbench command, such as making a file the next command reads, is tested too:
  * A fenced block whose info string holds `file=<path>`, such as ```` ```yaml file=config/judges.yaml ````,
    writes its text to that path in the scratch folder, at its place in the order.
  * A fenced block with the info string `sh setup` holds shell lines (`cp`, `mkdir`, `node -e`, ...), each
    run with bash in the scratch folder at its place in the order, and must exit 0 unless the line ends
    with `# exit <n>`. A `driftbench ` line inside it runs like any other.
  * Both write only to new relative paths: never under `examples/` or `packages/`, never with `..` or an
    absolute path. A `file=` path that breaks this is refused. A `sh setup` line runs with its working
    folder and `HOME` set to the scratch folder, and is refused when it names an absolute path, a `~` path,
    `..` or `ln`. Setup lines and driftbench lines see `INIT_CWD` and `PWD`
    set to the scratch folder too. Every topic fails its test when git then sees a change or a new file
    under `examples/` or `packages/` of the repository, or any new file at its root, ignored or not. So no worked example step stays untested: show a step as `text` only for one of these
    reasons, and say which in one line beside it:
    1. it calls a paid model;
    2. it reads git;
    3. it runs until stopped;
    4. it is a whole validator ladder run: it takes minutes, and its level moves as fixes land;
    5. it needs repository folders the scratch folder does not hold, such as `tools/` or `docs/`.

## Style

Plain text for an agent with no other context: say that each capability exists and exactly how to use it.
No em or en dashes. No slogans. Fictional data only: emails at example.com, no real names of clients.

## Changes

* Area `recipes`, with its own sections.
* Front matter key `next`, optional.
* `OVERVIEW.md`, printed at the top of `driftbench help`.
* Reader commands: `driftbench help <area>` lists one area, `driftbench help search <words>` finds topics,
  `driftbench help --list` prints every command with its one line description and its topic.
* Worked examples: `file=<path>` blocks and `sh setup` blocks, run in order with the commands.

* Coverage gate: `tools/docs/help-coverage.test.ts` walks the registered Commander tree.
  Every runnable command needs a topic and every flag needs a Commands and every option section.
  Shared flags may use a directly linked `see_also` topic. Examples alone do not count.
* Exported `IssueCodes`, `*IssueCodes`, `*WarningCodes` and `*ErrorCodes` arrays under package source
  are discovered automatically. Each code needs an exact inline-code entry in Common errors.
  A new registry must be a literal array, or the inventory reader must be extended with tests.
* The PR checks run every help worked example, including changes that only edit Markdown.
