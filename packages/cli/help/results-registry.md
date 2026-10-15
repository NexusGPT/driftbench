---
title: "Version datasets and prompts"
summary: "Keep immutable, content-addressed versions of spec sets and prompts in the store, diff and restore them, and record which versions a campaign ran."
commands:
  - dataset push
  - dataset list
  - dataset diff
  - dataset restore
  - prompt push
  - prompt list
  - prompt diff
  - prompt restore
see_also:
  - results-exports
  - results-compare
  - results-report
next:
  - results-exports
---

## What it is

The store holds a registry of versions beside the campaigns. `driftbench dataset` versions folders of spec
files; `driftbench prompt` versions prompt files (a file, or a folder of them). Both take the same four
subcommands: `push`, `list`, `diff` and `restore`.

* **Content addressed.** Each file is kept once, by its SHA-256. A version is the sorted list of its paths
  and file hashes; its hash is the SHA-256 of that list.
* **Immutable.** A version never changes. Pushing content a name already holds gives back that version and
  adds nothing.
* **Numbered.** The versions of one name count up from 1.
* **Checked.** `dataset push` loads every spec of the folder first and refuses the push when one is
  invalid. Generated `.seed-*` folders are included; other dot entries are skipped; `.git` and
  `node_modules` are always skipped.
* **Exact.** `restore` writes the bytes of every file as they were pushed, checked against their hashes, to
  the path they were pushed from or to `--out`. A file already there with other bytes stops the restore, and
  nothing is written, unless `--force`. Files the version does not hold are left alone.

A reference `<ref>` is `name@version` (`acme-specs@2`), `name@latest`, `name@<six or more hex characters of
the hash>`, or a bare name for the latest version.

Campaigns use the registry: `campaign run --dataset <ref>` runs the specs of a dataset version, restored
byte for byte into the campaign's temporary folder, and `campaign run --prompt <ref>` hands a prompt version
(one UTF-8 text file) to every target as `target.prompt`. Both need `--store`. The campaign records each
version by name, number and hash in its `sources`, and `campaign export` carries those versions into its
bundle, which `campaign import` stores in another store.

## When to use it

* To know exactly which specs and which prompt produced a result, months later.
* To compare two versions of a suite or a prompt before running them.
* To get back the exact files of a version that ran.
* To move a result, with its inputs, to another machine (`campaign export`, then `campaign import`).

## Commands and every option

```
driftbench dataset push <name> <path> --store <file> [--note <text>] [--json]
driftbench dataset list [name] --store <file> [--json]
driftbench dataset diff <ref> [other] --store <file> [--dir <path>] [--json]
driftbench dataset restore <ref> --store <file> [--out <path>] [--force] [--json]
```

`driftbench prompt push|list|diff|restore` takes the same arguments and options; its `<path>` is a prompt
file or a folder of them.

| Command | Argument or option | Default | Meaning |
|---|---|---|---|
| `push` | `<name>` | required | the name: letters, digits, dots, underscores and hyphens |
| `push` | `<path>` | required | dataset: the folder of spec files; prompt: the prompt file or folder |
| `push` | `--note <text>` | none | a note kept with the version |
| `list` | `[name]` | every name | list the versions of one name only |
| `diff` | `<ref>` | required | the version to read; the latest without `@` |
| `diff` | `[other]` | the version before `<ref>` | the version to compare with: `name@version`, `@version` or a number |
| `diff` | `--dir <path>` | none | compare with the files of this folder or file instead of a version |
| `restore` | `<ref>` | required | the version to write back; the latest without `@` |
| `restore` | `--out <path>` | the path it was pushed from | where to write: a folder, or a file path for a version of one file |
| `restore` | `--force` | off | overwrite files that differ from the version |
| all | `--store <file>` | required | the store that keeps the versions; made when missing on `push` |
| all | `--json` | off | print one JSON document |

Global: `--plugin <module>`.

| Exit | When |
|---|---|
| 0 | `push`, `list`, `restore`: done. `diff`: no difference |
| 1 | `push`: an invalid spec in the dataset. `diff`: the two differ. `restore`: a file differs and `--force` was not given |
| 2 | bad input: an unknown name or version, a path that cannot be read, a store that cannot be opened |

## Inputs

A folder of specs (`*.yaml`, `*.yml`, `*.spec.json`) for a dataset; one or more text files for a prompt. A
prompt used by `campaign run --prompt` must be a version of a single UTF-8 file.

## Outputs and how to read them

* `push`: `Pushed dataset <name>@<n> (hash <12 hex>): <k> files from <path>.`, or `Unchanged: ...` when the
  content is already a version. `--json` adds `created`.
* `list`: one line per version: `name@n`, short hash, file count, creation time, note.
* `diff`: one line per file, `A` added, `D` removed, `M` changed, with the changed lines of a text file and
  the sizes of a binary one, then a count. `--json` gives `from`, `to` and `changes`.
* `restore`: `Restored ... into <path>: <n> written, <m> unchanged.`, or one `✗ <file> differs` line per
  conflict and `Nothing was written.`
* A campaign that used `--dataset` or `--prompt` keeps `sources` in its record: `kind`, `name`, `version`
  and the full `hash` of each.

## Worked example

```sh
driftbench dataset push acme-specs examples/acme/specs/conversations --store reg.db --note first
driftbench dataset push acme-specs examples/acme/specs/conversations --store reg.db
driftbench dataset push acme-specs examples/acme/golden/specs --store reg.db
driftbench dataset list --store reg.db
driftbench dataset diff acme-specs --store reg.db # exit 1
driftbench dataset diff acme-specs@1 --dir examples/acme/specs/conversations --store reg.db
driftbench dataset restore acme-specs@1 --store reg.db --out restored
driftbench prompt push acme-sales examples/acme/src/policy.ts --store reg.db
driftbench prompt list acme-sales --store reg.db --json
driftbench campaign run --dataset acme-specs@1 --prompt acme-sales --target function:acme --store reg.db --campaign c-reg
driftbench campaign export c-reg --store reg.db --out bundles
driftbench prompt restore acme-sales --store reg.db --out restored-policy.ts
```

The working folder is shown as `/abs/path`.

```text
$ driftbench dataset push acme-specs examples/acme/specs/conversations --store reg.db --note first
Pushed dataset acme-specs@1 (hash 74ce682f7438): 6 files from examples/acme/specs/conversations.
$ driftbench dataset push acme-specs examples/acme/specs/conversations --store reg.db
Unchanged: dataset acme-specs@1 already holds these 6 files.
$ driftbench dataset push acme-specs examples/acme/golden/specs --store reg.db
Pushed dataset acme-specs@2 (hash 7de3ed02c403): 10 files from examples/acme/golden/specs.
$ driftbench dataset list --store reg.db
acme-specs@1  74ce682f7438  6 files  2026-10-14T14:03:22.687Z  first
acme-specs@2  7de3ed02c403  10 files  2026-10-14T14:03:49.743Z
$ driftbench dataset diff acme-specs --store reg.db
A conversations/new-customer-coverage.yaml
A conversations/order-loose-confirmation.yaml
D new-customer-coverage.yaml
D number-porting.yaml
D off-topic-return.yaml
D order-loose-confirmation.yaml
D plan-upgrade.yaml
A task/acme-price-sheet-i08-planted.yaml
D tool-failure.yaml
A twise/gen-twise-018.yaml
A twise/gen-twise-023.yaml
A twise/gen-twise-066.yaml
A twise/gen-twise-074.yaml
A twise/gen-twise-081.yaml
A twise/gen-twise-091.yaml
A twise/gen-twise-108.yaml
16 files differ between acme-specs@1 and acme-specs@2.
(exit 1)
$ driftbench dataset diff acme-specs@1 --dir examples/acme/specs/conversations --store reg.db
No difference between acme-specs@1 and examples/acme/specs/conversations.
$ driftbench dataset restore acme-specs@1 --store reg.db --out restored
Restored dataset acme-specs@1 into restored: 6 written, 0 unchanged.
$ driftbench prompt push acme-sales examples/acme/src/policy.ts --store reg.db
Pushed prompt acme-sales@1 (hash 2688721fedde): 1 file from examples/acme/src/policy.ts.
$ driftbench prompt list acme-sales --store reg.db --json
[
  {
    "kind": "prompt",
    "name": "acme-sales",
    "version": 1,
    "hash": "2688721fedde9e1a8f53d9e95a989f304faea98f4c3d7b18cf61de72e826c9e9",
    "files": [
      {
        "path": "policy.ts",
        "sha256": "e4fb6a5817c1dba0428cd056ebd25eecae76172c4fe55b575e8363e08b81c404",
        "size": 28007
      }
    ],
    "source": "/abs/path/examples/acme/src/policy.ts",
    "single": true,
    "createdAt": "2026-10-14T14:04:02.491Z"
  }
]
$ driftbench campaign run --dataset acme-specs@1 --prompt acme-sales --target function:acme --store reg.db --campaign c-reg
Campaign c-reg: 6 cells, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, regex, exact, injection, length, markup, starts_with, finish_reason, json, tool_f1, refusal, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
Not judged: 8 criteria in 16 blocks of 6 specs (one_question_per_turn, coverage_before_offer, checks_before_promising, resumes_pending_step, ledger_intact, and 3 more), 6 of them gating. This campaign loads no judge, so these criteria have no verdict and count in no pass or fail. See docs/concepts/judges.md.
6 cells: 6 pass, 0 fail, 0 failed. Spent $0.00.
$ driftbench campaign export c-reg --store reg.db --out bundles
Exported campaign c-reg to bundles/c-reg: 6 runs, 6 specs, 2 sources (dataset acme-specs@1, prompt acme-sales@1).
$ driftbench prompt restore acme-sales --store reg.db --out restored-policy.ts
Restored prompt acme-sales@1 into restored-policy.ts: 1 written, 0 unchanged.
```

## Common errors

| Message | Cause and fix |
|---|---|
| `No dataset <name> in <store>.` (exit 2) | an unknown name; `dataset list --store <file>` shows them |
| `<path> holds no spec file: a dataset is a folder of *.yaml, *.yml or *.spec.json specs.` (exit 2) | push a spec folder, or use `prompt push` for prompt files |
| `Fix the invalid specs first: nothing was pushed.` (exit 1) | the lines above name each invalid spec |
| `<name>@1 is the first version: name another, or compare with a folder with --dir.` (exit 2) | `diff` of version 1 needs a second ref or `--dir` |
| `✗ <file> differs from <ref>` then `Nothing was written. Restore over them with --force.` (exit 1) | the target holds edited files; pass `--out` elsewhere, or `--force` |
| `<ref> was pushed without its source path: give --out.` (exit 2) | give `--out` |
| a campaign refuses `--prompt` (exit 2) | the prompt version holds several files or bytes that are not UTF-8, or two `--prompt` options were given |
