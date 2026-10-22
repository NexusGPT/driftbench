# Estate settings

This is a hands-on guide to the settings file of an estate. An **estate** is the folder that holds your coding agent: its system prompt, skills and settings. driftbench reads that folder to build tests. One small file in the folder, `driftbench.estate.yaml`, tells driftbench how to read it. The guide shows what the file holds and where it lives. It covers each key, how to check the file, and what a wrong key prints. Every command below is run by a test on GitHub, and every excerpt is real output. Nothing calls a model and nothing is paid for. The full list is in [what you can change in an estate](../estate-settings.md) and the [estate files reference](../reference/estate-files.md).

## Before you start

**Why you do this.** driftbench reads files the same way on every machine only if the way is written down. The settings file writes it down once, and every scan then reads the estate alike.

**You need.**

- Node 22 or newer, and driftbench: `npm install --global @agent-nexus/driftbench`, which gives you the command `driftbench`. In a clone of this repository, run `pnpm install` and put `pnpm` in front of every `driftbench` below.
- An estate. The guide uses `examples/estates/fixture`, the Northwind ops assistant, a made-up agent. Its layout is the one of Claude Code, Anthropic's coding agent.

This is the start of the estate's `CLAUDE.md`, its system prompt:

```markdown
# Northwind ops assistant

## Rules

- **R1.** Always answer in the language of the user's latest message.
```

**Where the file lives.** It is named `driftbench.estate.yaml` and sits at the root of the estate. It may also sit at `.claude/driftbench.estate.yaml`, and the root file wins. Every path inside it is relative to the estate root. Every key is optional. A command-line option always wins over its key.

**Words used below.**

- An **atom** is one thing the files tell the agent to do or to use. The list of all atoms is the **map**.
- A **labeler** is the code or the model that reads each sentence of your prose and says whether it is a rule.
- A **cassette** is a file of recorded labeler answers. A scan that replays a cassette needs no key and no network.
- The **ledger** is a file of ids, one per unit of your prose. It lets a later scan tell which unit you edited.

**Which command reads which key.**

| Command | Keys it reads |
|---|---|
| `estate scan`, and `estate build`, which runs it | `ignore`, `externals`, `userSkills`, `aliases`, `documents`. With `--pointer`: `labels`, `labeler`, `threshold`, `ledger`. |
| `estate lint` | `ignore` and `userSkills` |
| `estate unit` | `scripts` and `helpers` |
| `estate run` | none |
| `radius ledger` | `ledger` |

Step 6 shows each row at work.

## 1. See the settings file you have

**Why you do this.** Before you add a key, look at what the estate already says. The Northwind fixture ships a file that sets two keys.

**You need.** A copy of the fixture, so the repository stays as it is.

**Relevant commands.**

- `cp -R examples/estates/fixture est1`: copies the example estate into a folder you can change · `-R` copies a whole folder · it produces `est1`. With your own agent, point at your own folder.
- `grep -o '^[a-z]*:' est1/driftbench.estate.yaml`: prints the top-level keys of the file · `-o` prints only the match, and the pattern matches a lowercase word at the start of a line followed by a colon · it prints one key per line.

**You type and you see.**

```console
$ cp -R examples/estates/fixture est1
$ grep -o '^[a-z]*:' est1/driftbench.estate.yaml
helpers:
scripts:
```

**How to read it.**

- The fixture sets `helpers` and `scripts`. Both are read by `estate unit`, in step 3.
- The long file has comments at the top that explain each key. Read them in `examples/estates/fixture/driftbench.estate.yaml`.

**If it goes wrong.**

- `grep` prints nothing: the estate has no settings file. That is allowed. Create one when you need a key.
- The file is not valid YAML. A scan with `--pointer` stops with `not YAML:`, then the first line of the parser's message, and exit 2. A plain scan prints nothing and reads the estate as if the file were empty.

## 2. Choose which files the scan reads

**Why you do this.** Some files in an estate are not part of the agent: logs, drafts, notes. They would add atoms that no test should cover. Five keys decide which files the scan reads.

**You need.** The copy `est1`. First scan it with no key, to see the starting count.

**Relevant commands.**

- `driftbench estate scan`: reads the estate into a map of atoms · `est1` is the estate folder. `--no-model` reads the structure only, so no model is called. `--out m1.yaml` is the map file to write · it writes the map and prints the counts, the files it ignored and the files nothing names.
- `echo 'ignore: [.claude/steps.json]' >> est1/driftbench.estate.yaml`: adds one key to the file · `>>` appends a line and keeps the rest · it changes the settings file.

**You type and you see.**

```console
$ driftbench estate scan est1 --no-model --out m1.yaml
Wrote m1.yaml: 47 atoms (47 read by code and approved, 0 split from prose by the model and waiting for approval), 34 edges.
  Ignored: none.
$ echo 'ignore: [.claude/steps.json]' >> est1/driftbench.estate.yaml
$ driftbench estate scan est1 --no-model --out m2.yaml
Wrote m2.yaml: 42 atoms (42 read by code and approved, 0 split from prose by the model and waiting for approval), 30 edges.
  Ignored: 1 file no runtime loads.
```

**How to read it.**

- Ignoring `.claude/steps.json` removes 5 atoms and 4 edges. The file lists the steps of a process, and nothing in the estate names it.
- `Ignored: 1 file no runtime loads.` confirms the key worked. Read this line each time you change `ignore`.
- The map keeps the ignored paths in its own `ignore:` list. Later commands that read the map, such as `radius ledger`, then skip the same files.

**The five keys, one at a time.**

- `ignore`: a list of globs of paths the scan skips, beside the defaults · example `ignore: [logs/, drafts/**]` · a glob works like a line of `.gitignore`: without a leading slash it matches at any depth, and a matched folder is skipped whole. The option `--ignore <glob>` adds one for a single run.
- `externals`: a list of folders outside the estate that a path in your prose may name · example `externals: [docs/, _meta/, companies/]` · the list replaces the defaults, `docs/` and `_meta/`, so list the defaults again. A path that names an external folder counts as information. It is no missing file.
- `userSkills`: the folder of a second layer of skills, such as the skills of one user · example `userSkills: ~/.claude/skills` · without it or the option `--user-skills <folder>`, the scan reads no home folder. This keeps a map the same on every machine.
- `aliases`: a short name for a folder · example `aliases: { REF: .claude/skills/invoice-reconcile/references }` · a path `REF/matching-rules.md` in your prose then reads as the file in that folder.
- `documents`: the role of each document the agent does not load as an instruction · example `documents: { 'archive/**': archive, 'forms/*.md': template }` · the roles are `normative`, `changelog`, `history`, `template`, `example`, `journal`, `fixture` and `archive`. A declared role wins over the recorded label and over the structure.

**If it goes wrong.**

- The count does not change: the glob does not match. Check the path from the estate root, and read the `Ignored:` line.
- A key with the wrong shape is dropped, and the scan prints no message about it. For example `ignore: logs` is a word and not a list, so nothing is ignored. Check the `Ignored:` line after each edit.

## 3. Declare scripts and helper agents for the unit runner

**Why you do this.** An estate holds scripts and helper agents. The unit runner tests them with no model, but it needs to know how to call them. Two keys say how.

**You need.** The copy `est1`, and the unit tests the fixture ships in `examples/estates/fixture/generated/unit`.

**Relevant commands.**

- `driftbench estate unit`: runs unit tests on the guards and scripts of an estate, with no model · `est1/generated/unit/script_fixture` is the folder of script tests. `--estate est1` is the estate whose scripts run · it prints one line per test and a count, and exits 0 when every test passes.

**You type and you see.**

```console
$ driftbench estate unit est1/generated/unit/script_fixture --estate est1
✓ unit.script_fixture.script.invoice-reconcile.script-scripts-reconcile-py  13 of 13 fixtures as declared
✓ unit.script_fixture.script.shipment-tracker.script-scripts-track-sh  10 of 10 fixtures as declared
```

**How to read it.**

- `13 of 13 fixtures as declared` means the script gave the exit code and output the settings file declares for each of its 13 cases.
- A **fixture** is one case of a script: the arguments it gets, the files it finds, and what it must answer.

**The two keys, one at a time.**

- `scripts`: per script path, a list of fixtures · example `scripts: { .claude/guards/check.py: [{ args: [--dry-run], expect: { exitCode: 0 } }] }` · each fixture holds `args`, optional `stdin` and `files`, and an `expect` with `exitCode` (default 0), `stdout` or `stdoutIncludes`. Write the expectation from the script's usage line, never from its source.
- `helpers`: per helper agent, a local command that stands in for the model · example `helpers: { route-planner: { command: [python3, .claude/stand-in.py], timeoutMs: 10000 } }` · the runner sends the helper's current body and task on standard input, and reads the answer from standard output.

**Change one expectation, and the test says so.** The next command makes the first fixture of `reconcile.py` expect exit 0 where the script exits 2:

```console
$ perl -0pi -e 's/args: \[\]\n        expect:\n          exitCode: 2/args: []\n        expect:\n          exitCode: 0/' est1/driftbench.estate.yaml
$ driftbench estate unit est1/generated/unit/script_fixture --estate est1   # exit 1
✗ unit.script_fixture.script.invoice-reconcile.script-scripts-reconcile-py  fixture-1: exit 2 where 0 is declared
```

The line names the fixture, the exit code the script gave, and the code the file declares. Fix whichever is wrong.

**If it goes wrong.**

- A `·` line that ends `driftbench.estate.yaml declares no fixture for <path>`: the script has no entry under `scripts`. The test is inert and passes. Add a fixture list.
- `a helper needs a configured executor in driftbench.estate.yaml helpers`: a helper test ran and the helper has no `command`.
- `no outcome recorded: run --record on the original first`: the tests were never recorded. Run `estate unit --record` on a copy of the suite you own.

## 4. Read the prose with labelers, and keep a ledger

**Why you do this.** Prose is not structured, so a labeler reads it. Four keys, the pointer keys, choose the label sets, the labelers, the thresholds and the ledger. They apply with `estate scan --pointer`.

**You need.** A fresh copy of the estate, and a settings file that sets the keys. The fixture ships `settings-labels.yaml`, a set of labels, and `settings-cassette.jsonl`, the recorded answers for it.

**Relevant commands.**

- `cp -R examples/estates/fixture estate`: copies the example estate into `estate` · `-R` copies a whole folder · it produces `estate`.
- `driftbench estate scan`: reads the estate, with the pointer reader for the prose · `estate` is the folder. `--pointer` reads the prose with labelers. `--cassette estate/settings-cassette.jsonl` replays the recorded answers, so no key is needed. `--update` writes the ledger the settings file names. `--out map.yaml` is the map to write · it prints which keys it read, the requests answered, and the units new or changed since the last ledger.

```console
$ cp -R examples/estates/fixture estate
```

This file replaces the fixture's file. It sets the four pointer keys beside `documents`:

```yaml
# file: estate/driftbench.estate.yaml
labels: settings-labels.yaml
threshold: { pass_at: 0.9, fail_at: 0.1 }
ledger: driftbench.ledger.json
documents:
  .claude/skills/invoice-reconcile/references/currency-table.md: fixture
  .claude/skills/invoice-reconcile/references/matching-rules.md: normative
  .claude/skills/invoice-reconcile/references/old-tolerances.md: archive
  .claude/skills/shipment-tracker/data/shipments.txt: history
  .claude/skills/weekly-report/templates/report.md: template
```

**You type and you see.**

```console
$ driftbench estate scan estate --pointer --cassette estate/settings-cassette.jsonl --update --out map.yaml
Pointer settings from driftbench.estate.yaml: labels, threshold, ledger.
  Requests: 91 answered, 0 sent, 0 recorded.
  Units since the last ledger: new 136.
```

**How to read it.**

- The first line lists the keys the scan read. A key you set and do not see here was not read.
- `91 answered, 0 sent, 0 recorded` means the cassette held every answer. A run that sends 0 requests costs nothing.
- `new 136` means the ledger did not exist, so all 136 units are new. The scan wrote `estate/driftbench.ledger.json`.

**The four keys, one at a time.**

- `labels`: the label sets, as a file or as a list written inline · example `labels: labels.yaml` · a set has a name, a description and the labels a unit can take. A new description re-asks that set only. The option `--labels <file>` wins.
- `labeler`: one labeler per class, written `<class>:<client>` · example `labeler: [system1:openai-decisions, system2:anthropic]` · `system1` is a quick yes-or-no labeler, and `system2` is a careful one. The key never names a model. A model is set by an environment variable, such as `ANTHROPIC_LABELER_MODEL`. Without the key, the default stack of both classes runs. The option `--labeler` wins.
- `threshold`: when the quick labeler decides alone · example `threshold: { pass_at: 0.9, fail_at: 0.1 }` · the keys are `labeler`, `pass_at`, `fail_at` and `margin_cut`, each a number from 0 to 1. Between `fail_at` and `pass_at`, the careful labeler decides. A new threshold voids no recorded answer.
- `ledger`: the file of unit ids · example `ledger: driftbench.ledger.json` · the scan writes it only with `--update`. Commit it, so a later edit is read against it.

**What an edit costs.** Edit one rule, then ask which units the edit reruns. The ledger the settings file names is the baseline. `radius ledger` reads that key.

**Relevant commands.**

- `perl -pi -e 's/more than two days/more than one day/' estate/CLAUDE.md`: changes rule R7 from two days to one · `-p` prints each line and `-i` edits the file in place · it changes `CLAUDE.md`.
- `driftbench radius ledger`: compares the estate with its ledger and lists what changed · `map.yaml` is the map of the last scan, and the ledger comes from the `ledger:` key. `--out change.yaml` is the change file to write · it prints the count of each class of edit and the units to rerun.

```console
$ perl -pi -e 's/more than two days/more than one day/' estate/CLAUDE.md
$ driftbench radius ledger map.yaml --out change.yaml
Units: 133 unchanged, 2 context, 0 moved, 1 changed, 0 deleted, 0 new.
  1 unit reruns, 2 advisory only; 1 change.
Wrote change.yaml.
```

Of 136 units, 1 changed, so 1 unit reruns. Two neighbours are **advisory**: shown for you to read, and not rerun. [Rerun less](rerun-less.md) uses this file.

**Plug in a labeler of your own.** A labeler can be a module you write. This one calls a line that starts with "Never" a prohibition:

```js
// file: estate/labeler.mjs
export default {
  id: 'never-lines',
  cls: 'system2',
  label(request) {
    const labels = request.window.units.map((unit) => ({
      units: String(unit.n),
      label: /^(?:- )?(?:\*\*[^*]+\*\* )?Never\b/.test(unit.text) ? 'prohibition' : 'none',
    }));
    return { labels };
  },
};
```

```yaml
# file: estate/driftbench.estate.yaml
labeler: system2:module:labeler.mjs
ledger: driftbench.ledger.json
```

```console
$ driftbench estate scan estate --pointer --cassette estate/module-cassette.jsonl --record --out module-map.yaml
Pointer settings from driftbench.estate.yaml: labeler, ledger.
  Requests: 95 answered, 95 sent, 95 recorded.
  Units since the last ledger: new 20, unchanged 135, changed 1.
The ledger estate/driftbench.ledger.json is not written: pass --update to write it.
```

**How to read it.**

- `95 sent` means the module answered 95 requests, and `95 recorded` means the cassette now holds them. A second run reads the cassette and sends 0.
- `unchanged 135, changed 1` is the edit above, read against the ledger.
- The ledger is not written, because `--update` was left out. The scan only reads it.

**If it goes wrong.**

- `the cassette has no answer for request <key>`: a changed set, model or prose needs an answer the cassette lacks. Scan with `--record`, or undo the change.
- `error: --pointer needs --cassette <file>: the file that holds the recorded answers`: add the option.
- A real model needs a key: `export ANTHROPIC_API_KEY=<your key>`, and `--record` to call it. The guide does not run that, because it is billed.

## 5. Check the file, and read what a wrong key prints

**Why you do this.** A wrong key can change which labels your tests rest on. The pointer keys therefore stop the scan with a message. Check the file with a scan before you trust it.

**You need.** A fresh copy of the estate and a wrong key.

**Relevant commands.**

- `cp -R examples/estates/fixture est5`: copies the example estate · `-R` copies a whole folder · it produces `est5`.
- `driftbench estate scan`: reads the estate, so it also reads and checks the settings file · `est5` is the folder. `--pointer` and `--cassette` are the options of step 4. `--out refused.yaml` is the map to write, and it is not written when the scan stops · it prints the message of a wrong key, and exits 2.

A model in the settings file is refused, because a file you share must never pin a model:

```console
$ cp -R examples/estates/fixture est5
```

```yaml
# file: est5/driftbench.estate.yaml
labeler: system2:anthropic:claude-haiku-5-5
```

```console
$ driftbench estate scan est5 --pointer --cassette est5/settings-cassette.jsonl --out refused.yaml   # exit 2
Cannot use the pointer settings of driftbench.estate.yaml:
  labeler: "system2:anthropic:claude-haiku-5-5" names a model; a model is set by environment variable, ANTHROPIC_LABELER_MODEL for anthropic
```

A number out of range is refused the same way:

```yaml
# file: est5/driftbench.estate.yaml
threshold: { pass_at: 2 }
```

```console
$ driftbench estate scan est5 --pointer --cassette est5/settings-cassette.jsonl --out refused.yaml   # exit 2
Cannot use the pointer settings of driftbench.estate.yaml:
  threshold: pass_at is a number from 0 to 1
```

**How to read it.**

- The first line names the file. Each next line starts with the key and says what shape the key wants.
- Exit 2 means nothing was measured. Fix the key and run again.
- These are the messages for the pointer keys:

| Message | Cause | Fix |
|---|---|---|
| `labeler: "<spec>" names a model; a model is set by environment variable, <VARIABLE> for <client>` | the file names a model | remove the model and set the variable |
| `labeler: "nonsense" starts with system1 or system2, the class of the labeler` | a labeler without its class | write `system1:` or `system2:` first |
| `threshold: <key> is not a threshold; the thresholds are labeler, pass_at, fail_at, margin_cut` | a wrong key under `threshold` | use one of the four |
| `threshold: <key> is a number from 0 to 1` | a value out of range | give a number from 0 to 1 |
| `labels: a file of label sets, or a list of sets` | `labels` holds something else | name a file or list the sets |
| `ledger: the path of the ledger file` | `ledger` is not a path | write a path |
| `name the ledger with --ledger <file>, or with ledger: in driftbench.estate.yaml` | `radius ledger` found no ledger | add the key, or pass the option |

**If it goes wrong.**

- A wrong key of the scan (`ignore`, `externals`, `userSkills`, `aliases`, `documents`) prints no message. The scan drops it and reads the estate without it. Read the `Ignored:` and `Orphans:` lines after the scan.
- A key that driftbench does not know, such as `ledgr`, is dropped without a message. Check the spelling against the list in step 7.

## 6. Which command reads which key

**Why you do this.** A key in the file does not reach every command. This step shows each path with a real run.

**You need.** A copy of the estate with the settings of step 4.

**Relevant commands.**

- `cp -R examples/estates/fixture bld`: copies the example estate · `-R` copies a whole folder · it produces `bld`.
- `driftbench estate build`: runs the whole chain, from the scan to the written tests · `bld` is the estate. `--out build` is the folder for every file. `--pointer` reads the prose with labelers. `--cassette bld/settings-cassette.jsonl` replays the recorded answers. `--yes` answers yes to its two questions · it writes the map, the plan and the tests in `build`, and exits 1 while some tests wait for something.
- `ls build | grep ledger`: lists the files of `build` that hold the word ledger · the pipe keeps only matching lines · it prints one name.

```console
$ cp -R examples/estates/fixture bld
```

```yaml
# file: bld/driftbench.estate.yaml
labels: settings-labels.yaml
threshold: { pass_at: 0.9, fail_at: 0.1 }
ledger: driftbench.ledger.json
documents:
  .claude/skills/invoice-reconcile/references/currency-table.md: fixture
  .claude/skills/invoice-reconcile/references/matching-rules.md: normative
  .claude/skills/invoice-reconcile/references/old-tolerances.md: archive
  .claude/skills/shipment-tracker/data/shipments.txt: history
  .claude/skills/weekly-report/templates/report.md: template
```

**You type and you see.**

```console
$ driftbench estate build bld --out build --pointer --cassette bld/settings-cassette.jsonl --yes   # exit 1
1. Read the estate: 114 atoms, 67 of them split from prose by a model and waiting for approval. Wrote build/map.yaml.
5. Write the tests: 1547 tests written. 1378 are complete and 169 still wait for something (the report lists what).
$ ls build | grep ledger
ledger.json
$ ls bld | grep driftbench.ledger   # exit 1
```

**How to read it.**

- **`estate build`** runs `estate scan` for you. The settings reached it: 114 atoms is the count with the label set and the roles of this file, where the plain fixture gives 116.
- `estate build` keeps its own ledger in `build/ledger.json`. The `ledger:` key does not reach it, and the file `driftbench.ledger.json` was never made. After an edit, pass `--ledger build/ledger.json` to `radius ledger`.
- **`estate run`** reads none of these keys. It starts the agent in a throw-away copy of the estate and checks what the agent did. The [walkthrough](walkthrough.md), step 3, shows it.
- **`radius ledger`** reads the `ledger:` key when you pass no `--ledger`. It reads `ignore` and `documents` from the map, which records them. The plain `radius` command, which takes a change file, reads no key.

**If it goes wrong.**

- Exit 1 from `estate build` is expected while tests wait for something, such as an answer to give. The report in `build/generated` says what.
- `Stopped before the first approval: ... Approve all 67?`: you ran without `--yes` in a place with no terminal. Add `--yes`, or approve some atoms first with `estate approve`.

## 7. The keys at a glance

**Why you do this.** One place to look a key up.

| Key | Holds | Read by | Example |
|---|---|---|---|
| `ignore` | globs of paths to skip | `estate scan`, `estate lint` | `ignore: [logs/, drafts/**]` |
| `externals` | folders outside the estate | `estate scan` | `externals: [docs/, _meta/]` |
| `userSkills` | a second layer of skills | `estate scan`, `estate lint` | `userSkills: ~/.claude/skills` |
| `aliases` | an alias for a folder | `estate scan` | `aliases: { REF: .claude/skills/x/references }` |
| `documents` | the role of a document | `estate scan` | `documents: { 'archive/**': archive }` |
| `scripts` | fixtures of each script | `estate unit` | `scripts: { .claude/guards/check.py: [{ args: [], expect: { exitCode: 2 } }] }` |
| `helpers` | a stand-in command per helper | `estate unit` | `helpers: { route-planner: { command: [python3, stand-in.py] } }` |
| `labels` | the label sets | `estate scan --pointer` | `labels: labels.yaml` |
| `labeler` | one labeler per class | `estate scan --pointer` | `labeler: [system1:openai-decisions, system2:anthropic]` |
| `threshold` | when the quick labeler decides | `estate scan --pointer` | `threshold: { pass_at: 0.9, fail_at: 0.1 }` |
| `ledger` | the ledger of unit ids | `estate scan --pointer`, `radius ledger` | `ledger: driftbench.ledger.json` |

Two words are easy to mix up. The file `.claude/settings.json` holds the settings of the agent itself: its model, its permissions and its guards. The file `driftbench.estate.yaml` holds the settings of driftbench. The estate scan reads the first one as part of the agent, and the second one as its own instructions.

**What a change costs in recorded answers.**

| Change | Recorded answers it voids |
|---|---|
| A label set's description or labels | The answers of that set |
| A model, set by its variable | The answers of that labeler |
| A threshold | None. The labels are decided again from the cassette. |
| A labeler left out of the stack | None |
| The ledger path | None |
| An edit of the prose | None of the old answers. The windows that hold an edited unit need new ones. |
