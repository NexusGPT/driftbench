# The command line

This is a hands-on tour of the `driftbench` command. It walks through the command families in the order a person meets them. Each family gets one real run on the Acme Telecom sample agent. The guide also shows how to find help, how to pass options, and how to read an exit code. Every command below is run by a test on GitHub, and every excerpt is real output. Nothing calls a model and nothing is paid for. The full list of commands and options is in the [CLI reference](../reference/cli.md), and a shorter table is in the [command tour](../cli-tour.md).

## Before you start

**Why you do this.** The tour uses the sample files of the repository, so you need the tool and a copy of those files.

**You need.**

- Node 22.13 or newer, and driftbench installed from a clone, as the [guide index](index.md#install) shows. That gives you the command `driftbench`.
- The folder `examples/acme` from a clone of this repository. In a clone, run `pnpm install` and put `pnpm` in front of every `driftbench` below.
- Acme is a made-up phone company. Its sales assistant is a small program, so no model runs. A **spec** is one test file. This is the start of one, `examples/acme/specs/conversations/tool-failure.yaml`:

```yaml
id: acme-tool-failure
title: The coverage service is down, and the assistant falls back to a sales callback
target: { adapter: function, agent: acme-sales }
blocks:
  - user: Hi, I want home internet at 7 Quarry Lane, Acmeville.
```

**How a command is built.** Every command has the same shape:

- `driftbench`, then a **family** (`spec`, `campaign`, `estate` and so on).
- Then, for some families, a **subcommand** (`spec validate`, `campaign run`).
- Then **arguments**, which are the files or folders the command works on.
- Then **options**, which start with `--` and change how the command works.

## 1. Find help

**Why you do this.** You will meet a command you do not know. The help is inside the tool, it matches your version, and it needs no network.

**You need.** Nothing but the `driftbench` command.

**Relevant commands.**

- `driftbench help`: prints an overview of driftbench, every command grouped by task, and the index of help topics · no arguments · it prints text and exits 0.
- `driftbench help <topic>`: prints one **topic**, a page about one capability · `<topic>` is a topic id such as `core-exit-codes`, or its last part, `exit-codes`, when that part is unique · it prints the page.
- `driftbench help <area>`: lists the topics of one area, such as `recipes`, `authoring`, `running`, `judging`, `results`, `validate` or `redteam` · `recipes` is the area here · it prints one line per topic.
- `driftbench help search <words>`: finds the topics that hold every word · `exit code` is the two words to find · it prints each topic with its first matching line.
- `driftbench help --list`: lists every command and subcommand with one line each and the topic about it · no arguments · it prints one line per command.
- `driftbench <command> --help`: prints the usage of one command · `spec validate` is the command here, and `--help` asks for its usage · it prints the arguments, the options with their defaults, and the topics about the command.

**You type and you see.**

```console
$ driftbench help core-exit-codes
Exit codes
What each driftbench exit code means, 0 pass, 1 check failed, 2 bad input, and the commands that use other codes.
## What it is
## When to use it
## Commands and every option
$ driftbench help recipes
Help topics of the area recipes
recipes
$ driftbench help --list
Every driftbench command, with one line each and the help topic about it.
$ driftbench spec validate --help
Usage: driftbench spec validate [options] <paths...>
Parse and validate specs. Exit 1 when any spec is invalid.
  paths       spec files or folders
  --json      print one JSON document
  -h, --help  display help for command
```

**How to read it.**

- Every topic has the same sections. They are: what it is, when to use it, every option, inputs, outputs, a worked example and common errors.
- In a usage, `<x>` is a required argument, `[x]` an optional one, and `x...` means one or more.
- `driftbench help` is the best start when you do not know the command. `<command> --help` is the best start when you know it.

**If it goes wrong.**

- `driftbench: no help topic or command named "<name>"` with exit 2: the name is not a topic. Run `driftbench help` and copy an id, or run `driftbench help search <word>`.
- `driftbench help campaign run` prints the usage of `campaign` only. For a subcommand, type `driftbench campaign run --help`.

```console
$ driftbench help no-such-topic   # exit 2
driftbench: no help topic or command named "no-such-topic". List the topics: driftbench help. Search them: driftbench help search no-such-topic
```

## 2. Pass options

**Why you do this.** Options change what a command does. They follow a few rules, and the rules are the same for every command.

**You need.** The Acme specs folder, `examples/acme/specs`.

**Relevant commands.**

- `driftbench campaign plan`: lists the runs a campaign would make and runs nothing · `examples/acme/specs/conversations/plan-upgrade.yaml` is the spec to plan. `--target function:acme` is the agent to plan it on. `--mode T,F` names two run modes in one value. `--repeats 2` runs each test twice. `--json` prints one JSON document · it prints the plan, with one row per run.
- `driftbench spec validate`: checks that spec files are well formed · `--json` prints one JSON document · it exits 0 when every spec is valid.

These are the rules for options.

- A value follows its option: `--repeats 2`. The form `--repeats=2` works too.
- An option that takes a list can be repeated: `--target function:acme --target function:acme-sales`. Some also take one value with commas: `--mode T,F`.
- Options of a subcommand go after the subcommand. `driftbench campaign --repeats 2 plan` is an error.
- `--json` prints one JSON document on standard output. Exit codes do not change.
- `--store <file>` names the file that keeps runs. `--config <file>` names the project config, `driftbench.yaml`. `--out <path>` names where a command writes files.
- A relative path is read from the folder where you type the command.
- `--plugin <module>` is the one option of the program itself. It loads your own code before the command runs, and it may stand anywhere on the line.

**You type and you see.**

```console
$ driftbench campaign plan examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme --mode T,F --repeats 2
Plan: 1 spec, 1 target, modes T, F, 2 repeats: 4 cells, 20 blocks.
Projected cost: $0.00 (function: no unit measured).
$ driftbench campaign plan examples/acme/specs/conversations/plan-upgrade.yaml --target=function:acme --json
  "blocks": 5,
```

**How to read it.**

- `4 cells` is two modes times two repeats. A **cell** is one test run once, in one mode.
- `Projected cost: $0.00` is right: the Acme agent is a program, and no model runs.
- The second command prints JSON, so a script can read it. Here the line `"blocks": 5,` is one field of that document.

**If it goes wrong.**

- `error: unknown option '--x'` with exit 2: the option does not belong to that command. Read `driftbench <command> --help`, and check that the option stands after the subcommand.
- `--repeats takes a whole number of at least 1, not "zero".` with exit 2: give a whole number.
- `error: unknown command 'x'` with exit 2: run `driftbench --help` for the list of families.

## 3. Spec: check your tests

**Why you do this.** A spec with a typo fails late and confusingly. Checking first costs a second.

**You need.** A folder of specs. Acme has seven, in `examples/acme/specs`. A spec file says what the user says and what the agent must answer.

**Relevant commands.**

- `driftbench spec validate`: parses each spec and reports whether it is valid · `examples/acme/specs` is a folder, searched for `*.yaml` files · it prints one line per file and a count, and exits 1 when any spec is invalid.
- `driftbench spec lint`: does what `validate` does, then prints advice (warnings) · `--strict` would turn warnings into failures · it prints the same lines and a count of warnings.
- `driftbench spec coverage`: shows which behaviours and deviations the specs cover · `--inventory examples/acme/inventory.yaml` is the list of behaviours the agent must show · it prints a table of covered and missing cells, and exits 1 when something is missing.

**You type and you see.**

```console
$ driftbench spec validate examples/acme/specs
✓ examples/acme/specs/conversations/tool-failure.yaml  acme-tool-failure · 3 blocks · 1 perturbation · hash e5bc5c9ba9d2
Checked 7 specs: 7 valid, 0 invalid, 0 warnings.
$ driftbench spec lint examples/acme/specs
Checked 7 specs: 7 valid, 0 invalid, 0 warnings.
$ driftbench spec coverage examples/acme/specs --inventory examples/acme/inventory.yaml   # exit 1
Behaviours by channel
Coverage: 4 of 14 behaviours covered, 7 of 10 flow deviations covered.
```

**How to read it.**

- A `✓` line names the file, the spec id, its **blocks** (one exchange each) and its **hash**, a short fingerprint of the content. A changed spec has a new hash.
- `spec coverage` exits 1 on Acme by design. The inventory keeps known gaps so you can see what a missing cell looks like. Its last line counts what is covered.
- Exit 0 means the specs are valid. Coverage shows whether they test enough.

**If it goes wrong.**

- A `✗` line with a code such as `SPEC_PARSE`: the spec is not well formed. Fix the key the line names. Every code is in the [CLI reference](../reference/cli.md).
- A path that does not exist is reported as an invalid spec and exits 1:

```console
$ driftbench spec validate examples/acme/specs/no-such-folder   # exit 1
✗ examples/acme/specs/no-such-folder
Checked 1 spec: 0 valid, 1 invalid, 0 warnings.
```

## 4. Campaign: run the tests

**Why you do this.** A **campaign** runs your specs on an agent and keeps the results. It is the command that tests the agent. The [campaigns page](campaigns.md) covers it in depth.

**You need.** Specs, and a **target**, which is the way driftbench reaches your agent. Acme's sales assistant is the target `function:acme-sales`.

**Relevant commands.**

- `driftbench campaign run`: sends each block of each spec to the agent and checks each answer · `examples/acme/specs/conversations` is the folder of specs. `--target function:acme-sales` is the agent. `--store demo.db` is the file that keeps the runs. `--campaign demo` is the name of this campaign · it prints one line per cell and a total, and writes `demo.db`.

**You type and you see.**

```console
$ driftbench campaign run examples/acme/specs/conversations --target function:acme-sales --store demo.db --campaign demo
✓ acme-plan-upgrade · function:acme-sales · F · repeat 0  pass  5 blocks
✓ acme-tool-failure · function:acme-sales · F · repeat 0  pass  3 blocks
6 cells: 6 pass, 0 fail, 0 failed. Spent $0.00.
```

**How to read it.**

- `✓` is a pass, `✗` a failure. The letter `F` is the **run mode**: the agent answers on its own replies. Modes are `T`, `F` and `P`.
- `Spent $0.00` is the money spent on the agent's model. Acme spends none.
- Without `--store`, the runs vanish when the command ends. Keep the store, because `report`, `compare` and `view` read it.

**If it goes wrong.**

- `Campaign demo already exists. Resume it with: driftbench campaign resume demo`: the store holds that name. Pick another `--campaign`, or drop the option.
- `No adapter is set up for <target>.`: the target is wrong. The message lists the targets this install reaches.

## 5. Report and view: read the results

**Why you do this.** A stored campaign is a file of numbers. These commands turn it into pages a person reads.

**You need.** The store `demo.db` from step 4.

**Relevant commands.**

- `driftbench report`: writes the scorecard of a campaign as one HTML page · `--store demo.db` is the file to read. `--out scorecard.html` is the page to write · it writes the page and prints the pass rate with its interval. It exits 0 when written.
- `driftbench compare`: compares a candidate campaign with a baseline and says whether the candidate is no worse · `--store`, `--baseline` and `--candidate` name the file and the two campaigns · it exits 0 when no worse and 1 when worse. The [read the numbers](read-the-numbers.md) page runs it.
- `driftbench view`: serves a local web page of a store, with hand labels · `--store demo.db` is the file to show · it runs until you stop it. Our tests do not run it.

```console
$ driftbench report --store demo.db --out scorecard.html
Campaign demo: 6 runs, 6 pass, 0 fail, 0 did not complete.
Wrote scorecard.html.
```

```bash
driftbench view --store demo.db
```

**How to read it.**

- `report` prints the counts first, then where it wrote the page. Open `scorecard.html` in a browser.
- `view` prints `driftbench view at` and a local address on your own machine. Open that address in a browser, and press Ctrl+C in the terminal to stop.

**If it goes wrong.**

- `No store at demo.db: this command reads a store and does not make one.` with exit 2: the path is wrong, or no campaign ran with `--store` yet.

## 6. Generate and extract: write tests by code

**Why you do this.** Writing hundreds of specs by hand is slow. These commands write them from a **map**, a list of the situations the agent can face. See [generate tests](generate-tests.md).

**You need.** A map. Acme has one, `examples/acme/map/approved.yaml`, and a proposal a person has not approved yet.

**Relevant commands.**

- `driftbench extract approve`: lists the decisions a person has to make on a proposed map · `examples/acme/map/proposal.yaml` is the proposal · it prints how many decisions are open. `--all` approves every entry.
- `driftbench generate`: writes specs from an approved map, by code, with no model · `--map` is the approved map. `--out generated` is the folder for the specs. `--t 2` makes every pair of situations meet at least once · it writes the specs and prints a table of what each seeder wrote. It exits 1 while some specs are incomplete.

**You type and you see.**

```console
$ driftbench extract approve examples/acme/map/proposal.yaml
examples/acme/map/proposal.yaml: 291 of 291 decisions are open (51 dimensions, 111 constraints, 55 phrases, 74 relations).
$ driftbench generate --map examples/acme/map/approved.yaml --out generated --t 2   # exit 1
Seed 1, t = 2.
Coverage on the axis map at t = 2: complete specs 708 of 708 (100.0%), all specs 708 (100.0%).
```

**How to read it.**

- `291 of 291 decisions are open` means a person has approved nothing in the proposal yet.
- `generate` exits 1 on Acme because some generated specs are incomplete. They wait for an approved phrase. The report lists which.
- The commands `gate` and `select` come next in this family. They reject tests that cannot fail and keep the smallest useful set. [Generate tests](generate-tests.md) runs them.

**If it goes wrong.**

- `extract` without `--no-model` or `--replay` calls a model and needs a key. Run it only on your own agent, as the [CLI reference](../reference/cli.md) describes.

## 7. Estate: read an agent folder

**Why you do this.** A coding agent is a folder of files: a system prompt, skills and settings. The `estate` family reads the folder into rules and tests. The [walkthrough](walkthrough.md) uses it in full.

**You need.** An **estate**, which is the agent's folder. The sample is `examples/estates/fixture`, the Northwind ops assistant.

**Relevant commands.**

- `driftbench estate scan`: reads the folder into a **map** of **atoms**, where an atom is one thing the files tell the agent to do · `examples/estates/fixture` is the folder. `--no-model` reads only the structure, so no model is called. `--out estate-map.yaml` is the map file · it writes the map and prints the counts.
- `driftbench estate lint`: checks the folder against its map for orphan files, unreachable files and missing references · `estate-map.yaml` is the map · it prints one line per finding and exits 1 when there are findings.

**You type and you see.**

```console
$ driftbench estate scan examples/estates/fixture --no-model --out estate-map.yaml
Wrote estate-map.yaml: 47 atoms (47 read by code and approved, 0 split from prose by the model and waiting for approval), 34 edges.
$ driftbench estate lint estate-map.yaml   # exit 1
estate-map.yaml: estate at examples/estates/fixture, 47 atoms.
  ORPHAN            .claude/steps.json: nothing in the estate names this file
19 findings.
```

**How to read it.**

- An **orphan** is a file that nothing names. An **unreachable** file is one that the standing instructions never lead to.
- The fixture holds 19 findings planted on purpose, so the lint has something to find.
- The other estate commands (`build`, `plan`, `generate`, `run`, `unit`) are in the [CLI reference](../reference/cli.md). Settings are on the [estate settings page](estate-settings.md).

**If it goes wrong.**

- `Cannot find the estate folder <folder>.` with exit 2: the folder does not exist. Check the path.

## 8. Radius: rerun only what a change can affect

**Why you do this.** After you edit the agent, most tests cannot change. The radius lists the ones that can, and runs nothing. See [rerun less](rerun-less.md).

**You need.** A suite of specs, and a **change manifest**: a short file that says what changed. Acme has `examples/acme/radius/stage-recap.yaml`, which says the recap stage changed.

**Relevant commands.**

- `driftbench radius`: lists the blocks a change can affect, against the whole suite · `examples/acme/gated/specs` is the suite. `--change` is the manifest. `--mode F,T` asks for the radius in both modes · it prints counts and a table, and runs nothing.

**You type and you see.**

```console
$ driftbench radius examples/acme/gated/specs --change examples/acme/radius/stage-recap.yaml --mode F,T
Blast radius of acme-v1 to acme-v2 (manifest edeee14e9937): stage:recap.
195 specs, 861 blocks scored (6 more run with their spec and are not scored: a gate rejected them).
Mode F, free-running: 298 of 861 blocks in the radius (233 direct, 65 forward), 563 out. 102 of 195 cells.
Mode T, teacher-forced: 233 of 861 blocks in the radius (233 direct, 0 forward), 628 out. 102 of 195 cells.
```

**How to read it.**

- In mode F, 298 of 861 blocks can change. The other 563 cannot, so a rerun may skip them.
- In mode T, each block runs alone, so only the 233 direct blocks need a rerun.

**If it goes wrong.**

- `radius needs spec paths and --change <manifest>.` with exit 2: give the suite and a manifest. For an estate, `radius ledger` derives a manifest from the files.

## 9. Judge: score what code cannot check

**Why you do this.** Some answers need judgement, such as "was the reply polite". A **judge** is a model that scores an answer against a written **criterion**. This family checks the criteria before you trust them. See [judge answers](judge-answers.md).

**You need.** A folder of criteria. Acme has twelve in `examples/acme/criteria`, each with a passing and a failing sample.

**Relevant commands.**

- `driftbench judge check`: validates each criterion and its sample transcripts, and calls no model · `examples/acme/criteria` is the folder · it prints one line per criterion and a count, and exits 1 on an issue.
- `driftbench judge run`: replays a panel of judges on recorded answers · `--criteria` is the folder and `--cassette` is the recording · it needs no key when you give a recording. A live judge is billed, so our tests do not run one.

**You type and you see.**

```console
$ driftbench judge check examples/acme/criteria
ok  care_redirect [system1, gating]: pass fixture 2 line(s), fail fixture 2 line(s)
12 valid criteria, 0 issue(s).
```

**How to read it.**

- `system1` is a quick, cheap judge that answers yes or no. `system2` is a careful one. `gating` means a failure of that criterion fails the block.
- `ok` means the criterion parses and its two samples are present.

**If it goes wrong.**

- A problem line starts with the file name, then the key and the reason. The summary ends with `0 valid criteria, 3 issue(s).` or similar, and the exit code is 1. Fix the key and run the check again.

## 10. Validate: check driftbench itself

**Why you do this.** driftbench measures your agent, so it must measure correctly. The `validate` family proves this. Each ladder of levels builds an input with a known answer, and checks that driftbench finds it.

**You need.** A clone of the repository. A ladder reads files from the repository, so run it from the repository root.

**Relevant commands.**

- `driftbench validate floors`: prints the level each ladder must reach in CI, read from `validators/floors.json` · no arguments · it prints one line, and it prints `none` when the folder holds no such file.
- `driftbench validate <component>`: runs one ladder · `<component>` is `estate`, `generator`, `judges`, `map`, `stats`, `system` or `variables`, or `all` · it prints a table of levels, and the exit code is the level reached.

```console
$ driftbench validate floors
Floors (validators/floors.json): none.
```

```bash
driftbench validate stats
```

The second command is not run by our tests, because a ladder takes minutes.

**How to read it.**

- `validate floors` prints `none` here because the test folder is not the repository root. In a clone it prints the floors.
- A ladder stops at the first failing level. The exit code is the level reached, from 0 to 63. Level 0 means level 1 failed.

**If it goes wrong.**

- Exit 64 is an input error, such as an unknown component. The message reads `No validator is registered for "x".` and lists the registered names.

## 11. Read an exit code

**Why you do this.** A script or a CI job reads the exit code. The code says whether what the command checks holds.

**You need.** A shell. In `sh` or `bash`, `echo $?` prints the code of the last command.

**The codes.**

| Code | Meaning |
|---|---|
| 0 | What the command checks holds, or what it writes was written. |
| 1 | What the command checks fails: an invalid spec, a failing cell, a regression, a coverage gap. |
| 2 | Usage or input error: an unknown option, a missing file, a bad number, an unreadable store. |
| 3 | `campaign run`, `campaign resume`, `ci`, `campaign rejudge` and `family verify` only: no test failed, but a block did not run. |

A few commands give the codes another meaning, and say so in their own help. `validate` exits with the level it reached. `view` runs until you stop it. The topic is `driftbench help core-exit-codes`.

**You type and you see.**

```console
$ driftbench campaign plan examples/acme/specs --mode X   # exit 2
Unknown mode "X". The modes are T, F and P, alone or separated by commas.
$ driftbench campaign status --store no-such-store.db   # exit 2
No store at no-such-store.db: this command reads a store and does not make one.
$ driftbench spec validate --no-such-option examples/acme/specs   # exit 2
error: unknown option '--no-such-option'
```

**How to read it.**

- Exit 1 means driftbench measured and found a problem with the agent or the files. Exit 2 means it never measured, because the command could not start.
- The message that goes with a nonzero code is on standard error. The results are on standard output.
- Piping output into `head` can cut the command short before it sets its code. Write to a file when the code matters.

**If it goes wrong.**

- A CI job fails and you cannot tell why: read the last lines on standard error. Exit 2 is almost always a path or an option.
