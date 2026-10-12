# Datasets and prompts

driftbench keeps two kinds of test input as versioned, immutable sets of files in its store: a **dataset** is a folder of spec files, a **prompt** is a prompt file or a folder of them. Specs can also come from a table: `driftbench import` turns the rows of a CSV file or a spreadsheet into spec files.

Every example on this page is fictional (Acme Telecom, Acmeville) and runs from the repository root.

## Import specs from a table

```
driftbench import csv <file> --mapping <yaml> --out <dir> [--force] [--json]
driftbench import xlsx <file> --mapping <yaml> --out <dir> [--force] [--json]
```

`import csv` reads a `.csv` or `.tsv` file; every field is text. `import xlsx` reads one sheet of a `.xlsx` workbook; numbers and booleans stay numbers and booleans, and a formula gives its cached result. Both read the file with the readers of the `artifacts` check, the same code that opens files an agent produced.

A mapping file says which columns fill which fields. It has a `spec` template, read once per spec, and a `block` template, read once per row. This mapping is [`examples/acme/import/mapping.yaml`](../examples/acme/import/mapping.yaml):

```text
sheet: Cases
group_by: conversation
spec:
  id: "acme-imported-{conversation}"
  title: "{title}"
  channel: chat
  lang: EN
  target: { adapter: function, agent: acme-sales }
  stages: [address, offer, details, recap, order_placed, callback, handover, closing]
block:
  user: "{question}"
  expect:
    stage: "{stage}"
    must: { $column: must, $split: "|" }
    must_not: { $column: must_not, $list: true }
    tools:
      - label: coverage.check
        count: { max: { $column: max_calls, $as: number } }
```

| Mapping key | Means |
|---|---|
| `sheet` | the sheet of a workbook; the first sheet without it. A CSV file has one table, so `import csv` ignores it |
| `header_row` | the row that names the columns; 1 by default. Rows above it are skipped |
| `group_by` | a column: rows sharing its value become the blocks of one spec, in row order, and the `spec` template reads the first of them. Without it, every row is a spec of one block |
| `spec` | the spec fields. It must give an `id` |
| `block` | the block fields. It must give `user`, `burst` or `when`; `expect` takes any field of the [spec reference](reference/spec.md) |

Inside the templates:

* A text with `{column}` takes the cell of that column; `{row}` is the source row number; `{{` writes a brace.
* A text that is one placeholder, such as `"{question}"`, takes the cell as it is: a spreadsheet number stays a number. An empty cell leaves the field out, and an object left empty is left out too.
* A directive reads one column with options: `$split: "|"` makes a list, the cell split on the separator and each part trimmed; `$list: true` makes a list of the whole cell; `$as` converts to `text`, `number`, `boolean` or `json`.
* Anything else is copied as it is.

Every spec is checked with the spec loader before anything is written. The CSV file [`examples/acme/import/cases.csv`](../examples/acme/import/cases.csv) holds three rows:

```
$ pnpm -s driftbench import csv examples/acme/import/cases.csv --mapping examples/acme/import/mapping.yaml --out _demo/imported
✓ _demo/imported/acme-imported-upgrade.yaml  acme-imported-upgrade · 2 blocks · rows 2, 3
✓ _demo/imported/acme-imported-porting.yaml  acme-imported-porting · 1 block · row 4
Imported 2 specs from 3 rows of cases.csv into _demo/imported.
```

The written spec starts with a comment naming its rows:

```yaml
# Imported from cases.csv, rows 2, 3.
id: acme-imported-upgrade
title: A customer upgrades home internet
channel: chat
lang: EN
target:
  adapter: function
  agent: acme-sales
stages: [address, offer, details, recap, order_placed, callback, handover, closing]
blocks:
  - user: Hello, I'm looking for faster home internet.
    expect:
      stage: address
      must: [Acme Telecom, street address]
      tools:
        - label: coverage.check
          count: { max: 0 }
  - user: 88 Summit Avenue, Acmeville
    expect:
      stage: offer
      must: [Fiber is not available, Acme Air 5G]
      must_not: ['Fiber (300|1000)']
      tools:
        - label: coverage.check
          count: { max: 1 }
```

(The file writes the lists one item per line; they are folded here.) The Cases sheet of [`cases.xlsx`](../examples/acme/import/cases.xlsx) holds the same rows and gives the same specs with `import xlsx`.

| Exit code | When |
|---|---|
| 0 | every spec is written |
| 1 | a row makes an invalid spec: each one is printed with its row numbers and the loader's error, and nothing is written |
| 2 | bad input: the mapping, the file, a format that does not match the file, a column the mapping names and the table lacks, or a spec file that exists with other content (overwrite it with `--force`) |

## The registry

```
driftbench dataset push <name> <path> --store <file> [--note <text>] [--json]
driftbench dataset list [name] --store <file> [--json]
driftbench dataset diff <ref> [other] --store <file> [--dir <path>] [--json]
driftbench dataset restore <ref> --store <file> [--out <path>] [--force] [--json]
```

`driftbench prompt` takes the same four commands. A `<ref>` is `name@version` (`acme-specs@2`), `name@latest`, `name@<six or more hex characters of the hash>`, or a bare name for the latest version.

* **Content addressed.** Each file is kept once, by its SHA-256. A version is the sorted list of its paths and file hashes; its hash is the SHA-256 of that list.
* **Immutable.** A version never changes. Pushing content a name already holds gives back that version and adds nothing.
* **Numbered.** Versions of one name count up from 1.
* **Checked.** `dataset push` loads every spec of the folder first and refuses the push when one is invalid. Entries whose name starts with a dot and `node_modules` are skipped, as the spec loader skips them.
* **Exact.** `restore` writes the bytes of every file as they were pushed, checked against their hashes, to the path they were pushed from or to `--out`. A file already there with other bytes stops the restore, and nothing is written, unless `--force` is given. Files the version does not hold are listed and left alone.

```
$ pnpm -s driftbench dataset push acme-specs _demo/specs --store _demo/store.db --note 'first import'
Pushed dataset acme-specs@1 (hash e836f6673509): 6 files from _demo/specs.
$ pnpm -s driftbench dataset push acme-specs _demo/specs --store _demo/store.db
Pushed dataset acme-specs@2 (hash ab756cbb1aa3): 6 files from _demo/specs.
$ pnpm -s driftbench dataset list --store _demo/store.db
acme-specs@1  e836f6673509  6 files  2026-10-11T23:50:43.942Z  first import
acme-specs@2  ab756cbb1aa3  6 files  2026-10-11T23:50:52.379Z
$ pnpm -s driftbench dataset diff acme-specs@2 --store _demo/store.db
M plan-upgrade.yaml
    @@ line 2 @@
     id: acme-plan-upgrade
    +# edited
     version: '1'
1 file differs between acme-specs@1 and acme-specs@2.
$ pnpm -s driftbench dataset restore acme-specs@1 --store _demo/store.db
✗ plan-upgrade.yaml differs from acme-specs@1
Nothing was written. Restore over them with --force.
$ pnpm -s driftbench dataset restore acme-specs@1 --store _demo/store.db --force
Restored dataset acme-specs@1 into _demo/specs: 1 written, 5 unchanged.
```

Between the two pushes, one line was added to `plan-upgrade.yaml`. `diff` without a second ref compares a version with the one before it; with `--dir` it compares a version with the files of a folder. It marks each file `A` added, `D` removed or `M` changed, with the changed lines of a text file and the sizes of a binary one.

| Exit code | When |
|---|---|
| 0 | `push`, `list`, `restore`: done. `diff`: no difference |
| 1 | `push`: an invalid spec in the dataset. `diff`: the two differ. `restore`: a file differs and `--force` was not given |
| 2 | bad input: an unknown name or version, a path that cannot be read, a store that cannot be opened |

## A campaign records the versions it ran

`campaign run --dataset <ref>` runs the specs of a dataset version: they are restored, byte for byte, into the campaign's temporary folder and loaded from there. `--prompt <ref>` names a prompt version the campaign ran with; repeat it for several. Both need `--store`, and the campaign records each version by name, number and hash in its `sources`, so a later reader knows exactly which inputs produced the runs.

```
$ pnpm -s driftbench campaign run --dataset acme-specs@1 --prompt acme-sales --target function:acme --campaign c-demo --store _demo/store.db
Campaign c-demo: 6 cells, 4 at a time. Checks: tools, forbidden, must, must_not, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
✓ acme-new-customer-coverage · function:acme · F · repeat 0  pass  4 blocks
✓ acme-number-porting · function:acme · F · repeat 0  pass  5 blocks
✓ acme-off-topic-return · function:acme · F · repeat 0  pass  5 blocks
✓ acme-order-loose-confirmation · function:acme · F · repeat 0  pass  4 blocks
✓ acme-plan-upgrade · function:acme · F · repeat 0  pass  5 blocks
✓ acme-tool-failure · function:acme · F · repeat 0  pass  3 blocks
6 cells: 6 pass, 0 fail, 0 failed. Spent $0.00.
```

The stored campaign then holds:

```json
"sources": [
  { "kind": "dataset", "name": "acme-specs", "version": 1, "hash": "e836f6673509..." },
  { "kind": "prompt", "name": "acme-sales", "version": 1, "hash": "de4d2b6ffa13..." }
]
```

Hashes are shortened here; the record keeps all 64 characters.

## Not built yet

* Handing a prompt version to an adapter: today `--prompt` records the version; each adapter reads its prompt the way its page says.
* Pushing a version to a shared remote registry: versions live in one store file, and a campaign bundle (`exportCampaign`) carries the campaign with its `sources`, not the files.
