---
title: Global options
summary: The options every driftbench command accepts, --plugin, --version and --help, and the options most commands share.
commands:
  - help
see_also:
  - core-reading-help
  - core-configuration
  - core-exit-codes
next:
  - core-configuration
---

## What it is

A few options belong to the program, not to one command. They work with any command and may stand anywhere
on the command line. Beside them, most commands share the same spelling for the same idea (`--json`,
`--store`, `--config`), described here once.

## When to use it

* `--plugin`: to load your own adapters, custom checks or pairwise judges before a command runs.
* `--version`: to record which driftbench produced a result.
* `--help` and `help`: to learn a command's arguments and options, or to read a help topic.

## Commands and every option

Program options:

| Option | Default | Effect |
|---|---|---|
| `--plugin <module>` | none | Load a plugin before the command runs: a module path, relative to the working folder, or a package name. Repeat it for several. `--plugin=<module>` works too. It is read before the arguments are parsed, so it may stand before or after the command. Plugins of the project config's `plugins` list load as well; a module named twice runs once. |
| `-V`, `--version` | | Print the version, such as `0.1.0`, and exit 0. |
| `-h`, `--help` | | Print the usage of the program, or of the command it follows, and exit 0. A command's usage ends with the help topics about it. |

The help command:

* `driftbench help`: print the index of every help topic, grouped by area.
* `driftbench help <topic>`: print one topic. `<topic>` is a topic id such as `core-exit-codes`, or its slug
  alone, `exit-codes`, when only one area has that slug.
* `driftbench help <area>`: print the topics of one area, such as `recipes`.
* `driftbench help search <words>`: print the topics that hold every word, ranked.
* `driftbench help --list`: print every command and subcommand with its one line description and its topic.
* `driftbench help <command>`: print the usage of a top-level command, the same as `driftbench <command> --help`.
* An unknown name prints `no help topic or command named "<name>"` with close topic ids, and exits 2.

Options most commands share. Each command's `--help` says which of them it takes:

| Option | Meaning wherever it appears |
|---|---|
| `--json` | Print one JSON document on stdout instead of the text lines. Exit codes do not change. |
| `--store <file>` | The SQLite store: campaigns, runs, the cache, datasets, prompts, labels. A command that writes runs makes the file when missing. A command that only reads a store refuses a missing path with exit 2. |
| `--config <file>` | The project config. Default `driftbench.yaml` in the working folder, read when present. See `driftbench help core-configuration`. |
| `--out <path>` | Where a command writes its files. |

Relative paths in arguments and options are read from the folder where you type the command. Under
`pnpm driftbench`, that is the folder you typed it in, not the package folder.

## Inputs

* A plugin module: a file whose default export (or export named `plugin`) is a function
  `(api) => { ... }`. It may call `api.adapter(name, factory)`, `api.check(name, check)` and
  `api.pairwiseJudge(name, factory)`. A plugin is code that runs with your rights: list only modules you trust.
* A spec file never loads a plugin. Plugins come only from `--plugin` and the config's `plugins` list.

## Outputs and how to read them

* `--version` prints one line, the version.
* `--help` prints `Usage:`, the description, the arguments, the options with their defaults, then
  `Help topics:` with the ids of the topics about the command, then `Every topic: driftbench help`.
* A plugin that cannot be loaded prints `driftbench: Cannot load the plugin <module>: <reason>` and the
  command does not run.

## Worked example

```sh
driftbench --version
driftbench --help
driftbench spec validate examples/acme/specs --json
driftbench spec validate --help
driftbench spec validate examples/acme/specs --plugin ./no-such-plugin.mjs # exit 2
```

```text
0.1.0

[
  {
    "path": "examples/acme/specs/conversations/new-customer-coverage.yaml",
    "ok": true,
    "id": "acme-new-customer-coverage",
    ...

driftbench: Cannot load the plugin ./no-such-plugin.mjs: Cannot find module '.../no-such-plugin.mjs' ...
```

## Common errors

* `driftbench: --plugin takes a module path or a package name` (exit 2): `--plugin` was last on the line,
  or followed by another option.
* `driftbench: Cannot load the plugin <module>: ...` (exit 2): the path is wrong, or the module's own
  imports do not resolve from where the module lives.
* `The plugin <module> exports no function` (exit 2): export the plugin as default.
* `error: unknown option '--x'` (exit 2): the option does not belong to that command. Read
  `driftbench <command> --help`; options of a subcommand go after the subcommand.
* `error: unknown command 'x'` (exit 2): run `driftbench --help` for the command list.
