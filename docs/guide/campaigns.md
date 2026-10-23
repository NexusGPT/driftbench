# Campaigns

This is a hands-on guide to campaigns, the commands that run your tests on your agent and keep the results. It plans a campaign and runs it. Then it reads the campaign again, repeats it, caps its spend and resumes it after an interruption. The last step sets a rule over all its runs. It uses the Acme Telecom sample agent, so nothing calls a model and nothing is paid for. Every command below is run by a test on GitHub, and every excerpt is real output. The full option list is in the [campaign configuration reference](../reference/campaign.md) and the [CLI reference](../reference/cli.md).

## Before you start

**Why you do this.** One run of one test proves little. A **campaign** runs many tests, many times, on one agent, and keeps every result so you can read it later.

**You need.**

- Node 22.13 or newer, and driftbench installed from a clone, as the [guide index](index.md#install) shows. That gives you the command `driftbench`. Run this page from the root of the clone.
- The folder `examples/acme` of the repository. Its seven **specs** (test files) are the tests. Acme is a made-up phone company.
- A **target**, the way driftbench reaches your agent. The Acme sales assistant is a small program, and its target is `function:acme-sales`.

This is the start of one spec, `examples/acme/specs/conversations/tool-failure.yaml`:

```yaml
id: acme-tool-failure
title: The coverage service is down, and the assistant falls back to a sales callback
target: { adapter: function, agent: acme-sales }
blocks:
  - user: Hi, I want home internet at 7 Quarry Lane, Acmeville.
```

**Five words first.**

- A **block** is one exchange: what the user says and what the agent must answer.
- A **cell** is one spec, run once, on one target, in one mode. A campaign is a set of cells.
- A **mode** says how the agent runs. `T` feeds the agent the recorded history. `F` lets it carry its own earlier replies. `P` injects a **perturbation**, a planned disturbance such as a failing tool.
- A **repeat** is the same cell run again, to see how much the result varies.
- The **store** is one file, a SQLite database, that keeps campaigns and their runs.

**Which command runs my tests?** Two commands run tests, for two kinds of test.

| You have | Run | Where it is shown |
|---|---|---|
| A spec file, run against a target you name: a function, a command, an HTTP endpoint | `campaign run` | The [quickstart](quickstart.md), and this page |
| A test generated from the folder of a coding agent, run in a throw-away copy of that folder | `estate run` | The [walkthrough](walkthrough.md), step 3 |

Both keep runs in a store. This page covers `campaign run`.

## 1. Plan a campaign before you run it

**Why you do this.** A campaign can be large or cost money. The plan counts the runs first, and runs nothing.

**You need.** A folder of specs and a target. Here: `examples/acme/specs/conversations`, six specs, and `function:acme`.

**Relevant commands.**

- `driftbench campaign plan`: lists the cells a campaign would run, the projected cost, and how small a drop in pass rate the campaign could detect · `examples/acme/specs/conversations` is the folder of specs. `--target function:acme` is the agent every spec runs on. `--repeats 2` runs every spec twice · it prints one row per cell and a cost line, and one line for the smallest detectable drop per mode. It runs no agent.

**You type and you see.**

```console
$ driftbench campaign plan examples/acme/specs/conversations --target function:acme --repeats 2
Plan: 6 specs, 1 target, mode F, 2 repeats: 12 cells, 52 blocks.
  cell              spec                           target         mode  repeat  blocks
  4174f4a19290389c  acme-new-customer-coverage     function:acme  F     0       4
  ce26bf03629c9df4  acme-new-customer-coverage     function:acme  F     1       4
Projected cost: $0.00 (function: no unit measured).
Minimum detectable effect, mode F: 47.8 points on a 50% pass rate, with 12 runs per arm over 6 specs (rho 0, design effect 1.00; two-sided alpha 0.05, power 0.8).
```

**How to read it.**

- `12 cells` is six specs times two repeats. `52 blocks` is the number of exchanges the agent would answer.
- The 16 hex characters are the **cell id**. They stay the same in every campaign, so a cell can be found again.
- `Projected cost: $0.00` is right here. The price comes from costs measured earlier in a store, and a plain program has none.
- The last line is the **minimum detectable effect**: the smallest drop in pass rate that comparing two campaigns of this size could show. About 48 points is large, so six specs can only reveal a big change. Add specs to shrink it.

Repeats of one spec resemble each other. The option `--rho` is the correlation between them, from 0 to 1. With `--rho 0.5` the same plan has fewer independent runs and detects nothing:

```console
$ driftbench campaign plan examples/acme/specs/conversations --target function:acme --repeats 2 --rho 0.5
Minimum detectable effect, mode F: none detectable on a 50% pass rate, with 12 runs per arm over 6 specs (rho 0.5, design effect 1.50; two-sided alpha 0.05, power 0.8).
```

**If it goes wrong.**

- `--repeats takes a whole number of at least 1, not "0".` with exit 2: give 1 or more.
- `Unknown mode "X". The modes are T, F and P, alone or separated by commas.` with exit 2: use `T`, `F`, `P`, or a list such as `T,F`.
- `No spec files found.` with exit 2: the path holds no `*.yaml` file.

## 2. Run the campaign and keep the runs

**Why you do this.** This is the step that tests the agent. Naming the campaign and the store keeps the results.

**You need.** The specs of step 1.

**Relevant commands.**

- `driftbench campaign run`: sends each block of each spec to the agent, checks each answer, and records the run · `examples/acme/specs` is the folder of specs. Each Acme spec names its own target, so `--target` is left out. `--store acme.db` is the file that keeps the runs, and it is made when missing. `--campaign acme-first` is the name of the campaign · it prints one line per cell and a total, and writes `acme.db`. It exits 0 when every cell passes.

**You type and you see.**

```console
$ driftbench campaign run examples/acme/specs --store acme.db --campaign acme-first
✓ acme-new-customer-coverage · function:acme-sales · F · repeat 0  pass  4 blocks
✓ acme-price-sheet · process:acme-ops · F · repeat 0  pass  2 blocks
7 cells: 7 pass, 0 fail, 0 failed. Spent $0.00.
```

**How to read it.**

- A cell line shows a mark, the spec, the target, the mode, the repeat, the state and the number of blocks. `✓` is a pass, `✗` a fail, and `!` a cell that failed to finish or was stopped.
- `fail` means the agent answered wrongly. `failed` means the run itself broke, for example the agent could not be reached.
- The conversation specs run on the chat agent, and the price-sheet spec runs on `process:acme-ops`, a code agent. Each spec chose its own target.
- `Spent $0.00` counts the cost of the agent's calls. Acme costs nothing.
- Before the cell lines, driftbench may print a line that starts with `Not judged:`. Some criteria need a **judge**, a model that reads an answer. This campaign loads no judge, so those criteria give no verdict and count in no pass or fail. [Judge answers](judge-answers.md) adds one.

**If it goes wrong.**

- `Campaign acme-first already exists. Resume it with: driftbench campaign resume acme-first` with exit 2: the store holds that name. Pick another `--campaign`, or drop the option.
- `No adapter is set up for <target>.` with exit 2: the target is unknown. The message lists the targets this install reaches.
- A `✗` line with `block 0 must.0` or similar: the agent failed that check on that block. The part before the first dot names the check.

## 3. Read a stored campaign with status

**Why you do this.** A stored campaign can be read again without running anything. You see which cells passed, which failed, and which have not run.

**You need.** The store `acme.db` and the campaign `acme-first` of step 2.

**Relevant commands.**

- `driftbench campaign status`: prints the state of every cell of a stored campaign · `acme-first` is the campaign. Without it, the latest campaign of the store is read. `--store acme.db` is the store, which must exist · it prints a header, one line per cell and a total. It exits 0 when every cell passes and 1 otherwise, a pending cell included.

**You type and you see.**

```console
$ driftbench campaign status acme-first --store acme.db
✓ acme-number-porting · function:acme-sales · F · repeat 0  pass  5 blocks
7 cells: 7 pass, 0 fail, 0 failed. Spent $0.00.
```

**How to read it.**

- The first line, which this page leaves out, reads `Campaign acme-first, created` and the time you ran it.
- The cell lines are the same as in `campaign run`. A cell that has no stored run reads `pending`.
- `status --detail` adds three tables. The **compounding index** compares modes `T` and `F`. A positive number means the agent does worse when it carries its own replies. The other two tables show where the first failing block is and how the agent recovers from a perturbation.

**If it goes wrong.**

- `No store at acme.db: this command reads a store and does not make one.` with exit 2: check the `--store` path.
- `No campaign nope in acme.db.` with exit 2: the name is wrong. Leave it out to read the latest campaign.

## 4. Repeats, modes and cell ids

**Why you do this.** A model answers differently each time. Running a cell again, and in other modes, shows how steady the result is.

**You need.** One spec. Here: `plan-upgrade.yaml`, five blocks and three perturbations.

**Relevant commands.**

- `driftbench campaign run`: as in step 2 · `examples/acme/specs/conversations/plan-upgrade.yaml` is one spec. `--target function:acme` is the agent. `--mode T,F,P` runs the three modes. `--repeats 2` runs each cell twice. `--store modes.db` and `--campaign modes` keep the runs · it prints one line per cell.

**You type and you see.**

```console
$ driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme --mode T,F,P --repeats 2 --store modes.db --campaign modes
✓ acme-plan-upgrade · function:acme · T · repeat 0  pass  5 blocks
✓ acme-plan-upgrade · function:acme · F · repeat 1  pass  5 blocks
✓ acme-plan-upgrade · function:acme · P · repeat 0 · billing-aside  pass  6 blocks
✓ acme-plan-upgrade · function:acme · P · repeat 1 · order-service-down  pass  5 blocks
10 cells: 10 pass, 0 fail, 0 failed. Spent $0.00.
```

**How to read it.**

- `10 cells` is two cells for `T`, two for `F`, and six for `P`: three perturbations times two repeats.
- A `P` line ends with the name of the perturbation. `order-service-down` sends 5 blocks and `billing-aside` sends 6, because a perturbation that only changes the world adds no block.
- The **campaign id** is the name you gave with `--campaign`. Without it, driftbench makes an id that starts with `c-` and changes with every run, so name the campaigns you want to find again.
- A **cell id** is not the campaign id. It names a spec, a target, a mode and a repeat. It is also the id of that run in the store.
- To avoid typing flags every time, put them under the `campaign:` key of `driftbench.yaml`. A flag on the command line wins over the file. The keys are in the [campaign configuration reference](../reference/campaign.md).

**If it goes wrong.**

- `Unknown mode "X". The modes are T, F and P, alone or separated by commas.` with exit 2: use `T`, `F`, `P`, or a list such as `T,F,P`.
- A repeat that gives a different verdict from repeat 0 shows noise in the agent or the judge. Read [read the numbers](read-the-numbers.md) before you act on one run.

## 5. Cap the spend with a budget

**Why you do this.** A campaign on a paid model can cost real money. A budget stops new cells from starting once the campaign has spent that much.

**You need.** A campaign to run. A budget of 0 is the quickest way to see the stop.

**Relevant commands.**

- `driftbench campaign run`: as in step 2 · `--budget-usd 0` is a hard stop: no cell starts once the campaign has spent this many dollars. `--repeats 2` makes four cells. `--store halted.db` and `--campaign halted` keep the runs · it prints one line per cell, and it exits 1 when a budget stops a cell.
- `driftbench campaign status`: as in step 3 · without a campaign name it reads the latest one · it shows the stopped cells as `pending`.

**You type and you see.**

```console
$ driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml examples/acme/specs/conversations/tool-failure.yaml --target function:acme --repeats 2 --budget-usd 0 --store halted.db --campaign halted   # exit 1
! acme-plan-upgrade · function:acme · F · repeat 0  stopped  not started: the campaign spent $0.00 of its $0.00 budget
4 cells: 0 pass, 0 fail, 0 failed, 4 stopped by the budget. Spent $0.00.
$ driftbench campaign status --store halted.db   # exit 1
· acme-plan-upgrade · function:acme · F · repeat 0  pending
4 cells: 0 pass, 0 fail, 0 failed, 4 pending. Spent $0.00.
```

**How to read it.**

- `stopped` means the budget stopped the cell before it started. The cell has no stored run, so `status` calls it `pending`.
- A budget counts the agent's own cost. It does not count a simulated user or a judge. Each of those has its own cap, such as `--judge-budget`.
- A real campaign uses a real number, such as `--budget-usd 5`. Run `campaign plan --budget-usd 5` first: it says `Within the budget` or `Over the budget`.

**If it goes wrong.**

- `--budget-usd takes a number of at least 0, not "-1".` with exit 2: give 0 or more.
- A token price error that names a model: the agent reports tokens and no dollars, and no price table is found. Pass `--prices <file>` or keep a `prices:` key in `driftbench.yaml`.

## 6. Resume an interrupted campaign

**Why you do this.** A campaign can stop early. You press Ctrl-C, the machine restarts, a budget runs out, or a call fails. `campaign resume` runs only the cells that did not finish.

**You need.** A stored campaign with cells that have no completed run. The campaign `halted` of step 5 is one.

**Relevant commands.**

- `driftbench campaign resume`: runs the cells of a stored campaign that have no completed run, and reuses the others · the campaign name is left out, so the latest campaign of the store is used. `--store halted.db` is the store, which must exist · it prints one line per cell and a total, and files the new runs in the same campaign. It makes no new campaign.

**You type and you see.**

```console
$ driftbench campaign resume --store halted.db
✓ acme-plan-upgrade · function:acme · F · repeat 0  pass  5 blocks
4 cells: 4 pass, 0 fail, 0 failed. Spent $0.00.
$ driftbench campaign resume halted --store halted.db
✓ acme-plan-upgrade · function:acme · F · repeat 0  pass (reused)  5 blocks
4 cells: 4 pass, 0 fail, 0 failed, 4 reused. Spent $0.00.
```

**How to read it.**

- The first `resume` runs all four cells. Step 5 stored the budget as 0, and `resume` reads 0 as no budget.
- The second `resume` finds a finished run for every cell. It runs nothing, and marks each cell `reused`.
- Every run is filed in the store as it finishes, so Ctrl-C loses no finished run. A cell that was in flight has no run, and it runs again.
- A finished run is kept even when it failed. To measure again, start a new campaign with `campaign run`.
- `resume` takes no `--target`, `--mode` or `--repeats`. It uses the cells the campaign was created with.

**If it goes wrong.**

- `No adapter is set up for process:my-agent.` with exit 2: you ran the campaign with `--process-command`. The store keeps targets and not the commands behind them, so give the same `--process-command` to `resume`.
- `No campaign x in halted.db.` with exit 2: check the name with `campaign status`.

## 7. Retries: when a call to the agent fails

**Why you do this.** A web agent can fail for a moment, on a rate limit or a dropped connection. The tool retries such failures a few times before it gives up. The retry rules are on the [retries page](../retries.md).

**You need.** A target that fails. This spec points at an address where nothing listens, so every call fails:

```yaml
# file: down/down.yaml
id: acme-endpoint-down
title: The endpoint of the agent is down
target: { adapter: http, agent: acme-bot, options: { url: 'http://127.0.0.1:9/chat', timeout_ms: 2000 } }
blocks:
  - user: Hi, I want home internet at 7 Quarry Lane, Acmeville.
    expect:
      must: ['coverage']
```

**Relevant commands.**

- `driftbench campaign run`: as in step 2 · `down/down.yaml` is the spec above. `--retry-attempts 3` is the number of tries per call, the first included, and the default is 4. `--retry-base-ms 20` is the wait before the first retry, doubled for each later one, and the default is 500. `--retry-max-ms 100` is the longest wait between two tries, and the default is 30000 · it prints one line for the cell. It exits 1 here.

**You type and you see.**

```console
$ driftbench campaign run down/down.yaml --store down.db --campaign down --retry-attempts 3 --retry-base-ms 20 --retry-max-ms 100   # exit 1
! acme-endpoint-down · http:acme-bot · F · repeat 0  failed  send on block 0 failed after 3 attempts: AdapterTransportError: 127.0.0.1:9 transport failed: request or response transport failed; body length unknown
1 cell: 0 pass, 0 fail, 1 failed. Spent $0.00.
```

**How to read it.**

- The cell is `failed`. The agent never answered, so no check ran. The line says `after 3 attempts`: driftbench tried three times.
- Only transient trouble is retried: HTTP 408, 429 and any 5xx status, and network errors. A wrong answer is never retried, and an agent that fails by itself is not retried either.
- Waits grow from the base, are drawn at random below that, and never run shorter than the server's `Retry-After` header.
- Every retry is recorded on the block in the store, with the reason and the wait.
- A spec can set the same rules on its target, under `retry:` with `max_attempts` and `base_delay_ms`. The command line wins.

**If it goes wrong.**

- `--retry-attempts takes a whole number of at least 1, not "0".` with exit 2: give 1 or more.
- A failed cell runs again with `campaign resume` once the agent is back, because only finished runs are kept.

## 8. Aggregates: one rule over all runs

**Why you do this.** A block check judges one answer. Some rules judge the whole campaign, such as "at least 99 percent of runs pass". An **aggregate** is such a rule. See [aggregates](../aggregates.md).

**You need.** The stored campaign `acme-first`, and one campaign that fails. The next command makes one by forcing the price-sheet spec onto the chat agent, which cannot build a workbook.

**Relevant commands.**

- `driftbench campaign run`: as in step 2 · `examples/acme/specs/tasks/price-sheet.yaml` is the spec. `--target function:acme` forces the chat agent. `--store acme.db` is the store of step 2. `--campaign acme-wrong-target` is a new name · it prints one failing cell and exits 1.
- `driftbench report`: writes the scorecard page and prints the counts · `acme-first` is the campaign to report. `--store acme.db` is the store. `--out first.html` is the page. `--aggregate 'pass-rate:>=0.99'` is the rule: the share of runs that pass must be at least 0.99. The other built-in name is `broken-share`, with `<=` · it prints one line per rule. It exits 0 even when a rule fails.

**You type and you see.**

```console
$ driftbench campaign run examples/acme/specs/tasks/price-sheet.yaml --target function:acme --store acme.db --campaign acme-wrong-target   # exit 1
1 cell: 0 pass, 1 fail, 0 failed. Spent $0.00.
$ driftbench report acme-first --store acme.db --out first.html --aggregate 'pass-rate:>=0.99'
aggregate pass-rate >= 0.99: passes (1 >= 0.99, Wilson 95% interval 0.646 to 1.000 over 7 runs, undecided: 381 runs at this rate would decide it)
$ driftbench report acme-wrong-target --store acme.db --out wrong.html --aggregate 'pass-rate:>=0.99'
aggregate pass-rate >= 0.99: fails (0 >= 0.99, Wilson 95% interval 0.000 to 0.793 over 1 runs, decided)
```

**How to read it.**

- `passes (1 >= 0.99 ...)` shows the measured value, then the rule. The seven runs of `acme-first` all pass, so the rate is 1.
- The **Wilson interval** is the range the true rate probably lies in. For 7 runs it is wide, from 0.646 to 1.000. So the word `undecided` follows: the interval still reaches below 0.99.
- `381 runs at this rate would decide it` is how many runs the rule needs before the data settles it.
- `decided` on the second line means the interval lies wholly below 0.99, so the rule fails for sure.
- `report` always exits 0. The command `ci` uses the same `--aggregate` option and exits 1 when a rule fails. Rules can also live in `driftbench.yaml`, under `aggregates:`.

**If it goes wrong.**

- A rule that driftbench cannot read exits 2 before any campaign loads. Write `<name>:<op><number>`, with `>=` or `<=`.
- A campaign with no runs gives `inconclusive`. It never counts as a failure.

## 9. The store, and a campaign in a config file

**Why you do this.** The store holds everything a campaign made. The config file saves you from typing the same flags.

**You need.** A working folder with a `driftbench.yaml`:

```yaml
# file: cfg/driftbench.yaml
campaign:
  specs: [../examples/acme/specs/conversations]
  targets: [function:acme-sales]
  modes: [T, F]
  repeats: 2
  store: cfg.db
```

**Relevant commands.**

- `cd cfg`: goes into the folder that holds the config · no options · the later commands read `driftbench.yaml` from there.
- `driftbench campaign run`: as in step 2 · no paths and no flags, except `--campaign from-config` · the config supplies the specs, the target, the modes, the repeats and the store. It prints one line per cell.
- `driftbench campaign export`: writes a stored campaign as a folder of JSON files you can hand to another machine · `from-config` is the campaign. `--store cfg.db` is the store. `--out bundles` is the parent folder · it prints how many runs and specs it wrote.

**You type and you see.**

```console
$ cd cfg
$ driftbench campaign run --campaign from-config
✓ acme-tool-failure · function:acme-sales · F · repeat 1  pass  3 blocks
24 cells: 24 pass, 0 fail, 0 failed. Spent $0.00.
$ driftbench campaign export from-config --store cfg.db --out bundles
Exported campaign from-config to bundles/from-config: 24 runs, 6 specs, 0 sources.
```

**How to read it.**

- `24 cells` is six specs times two modes times two repeats.
- The store keeps the specs at the exact content that ran, and every run with its blocks and verdicts. It also keeps a cache of answers, and the versioned datasets and prompts. It holds every message the agent sent and received, so treat the file as private.
- A relative `--store` path is read from the folder where you type the command. Without `--store`, the runs live in memory and vanish when the command ends. The command then prints `The runs are not kept: pass --store <file> to keep them.`
- `campaign import <folder> --store <file>` stores a bundle in another store, all or nothing.

**If it goes wrong.**

- `Cannot open the store at <path>` with exit 2: the file is not a SQLite store, or the folder cannot be written.
- A key under `campaign:` that the page above does not list is an error. Keys use snake case, such as `budget_usd`.
