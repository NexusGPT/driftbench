---
title: What you can change in an estate
summary: Every setting, file and port of an estate scan that you can change, with an example each, and what a change costs in recorded answers.
commands:
  - estate scan
  - radius ledger
see_also:
  - validate-estate-scan
  - validate-estate-maintain
  - authoring-blast-radius
next:
  - validate-estate-scan
---

## What it is

An estate scan reads your agent's files. You choose how it reads them in three places.

* Settings: the keys of `driftbench.estate.yaml` at the root of the estate.
* Files: what the scan reads beside the estate, and what it writes for you to keep.
* Ports: where your own code or service plugs in, and the environment variables that choose a model or a key.

A command-line option always wins over its key in the settings file. Every path in the settings file is relative to the estate root.

## When to use it

* Before the first scan of a new estate: write the settings file once, so every scan reads the same way.
* Before you change a label set, a model or a threshold: see which recorded answers the change costs.
* When you want your own labeler: plug it into the port instead of changing driftbench.

## Commands and every option

The settings file, `driftbench.estate.yaml`. Every key is optional.

| Key | Read by | What it holds | Example |
|---|---|---|---|
| `ignore` | `estate scan`, `estate lint` | globs of paths the scan skips, beside the defaults | `ignore: [logs/, drafts/**]` |
| `externals` | `estate scan` | folders outside the estate a path may name | `externals: [docs/]` |
| `aliases` | `estate scan` | an alias and the folder it stands for | `aliases: { REF: .claude/skills/x/references }` |
| `documents` | `estate scan` | a glob and the role of the documents it matches; it wins over the recorded label and over structure | `documents: { 'archive/**': archive, 'forms/*.md': template }` |
| `scripts` | `estate unit` | the fixtures of each script the unit runner runs | `scripts: { .claude/guards/check.py: [{ args: [--dry-run], expect: { exitCode: 0 } }] }` |
| `labels` | `estate scan --pointer` | the label sets: a file, or the sets inline | `labels: labels.yaml` |
| `labeler` | `estate scan --pointer` | one labeler per class, `<class>:<client>`, never a model; without it, the default stack of both classes | `labeler: [system1:openai-decisions, system2:anthropic]` |
| `threshold` | `estate scan --pointer` | `labeler`, `pass_at`, `fail_at`, `margin_cut`, each from 0 to 1 | `threshold: { pass_at: 0.9, fail_at: 0.1 }` |
| `ledger` | `estate scan --pointer`, `radius ledger` | the ledger of unit ids | `ledger: driftbench.ledger.json` |

The options that win over a key: `--labels <file>`, `--labeler <class>:<client>[:<model>]`, `--labeler-threshold <p>`, `--labeler-pass-at <p>`, `--labeler-fail-at <p>`, `--labeler-margin-cut <m>` and `--ledger <file>` of `estate scan`, and `--ledger <file>` of `radius ledger`. A path given as an option is relative to the folder you run the command from. `--update` writes the ledger; without it the scan only reads it.

The files.

| File | Who writes it | What a change does | Example |
|---|---|---|---|
| `driftbench.estate.yaml` | you | the settings above | `ledger: driftbench.ledger.json` |
| the label sets file | you | which labels a unit can take; a set's description is in the request, so a new description re-asks that set only | `labels: [{ set: house, description: How replies are worded., labels: [{ name: rule, description: A unit that fixes a word. }] }]` |
| the ledger | `estate scan --pointer --update` | the unit ids of the last scan; commit it, so `radius ledger` reads an edit against it | `driftbench.ledger.json` |
| the cassette | `estate scan --pointer --record` | the recorded answers; a scan without `--record` needs no key and no network | `--cassette estate/cassette.jsonl` |
| `guard-state.yaml` | you, beside a map | the enforcement mode of each guard, read by `estate diff` | `version: 1` and `guards: [{ guard: guard.settings.x, mode: warn, since: 2026-10-01 }]` |
| a change manifest | `radius ledger`, `estate diff --change-out`, or you | what changed, read by `radius` and `campaign run --change` | `changes: [{ kind: prompt, id: instruction.standing.r7 }]` |

The ports.

| Port | How it plugs in | Example |
|---|---|---|
| a labeler endpoint | `<class>:http:<url>`; the bearer token in the variable `--labeler-key` names | `labeler: system2:http:https://labels.example.com/label` |
| a labeler module | `<class>:module:<path>`; a module that exports `id`, `cls` and `label(request)` | `labeler: system2:module:labeler.mjs` |
| `ANTHROPIC_LABELER_MODEL` | the model of `anthropic`; default `claude-haiku-5-5` | `ANTHROPIC_LABELER_MODEL=claude-sonnet-5-5` |
| `JEV_MODEL` | the model of the system 1 client of the Nexus platform, the default system 1 labeler (on the Nexus adapter page) | `JEV_MODEL=<model>` |
| `OPENAI_DECISIONS_MODEL` | the model of `openai-decisions`; it has no default | `OPENAI_DECISIONS_MODEL=<model>` |
| `ANTHROPIC_API_KEY`, `JEV_API_KEY` with `JEV_URL` or `JEV_ROUTE`, `OPENAI_API_KEY` | the keys of a `--record` run; never printed or recorded | `ANTHROPIC_API_KEY` set in the shell |

No key of the settings file names a model. A labeler with a model in the file stops the scan and names the variable to use, so a file you share never pins a model.

## Inputs

* The estate folder, with `driftbench.estate.yaml` at its root when you have one.
* For `--pointer`: a cassette, and with `--record` the keys of the services the labelers call.
* For `radius ledger`: the map of the last scan and the ledger it wrote.

What a change costs in recorded answers:

| Change | Recorded answers it voids |
|---|---|
| a label set's description or labels | the answers of that set |
| a model, by its variable | the answers of that labeler |
| a threshold | none: the labels are decided again from the cassette |
| a labeler left out of the stack | none |
| the ledger path | none |
| an edit of the estate's prose | none of the old answers; the windows that hold an edited unit need new ones |

## Outputs and how to read them

With a settings file, `estate scan --pointer` prints `Pointer settings from driftbench.estate.yaml: <keys>.` first: the keys it read. The report then names the labelers (`Pointer reader: ...`), the units kept from the ledger and labelled by this run, and the requests: answered, sent and recorded. A run that prints `0 sent` cost nothing.

A pointer key with the wrong shape stops the scan with exit 2 and names the key. The other keys are a note of the scan and are left out.

`radius ledger` prints the count of each edit class, then how many units rerun and how many are advisory only.

## Worked example

The fixture estate, copied, with a settings file. It selects the fixture's label set `settings-labels.yaml`, the shipped set without its `condition` label: this example shows the settings file, and the recorded answers of that set in `settings-cassette.jsonl` answer every request, so nothing is sent. It sets no labeler, so the scan reads with the default stack of both classes.

```sh setup
cp -R examples/estates/fixture estate
```

```yaml file=estate/driftbench.estate.yaml
labels: settings-labels.yaml
threshold: { pass_at: 0.9, fail_at: 0.1 }
ledger: driftbench.ledger.json
```

```sh
driftbench estate scan estate --pointer --cassette estate/settings-cassette.jsonl --update --out map.yaml
```

```text
Pointer settings from driftbench.estate.yaml: labels, threshold, ledger.
  Requests: 73 answered, 0 sent, 0 recorded.
  Units since the last ledger: new 154.
```

Edit one rule, then ask what the edit reruns. The ledger the settings file names is the baseline.

```sh setup
perl -pi -e 's/more than two days/more than one day/' estate/CLAUDE.md
```

```sh
driftbench radius ledger map.yaml --out change.yaml
```

```text
Units: 151 unchanged, 2 context, 0 moved, 1 changed, 0 deleted, 0 new.
  1 unit reruns, 2 advisory only; 1 change.
Wrote change.yaml.
```

Plug in a labeler of your own. This module calls a line that starts with "Never" a prohibition.

```js file=estate/labeler.mjs
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

```yaml file=estate/driftbench.estate.yaml
labeler: system2:module:labeler.mjs
ledger: driftbench.ledger.json
```

```sh
driftbench estate scan estate --pointer --cassette estate/module-cassette.jsonl --record --out module-map.yaml
```

```text
Pointer settings from driftbench.estate.yaml: labeler, ledger.
  Pointer reader: system 2 module:never-lines never-lines.
  Requests: 54 answered, 54 sent, 54 recorded.
  Units since the last ledger: unchanged 153, changed 1.
The ledger estate/driftbench.ledger.json is not written: pass --update to write it.
```

A model in the settings file is refused:

```yaml file=estate/driftbench.estate.yaml
labeler: system2:anthropic:claude-haiku-5-5
```

```sh
driftbench estate scan estate --pointer --cassette estate/cassette.jsonl --out refused.yaml # exit 2
```

## Common errors

| Message | Cause | Fix |
|---|---|---|
| `labeler: "<spec>" names a model; a model is set by environment variable, <VARIABLE> for <client>` | the settings file names a model | remove the model and set the variable |
| `threshold: <key> is not a threshold` | a key other than `labeler`, `pass_at`, `fail_at`, `margin_cut` | use one of the four |
| `name the ledger with --ledger <file>, or with ledger: in driftbench.estate.yaml` | `radius ledger` found no ledger | add `ledger:` to the settings file, or pass `--ledger` |
| `the cassette has no answer for request <key>` | a changed set, model or prose needs an answer the cassette lacks | scan with `--record`, or undo the change |
