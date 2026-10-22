# Variables and datasets

This part shows how values get into a test, and how one table of rows becomes many tests. A **variable** is a value that changes from one test to the next, such as an order number. A **dataset** is a versioned set of test files that driftbench keeps in a store. Every command below is run by a test on GitHub, and every output is real. Nothing calls a model and nothing is paid for. The detail is in [the variable store](../variables.md) and [datasets and prompts](../datasets.md).

## Before you start

**Why you do this.** The examples need a tiny agent to talk to. This step makes a folder and a stand-in agent, a script that looks an order up, so you need no key.

**You need.**

- Node 22 or newer, and driftbench installed, as in the [guide index](index.md#install). In a clone of this repository, write `pnpm driftbench` where this page says `driftbench`.
- A folder for your files, with a folder `intro` for a first spec. Make it inside your clone of this repository, so that `../examples` is the examples folder of the clone.

**Relevant commands.**

- `mkdir -p evals/intro`: makes the folder `evals` and, inside it, the folder `intro` · `-p` makes every missing folder on the way · it produces both folders.
- `cd evals`: goes into the folder · no options · every later command runs from there.

```console
$ mkdir -p evals/intro
$ cd evals
```

The stand-in agent is the file `agent.mjs`. It looks an order number up in `orders.json` in its working folder. Without an order number it repeats the message.

```js
// file: agent.mjs
// A stand-in for your agent: reads the user message on stdin, prints one reply.
import { existsSync, readFileSync } from 'node:fs';

const message = readFileSync(0, 'utf8').trim();
const orders = existsSync('orders.json') ? JSON.parse(readFileSync('orders.json', 'utf8')) : {};
const order = message.match(/\bA-\d+\b/)?.[0];

if (order && orders[order]) {
  console.log(`Order ${order} is ${orders[order].status}.`);
} else if (order) {
  console.log(`I cannot find order ${order}.`);
} else {
  console.log(`You wrote: ${message}`);
}
```

## 1. How values enter a spec

**Why you do this.** Before you build a table of tests, you should know the doors a value can use. Some doors exist and some do not. This step tests both.

**You need.** Nothing new. The table lists the doors.

| Door | What it does | Example |
|---|---|---|
| The message | The text of `user` goes to the agent as written. | `user: Where is order A-1042?` |
| `given.world.workspace.files` | Seeds files in the agent working folder before the block. | `orders.json` holds order A-1042. |
| `given.ledger` | Facts the agent must hold, which the checks read. | `customer: new` |
| `given.vars` | Runtime variables, such as the clock or the channel, that an adapter hands to the agent. | `channel: chat` |
| A table import | Turns each row of a CSV file or a spreadsheet into a spec. | Step 2. |

driftbench has no `{{name}}` placeholder inside a spec. The spec below proves it. Block 1 sends `{{name}}` and the agent must receive those characters unchanged. Block 2 reads a value seeded in a file.

```yaml
# file: intro/literal.yaml
id: literal-braces
title: Braces reach the agent as written, and a seeded file reaches it as a file
target: { adapter: process, agent: my-agent }
given:
  vars: { name: Sam }
  world:
    workspace:
      files: { orders.json: '{"A-1042": {"status": "paid"}}' }
blocks:
  - user: 'Hello {{name}}'
    expect:
      must: ['\{\{name\}\}']

  - user: Where is order A-1042?
    expect:
      must: ['Order A-1042 is paid']
```

- `vars` sets `name: Sam`. The process adapter keeps the variables in the run record and in the hash of the block. It does not hand them to your command. The function adapter does: its agent function receives them as the third argument.
- `files` writes `orders.json` into the working folder of the agent. This is how a value reaches a command.

**Relevant commands.**

- `driftbench campaign run`: runs every block of every spec on the agent and checks each reply · `intro/literal.yaml` is the spec to run. `--process-command` is the command that starts your agent, as a list of words in JSON. The list holds `node` and the full path of `agent.mjs`. `$PWD` stands for the current folder · it prints one line per run and a count, and exits 1 when a run fails.

**You type.**

```console
$ driftbench campaign run intro/literal.yaml --process-command "[\"node\",\"$PWD/agent.mjs\"]"
✓ literal-braces · process:my-agent · F · repeat 0  pass  2 blocks
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
```

**How to read it.** `pass  2 blocks` means the agent received `{{name}}` as plain text and found order A-1042 through the seeded file. A value in a spec is the text you write. To make the text differ from test to test, write a table and import it.

**If it goes wrong.**

- Block 2 fails with `must.0`: the file `orders.json` is not where the agent reads it. The `files` map writes in the agent working folder, so read from the current folder in your own agent.
- `campaign run` cannot start your agent: the path in `--process-command` is wrong. Run `node agent.mjs` by hand with a message on standard input to see the error.

## 2. One table of rows becomes many specs

**Why you do this.** Ten orders mean ten near-identical tests. You write one table of rows and one mapping instead. driftbench turns each row into a spec.

**You need.** A table `orders.csv` with a header row and one row per order, and a mapping `mapping.yaml` that says which column fills which field.

```csv
# file: orders.csv
order,status,expected
A-1042,paid,A-1042|paid
A-2001,shipped,A-2001|shipped
A-3003,refunded,A-3003|refunded
```

```yaml
# file: mapping.yaml
spec:
  id: "order-{order}"
  title: "Where is order {order}?"
  target: { adapter: process, agent: my-agent }
  given:
    world:
      workspace:
        files: { orders.json: '{{"{order}": {{"status": "{status}"}}' }
block:
  user: "Where is order {order}?"
  expect:
    must: { $column: expected, $split: "|" }
```

- `{order}` takes the cell of the column `order`. `{row}` is the number of the source row.
- Two opening braces in a row write one opening brace. That is how the JSON of `orders.json` is written in the template.
- `$column` reads one column with options. `$split: "|"` turns the cell into a list. `$list: true` makes a list of the whole cell. `$as` converts to `text`, `number`, `boolean` or `json`.
- `group_by` (not used here) names a column: rows that share its value become the blocks of one spec. Without it, each row is one spec with one block.
- `sheet` picks the sheet of a workbook, and `header_row` says which row names the columns.

**Relevant commands.**

- `driftbench import csv`: turns the rows of a table into spec files · `orders.csv` is the table. `--mapping mapping.yaml` says which column fills which field. `--out specs` is the folder that receives one `<id>.yaml` per spec · it prints one line per spec and a count, and exits 0 when every spec is written.
- `driftbench spec validate`: checks that every spec file in a folder is well formed · `specs` is the folder · it prints one line per spec and a count.
- `driftbench campaign run`: as in step 1 · `specs` is the folder; the same `--process-command` starts the agent · it prints one line per run and a count.

**You type.**

```console
$ driftbench import csv orders.csv --mapping mapping.yaml --out specs
✓ specs/order-A-1042.yaml  order-A-1042 · 1 block · row 2
✓ specs/order-A-2001.yaml  order-A-2001 · 1 block · row 3
✓ specs/order-A-3003.yaml  order-A-3003 · 1 block · row 4
Imported 3 specs from 3 rows of orders.csv into specs.
$ driftbench spec validate specs
Checked 3 specs: 3 valid, 0 invalid, 0 warnings.
$ driftbench campaign run specs --process-command "[\"node\",\"$PWD/agent.mjs\"]"
✓ order-A-1042 · process:my-agent · F · repeat 0  pass  1 block
✓ order-A-2001 · process:my-agent · F · repeat 0  pass  1 block
✓ order-A-3003 · process:my-agent · F · repeat 0  pass  1 block
3 cells: 3 pass, 0 fail, 0 failed. Spent $0.00.
```

**How to read it.**

- `rows 2` and so on in the import lines are the source rows. Row 1 is the header.
- Every written spec starts with a comment that names its file and rows, such as `# Imported from orders.csv, rows 2.`
- `3 cells: 3 pass` means each order spec ran once and passed. The table is the dataset of the tests; the specs are generated from it.
- Add a row to the table and import again with `--force` to add a test.

**If it goes wrong.**

- `the mapping names column "nope", which orders.csv does not have; its columns are order, status, expected` (exit 2): the mapping uses a column the table lacks. Use a name from the header row.
- `import csv reads a .csv or .tsv file; ... is not one.` (exit 2): the file is a workbook. Use `import xlsx` for a `.xlsx` file.
- `✗ row 2: spec ...` (exit 1) and nothing is written: the mapping makes an invalid spec. Fix the mapping or the cell. Every spec is checked before anything is written.
- A spec file that exists with other content stops the import (exit 2). Add `--force` to overwrite it.

The two wrong values, run on purpose:

```yaml
# file: broken/missing-column.yaml
spec:
  id: "order-{nope}"
block:
  user: "Where is order {order}?"
```

```console
$ driftbench import csv orders.csv --mapping broken/missing-column.yaml --out broken/out   # exit 2
ZZZ
$ driftbench import csv ../examples/acme/import/cases.xlsx --mapping ../examples/acme/import/mapping.yaml --out broken/out   # exit 2
import csv reads a .csv or .tsv file; ../examples/acme/import/cases.xlsx is not one.
```

## 3. What each loader accepts

**Why you do this.** Each way of bringing values in reads one kind of file. Knowing what it accepts saves a failed import.

**You need.** Nothing new. The table lists the loaders.

| Loader | It reads | Typed values | Note |
|---|---|---|---|
| `import csv` | A `.csv` or `.tsv` file. | Every field is text. | Use `$as: number` to convert. |
| `import xlsx` | One sheet of a `.xlsx` workbook. | Numbers and booleans stay typed. A formula gives its cached result. | `sheet` picks the sheet. |
| `import traces` | OpenTelemetry spans, Nexus traces or a Claude Code session. | Not applicable. | Writes drafts with no `expect`; a person writes it. |
| `dataset push` | A folder of spec files. | Not applicable. | Refuses the push when a spec is invalid. |
| Variable store | A YAML or JSON file, `variables.yaml`. | Weights are numbers. | Step 5. |

The Acme example ships a workbook and a mapping. The same rows give the same specs from CSV and from the workbook.

**Relevant commands.**

- `driftbench import xlsx`: turns one sheet of a workbook into spec files · `../examples/acme/import/cases.xlsx` is the workbook. `--mapping` is the mapping, which names the sheet `Cases`. `--out` is the folder that receives the specs · it prints one line per spec and a count.

**You type.**

```console
$ driftbench import xlsx ../examples/acme/import/cases.xlsx --mapping ../examples/acme/import/mapping.yaml --out acme-specs
✓ acme-specs/acme-imported-upgrade.yaml  acme-imported-upgrade · 2 blocks · rows 2, 3
✓ acme-specs/acme-imported-porting.yaml  acme-imported-porting · 1 block · row 4
Imported 2 specs from 3 rows of cases.xlsx into acme-specs.
```

**How to read it.** Rows 2 and 3 share a `conversation` value, so the mapping groups them into one spec of two blocks. Row 4 is a spec of its own.

**If it goes wrong.**

- `has no sheet "<name>"; its sheets are ...` (exit 2): the mapping names a sheet the workbook lacks. Fix `sheet`.

## 4. Keep the specs as a versioned dataset

**Why you do this.** You change the table, import again, and later wonder which tests produced which result. A dataset keeps each version of a folder of specs, so a campaign can name the exact version it ran.

**You need.** The folder `specs` from step 2, and a store file. Add a fourth order to the table first.

```csv
# file: orders.csv
order,status,expected
A-1042,paid,A-1042|paid
A-2001,shipped,A-2001|shipped
A-3003,refunded,A-3003|refunded
A-4004,paid,A-4004|paid
```

**Relevant commands.**

- `driftbench dataset push`: stores a folder of specs as the next version of a named dataset · `order-specs` is the dataset name. `specs` is the folder. `--store runs.db` is the store file, made when missing · it prints the version, a hash and the number of files.
- `driftbench dataset diff`: shows what changed between a version and the one before it · `order-specs@2` is the version · it prints one line per file, marked `A` added, `D` removed or `M` changed, and exits 1 when they differ.
- `driftbench dataset restore`: writes a version back to a folder, byte for byte · `order-specs@1` is the version. `--out restored` is the folder · it prints how many files it wrote.
- `driftbench import csv`: as in step 2 · `--force` overwrites spec files that exist.

**You type.**

```console
$ driftbench dataset push order-specs specs --store runs.db --note 'three orders'
Pushed dataset order-specs@1 (hash 0b20174121e0): 3 files from specs.
$ driftbench import csv orders.csv --mapping mapping.yaml --out specs --force
Imported 4 specs from 4 rows of orders.csv into specs.
$ driftbench dataset push order-specs specs --store runs.db --note 'four orders'
Pushed dataset order-specs@2 (hash cc0c5a9e18b8): 4 files from specs.
$ driftbench dataset diff order-specs@2 --store runs.db   # exit 1
ZZZ
$ driftbench dataset restore order-specs@1 --store runs.db --out restored
ZZZ
$ driftbench dataset list order-specs --store runs.db
ZZZ
```

**How to read it.**

- `order-specs@1` is the name and the version number. A version never changes. Pushing the same content again gives back the same version.
- The hash is a code of the file list. The same files always give the same hash.
- `dataset list --store runs.db` prints every version with its time and note. The time changes on every run, so this page does not show it.
- `restore` stops when a file already exists with other bytes. Add `--force` to write over it.

**If it goes wrong.**

- `Dataset ... not found` style errors exit 2: the name or version is not in the store. Run `dataset list` to see what the store holds.
- A push refuses an invalid spec (exit 1). Run `spec validate` on the folder first.

## 5. Run a campaign on a dataset and read what it records

**Why you do this.** A campaign that names its dataset can be reproduced. The campaign record keeps the name, the version and the hash of everything it ran.

**You need.** The dataset `order-specs` in `runs.db`, with two versions.

**Relevant commands.**

- `driftbench campaign run`: as in step 1 · `--dataset order-specs` runs the specs of the latest version of the dataset, restored byte for byte. `--campaign c-orders` is the id of the campaign. `--store runs.db` keeps it. `--process-command` starts the agent · it prints one line per run and a count.
- `driftbench campaign status`: shows a kept campaign again, and calls no agent · `c-orders` is the campaign · `--store runs.db` is the store to read · it prints one line per cell, and exits 0 when every cell passes.
- `driftbench campaign export`: writes a campaign and everything it ran to a folder, to carry to another store · `c-orders` is the campaign. `--store` is the store. `--out bundles` is the folder · it writes `bundles/c-orders` with the runs, the specs and the dataset files.

**You type.**

```console
$ driftbench campaign run --dataset order-specs --campaign c-orders --store runs.db --process-command "[\"node\",\"$PWD/agent.mjs\"]"
✓ order-A-1042 · process:my-agent · F · repeat 0  pass  1 block
✓ order-A-2001 · process:my-agent · F · repeat 0  pass  1 block
✓ order-A-3003 · process:my-agent · F · repeat 0  pass  1 block
✓ order-A-4004 · process:my-agent · F · repeat 0  pass  1 block
4 cells: 4 pass, 0 fail, 0 failed. Spent $0.00.
$ driftbench campaign status c-orders --store runs.db
ZZZ
$ driftbench campaign export c-orders --store runs.db --out bundles
ZZZ
$ grep -A6 '"sources"' bundles/c-orders/campaign.json
ZZZ
```

**How to read it.**

- Four cells ran, one for each row of the table. Each cell is one spec run once.
- The `sources` entry of the campaign names the dataset, its version and its hash. A reader a year later knows which tests produced the runs.
- `campaign status` prints the stored result again. It also prints a line with the time the campaign was created, which this page does not show.
- Import the bundle on another machine with `driftbench campaign import` and run the same dataset again there.

**If it goes wrong.**

- `Campaign c-orders already exists. Resume it with: driftbench campaign resume c-orders`: the store holds a campaign with this id. Pick another id.
- `--dataset needs --store`: a dataset lives in a store. Add `--store runs.db`.

## 6. Plan the rows from a variable store

**Why you do this.** A table of rows needs the right rows. Too few and a case is missed. Too many and you pay for repeats. A **variable store** lists the things a situation varies on, and a planner chooses rows that cover every pair of values.

**You need.** A file `variables.yaml` with two variables, and a short script that loads it and plans six rows. The store is a YAML or JSON file with `format`, `agent`, `version` and a list of `variables`. Each variable has `values`, and a value may carry a `weight`, the share of users it stands for.

```yaml
# file: variables.yaml
format: 1
agent: northwind-orders
version: '1'
variables:
  - id: channel
    title: The channel a customer writes on
    kind: channel
    role: axis
    approved: true
    values:
      - { id: web_chat, title: On the web chat, weight: 0.7 }
      - { id: email, title: By email, weight: 0.3 }
  - id: order_state
    title: What the order system says about the order
    kind: data
    role: axis
    approved: true
    values:
      - { id: paid, title: The order is paid }
      - { id: shipped, title: The order is shipped }
      - { id: refunded, title: The order is refunded }
```

```yaml
# file: broken-variables.yaml
format: 1
agent: northwind-orders
version: '1'
variables:
  - id: order_state
    title: What the order system says about the order
    kind: data
    role: axis
    approved: true
    values:
      - { id: paid, title: The order is paid, weight: 1 }
      - { id: shipped, title: The order is shipped }
```

```ts
// file: plan.ts
import { planV2 } from '@agent-nexus/driftbench-generate';
import { loadVariableStore } from '@agent-nexus/driftbench-space';

async function main(): Promise<void> {
  for (const file of ['variables.yaml', 'broken-variables.yaml']) {
    const loaded = await loadVariableStore(file);
    if (!loaded.ok) {
      for (const issue of loaded.errors) console.log(`${file}: ${issue.code} ${issue.path}`);
      continue;
    }
    console.log(`${file}: ${loaded.store.variables.length} variables`);
    const plan = planV2(loaded.store, { seed: 1, budget: 6 });
    for (const row of plan.rows) console.log(`${row.id} ${JSON.stringify(row.values)}`);
  }
}

main();
```

- `kind` says how a spec is placed on the variable: `stage`, `behaviour`, `deviation`, `persona`, `channel`, `data` or `task`.
- `role: axis` means the variable is crossed with the other axes. A `detail` stays out of the cross and is varied inside a cell.
- `approved: true` says a person approved the variable. The planner uses only what a person approved.
- A weight is relative. Give a weight to every value of a variable or to none.

**Relevant commands.**

- `npx tsx plan.ts`: runs the script · `plan.ts` is the script above · it prints one line per file and the planned rows. The guide test runs it with the driftbench packages of this clone standing in for the ones you install.

**You type.**

```console
$ npx tsx plan.ts
variables.yaml: 2 variables
ZZZ
broken-variables.yaml: VARIABLES_WEIGHT_INCOMPLETE variables.0.values.1.weight
```

**How to read it.**

- Each planned row gives one value to every approved variable. Six rows cover every pair of values of the two variables.
- The broken store names its problem by code and by path: a variable that weighs some of its values and not all. Fix it by weighing every value or none.
- No command reads a variable store yet. You copy the rows into a table, then import the table as in step 2.

**If it goes wrong.**

- `VARIABLES_PARSE`: the file is not valid YAML or JSON. Check the indentation.
- `SCHEMA_` codes: a field is missing or has the wrong form. The path names it.
- Every code is in the [variable store page](../variables.md#loading-checking-and-converting).

## Where to go next

- Every field of a spec: [Spec fields](spec-fields.md).
- The detail of imports, the registry and exports: [datasets and prompts](../datasets.md).
- How to read the campaign you get: step 6 of the [quickstart](quickstart.md) and the [read the numbers](read-the-numbers.md) part.
