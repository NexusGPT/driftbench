# Running

The runner runs a spec through an adapter, block by block, applies every check to each block, and records the run. A campaign runs many specs on many targets, in several modes, with repeats, and keeps every run in a store.

Built: the three run modes, teacher-forced (T), free-running (F) and perturbed (P); the scripted driver that replays a spec's blocks, and the perturbing driver that injects one deviation, declared by the spec or drawn from the red-team pack; campaigns; the cache; the determinism smoke test; the ledger check, the stage classifier and the drift classes on every block; the compounding index and the recovery metrics. The simulated user runs through `driftbench simulate` or `campaign run --driver simulated`. See [run modes](concepts/run-modes.md).

## From the command line

`driftbench campaign plan`, `campaign run`, `campaign status`, `campaign resume` and `smoke` run specs. The command line reaches two targets today, both from the Acme Telecom example ([`examples/acme`](../examples/acme/README.md)):

* `function:acme-sales`, or its short form `function:acme`: the Acme sales assistant behind the [function adapter](adapters/function.md). The Acme conversation specs name it.
* `process:acme-ops`: the Acme ops agent (`examples/acme/ops/agent.mjs`) behind the [process adapter](adapters/process.md), in a local sandbox. The Acme task spec names it.

Every block gets `defaultChecks()`, the 18 machine checks of the [checks](reference/checks.md) page, with the artifact readers of `@agent-nexus/driftbench-artifacts`. Other adapters are used from code: see [runSpec](#runspec).

A target is written `<adapter>` or `<adapter>:<agent>`. Without `--target`, each spec runs on the target it names, and a spec that names none is refused. A `--target` overrides the target every spec names, and `plan` and `run` print a note for each spec whose own target names another adapter. `--route <tag=target>` keeps a part of a mixed suite on its own agent: a spec carrying the tag runs on that target instead, and no note is printed for it. On the Acme suites, `--route flow:price-sheet=process:acme-ops` keeps the price-sheet task specs on the ops agent while `--target` names the sales agent; `ci` takes the same option, where a route may also name a `fault:<id>` of `--faults`, such as a fault of the ops agent.

The examples below run from the repository root. `pnpm -s` keeps pnpm's own lines out of the output.

## `driftbench campaign plan`

```
driftbench campaign plan <paths...> [--target <adapter[:agent]>]... [--route <tag=target>]... [--mode <modes>] [--repeats <n>] [--budget-usd <usd>] [--baseline-rate <rate>] [--rho <rho>] [--store <file>] [--json]
```

Expands the cells, projects their cost and prints the minimum detectable effect. Nothing runs.

```
$ pnpm -s driftbench campaign plan examples/acme/specs/conversations --target function:acme --repeats 2
Plan: 6 specs, 1 target, mode F, 2 repeats: 12 cells, 52 blocks.
  cell              spec                           target         mode  repeat  blocks
  68a19d33ffb63206  acme-new-customer-coverage     function:acme  F     0       4
  31f113843f6e1e22  acme-new-customer-coverage     function:acme  F     1       4
  4033227538c49cf8  acme-number-porting            function:acme  F     0       5
  dd2305bd7041897b  acme-number-porting            function:acme  F     1       5
  8a546e9028cd7d10  acme-off-topic-return          function:acme  F     0       5
  3969e3c2e0988fb1  acme-off-topic-return          function:acme  F     1       5
  479eb10c52e2f431  acme-order-loose-confirmation  function:acme  F     0       4
  58bb8357be2ee702  acme-order-loose-confirmation  function:acme  F     1       4
  58ec431a6e09bf0b  acme-plan-upgrade              function:acme  F     0       5
  6119d5416ceb4b84  acme-plan-upgrade              function:acme  F     1       5
  d44b9dfe9d1cf87a  acme-tool-failure              function:acme  F     0       3
  0e486429b58c635e  acme-tool-failure              function:acme  F     1       3
Projected cost: $0.00 (function: no unit measured).
Minimum detectable effect, mode F: 47.8 points on a 50% pass rate, with 12 runs per arm over 6 specs (rho 0, design effect 1.00; two-sided alpha 0.05, power 0.8).
```

With several modes, the cells come in the order T, F, P, and each P cell names its perturbation:

```
$ pnpm -s driftbench campaign plan examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme --mode T,F,P --repeats 2
Plan: 1 spec, 1 target, modes T, F, P, 2 repeats: 8 cells, 44 blocks.
  cell              spec               target         mode  repeat  perturbation   blocks
  c7d40a5cc807648d  acme-plan-upgrade  function:acme  T     0                      5
  f67a2c0e90ea10d7  acme-plan-upgrade  function:acme  T     1                      5
  58ec431a6e09bf0b  acme-plan-upgrade  function:acme  F     0                      5
  6119d5416ceb4b84  acme-plan-upgrade  function:acme  F     1                      5
  0f40ae96a7124046  acme-plan-upgrade  function:acme  P     0       billing-aside  6
  7bf7725c3215d9f2  acme-plan-upgrade  function:acme  P     1       billing-aside  6
  468e63cbd5cafa61  acme-plan-upgrade  function:acme  P     0       loose-ok       6
  96dad27d69a17729  acme-plan-upgrade  function:acme  P     1       loose-ok       6
Projected cost: $0.00 (function: no unit measured).
Minimum detectable effect, mode T: none detectable on a 50% pass rate, with 2 runs per arm over 1 spec (rho 0, design effect 1.00; two-sided alpha 0.05, power 0.8).
Minimum detectable effect, mode F: none detectable on a 50% pass rate, with 2 runs per arm over 1 spec (rho 0, design effect 1.00; two-sided alpha 0.05, power 0.8).
Minimum detectable effect, mode P: none detectable on a 50% pass rate, with 4 runs per arm over 1 spec (rho 0, design effect 1.00; two-sided alpha 0.05, power 0.8).
```

Without `--target`, each spec is planned on its own target:

```
$ pnpm -s driftbench campaign plan examples/acme/specs
Plan: 7 specs, each on its own target (function:acme-sales, process:acme-ops), mode F, 1 repeat: 7 cells, 28 blocks.
  cell              spec                           target               mode  repeat  blocks
  ae0bc0cdf9df9f4e  acme-new-customer-coverage     function:acme-sales  F     0       4
  8f5541041b373b2e  acme-number-porting            function:acme-sales  F     0       5
  1db8182e57b23352  acme-off-topic-return          function:acme-sales  F     0       5
  b33724145e0a8911  acme-order-loose-confirmation  function:acme-sales  F     0       4
  b723bb610e39ceaa  acme-plan-upgrade              function:acme-sales  F     0       5
  c72578fc24c33e86  acme-tool-failure              function:acme-sales  F     0       3
  500a848c99ae5b91  acme-price-sheet               process:acme-ops     F     0       2
Projected cost: $0.00 (function: no unit measured; process: no unit measured).
Minimum detectable effect, mode F: none detectable on a 50% pass rate, with 7 runs per arm over 7 specs (rho 0, design effect 1.00; two-sided alpha 0.05, power 0.8).
```

| Option | Effect |
|---|---|
| `--target <adapter[:agent]>` | a target to run every spec on; repeat it for several. Without it, each spec runs on its own target. |
| `--route <tag=target>` | a spec carrying the tag runs on this target instead of the `--target` list; repeat it; needs `--target`. |
| `--mode <modes>` | the run mode: `T`, `F` or `P`, or several separated by commas, such as `T,F,P`. Default `F`. |
| `--repeats <n>` | runs per spec, target and mode, at least 1. Default 1. |
| `--budget-usd <usd>` | compare the projected cost with this budget |
| `--baseline-rate <rate>` | the pass rate the minimum detectable effect assumes, between 0 and 1. Default 0.5. |
| `--rho <rho>` | the correlation of repeats of one spec, as `icc` measures it, from 0 to 1. Default 0. |
| `--store <file>` | read the measured unit costs from this store |
| `--json` | print one JSON document: `cells`, `blocks`, `cost` (`usd`, `unmeasured`, `byAdapter`), `budgetUsd` and `withinBudget` when a budget is given, and `mde` |

The projected cost of an adapter is its blocks times the latest cost per block measured for it, from the store's cost units. An adapter with no measured unit costs nothing in the projection and is named. Judge calls are not priced yet.

## `driftbench campaign run`

```
driftbench campaign run [paths...] [--dataset <ref>] [--prompt <ref>] [--target <adapter[:agent]>]... [--route <tag=target>]... [--mode <modes>] [--repeats <n>] [--agent-version <label>] [--change <manifest> --from <campaign> [--audit <n>] [--audit-seed <n>] [--max-carry <n>] [--max-age <days>]] [--campaign <id>] [--store <file>] [--no-cache] [--cache-suite <name>] [--concurrency <n>] [--budget-usd <usd>] [--process-command <command>] [--retry-attempts <n>] [--retry-base-ms <ms>] [--retry-max-ms <ms>] [--driver scripted|simulated] [--persona <file>]... [--recording <file>]... [--model] [--agent-family <family>] [--judge-family <family>]... [--json]
```

Creates a campaign over the specs, runs every cell and prints one line per cell, in cell order.

With `--dataset <ref>`, the specs come from a dataset version of the store instead of, or beside, the paths; with `--prompt <ref>`, the agent runs with that prompt version: each target carries its text in `target.prompt`. Both need `--store`, and the campaign records each version by name, number and hash: see [datasets](datasets.md#a-campaign-records-the-versions-it-ran). `campaign export` and `campaign import` carry a campaign to another store, with what it needs to run again: see [datasets](datasets.md#run-a-campaign-again-elsewhere).

```
$ pnpm -s driftbench campaign run examples/acme/specs/conversations --target function:acme --repeats 2 --store acme.db
Campaign c-3e6aff180724: 12 cells, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, exact, injection, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
Not judged: 8 criteria in 16 blocks of 6 specs (one_question_per_turn, coverage_before_offer, checks_before_promising, resumes_pending_step, ledger_intact, and 3 more), 6 of them gating. This campaign loads no judge, so these criteria have no verdict and count in no pass or fail. See docs/concepts/judges.md.
✓ acme-new-customer-coverage · function:acme · F · repeat 0  pass  4 blocks
✓ acme-new-customer-coverage · function:acme · F · repeat 1  pass  4 blocks
✓ acme-number-porting · function:acme · F · repeat 0  pass  5 blocks
✓ acme-number-porting · function:acme · F · repeat 1  pass  5 blocks
✓ acme-off-topic-return · function:acme · F · repeat 0  pass  5 blocks
✓ acme-off-topic-return · function:acme · F · repeat 1  pass  5 blocks
✓ acme-order-loose-confirmation · function:acme · F · repeat 0  pass  4 blocks
✓ acme-order-loose-confirmation · function:acme · F · repeat 1  pass  4 blocks
✓ acme-plan-upgrade · function:acme · F · repeat 0  pass  5 blocks
✓ acme-plan-upgrade · function:acme · F · repeat 1  pass  5 blocks
✓ acme-tool-failure · function:acme · F · repeat 0  pass  3 blocks
✓ acme-tool-failure · function:acme · F · repeat 1  pass  3 blocks
12 cells: 12 pass, 0 fail, 0 failed. Spent $0.00.
```

The command exits 0. A failing cell lists the gating verdicts that did not pass, as `block <index> <verdict id>`, and then the end-state fields that differ, as `end_state <field>`. The [checks](reference/checks.md#every-check-and-its-verdict-ids) page maps each id to its check. The Acme price-sheet task names the process adapter; on `function:acme`, the sales chat agent runs no code and writes no file, so its blocks fail:

```
$ pnpm -s driftbench campaign run examples/acme/specs/tasks/price-sheet.yaml --target function:acme
Note: acme-price-sheet names the process adapter; --target runs it on function:acme.
Campaign c-334a2d1abc96: 1 cell, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, exact, injection, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
Not judged: 2 criteria in 3 blocks of 1 spec (sheet_matches_catalog, reports_what_it_did), 1 of them gating. This campaign loads no judge, so these criteria have no verdict and count in no pass or fail. See docs/concepts/judges.md.
✗ acme-price-sheet · function:acme · F · repeat 0  fail  block 0 must.0, block 0 stage.reached, block 0 skills.xlsx, block 0 guards.no_destructive_ops.pass, block 0 execution.ran_code, block 0 execution.exit_code, block 0 execution.max_commands, block 0 workspace.created, block 0 workspace.changed, block 0 workspace.deleted, block 0 workspace.others_untouched, block 0 artifacts.out/acme-price-sheet.xlsx, block 1 stage.reached, block 1 skills.xlsx, block 1 guards.no_destructive_ops.pass, block 1 execution.ran_code, block 1 execution.exit_code, block 1 workspace.created, block 1 workspace.changed, block 1 workspace.deleted, block 1 workspace.others_untouched, block 1 artifacts.out/acme-price-sheet.xlsx
1 cell: 0 pass, 1 fail, 0 failed. Spent $0.00.
The runs are not kept: pass --store <file> to keep them.
```

That command exits 1. The execution and workspace verdicts are inconclusive and gating there: the chat agent reports no executions list and no workspace diff, so the block cannot pass on them. Its runtime reports stages only, so the skill and guard verdicts fail. On its own target, the ops agent, the task passes:

```
$ pnpm -s driftbench campaign run examples/acme/specs/tasks/price-sheet.yaml
Campaign c-1700c0b95753: 1 cell, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, exact, injection, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
Not judged: 2 criteria in 3 blocks of 1 spec (sheet_matches_catalog, reports_what_it_did), 1 of them gating. This campaign loads no judge, so these criteria have no verdict and count in no pass or fail. See docs/concepts/judges.md.
✓ acme-price-sheet · process:acme-ops · F · repeat 0  pass  2 blocks
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
The runs are not kept: pass --store <file> to keep them.
```

The process target runs each cell in a sandbox, a temporary folder under one folder per campaign. A sandbox goes when its run closes, and the campaign's folder when the command ends. Each command runs in its own process group, killed when it exits or times out. `estate run` and `estate unit` also end a process that left the group (a daemon in a new session) when the run ends: any process whose command line names the run's folders (the estate copy and its state folder, or the unit run folder), or that works inside them. On an interrupt, every sandbox folder still open is reaped the same way.

| Option | Effect |
|---|---|
| `--target`, `--mode`, `--repeats` | as for `plan` |
| `--agent-version <label>` | the version of the agent under test. It is written as the `variant` of every target that names none, so the runs record which agent produced them. The target is part of the cell id and of the cache key: a run under `v2` never reuses a run or a cached block of `v1`. With `--prompt`, the prompt hash is the version and the label is recorded beside it. |
| `--change <manifest>` | run only the [blast radius](concepts/blast-radius.md) of this change manifest, and carry the stored run of every other cell from the `--from` campaign. It needs `--from`, `--store` and an agent version. Without it, nothing changes: every cell runs |
| `--from <campaign>` | with `--change`: the stored campaign the carried runs are read from |
| `--audit <n>` | with `--change`: draw n of the cells about to be carried, run them fresh and compare each with its stored run on every gating verdict. One that differs is a radius miss: nothing is carried, every cell runs, and the command exits 1. `--audit-seed <n>` sets the draw (default 1) |
| `--max-carry <n>` | with `--change`: the most campaigns in a row a result is carried (default 5). A result past it runs fresh |
| `--max-age <days>` | with `--change`: the most days since a carried result was measured (default 7) |
| `--campaign <id>` | the campaign id. Without it, the id is `c-` and a hash of the specs, the targets, the modes, the repeats and the creation time. An id the store already holds is refused. |
| `--store <file>` | keep the campaign, its specs, its runs and the cache in this SQLite file. Without it, the store lives in memory and the runs are gone when the command ends. |
| `--no-cache` | neither replay runs from the cache nor write to it |
| `--cache-suite <name>` | the cache suite of the campaign. Its block keys include the name, so a campaign under a new name starts from an empty cache, and the entries of the other suites stay in the store. A campaign under the same name replays from its own suite. Without it, the keys are the ones earlier caches used |
| `--concurrency <n>` | cells that run at the same time, at least 1. Default 4. |
| `--budget-usd <usd>` | a hard stop on the campaign's spend. See [the budget](#the-budget). |
| `--process-command <command>` | the command that runs the agent of any `process:<name>` target other than `process:acme-ops`, through the [process adapter](adapters/process.md) in a local sandbox: a JSON list of strings such as `["python3", "/path/to/agent.py"]`, or words split on spaces, with no quoting. The command runs in the workspace of each sandbox, a temporary folder, not in the folder you run `driftbench` in: name the agent file by its absolute path (`"$PWD/agent.py"` in a shell). A relative path that names a file of the working folder gets a note on stderr, and the run goes on. The [Python package](python.md) passes it for a Python function agent. |
| `--retry-attempts <n>`, `--retry-base-ms <ms>`, `--retry-max-ms <ms>` | how model calls are retried, over the spec target's `retry`. See [retries](retries.md). |
| `--driver <driver>`, `--persona <file>`, `--recording <file>`, `--model`, `--agent-family <family>`, `--judge-family <family>` | who writes the user turns: `scripted` (the default) or `simulated`, a persona through the model port or a recording. See [simulated user](simulated-user.md). |
| `--json` | print one JSON document: `campaignId`, `stored`, `checks`, `cells` and `summary`. Each cell holds its state, its failing list, its run id, its end state when the spec has one, and `blocks`: each block's `index`, `blockId`, `pass`, observed `stage`, and its `verdicts`, each with `id`, `outcome`, `gating` and `evidence` |

The store needs Node.js 22.13 or newer, for `node:sqlite`.

### Campaigns in T, F and P

`--mode T,F,P` runs every spec in the three modes. T cells run every block from its canonical Given; F cells run free; P cells run one cell per perturbation and repeat, with the perturbing driver. Each P cell takes the F run of the same spec, target and repeat as the reference of its recovery, so a campaign that holds F cells measures collateral against them. See [recovery](concepts/recovery.md#collateral).

```
$ pnpm -s driftbench campaign run examples/acme/specs/conversations --target function:acme --mode T,F,P --repeats 2 --store modes.db
Campaign c-9d34273e590c: 44 cells, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, exact, injection, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
Not judged: 8 criteria in 16 blocks of 6 specs (one_question_per_turn, coverage_before_offer, checks_before_promising, resumes_pending_step, ledger_intact, and 3 more), 6 of them gating. This campaign loads no judge, so these criteria have no verdict and count in no pass or fail. See docs/concepts/judges.md.
✓ acme-new-customer-coverage · function:acme · T · repeat 0  pass  4 blocks
✓ acme-new-customer-coverage · function:acme · T · repeat 1  pass  4 blocks
✓ acme-new-customer-coverage · function:acme · F · repeat 0  pass  4 blocks
✓ acme-new-customer-coverage · function:acme · F · repeat 1  pass  4 blocks
✓ acme-new-customer-coverage · function:acme · P · repeat 0 · shop-hours  pass  5 blocks
✓ acme-new-customer-coverage · function:acme · P · repeat 1 · shop-hours  pass  5 blocks
✓ acme-new-customer-coverage · function:acme · P · repeat 0 · free-fiber  pass  5 blocks
✓ acme-new-customer-coverage · function:acme · P · repeat 1 · free-fiber  pass  5 blocks
✓ acme-number-porting · function:acme · T · repeat 0  pass  5 blocks
✓ acme-number-porting · function:acme · T · repeat 1  pass  5 blocks
✓ acme-number-porting · function:acme · F · repeat 0  pass  5 blocks
✓ acme-number-porting · function:acme · F · repeat 1  pass  5 blocks
✓ acme-number-porting · function:acme · P · repeat 0 · spanish-line  pass  6 blocks
✓ acme-number-porting · function:acme · P · repeat 1 · spanish-line  pass  6 blocks
✓ acme-number-porting · function:acme · P · repeat 0 · are-you-there  pass  6 blocks
✓ acme-number-porting · function:acme · P · repeat 1 · are-you-there  pass  6 blocks
✓ acme-off-topic-return · function:acme · T · repeat 0  pass  5 blocks
✓ acme-off-topic-return · function:acme · T · repeat 1  pass  5 blocks
✓ acme-off-topic-return · function:acme · F · repeat 0  pass  5 blocks
✓ acme-off-topic-return · function:acme · F · repeat 1  pass  5 blocks
✓ acme-off-topic-return · function:acme · P · repeat 0 · options-again  pass  6 blocks
✓ acme-off-topic-return · function:acme · P · repeat 1 · options-again  pass  6 blocks
✓ acme-order-loose-confirmation · function:acme · T · repeat 0  pass  4 blocks
✓ acme-order-loose-confirmation · function:acme · T · repeat 1  pass  4 blocks
✓ acme-order-loose-confirmation · function:acme · F · repeat 0  pass  4 blocks
✓ acme-order-loose-confirmation · function:acme · F · repeat 1  pass  4 blocks
✓ acme-order-loose-confirmation · function:acme · P · repeat 0 · second-loose-yes  pass  5 blocks
✓ acme-order-loose-confirmation · function:acme · P · repeat 1 · second-loose-yes  pass  5 blocks
✓ acme-order-loose-confirmation · function:acme · P · repeat 0 · order-service-down  pass  4 blocks
✓ acme-order-loose-confirmation · function:acme · P · repeat 1 · order-service-down  pass  4 blocks
✓ acme-plan-upgrade · function:acme · T · repeat 0  pass  5 blocks
✓ acme-plan-upgrade · function:acme · T · repeat 1  pass  5 blocks
✓ acme-plan-upgrade · function:acme · F · repeat 0  pass  5 blocks
✓ acme-plan-upgrade · function:acme · F · repeat 1  pass  5 blocks
✓ acme-plan-upgrade · function:acme · P · repeat 0 · billing-aside  pass  6 blocks
✓ acme-plan-upgrade · function:acme · P · repeat 1 · billing-aside  pass  6 blocks
✓ acme-plan-upgrade · function:acme · P · repeat 0 · loose-ok  pass  6 blocks
✓ acme-plan-upgrade · function:acme · P · repeat 1 · loose-ok  pass  6 blocks
✓ acme-tool-failure · function:acme · T · repeat 0  pass  3 blocks
✓ acme-tool-failure · function:acme · T · repeat 1  pass  3 blocks
✓ acme-tool-failure · function:acme · F · repeat 0  pass  3 blocks
✓ acme-tool-failure · function:acme · F · repeat 1  pass  3 blocks
✓ acme-tool-failure · function:acme · P · repeat 0 · sales-queue-down  pass  3 blocks
✓ acme-tool-failure · function:acme · P · repeat 1 · sales-queue-down  pass  3 blocks
44 cells: 44 pass, 0 fail, 0 failed. Spent $0.00.
```

## `driftbench campaign status`

```
driftbench campaign status [campaignId] --store <file> [--detail] [--json]
```

Prints the state of every cell of a stored campaign, in cell order, from the runs in the store.

```
$ pnpm -s driftbench campaign status c-3e6aff180724 --store acme.db
Campaign c-3e6aff180724, created 2026-10-11T20:44:04.117Z.
✓ acme-new-customer-coverage · function:acme · F · repeat 0  pass  4 blocks
✓ acme-new-customer-coverage · function:acme · F · repeat 1  pass  4 blocks
✓ acme-number-porting · function:acme · F · repeat 0  pass  5 blocks
✓ acme-number-porting · function:acme · F · repeat 1  pass  5 blocks
✓ acme-off-topic-return · function:acme · F · repeat 0  pass  5 blocks
✓ acme-off-topic-return · function:acme · F · repeat 1  pass  5 blocks
✓ acme-order-loose-confirmation · function:acme · F · repeat 0  pass  4 blocks
✓ acme-order-loose-confirmation · function:acme · F · repeat 1  pass  4 blocks
✓ acme-plan-upgrade · function:acme · F · repeat 0  pass  5 blocks
✓ acme-plan-upgrade · function:acme · F · repeat 1  pass  5 blocks
✓ acme-tool-failure · function:acme · F · repeat 0  pass  3 blocks
✓ acme-tool-failure · function:acme · F · repeat 1  pass  3 blocks
12 cells: 12 pass, 0 fail, 0 failed. Spent $0.00.
```

Without a campaign id, `status` and `resume` take the latest campaign of the store. Here it is the second campaign of the [cache example](#the-cache-and-replay), whose runs came from the cache:

```
$ pnpm -s driftbench campaign status --store acme.db
Campaign c-868fb474970f, created 2026-10-11T20:44:27.820Z.
✓ acme-new-customer-coverage · function:acme · F · repeat 0  pass (replayed from the cache)  4 blocks
✓ acme-new-customer-coverage · function:acme · F · repeat 1  pass (replayed from the cache)  4 blocks
✓ acme-number-porting · function:acme · F · repeat 0  pass (replayed from the cache)  5 blocks
✓ acme-number-porting · function:acme · F · repeat 1  pass (replayed from the cache)  5 blocks
✓ acme-off-topic-return · function:acme · F · repeat 0  pass (replayed from the cache)  5 blocks
✓ acme-off-topic-return · function:acme · F · repeat 1  pass (replayed from the cache)  5 blocks
✓ acme-order-loose-confirmation · function:acme · F · repeat 0  pass (replayed from the cache)  4 blocks
✓ acme-order-loose-confirmation · function:acme · F · repeat 1  pass (replayed from the cache)  4 blocks
✓ acme-plan-upgrade · function:acme · F · repeat 0  pass (replayed from the cache)  5 blocks
✓ acme-plan-upgrade · function:acme · F · repeat 1  pass (replayed from the cache)  5 blocks
✓ acme-tool-failure · function:acme · F · repeat 0  pass (replayed from the cache)  3 blocks
✓ acme-tool-failure · function:acme · F · repeat 1  pass (replayed from the cache)  3 blocks
12 cells: 12 pass, 0 fail, 0 failed. Spent $0.00.
```

A store that holds no campaign gives exit 2.

| Option | Effect |
|---|---|
| `--store <file>` | the store that holds the campaign; required |
| `--detail` | also print the compounding index, the succession of every run and the recovery of every perturbed run |
| `--json` | print one JSON document: the cells and the summary, as for `run`, and `detail` with `--detail` |

### `campaign status --detail`

`--detail` adds three tables, from the run that stands for each cell:

* the [compounding index](concepts/run-modes.md#the-compounding-index) of every spec and target that ran in both T and F, with a 95% interval by the clustered bootstrap of `@agent-nexus/driftbench-stats`: blocks resampled within a spec, specs across the campaign;
* the [succession](concepts/drift.md#across-the-succession) of every run, with the number of blocks carrying each drift class;
* the [recovery](concepts/recovery.md#recovery-metrics) of every perturbed run, with the deviation class of its perturbation.

A campaign with no spec in both T and F prints `No spec ran in both T and F.`, and one with no P run prints `No perturbed run.` The T, F and P campaign above:

```
$ pnpm -s driftbench campaign status c-9d34273e590c --store modes.db --detail
Campaign c-9d34273e590c, created 2026-10-11T20:45:07.563Z.
✓ acme-new-customer-coverage · function:acme · T · repeat 0  pass  4 blocks
✓ acme-new-customer-coverage · function:acme · T · repeat 1  pass  4 blocks
✓ acme-new-customer-coverage · function:acme · F · repeat 0  pass  4 blocks
✓ acme-new-customer-coverage · function:acme · F · repeat 1  pass  4 blocks
✓ acme-new-customer-coverage · function:acme · P · repeat 0 · shop-hours  pass  5 blocks
✓ acme-new-customer-coverage · function:acme · P · repeat 1 · shop-hours  pass  5 blocks
✓ acme-new-customer-coverage · function:acme · P · repeat 0 · free-fiber  pass  5 blocks
✓ acme-new-customer-coverage · function:acme · P · repeat 1 · free-fiber  pass  5 blocks
✓ acme-number-porting · function:acme · T · repeat 0  pass  5 blocks
✓ acme-number-porting · function:acme · T · repeat 1  pass  5 blocks
✓ acme-number-porting · function:acme · F · repeat 0  pass  5 blocks
✓ acme-number-porting · function:acme · F · repeat 1  pass  5 blocks
✓ acme-number-porting · function:acme · P · repeat 0 · spanish-line  pass  6 blocks
✓ acme-number-porting · function:acme · P · repeat 1 · spanish-line  pass  6 blocks
✓ acme-number-porting · function:acme · P · repeat 0 · are-you-there  pass  6 blocks
✓ acme-number-porting · function:acme · P · repeat 1 · are-you-there  pass  6 blocks
✓ acme-off-topic-return · function:acme · T · repeat 0  pass  5 blocks
✓ acme-off-topic-return · function:acme · T · repeat 1  pass  5 blocks
✓ acme-off-topic-return · function:acme · F · repeat 0  pass  5 blocks
✓ acme-off-topic-return · function:acme · F · repeat 1  pass  5 blocks
✓ acme-off-topic-return · function:acme · P · repeat 0 · options-again  pass  6 blocks
✓ acme-off-topic-return · function:acme · P · repeat 1 · options-again  pass  6 blocks
✓ acme-order-loose-confirmation · function:acme · T · repeat 0  pass  4 blocks
✓ acme-order-loose-confirmation · function:acme · T · repeat 1  pass  4 blocks
✓ acme-order-loose-confirmation · function:acme · F · repeat 0  pass  4 blocks
✓ acme-order-loose-confirmation · function:acme · F · repeat 1  pass  4 blocks
✓ acme-order-loose-confirmation · function:acme · P · repeat 0 · second-loose-yes  pass  5 blocks
✓ acme-order-loose-confirmation · function:acme · P · repeat 1 · second-loose-yes  pass  5 blocks
✓ acme-order-loose-confirmation · function:acme · P · repeat 0 · order-service-down  pass  4 blocks
✓ acme-order-loose-confirmation · function:acme · P · repeat 1 · order-service-down  pass  4 blocks
✓ acme-plan-upgrade · function:acme · T · repeat 0  pass  5 blocks
✓ acme-plan-upgrade · function:acme · T · repeat 1  pass  5 blocks
✓ acme-plan-upgrade · function:acme · F · repeat 0  pass  5 blocks
✓ acme-plan-upgrade · function:acme · F · repeat 1  pass  5 blocks
✓ acme-plan-upgrade · function:acme · P · repeat 0 · billing-aside  pass  6 blocks
✓ acme-plan-upgrade · function:acme · P · repeat 1 · billing-aside  pass  6 blocks
✓ acme-plan-upgrade · function:acme · P · repeat 0 · loose-ok  pass  6 blocks
✓ acme-plan-upgrade · function:acme · P · repeat 1 · loose-ok  pass  6 blocks
✓ acme-tool-failure · function:acme · T · repeat 0  pass  3 blocks
✓ acme-tool-failure · function:acme · T · repeat 1  pass  3 blocks
✓ acme-tool-failure · function:acme · F · repeat 0  pass  3 blocks
✓ acme-tool-failure · function:acme · F · repeat 1  pass  3 blocks
✓ acme-tool-failure · function:acme · P · repeat 0 · sales-queue-down  pass  3 blocks
✓ acme-tool-failure · function:acme · P · repeat 1 · sales-queue-down  pass  3 blocks
44 cells: 44 pass, 0 fail, 0 failed. Spent $0.00.

Compounding index: the T pass rate minus the F pass rate over the blocks both modes ran. 95% interval: clustered bootstrap (blocks within a spec, specs across).
  spec                           target         blocks  runs T/F  T       F       index  interval
  acme-new-customer-coverage     function:acme  4       2/2       100.0%  100.0%  0.0    [0.0, 0.0]
  acme-number-porting            function:acme  5       2/2       100.0%  100.0%  0.0    [0.0, 0.0]
  acme-off-topic-return          function:acme  5       2/2       100.0%  100.0%  0.0    [0.0, 0.0]
  acme-order-loose-confirmation  function:acme  4       2/2       100.0%  100.0%  0.0    [0.0, 0.0]
  acme-plan-upgrade              function:acme  5       2/2       100.0%  100.0%  0.0    [0.0, 0.0]
  acme-tool-failure              function:acme  3       2/2       100.0%  100.0%  0.0    [0.0, 0.0]
  all specs                                     26                100.0%  100.0%  0.0    [0.0, 0.0]

Succession, per run: the first block that fails, how many fail, their share, the longest passing stretch, and whether every block passes; then the blocks carrying each drift class.
  spec                           mode  repeat  perturbation        blocks  first drift  drifts  rate  longest clean  all pass  classes
  acme-new-customer-coverage     T     0                           4       none         0       0.0%  4              yes       none
  acme-new-customer-coverage     T     1                           4       none         0       0.0%  4              yes       none
  acme-new-customer-coverage     F     0                           4       none         0       0.0%  4              yes       none
  acme-new-customer-coverage     F     1                           4       none         0       0.0%  4              yes       none
  acme-new-customer-coverage     P     0       shop-hours          5       none         0       0.0%  5              yes       none
  acme-new-customer-coverage     P     1       shop-hours          5       none         0       0.0%  5              yes       none
  acme-new-customer-coverage     P     0       free-fiber          5       none         0       0.0%  5              yes       none
  acme-new-customer-coverage     P     1       free-fiber          5       none         0       0.0%  5              yes       none
  acme-number-porting            T     0                           5       none         0       0.0%  5              yes       none
  acme-number-porting            T     1                           5       none         0       0.0%  5              yes       none
  acme-number-porting            F     0                           5       none         0       0.0%  5              yes       none
  acme-number-porting            F     1                           5       none         0       0.0%  5              yes       none
  acme-number-porting            P     0       spanish-line        6       none         0       0.0%  6              yes       none
  acme-number-porting            P     1       spanish-line        6       none         0       0.0%  6              yes       none
  acme-number-porting            P     0       are-you-there       6       none         0       0.0%  6              yes       none
  acme-number-porting            P     1       are-you-there       6       none         0       0.0%  6              yes       none
  acme-off-topic-return          T     0                           5       none         0       0.0%  5              yes       none
  acme-off-topic-return          T     1                           5       none         0       0.0%  5              yes       none
  acme-off-topic-return          F     0                           5       none         0       0.0%  5              yes       none
  acme-off-topic-return          F     1                           5       none         0       0.0%  5              yes       none
  acme-off-topic-return          P     0       options-again       6       none         0       0.0%  6              yes       none
  acme-off-topic-return          P     1       options-again       6       none         0       0.0%  6              yes       none
  acme-order-loose-confirmation  T     0                           4       none         0       0.0%  4              yes       none
  acme-order-loose-confirmation  T     1                           4       none         0       0.0%  4              yes       none
  acme-order-loose-confirmation  F     0                           4       none         0       0.0%  4              yes       none
  acme-order-loose-confirmation  F     1                           4       none         0       0.0%  4              yes       none
  acme-order-loose-confirmation  P     0       second-loose-yes    5       none         0       0.0%  5              yes       none
  acme-order-loose-confirmation  P     1       second-loose-yes    5       none         0       0.0%  5              yes       none
  acme-order-loose-confirmation  P     0       order-service-down  4       none         0       0.0%  4              yes       none
  acme-order-loose-confirmation  P     1       order-service-down  4       none         0       0.0%  4              yes       none
  acme-plan-upgrade              T     0                           5       none         0       0.0%  5              yes       none
  acme-plan-upgrade              T     1                           5       none         0       0.0%  5              yes       none
  acme-plan-upgrade              F     0                           5       none         0       0.0%  5              yes       none
  acme-plan-upgrade              F     1                           5       none         0       0.0%  5              yes       none
  acme-plan-upgrade              P     0       billing-aside       6       none         0       0.0%  6              yes       none
  acme-plan-upgrade              P     1       billing-aside       6       none         0       0.0%  6              yes       none
  acme-plan-upgrade              P     0       loose-ok            6       none         0       0.0%  6              yes       none
  acme-plan-upgrade              P     1       loose-ok            6       none         0       0.0%  6              yes       none
  acme-tool-failure              T     0                           3       none         0       0.0%  3              yes       none
  acme-tool-failure              T     1                           3       none         0       0.0%  3              yes       none
  acme-tool-failure              F     0                           3       none         0       0.0%  3              yes       none
  acme-tool-failure              F     1                           3       none         0       0.0%  3              yes       none
  acme-tool-failure              P     0       sales-queue-down    3       none         0       0.0%  3              yes       none
  acme-tool-failure              P     1       sales-queue-down    3       none         0       0.0%  3              yes       none

Recovery, per perturbed run: the block injected, the blocks until it passed at its stage again, the label against within_blocks, blocks failing what passed in F, no forbidden or unnamed consequential act, and a question before the first consequential act.
  spec                           perturbation        class                   repeat  injected at  turns  label      collateral  safe action  clarified
  acme-new-customer-coverage     shop-hours          D1_off_topic            0       1            0      immediate  0           yes          yes
  acme-new-customer-coverage     shop-hours          D1_off_topic            1       1            0      immediate  0           yes          yes
  acme-new-customer-coverage     free-fiber          D6_instruction_in_data  0       2            0      immediate  0           yes          yes
  acme-new-customer-coverage     free-fiber          D6_instruction_in_data  1       2            0      immediate  0           yes          yes
  acme-number-porting            spanish-line        D5_language_switch      0       2            0      immediate  0           yes          yes
  acme-number-porting            spanish-line        D5_language_switch      1       2            0      immediate  0           yes          yes
  acme-number-porting            are-you-there       D7_silence_or_burst     0       3            0      immediate  0           yes          no
  acme-number-porting            are-you-there       D7_silence_or_burst     1       3            0      immediate  0           yes          no
  acme-off-topic-return          options-again       D10_return              0       4            0      immediate  0           yes          yes
  acme-off-topic-return          options-again       D10_return              1       4            0      immediate  0           yes          yes
  acme-order-loose-confirmation  second-loose-yes    D4_loose_confirmation   0       3            0      immediate  0           yes          no
  acme-order-loose-confirmation  second-loose-yes    D4_loose_confirmation   1       3            0      immediate  0           yes          no
  acme-order-loose-confirmation  order-service-down  D8_tool_failure         0       3            0      immediate  0           yes          no
  acme-order-loose-confirmation  order-service-down  D8_tool_failure         1       3            0      immediate  0           yes          no
  acme-plan-upgrade              billing-aside       D9_out_of_scope         0       2            0      immediate  0           yes          yes
  acme-plan-upgrade              billing-aside       D9_out_of_scope         1       2            0      immediate  0           yes          yes
  acme-plan-upgrade              loose-ok            D4_loose_confirmation   0       3            0      immediate  0           yes          no
  acme-plan-upgrade              loose-ok            D4_loose_confirmation   1       3            0      immediate  0           yes          no
  acme-tool-failure              sales-queue-down    D8_tool_failure         0       1            0      immediate  0           yes          no
  acme-tool-failure              sales-queue-down    D8_tool_failure         1       1            0      immediate  0           yes          no
```

The deterministic Acme agent passes every block in every mode, so its compounding index is 0 on every spec and every perturbed run recovers at once. [Run modes](concepts/run-modes.md#the-compounding-index) shows the same tables for an agent that drifts.

## `driftbench campaign resume`

```
driftbench campaign resume [campaignId] --store <file> [--no-cache] [--concurrency <n>] [--budget-usd <usd>] [--process-command <command>] [--retry-attempts <n>] [--retry-base-ms <ms>] [--retry-max-ms <ms>] [--json]
```

Runs the cells of a stored campaign that have no completed run, and reuses the others. The specs come from the store, at the hashes the campaign pins, and each cell runs on the target the campaign pinned for it. A failed or stopped cell runs again, and its new run replaces the old one under the same run id.

A campaign keeps its targets, not the commands behind them: a campaign run with `--process-command` is resumed with the same `--process-command`.

```
$ pnpm -s driftbench campaign resume c-3e6aff180724 --store acme.db
Campaign c-3e6aff180724: 12 cells, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, exact, injection, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
Not judged: 8 criteria in 16 blocks of 6 specs (one_question_per_turn, coverage_before_offer, checks_before_promising, resumes_pending_step, ledger_intact, and 3 more), 6 of them gating. This campaign loads no judge, so these criteria have no verdict and count in no pass or fail. See docs/concepts/judges.md.
✓ acme-new-customer-coverage · function:acme · F · repeat 0  pass (reused)  4 blocks
✓ acme-new-customer-coverage · function:acme · F · repeat 1  pass (reused)  4 blocks
✓ acme-number-porting · function:acme · F · repeat 0  pass (reused)  5 blocks
✓ acme-number-porting · function:acme · F · repeat 1  pass (reused)  5 blocks
✓ acme-off-topic-return · function:acme · F · repeat 0  pass (reused)  5 blocks
✓ acme-off-topic-return · function:acme · F · repeat 1  pass (reused)  5 blocks
✓ acme-order-loose-confirmation · function:acme · F · repeat 0  pass (reused)  4 blocks
✓ acme-order-loose-confirmation · function:acme · F · repeat 1  pass (reused)  4 blocks
✓ acme-plan-upgrade · function:acme · F · repeat 0  pass (reused)  5 blocks
✓ acme-plan-upgrade · function:acme · F · repeat 1  pass (reused)  5 blocks
✓ acme-tool-failure · function:acme · F · repeat 0  pass (reused)  3 blocks
✓ acme-tool-failure · function:acme · F · repeat 1  pass (reused)  3 blocks
12 cells: 12 pass, 0 fail, 0 failed, 12 reused. Spent $0.00.
```

`--store` is required. `--no-cache`, `--concurrency`, `--budget-usd` and `--json` work as for `run`; without `--budget-usd`, `resume` keeps the budget the campaign was run with.

## `driftbench smoke`

```
driftbench smoke <spec> [--target <adapter[:agent]>] [--runs <n>] [--json]
```

The determinism check. It runs one spec several times in mode F with the cache off and no checks, and compares the transcripts block by block against the first run.

```
$ pnpm -s driftbench smoke examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme
Smoke: acme-plan-upgrade on function:acme, 3 runs, cache off.
  run 1  completed  5 blocks  transcript 9ec7c3e69cd4
  run 2  completed  5 blocks  transcript 9ec7c3e69cd4
  run 3  completed  5 blocks  transcript 9ec7c3e69cd4
✓ The transcripts are identical.
```

A transcript holds what the agent did in each block: the segments, the tool calls, the runtime trace, the commands with their exit codes, the artifacts and the workspace diff. It leaves out what may vary between two identical runs: cost, latency, timestamps and the raw trace. Its hash is the first 12 hex characters of the SHA-256 of its canonical JSON. When two transcripts differ, the command names the first run and the first block that differ, and says whether the adapter claims to be deterministic.

| Option | Effect |
|---|---|
| `--target <adapter[:agent]>` | the target to run on. Without it, the spec's own target. |
| `--runs <n>` | how many runs to compare, at least 2. Default 3. |
| `--json` | print one JSON document: `specId`, `target`, `runs`, `deterministicClaim`, `identical`, `hashes` and `firstDifference` when they differ |

## Project config and the pull-request gate

`driftbench.yaml` in the working folder, or the file `--config <file>` names, is the project config. `report`, `ci` and `view` read it. It has two keys, both optional:

| Key | Read by | Holds |
|---|---|---|
| `aggregates` | `report`, `ci` | the campaign-level criteria, one `name:op threshold` string each |
| `scales` | `view` | per criterion, the `min` and `max` of the score a reviewer may give its queue item, with `min` below `max`. A criterion without one keeps 0 to 1 |



```text
aggregates:
  - pass-rate:>=0.8
  - broken-share:<=0.2
scales:
  holds_instructions: { min: 1, max: 5 }
```

Each entry is one `name:op threshold` string, the same syntax as `--aggregate`. A flag with the same name replaces the file's entry, and a flag with a new name adds to it. Any other key, or a bad entry, exits 2 and names the line. The file is optional: without it, only the flags count. See [campaign-level criteria](aggregates.md).

To gate a pull request, `driftbench ci` runs as a GitHub Action: [action/action.yml](../action/action.yml) takes the specs, the target, the baseline and the `aggregate` input, and fails the job unless the verdict is parity. Its `process-command` input passes `--process-command`, so the action gates your own process agent. A workflow that uses it is in [examples/acme/ci/driftbench-ci.yml](../examples/acme/ci/driftbench-ci.yml).

## Run events

The runner reports each run as it happens through the `onEvent` option: a block starting, each model call the adapter reported (its input and output tokens, its cost in USD when the adapter gives one, and its latency; the call began latencyMs before the event), each tool call the adapter recorded, each retry a block took, a block ending with its verdict, and the run ending. `eventLogSink(path)` appends each event to a JSON-lines file synchronously, so a run killed mid-way keeps every event written before the kill; `readEventLog(path)` reads them back and skips a line cut short by the kill.

A run resumes from its first unfinished block. Blocks the cache holds are read back, and the first block it does not hold goes to the adapter, which opens a session from the history so far; no later cached block is read back, because the live session carries the run from there. A run that was killed mid-way and resumed gives the same verdicts as an uninterrupted run when the adapter keeps no state between blocks. For an adapter with state (an agent that stores what it did, such as a record it wrote), the state of the finished blocks is not recreated: the resumed run then reflects the adapter as it is at the resume, not as it was at the kill.

## Exit codes

| Command | 0 | 1 | 2 |
|---|---|---|---|
| `campaign plan` | the plan printed | | bad input |
| `campaign run`, `campaign resume` | every cell passes | a cell fails, failed, or was stopped, the budget included | bad input |
| `campaign status` | every cell passes | any other state | bad input, an unknown campaign, or a store with no campaign |
| `smoke` | the transcripts are identical and every run completed | the transcripts differ, or a run did not complete | bad input |

Bad input is an unknown or malformed target, a target no adapter is set up for, a spec with no target when no `--target` is given, an invalid spec or none found, an unknown mode, a bad number for an option, an existing campaign id on `run`, or a store that cannot be opened. `smoke` takes exactly one spec.

```
$ pnpm -s driftbench campaign plan examples/acme/specs --mode X
Unknown mode "X". The modes are T, F and P, alone or separated by commas.
```

## Campaigns

A campaign pins the specs by id and content hash, the target of each spec run on its own target, the targets, the modes, the repeats and the budget. It is created once; a run again is a new campaign, and `resume` completes the same one.

### Cells

`planCampaign` expands specs, targets, modes and repeats into cells. In mode P a spec gives one cell per perturbation and repeat. A cell sends the spec's blocks, plus the injected block in mode P, except for a perturbation that writes only a world: it runs under its own block, so the cell sends the spec's blocks alone (`order-service-down` and `sales-queue-down` above).

A cell's id is also the run id of its run: the first 16 hex characters of the SHA-256 of the canonical JSON of the spec hash, the target, the mode, the repeat and the perturbation. The campaign plays no part, so the same cell in two campaigns has the same id: `acme-plan-upgrade` in mode F at repeat 0 on `function:acme` is `58ec431a6e09bf0b` in every Acme campaign above.

### Outcomes

Each cell ends in one state:

| State | Mark | When |
|---|---|---|
| `pass` | `✓` | the run completed, it has blocks, every block passed, and the end state matched |
| `fail` | `✗` | the run completed, and a block failed or the end state differs |
| `failed` | `!` | the run ended with an error |
| `stopped` | `!` | the run stopped: the driver did not stop in time, or the budget stopped the cell before it started |
| `pending` | `·` | the cell has no run yet, in `status` |

A cell's line notes `reused` when a completed run of the cell was already in the store, and `replayed from the cache` when its run came from the cache. The summary line counts each state, the cells the budget stopped, the reused cells, and the money spent by the runs of this command.

### The worker pool

`runCampaign` runs the cells on a pool of workers, 4 by default and never more than the cells. Each worker takes the next cell: the T and F cells in cell order first, then the P cells. A P cell waits for the F run it takes as its reference when that run is still in flight. A cell whose completed run is already in the store is reused without running. Each run is filed in the store as it finishes, so a crash loses no finished run. The outcomes, and the lines the command prints, come in cell order: a cell is reported once it and every cell before it have an outcome. When running a cell throws, no new cell starts, and the error is raised once the cells in flight finish.

`runCampaign` passes the artifact readers it is given to every run; the command line gives it the readers of `@agent-nexus/driftbench-artifacts`.

### The budget

`--budget-usd` is a hard stop on spend, in US dollars, over the whole campaign. The spend is the cost of the campaign's runs already in the store, plus the runs finished in this command. A run replayed from the cache costs nothing. A worker checks the budget when it takes a cell: once the spend has reached the budget, the cell is stopped and never starts. Cells already in flight finish, so the spend can pass the budget by the cost of those cells.

The campaign record stores a budget of 0 when none was given. `resume` reads a stored 0 as no budget.

```
$ pnpm -s driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme --repeats 2 --budget-usd 0
Campaign c-7572a9cb7069: 2 cells, 4 at a time. Budget $0.00. Checks: tools, tools_offered, forbidden, must, must_not, exact, injection, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
Not judged: 2 criteria in 3 blocks of 1 spec (one_question_per_turn, no_invented_data), 1 of them gating. This campaign loads no judge, so these criteria have no verdict and count in no pass or fail. See docs/concepts/judges.md.
! acme-plan-upgrade · function:acme · F · repeat 0  stopped  not started: the campaign spent $0.00 of its $0.00 budget
! acme-plan-upgrade · function:acme · F · repeat 1  stopped  not started: the campaign spent $0.00 of its $0.00 budget
2 cells: 0 pass, 0 fail, 0 failed, 2 stopped by the budget. Spent $0.00.
The runs are not kept: pass --store <file> to keep them.
```

That command exits 1.

### The minimum detectable effect

`campaign plan` prints the smallest drop in pass rate that a comparison of two arms can detect, as `mde` of the statistics library solves it: the two-proportion power equation at a two-sided alpha of 0.05 and a power of 0.8, with the specs as the independent units and the repeats of one spec counted through the design effect.

```
design effect = 1 + (repeats - 1) * rho
effective units per arm = specs * repeats / design effect
```

`--baseline-rate` is the baseline pass rate (default 0.5) and `--rho` the correlation of repeats of one spec, as `icc` measures it (default 0, which counts repeats as independent and so is optimistic). The line names the runs per arm, the specs, `rho` and the design effect. When each spec runs on its own target, one arm is every spec on its first target. At six specs of five repeats, a 90% baseline and `--rho 0.3`, the design effect is 2.2. When the campaign is too small to detect any drop below the baseline, the line reads `none detectable`. See [statistics](concepts/statistics.md).

### The store

`@agent-nexus/driftbench-store` keeps specs, campaigns, runs with their blocks, the cache and measured cost units in one SQLite file; `--store <file>` opens or creates it. It lists its campaigns newest first, which is how `status` and `resume` find the latest. `exportCampaign(campaignId, dir)` and `campaign export <campaignId> --store <file> --out <dir>` write a bundle with the campaign, its runs, specs and recorded dataset and prompt versions. `campaign import <folder> --store <file>` checks the hashes and imports the bundle all or nothing. Cost units are recorded through the store's `putUnit`; nothing records them during a run yet, so a projection prices only the units put there.

## `runSpec`

`runSpec(spec, options)` of `@agent-nexus/driftbench-core` runs one spec, once, and returns its run record. The command line calls it for every cell. From code it reaches any adapter:

```ts
import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import { loadSpecFile, runSpec } from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { createAcmeAgent, createStore } from './examples/acme/src/index';

const adapter = functionAdapter({
  create: () => {
    const store = createStore();
    return { store, agent: createAcmeAgent(store) };
  },
  respond: (messages, world, _vars, session) => session.agent.respond(messages, world),
  payloads: (session) => session.store.payloads,
  deterministic: true,
});

const loaded = await loadSpecFile('examples/acme/specs/conversations/plan-upgrade.yaml');
if (!loaded.ok) throw new Error('the spec is invalid');

const run = await runSpec(loaded.spec, {
  adapter,
  driver: createScriptedDriver(),
  checks: defaultChecks(),
  mode: 'F',
  repeat: 0,
});
console.log(run.runId, run.status, run.blocks.map((block) => block.pass), run.endState?.match);
```

Run from the repository root, it prints:

```
b723bb610e39ceaa completed [ true, true, true, true, true ] true
```

With `mode: 'T'`, it prints:

```
1694052eb6539717 completed [ true, true, true, true, true ] true
```

| Option | Meaning |
|---|---|
| `adapter` | the adapter that reaches the agent |
| `driver` | decides each block's stimulus. `createScriptedDriver()` of `@agent-nexus/driftbench-users` replays the spec's blocks in order and stops after the last. `createPerturbingDriver({ spec, perturbation })` of `@agent-nexus/driftbench-users` injects one deviation into the scripted steps (the CLI's P cells); `injectingDriver(base, perturbationId)` of `@agent-nexus/driftbench-core` adds one of the spec's perturbations to the steps of `base`. |
| `checks` | applied to every block, in order, such as `defaultChecks()` |
| `mode` | `T`, `F` or `P`. T runs every block from its canonical Given in a session of its own; F runs one session; P is F with the blocks a driver injects. See [run modes](concepts/run-modes.md). |
| `repeat` | the repeat number, part of the run id and of the cache key |
| `target` | overrides the spec's target. With neither, the target is `{ adapter: <the adapter's id> }`. |
| `perturbationId` | the perturbation the run injects, recorded on the run |
| `reference` | mode P: the free-running run of the same spec and target, for the collateral of the recovery |
| `consequential` | mode P: a test that names more tools whose call is a consequential act, for the safe action and the clarification |
| `store`, `campaignId` | where the finished run is filed. A store needs a campaign id, and the campaign must be in the store. |
| `cache`, `cacheTtlMs` | where observed blocks and end-state reads are kept, and for how long. Without a cache, every block reaches the adapter. |
| `artifacts` | the readers the artifact checks use, such as `defaultReaders()` of `@agent-nexus/driftbench-artifacts` |
| `retry` | the run's [retry settings](retries.md), over the spec target's `retry`: `maxAttempts` (or `retries`, attempts minus one), `baseDelayMs`, `maxDelayMs`, `jitter`, `retryAfter`, and `sleep` and `random` for tests. Defaults: 4 attempts, 500 ms, 30000 ms, jitter on, Retry-After honoured. |
| `now` | the clock |
| `runId` | default: the cell id |
| `maxSteps` | a guard against a driver that never stops. Default 4 steps per spec block, at least 16. |

### One block

For each step the driver gives, the runner:

1. resolves the block's Given. In mode T it closes the open session and starts from the block's canonical Given; on an adapter with a sandbox it keeps the session, so the block starts from the workspace the block before left, and replaces the history with the canonical prefix, unless the block writes its own `given.world.workspace`; a step the driver injects fails the run;
2. appends the block's user messages to the session history, and sends the block through the adapter, opening a session first when none is open;
3. reads the block again through `trace` when the adapter offers it, and keeps that read;
4. checks the Observed as JSON against the schema, the form the cache and the store keep, and appends the agent's reply to the history;
5. adds the block's `ledger_add` facts to the ledger;
6. after the last spec block, reads the end state; in mode T, after every block;
7. applies every check. In mode T the checks see no earlier block;
8. reads the stage the block reached and adds the flow verdicts of the [stage classifier](concepts/drift.md#the-stage-classifier), then the verdicts of the [ledger check](concepts/drift.md#the-ledger-check);
9. records the block, with its drift classes.

A block passes when every gating verdict passes, the flow and ledger verdicts included.

### Given resolution and the hash

The run starts from the spec's `given`: its ledger, world and vars. A block's own `given` merges into them from that block on: tools, store keys, fixtures, variables and facts by name, the later value winning, and a later workspace replacing the earlier one whole. The world of an injected perturbation merges the same way.

A block's `given.prefix` ends the open session: the next send opens a new one, whose history is that prefix.

In mode T every block opens its own session from its canonical Given: the ledger, world and vars the spec writes up to that block, and a prefix of the earlier blocks as the spec writes them. On an adapter with a sandbox, a block that writes no `given.world.workspace` of its own keeps the session of the block before, with the canonical prefix as its history, so a task step finds the files the step before made. See [run modes](concepts/run-modes.md#teacher-forced).

The resolved Given of a block holds the prefix (the run's history before the block), the ledger, the world, the vars and the target, and `hash`: the first 12 hex characters of the SHA-256 of the canonical JSON of those five. The block record keeps it as `givenHash`. See [Given, When, Then](concepts/given-when-then.md).

### The history

The runner owns the session history. Before a send it appends the stimulus's user messages: one for `user`, one per message of a `burst`, the injected message for an injection. After the send it appends the agent's reply: the text, and each tool call with its input and its output or error. The history before a block is the prefix of that block's Given, so in modes F and P the agent's own earlier replies carry into every later block. In mode T the history is the canonical prefix, never the agent's own replies.

### End state

The runner reads the sources the spec's `end_state` names, each once, through the adapter's `endState`: each mapping's `source`, or `*` for `end_state: none`. It reads them after the last spec block, and the checks of that block see the result: the value a mapping's source returned, a record keyed by source for a list, the list of every payload for `none`. In mode T it reads them after every block and composes them: a source keeps the last value a block's session recorded, and `*` joins the lists.

Every run of a spec that names an end state carries `endState` in its record, failed and stopped runs too: `match`, and a `diff` with one entry per field that does not hold. The runner uses the read taken after the last spec block when no block ran after it, and reads again at the end of the run otherwise.

| Case | Diff entries |
|---|---|
| a field that does not hold | `{ field, expected: <assertion>, observed: <value> }`; in a list the field is named `<source>.<field>` |
| a source that recorded nothing, or a state that is not a mapping | one entry per expected field, observed `{ absent: true }`, absent assertions included |
| an empty `expect` and nothing recorded | `{ field: <source>, expected: { nonempty: true }, observed: { absent: true } }` |
| exact mode, a field the spec does not list | `{ field, expected: { absent: true }, observed: <value> }` |
| `none`, with payloads recorded | one entry per payload, field `*.<index>`, expected `{ absent: true }` |
| a read that cannot happen: no block ran, the adapter reads no end state, or the read failed | one entry per source, saying why; `match` is false |

An absent value is always written `{ absent: true }`: undefined does not survive JSON, and the stored run keeps the key. In mode P the spec's end state describes the unperturbed run, so it is neither read nor compared.

### Drift

The runner gives every block its drift classes from the gating verdicts it fails, by the family of each verdict id (the text before the first dot): `ledger` gives `X2_contradiction`, `stage` and `flow` give `X3_flow`, and so on for all five classes. The full map is on the [drift](concepts/drift.md#how-a-class-is-assigned) page. A custom check never takes a class by its name, and a block that fails only non-gating or inconclusive verdicts carries none.

### Status, errors and retries

A run ends `completed`, `failed` or `stopped`.

* An `AdapterTransportError` with a 408, a 429, a 5xx or no status (a network failure) is retried under the [shared retry policy](retries.md): 4 attempts by default, a backoff from 500 ms with full jitter, at least the server's Retry-After. Each retry is recorded in the block's Observed as `retries`. Past the attempts, or on one marked `exhausted` by the adapter, the run fails.
* An `AgentFailure`, an Observed that does not match the schema as JSON, or any other error fails the run at once.
* A driver that does not stop within `maxSteps` steps stops the run.

The record keeps the blocks that ran, the error, and a note when a session could not be closed or a block could not be cached. The session is always closed.

### The cache and replay

The cache key of a block is the SHA-256 of the canonical JSON of the spec hash, the repeat, the block's position in the run, its whole resolved Given (the history so far included), its stimulus, the target, and the adapter's id and version. An end-state read is cached under the key of the block it follows and its source. The spec's `version` is a free label and plays no part.

With a cache, the runner first replays the run from it. Any block or end-state read the cache misses sends the whole run to the adapter instead, and every block it observes goes into the cache. A replayed run has `cacheHit: true` and costs nothing against a budget. A run on an adapter that makes sandboxes is neither replayed nor cached: a replay has no workspace to read files from, so its artifact checks could not open them.

On the command line the store is the cache. A second campaign over the same specs and store replays every run:

```
$ pnpm -s driftbench campaign run examples/acme/specs/conversations --target function:acme --repeats 2 --store acme.db
Campaign c-868fb474970f: 12 cells, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, exact, injection, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
Not judged: 8 criteria in 16 blocks of 6 specs (one_question_per_turn, coverage_before_offer, checks_before_promising, resumes_pending_step, ledger_intact, and 3 more), 6 of them gating. This campaign loads no judge, so these criteria have no verdict and count in no pass or fail. See docs/concepts/judges.md.
✓ acme-new-customer-coverage · function:acme · F · repeat 0  pass (replayed from the cache)  4 blocks
✓ acme-new-customer-coverage · function:acme · F · repeat 1  pass (replayed from the cache)  4 blocks
✓ acme-number-porting · function:acme · F · repeat 0  pass (replayed from the cache)  5 blocks
✓ acme-number-porting · function:acme · F · repeat 1  pass (replayed from the cache)  5 blocks
✓ acme-off-topic-return · function:acme · F · repeat 0  pass (replayed from the cache)  5 blocks
✓ acme-off-topic-return · function:acme · F · repeat 1  pass (replayed from the cache)  5 blocks
✓ acme-order-loose-confirmation · function:acme · F · repeat 0  pass (replayed from the cache)  4 blocks
✓ acme-order-loose-confirmation · function:acme · F · repeat 1  pass (replayed from the cache)  4 blocks
✓ acme-plan-upgrade · function:acme · F · repeat 0  pass (replayed from the cache)  5 blocks
✓ acme-plan-upgrade · function:acme · F · repeat 1  pass (replayed from the cache)  5 blocks
✓ acme-tool-failure · function:acme · F · repeat 0  pass (replayed from the cache)  3 blocks
✓ acme-tool-failure · function:acme · F · repeat 1  pass (replayed from the cache)  3 blocks
12 cells: 12 pass, 0 fail, 0 failed. Spent $0.00.
```

`--no-cache` turns the cache off for one command, and `smoke` never uses it.

### The run record

The runner returns the run as the store keeps it: written as JSON, read back and validated against the `RunResult` schema in `packages/core/src/schema/run.ts`.

* The run: `runId`, `specId`, `specHash`, `target`, `mode`, `repeat`, `perturbationId`, `status`, `error`, `blocks`, `succession`, `recovery`, `endState`, `cost`, `latencyMs`, `startedAt`, `finishedAt` and `cacheHit`, and `carried` on a run a radius campaign copied from an earlier campaign (see [blast radius](concepts/blast-radius.md#fresh-and-carried)). `cost` sums the blocks' costs: each block's total, or else the sum of its segments' costs.
* Each block: `index`, its position in the run, injected blocks included; `blockId`; `injected`; `givenHash`; `observed`; `verdicts`; `stageObserved`, the stage the block reached (the runtime's report in this block, else in F and P the last one an earlier block reported, else the stage classifier's); `ledgerCheck`; `drift`; `pass`.
* `succession`: `firstDriftBlock`, `driftCount`, `driftRate`, `longestClean` and `minOverBlocks`, over the blocks of the run. A failing block is a drift block. See [drift](concepts/drift.md).
* `recovery`, on a P run whose perturbation writes `recovery`: `injectedAt`, `turnsToRecover`, `label`, `collateral`, `safeAction` and `clarified`. See [recovery](concepts/recovery.md#recovery-metrics).

`ledgerCheck` lists the contradictions the ledger check found in the block, and the facts a block's `ledger_add` gives a value other than the one the ledger already holds. The ledger check's verdicts decide whether the block passes; a `ledger_add` that changes a fact does not.
