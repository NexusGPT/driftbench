---
title: Build the tests of an estate in one command
summary: Run scan, approve, map, plan, approve and generate on an estate in one folder, with a question before each approval.
commands:
  - estate build
see_also:
  - validate-estate-scan
  - validate-estate-plan
  - validate-estate-generate
  - validate-estate-loop
next:
  - validate-estate-generate
---

## What it is

`estate build <root>` runs the chain that turns an estate into generated tests, in one folder, with no
model call when it replays recorded answers. The stages, in order:

1. `estate scan`: read the estate into a map of atoms (`map.yaml`).
2. Approve the atoms a model split from the prose (`approved.yaml`). This is the first question.
3. `estate map` and `estate plan`: write the situation axes (`space.yaml`) and the test plan (`plan.yaml`).
4. Approve the plan rows. This is the second question.
5. `estate generate`: write the tests into `generated/`.

Each stage calls the same code as its own command, so the files equal what the single commands write.

## When to use it

* To get from an estate to tests with one command, then `estate run` a test.
* To refresh the tests after the estate changed: a second run skips every stage whose inputs did not change,
  and runs the others again.

## Commands and every option

```
driftbench estate build <root> [--out <dir>] [--yes] [--verbose] [--runtime <name>] [--replay <file>] [--no-model] [--provider <name>] [--ignore <glob>]... [--user-skills <folder>] [--pointer] [--labels <file>] [--cassette <file>] [--record] [--labeler <spec>]... [--jobs <n>] [--phrases <file>] [--sessions <file>] [--t <n>]
```

| Option | Default | Meaning |
|---|---|---|
| `<root>` | required | the estate folder |
| `--out <dir>` | `driftbench-build` | the folder every file is written into |
| `--yes` | off | answer yes to both approvals |
| `--verbose` | off | print the full output of every command |
| `--runtime <name>` | `claude-code` | the runtime that reads the estate |
| `--replay <file>` | none | replay recorded answers instead of calling a model |
| `--no-model` | off | read the structured atoms only; no prose atom |
| `--provider <name>` | the first whose key is set | `anthropic` or `openai` |
| `--ignore <glob>` | none | skip the paths this glob matches; repeat it |
| `--user-skills <folder>` | none | also read the user-level skill layer from this folder, such as `~/.claude/skills`; none is read without it; a project skill wins a name clash. A change in the folder makes the scan run again |
| `--pointer` | off | read the prose with the pointer reader and keep `ledger.json` in the folder |
| `--labels <file>` | the shipped set | with `--pointer`: the label sets |
| `--cassette <file>` | none | with `--pointer`: the recorded labeler answers |
| `--record` | off | with `--pointer`: call the labelers on a cassette miss and record the answer |
| `--labeler <spec>` | the default stack | with `--pointer`: `<class>:<client>[:<model>]`; repeat it |
| `--jobs <n>` | `4` | with `--pointer`: requests in flight at once |
| `--phrases <file>` | none | the approved phrase bank for `estate generate` |
| `--sessions <file>` | none | the index of recorded sessions for `estate generate` |
| `--t <n>` | `2` | the strength of the covering array of the plan |

## Inputs

The estate folder, and optionally a replay file, a cassette, a phrase bank and a session index.

## Outputs and how to read them

The folder holds `map.yaml`, `approved.yaml`, `space.yaml`, `plan.yaml`, `plan.summary.json`,
`generated/` and `build.json`, which records what each stage read. With `--pointer` it also holds
`ledger.json`. The command prints one line per stage. Exit codes:

* 0: every stage ran and every generated test is complete.
* 1: an approval was declined, or cannot be asked, or the suite holds incomplete tests (as `estate generate`).
* 2: a usage or input error, such as a folder that is not there.

On a terminal, each approval is a question with the count: `Approve all 49? [y/N]`. Outside a terminal
without `--yes`, the command stops at the first approval, prints the next command, and approves nothing.

## Worked example

On the Northwind estate, with its recorded answers and no model call. `--yes` answers both approvals. It
exits 1 because some tests still wait for an ask or a check. The second run skips every stage:

```sh
driftbench estate build examples/estates/fixture --out built --replay examples/estates/fixture/answers.yaml --yes # exit 1
driftbench estate build examples/estates/fixture --out built --replay examples/estates/fixture/answers.yaml --yes # exit 1
driftbench estate build examples/estates/fixture --out stopped --replay examples/estates/fixture/answers.yaml # exit 1
```

The stage lines of the second run. The third run stops at the first approval with a line that says how many atoms wait, and approves nothing:

```text
1. Read the estate: unchanged since the last run, map.yaml kept.
2. Approve the atoms: done before, approved.yaml kept.
3. Map and plan: unchanged, space.yaml and plan.yaml kept.
4. Approve the plan: every test was approved before.
5. Write the tests: unchanged, generated/ kept.
```

## Common errors

| Message | Cause | Fix |
|---|---|---|
| `Stopped before the first approval: ...` (exit 1) | the atoms wait and no terminal can be asked | run again with `--yes`, or `estate approve <folder>/map.yaml --kind <kind>` and run again |
| `Stopped before the second approval: ...` (exit 1) | the plan rows wait and no terminal can be asked | run again with `--yes`, or `estate plan approve <folder>/plan.yaml --all` |
| `Cannot find <root>.` (exit 2) | the estate folder is not there | name an existing folder |
