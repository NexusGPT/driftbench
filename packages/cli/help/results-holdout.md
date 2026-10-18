---
title: "The sealed holdout"
summary: "Seal a share of the gated specs away from development, then score an agent on them once per query against a fixed budget."
commands:
  - holdout seal
  - holdout score
see_also:
  - results-select
  - results-statistics
next:
  - results-view
---

## What it is

A holdout is a set of specs no one tunes the agent on. A suite that is run, read and fixed against over and
over overfits: its pass rate stops predicting the next conversation. The sealed holdout keeps a share of
the gated specs out of sight:

* `holdout seal` writes a sealed bundle (`sealed.json`) of a share of the gated specs. When the gate
  already sealed a split (`holdout/seal.json` beside its specs), that split is taken as it is.
* `holdout score` runs every sealed spec once through the runner, in free-running mode, and prints only the
  pass rate with its 95% Wilson interval, never which spec passed.
* Each score spends one query of a budget fixed by the first score (`budget.json` beside the bundle). A
  spent budget refuses to score. A scored seal is never sealed again.
* `driftbench select` never counts a sealed spec.

## When to use it

Before a release, to measure the agent on conversations no one fixed it against. Keep the budget small:
each score leaks a little about the holdout.

## Commands and every option

```
driftbench holdout seal --specs <dir> --out <dir> [--share <share>] [--seed <n>] [--force]
driftbench holdout score --sealed <dir> --target <adapter:agent> [--budget <queries>] [--json]
```

`holdout seal`:

| Option | Default | Meaning |
|---|---|---|
| `--specs <dir>` | required | the gated specs: the gate's output folder, the one that holds `specs/` and `holdout/`, or a folder of specs |
| `--out <dir>` | required | the folder to write the sealed bundle into |
| `--share <share>` | `0.2` | the share of specs to seal when the gate sealed none |
| `--seed <n>` | `1` | the seed of the draw when the gate sealed none |
| `--force` | off | replace a seal that has never been scored |

`holdout score`:

| Option | Default | Meaning |
|---|---|---|
| `--sealed <dir>` | required | the folder `holdout seal` wrote |
| `--target <adapter:agent>` | required | the agent to score, such as `function:acme-sales` |
| `--budget <queries>` | required on the first score | the query budget, fixed by the first score; a later score may restate the same number |
| `--json` | off | print one JSON document |

Global: `--plugin <module>`, which also lets a plugin adapter be scored.

Exit codes. Seal: 0 when written, 2 on bad input. Score: 0 when scored, 1 when the budget is spent, 2 on
bad input.

## Inputs

The gate's output folder, such as `examples/acme/gated`. Its `specs/` subfolder alone does not hold the
sealed files, and `holdout seal` refuses it and names the folder to pass.

## Outputs and how to read them

`seal` prints how many specs it sealed and from where, a table of the sealed specs (id, content hash, the
file it was read from) and `Wrote <dir>/sealed.json.` The sealed bundle pins each spec by hash: a sealed
file edited later is refused at score time.

`score` prints the query number and the budget, then one row: `conversations` run, `passed`, `pass rate`
and the `95% Wilson interval`. Specs the target cannot run (a task spec naming `process:acme-ops` scored
on `function:acme-sales`) are listed as not run and not counted. The last line gives the budget left.

`score --json` holds `sealed`, `target`, `query`, `budget` (`total`, `used`, `left`), `conversations`,
`passed`, `not_run` and `rate` (`estimate`, `lower`, `upper`).

## Worked example

```sh
driftbench holdout seal --specs examples/acme/gated/specs --out sealed # exit 2
driftbench holdout seal --specs examples/acme/gated --out sealed
driftbench holdout score --sealed sealed --target function:acme-sales # exit 2
driftbench holdout score --sealed sealed --target function:acme-sales --budget 2
driftbench holdout score --sealed sealed --target function:acme-sales --json
driftbench holdout score --sealed sealed --target function:acme-sales # exit 1
driftbench holdout seal --specs examples/acme/gated --out sealed --force # exit 2
```

The `specs/` subfolder is refused:

```text
$ driftbench holdout seal --specs examples/acme/gated/specs --out sealed
--specs examples/acme/gated/specs is the specs folder inside a gate output. The specs the gate sealed are beside it, in examples/acme/gated/holdout. Pass the gate's output folder: --specs examples/acme/gated
(exit 2)
```

The gate's own split, taken as it is (58 of the 258 gated specs; the table is shown up to its eighth row):

```text
$ driftbench holdout seal --specs examples/acme/gated --out sealed
Sealed 58 of 258 gated specs: the gate's split (seed 1, share 0.2) from control-handwritten/holdout/seal.json, holdout/seal.json.

  #   spec                                 hash          read from
  1   acme-off-topic-return                a531a8b6fd91  control-handwritten/holdout/conversations/off-topic-return.yaml
  2   acme-price-sheet                     9359c6a8382e  control-handwritten/holdout/tasks/price-sheet.yaml
  3   gen-boundary-071                     49ac44e9c209  holdout/boundary/gen-boundary-071.yaml
  4   gen-cover-009                        ae185cbcce9f  holdout/cover/gen-cover-009.yaml
  5   gen-cover-010                        16c635af7b13  holdout/cover/gen-cover-010.yaml
  6   gen-deviation-002                    82969f5ecfdb  holdout/deviation/gen-deviation-002.yaml
  7   gen-deviation-003                    a5293fce1bec  holdout/deviation/gen-deviation-003.yaml
  8   gen-deviation-008                    e5cf23495fc4  holdout/deviation/gen-deviation-008.yaml
```

A first score needs a budget:

```text
$ driftbench holdout score --sealed sealed --target function:acme-sales
This holdout has never been scored: pass --budget <queries> to fix its query budget.
(exit 2)
```

The first query:

```text
$ driftbench holdout score --sealed sealed --target function:acme-sales --budget 2
Holdout score, query 1 of 2, on function:acme-sales: 58 sealed conversations, each run once.

  conversations  passed  pass rate  95% Wilson interval
  47             47      100.0%     92.4% to 100.0%

Not run, not counted: acme-price-sheet (names process:acme-ops), acme-price-sheet-i01-base (names process:acme-ops), acme-price-sheet-i01-unit-change (names process:acme-ops), acme-price-sheet-i03-empty-cell (names process:acme-ops), acme-price-sheet-i03-unit-change (names process:acme-ops), acme-price-sheet-i04-header-order (names process:acme-ops), acme-price-sheet-i04-planted (names process:acme-ops), acme-price-sheet-i06-unit-change (names process:acme-ops), acme-price-sheet-i07-duplicate-line (names process:acme-ops), acme-price-sheet-i07-empty-cell (names process:acme-ops), acme-price-sheet-i07-unit-change (names process:acme-ops).
Budget: 1 of 2 queries used, 1 left. Which conversation passed is not shown: the holdout stays sealed.
```

The second query, in JSON:

```text
$ driftbench holdout score --sealed sealed --target function:acme-sales --json
{
  "sealed": "sealed",
  "target": "function:acme-sales",
  "query": 2,
  "budget": {
    "total": 2,
    "used": 2,
    "left": 0
  },
  "conversations": 47,
  "passed": 47,
  "not_run": [
    "acme-price-sheet (names process:acme-ops)",
    "acme-price-sheet-i01-base (names process:acme-ops)",
    "acme-price-sheet-i01-unit-change (names process:acme-ops)",
    "acme-price-sheet-i03-empty-cell (names process:acme-ops)",
    "acme-price-sheet-i03-unit-change (names process:acme-ops)",
    "acme-price-sheet-i04-header-order (names process:acme-ops)",
    "acme-price-sheet-i04-planted (names process:acme-ops)",
    "acme-price-sheet-i06-unit-change (names process:acme-ops)",
    "acme-price-sheet-i07-duplicate-line (names process:acme-ops)",
    "acme-price-sheet-i07-empty-cell (names process:acme-ops)",
    "acme-price-sheet-i07-unit-change (names process:acme-ops)"
  ],
  "rate": {
    "estimate": 1,
    "lower": 0.9244423958360037,
    "upper": 1
  }
}
```

The budget is spent, and a scored seal cannot be replaced:

```text
$ driftbench holdout score --sealed sealed --target function:acme-sales
The query budget is spent: 2 of 2 queries used. The holdout is not scored again.
(exit 1)
$ driftbench holdout seal --specs examples/acme/gated --out sealed --force
sealed/budget.json shows this seal has been scored: a scored holdout is never sealed again.
(exit 2)
```

## Common errors

| Message | Cause and fix |
|---|---|
| `--specs <dir> is the specs folder inside a gate output.` (exit 2) | pass the gate's output folder, as the message names it |
| `This holdout has never been scored: pass --budget <queries> to fix its query budget.` (exit 2) | the first score fixes the budget |
| `The budget was fixed at <n> queries by the first score; it cannot become <m>.` (exit 2) | restate the same number, or leave `--budget` out |
| `The query budget is spent: <n> of <n> queries used. The holdout is not scored again.` (exit 1) | by design. Seal a new holdout from new gated specs |
| `<dir>/budget.json shows this seal has been scored: a scored holdout is never sealed again.` (exit 2) | by design |
| `The sealed bundle was changed: it is not scored.` (exit 2) | a sealed spec or the bundle was edited |
| `--target takes adapter:agent, such as function:acme-sales` (exit 2) | fix the target |
| specs listed as `Not run, not counted` | the target cannot run them; score the task specs on their own target |
