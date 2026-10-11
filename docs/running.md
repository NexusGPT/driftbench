# Running

The runner runs a spec through an adapter, block by block, applies every check to each block, and records the run. A campaign runs many specs on many targets, with repeats, and keeps every run in a store.

Built in phase 1: free-running mode (F), the scripted driver that replays a spec's blocks, campaigns, the cache, and the determinism smoke test. Teacher-forced mode (T) is planned, phase 3, and so are the drivers that simulate a user or inject a deviation; `runSpec` already takes mode P and the injected blocks such a driver hands it. See [run modes](concepts/run-modes.md).

## From the command line

`driftbench campaign plan`, `campaign run`, `campaign status`, `campaign resume` and `smoke` run specs. The command line reaches one target today: `function:acme`, the Acme Telecom example agent ([`examples/acme`](../examples/acme/README.md)) behind the [function adapter](adapters/function.md). It applies `defaultChecks()`, the 18 machine checks of the [checks](reference/checks.md) page. Other adapters are used from code: see [runSpec](#runspec).

A target is written `<adapter>` or `<adapter>:<agent>`. It overrides the target a spec names, and `plan` and `run` print a note for each spec whose own target names another adapter.

The examples below run from the repository root. `pnpm -s` keeps pnpm's own lines out of the output.

## `driftbench campaign plan`

```
driftbench campaign plan <paths...> --target <adapter[:agent]> [--mode F] [--repeats <n>] [--budget-usd <usd>] [--baseline-rate <rate>] [--store <file>] [--json]
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
Minimum detectable effect, mode F: 57.2 points on a 50% pass rate, with 12 runs per arm (two-sided alpha 0.05, power 0.8).
```

| Option | Effect |
|---|---|
| `--target <adapter[:agent]>` | a target to run on; repeat it for several. At least one is required. |
| `--mode <mode>` | the run mode. `F`, the default, is the only one today; `T` and `P` are refused. |
| `--repeats <n>` | runs per spec, target and mode, at least 1. Default 1. |
| `--budget-usd <usd>` | compare the projected cost with this budget |
| `--baseline-rate <rate>` | the pass rate the minimum detectable effect assumes, between 0 and 1. Default 0.5. |
| `--store <file>` | read the measured unit costs from this store |
| `--json` | print one JSON document: `cells`, `blocks`, `cost` (`usd`, `unmeasured`, `byAdapter`), `budgetUsd` and `withinBudget` when a budget is given, and `mde` |

The projected cost of an adapter is its blocks times the latest cost per block measured for it, from the store's cost units. An adapter with no measured unit costs nothing in the projection and is named. Judge calls are not priced yet: they come with the judges, phase 2.

## `driftbench campaign run`

```
driftbench campaign run <paths...> --target <adapter[:agent]> [--mode F] [--repeats <n>] [--campaign <id>] [--store <file>] [--no-cache] [--concurrency <n>] [--budget-usd <usd>] [--json]
```

Creates a campaign over the specs, runs every cell and prints one line per cell, in cell order.

```
$ pnpm -s driftbench campaign run examples/acme/specs/conversations --target function:acme --repeats 2 --store acme.db
Campaign c-5bc409c9a4ca: 12 cells, 4 at a time. Checks: tools, forbidden, must, must_not, lang, pii, cards, stage, skills, guards, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
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
Campaign c-807abe1666e6: 1 cell, 4 at a time. Checks: tools, forbidden, must, must_not, lang, pii, cards, stage, skills, guards, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
✗ acme-price-sheet · function:acme · F · repeat 0  fail  block 0 must.0, block 0 stage.reached, block 0 skills.xlsx, block 0 guards.no_destructive_ops.pass, block 0 execution.ran_code, block 0 execution.exit_code, block 0 execution.max_commands, block 0 workspace.created, block 0 workspace.changed, block 0 workspace.deleted, block 0 workspace.others_untouched, block 0 artifacts.out/acme-price-sheet.xlsx, block 1 stage.reached, block 1 skills.xlsx, block 1 guards.no_destructive_ops.pass, block 1 execution.ran_code, block 1 execution.exit_code, block 1 workspace.created, block 1 workspace.changed, block 1 workspace.deleted, block 1 workspace.others_untouched, block 1 artifacts.out/acme-price-sheet.xlsx
1 cell: 0 pass, 1 fail, 0 failed. Spent $0.00.
The runs are not kept: pass --store <file> to keep them.
```

That command exits 1. The execution and workspace verdicts are inconclusive and gating there: the chat agent reports no executions list and no workspace diff, so the block cannot pass on them. Its runtime reports stages only, so the skill and guard verdicts fail.

| Option | Effect |
|---|---|
| `--target`, `--mode`, `--repeats` | as for `plan` |
| `--campaign <id>` | the campaign id. Without it, the id is `c-` and a hash of the specs, the targets, the mode, the repeats and the creation time. An id the store already holds is refused. |
| `--store <file>` | keep the campaign, its specs, its runs and the cache in this SQLite file. Without it, the store lives in memory and the runs are gone when the command ends. |
| `--no-cache` | neither replay runs from the cache nor write to it |
| `--concurrency <n>` | cells that run at the same time, at least 1. Default 4. |
| `--budget-usd <usd>` | a hard stop on the campaign's spend. See [the budget](#the-budget). |
| `--json` | print one JSON document: `campaignId`, `stored`, `checks`, `cells` (each with its state, its failing list and its run id) and `summary` |

The store needs Node.js 22.13 or newer, for `node:sqlite`.

## `driftbench campaign status`

```
driftbench campaign status [campaignId] --store <file> [--json]
```

Prints the state of every cell of a stored campaign, in cell order, from the runs in the store.

```
$ pnpm -s driftbench campaign status c-5bc409c9a4ca --store acme.db
Campaign c-5bc409c9a4ca, created 2026-10-11T17:32:24.784Z.
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

Without a campaign id, `status` and `resume` take the latest campaign when the store can list its campaigns. The SQLite store cannot yet, so both commands need the id that `campaign run` prints:

```
$ pnpm -s driftbench campaign status --store acme.db
Name the campaign: driftbench campaign status <campaignId> --store acme.db. campaign run prints the id; this store cannot list its campaigns.
```

That command exits 2.

## `driftbench campaign resume`

```
driftbench campaign resume [campaignId] --store <file> [--no-cache] [--concurrency <n>] [--budget-usd <usd>] [--json]
```

Runs the cells of a stored campaign that have no completed run, and reuses the others. The specs come from the store, at the hashes the campaign pins. A failed or stopped cell runs again, and its new run replaces the old one under the same run id.

```
$ pnpm -s driftbench campaign resume c-5bc409c9a4ca --store acme.db
Campaign c-5bc409c9a4ca: 12 cells, 4 at a time. Checks: tools, forbidden, must, must_not, lang, pii, cards, stage, skills, guards, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
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
driftbench smoke <spec> --target <adapter[:agent]> [--runs <n>] [--json]
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
| `--target <adapter[:agent]>` | the target to run on; required |
| `--runs <n>` | how many runs to compare, at least 2. Default 3. |
| `--json` | print one JSON document: `specId`, `target`, `runs`, `deterministicClaim`, `identical`, `hashes` and `firstDifference` when they differ |

## Exit codes

| Command | 0 | 1 | 2 |
|---|---|---|---|
| `campaign plan` | the plan printed | | bad input |
| `campaign run`, `campaign resume` | every cell passes | a cell fails, failed, or was stopped, the budget included | bad input |
| `campaign status` | every cell passes | any other state | bad input, an unknown campaign, or no campaign id where the store cannot list campaigns |
| `smoke` | the transcripts are identical and every run completed | the transcripts differ, or a run did not complete | bad input |

Bad input is an unknown or malformed target, a target no adapter is set up for, an invalid spec or none found, a mode other than F, a bad number for an option, an existing campaign id on `run`, or a store that cannot be opened. `smoke` takes exactly one spec.

## Campaigns

A campaign pins the specs by id and content hash, the targets, the modes, the repeats and the budget. It is created once; a run again is a new campaign, and `resume` completes the same one.

### Cells

`planCampaign` expands specs, targets, modes and repeats into cells. In mode P a spec gives one cell per perturbation and repeat. A cell sends the spec's blocks, plus the injected block in mode P.

A cell's id is also the run id of its run: the first 16 hex characters of the SHA-256 of the canonical JSON of the spec hash, the target, the mode, the repeat and the perturbation. The campaign plays no part, so the same cell in two campaigns has the same id: `acme-plan-upgrade` at repeat 0 is `58ec431a6e09bf0b` in every Acme campaign above.

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

`runCampaign` runs the cells on a pool of workers, 4 by default and never more than the cells. Each worker takes the next cell in order. A cell whose completed run is already in the store is reused without running. Each run is filed in the store as it finishes, so a crash loses no finished run. The outcomes, and the lines the command prints, come in cell order: a cell is reported once it and every cell before it have an outcome. When running a cell throws, no new cell starts, and the error is raised once the cells in flight finish.

`runCampaign` passes no artifact readers to the runner yet, so the artifact checks of a campaign cannot open files.

### The budget

`--budget-usd` is a hard stop on spend, in US dollars, over the whole campaign. The spend is the cost of the campaign's runs already in the store, plus the runs finished in this command. A run replayed from the cache costs nothing. A worker checks the budget when it takes a cell: once the spend has reached the budget, the cell is stopped and never starts. Cells already in flight finish, so the spend can pass the budget by the cost of those cells.

The campaign record stores a budget of 0 when none was given. `resume` reads a stored 0 as no budget.

```
$ pnpm -s driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme --repeats 2 --budget-usd 0
Campaign c-7f6a58cc993e: 2 cells, 4 at a time. Budget $0.00. Checks: tools, forbidden, must, must_not, lang, pii, cards, stage, skills, guards, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
! acme-plan-upgrade · function:acme · F · repeat 0  stopped  not started: the campaign spent $0.00 of its $0.00 budget
! acme-plan-upgrade · function:acme · F · repeat 1  stopped  not started: the campaign spent $0.00 of its $0.00 budget
2 cells: 0 pass, 0 fail, 0 failed, 2 stopped by the budget. Spent $0.00.
The runs are not kept: pass --store <file> to keep them.
```

That command exits 1.

### The minimum detectable effect

`campaign plan` prints the smallest drop in pass rate that a comparison of two arms can detect, by the two-proportion normal approximation:

```
effect = (z(0.975) + z(0.8)) * sqrt(2 * p * (1 - p) / n)
```

`p` is the baseline pass rate (`--baseline-rate`, default 0.5) and `n` the runs per arm: the cells of the mode on the first target. `z(0.975)` and `z(0.8)` are the standard normal quantiles for a two-sided alpha of 0.05 and a power of 0.8. The formula treats runs as independent, so repeats of one spec count as separate runs. With 12 runs per arm at a 50% pass rate, the effect is 57.2 points, as the plan above prints. The clustered version, with one conversation as one cluster, is planned, phase 4. See [statistics](concepts/statistics.md).

### The store

`@driftbench/store` keeps specs, campaigns, runs with their blocks, the cache and measured cost units in one SQLite file; `--store <file>` opens or creates it. `exportCampaign(campaignId, dir)` writes one campaign as a versioned JSON bundle: `campaign.json`, one `runs/<runId>.json` per run, and `manifest.json`, written last. No command exports a campaign yet. Cost units are recorded through the store's `putUnit`; nothing records them during a run yet, so a projection prices only the units put there.

## `runSpec`

`runSpec(spec, options)` of `@driftbench/core` runs one spec, once, and returns its run record. The command line calls it for every cell. From code it reaches any adapter:

```ts
import { functionAdapter } from '@driftbench/adapters';
import { defaultChecks } from '@driftbench/checks';
import { loadSpecFile, runSpec } from '@driftbench/core';
import { createScriptedDriver } from '@driftbench/users';
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

| Option | Meaning |
|---|---|
| `adapter` | the adapter that reaches the agent |
| `driver` | decides each block's stimulus. `createScriptedDriver()` of `@driftbench/users` replays the spec's blocks in order and stops after the last. |
| `checks` | applied to every block, in order, such as `defaultChecks()` |
| `mode` | `F`, or `P` for a driver that injects blocks. `T` throws: teacher-forced mode is planned, phase 3. |
| `repeat` | the repeat number, part of the run id and of the cache key |
| `target` | overrides the spec's target. With neither, the target is `{ adapter: <the adapter's id> }`. |
| `perturbationId` | the perturbation the run injects, recorded on the run |
| `store`, `campaignId` | where the finished run is filed. A store needs a campaign id, and the campaign must be in the store. |
| `cache`, `cacheTtlMs` | where observed blocks and end-state reads are kept, and for how long. Without a cache, every block reaches the adapter. |
| `artifacts` | the readers the artifact checks use, such as `defaultReaders()` of `@driftbench/artifacts` |
| `retry` | `retries` (default 3) and `baseDelayMs` (default 200) for transport errors |
| `now` | the clock |
| `runId` | default: the cell id |
| `maxSteps` | a guard against a driver that never stops. Default 4 steps per spec block, at least 16. |

### One block

For each step the driver gives, the runner:

1. resolves the block's Given;
2. appends the block's user messages to the session history, and sends the block through the adapter, opening a session first when none is open;
3. reads the block again through `trace` when the adapter offers it, and keeps that read;
4. checks the Observed as JSON against the schema, the form the cache and the store keep, and appends the agent's reply to the history;
5. adds the block's `ledger_add` facts to the ledger;
6. after the last spec block, reads the end state;
7. applies every check and records the block.

A block passes when every gating verdict passes. Judged criteria give no verdict until the judges ship, phase 2.

### Given resolution and the hash

The run starts from the spec's `given`: its ledger, world and vars. A block's own `given` merges into them from that block on: tools, store keys, fixtures, variables and facts by name, the later value winning, and a later workspace replacing the earlier one whole. The world of an injected perturbation merges the same way.

A block's `given.prefix` ends the open session: the next send opens a new one, whose history is that prefix.

The resolved Given of a block holds the prefix (the run's history before the block), the ledger, the world, the vars and the target, and `hash`: the first 12 hex characters of the SHA-256 of the canonical JSON of those five. The block record keeps it as `givenHash`. See [Given, When, Then](concepts/given-when-then.md).

### The history

The runner owns the session history. Before a send it appends the stimulus's user messages: one for `user`, one per message of a `burst`, the injected message for an injection. After the send it appends the agent's reply: the text, and each tool call with its input and its output or error. The history before a block is the prefix of that block's Given, so the agent's own earlier replies carry into every later block.

### End state

The runner reads the sources the spec's `end_state` names, each once, through the adapter's `endState`: each mapping's `source`, or `*` for `end_state: none`. It reads them after the last spec block, and the checks of that block see the result: the value a mapping's source returned, a record keyed by source for a list, the list of every payload for `none`.

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

Before the drift classifier of phase 3, the runner gives a block drift classes by the checks its failing verdicts come from, read from the id before the first dot:

| Check | Drift class |
|---|---|
| `tools`, `forbidden`, `skills`, `guards` | `X5_tool` |
| `lang`, `cards` | `X4_format` |
| `stage` | `X3_flow` |

The other checks give no class yet, and a custom check never takes a class by its name. `X1_local` and `X2_contradiction` come with phase 3. See [drift](concepts/drift.md).

### Status, errors and retries

A run ends `completed`, `failed` or `stopped`.

* An `AdapterTransportError` is retried 3 times, after 200, 400 and 800 ms. Past the retries, the run fails.
* An `AgentFailure`, an Observed that does not match the schema as JSON, or any other error fails the run at once.
* A driver that does not stop within `maxSteps` steps stops the run.

The record keeps the blocks that ran, the error, and a note when a session could not be closed or a block could not be cached. The session is always closed.

### The cache and replay

The cache key of a block is the SHA-256 of the canonical JSON of the spec hash, the repeat, the block's position in the run, its whole resolved Given (the history so far included), its stimulus, the target, and the adapter's id and version. An end-state read is cached under the key of the block it follows and its source. The spec's `version` is a free label and plays no part.

With a cache, the runner first replays the run from it. Any block or end-state read the cache misses sends the whole run to the adapter instead, and every block it observes goes into the cache. A replayed run has `cacheHit: true` and costs nothing against a budget. A replayed run has no workspace to read files from, so its artifact checks cannot open files.

On the command line the store is the cache. A second campaign over the same specs and store replays every run:

```
$ pnpm -s driftbench campaign run examples/acme/specs/conversations --target function:acme --repeats 2 --store acme.db
Campaign c-38d1423fdef1: 12 cells, 4 at a time. Checks: tools, forbidden, must, must_not, lang, pii, cards, stage, skills, guards, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
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

* The run: `runId`, `specId`, `specHash`, `target`, `mode`, `repeat`, `perturbationId`, `status`, `error`, `blocks`, `succession`, `endState`, `cost`, `latencyMs`, `startedAt`, `finishedAt` and `cacheHit`. `cost` sums the blocks' costs: each block's total, or else the sum of its segments' costs.
* Each block: `index`, its position in the run, injected blocks included; `blockId`; `injected`; `givenHash`; `observed`; `verdicts`; `stageObserved`, the last stage the runtime reported in the block; `ledgerCheck`; `drift`; `pass`.
* `succession`: `firstDriftBlock`, `driftCount`, `driftRate`, `longestClean` and `minOverBlocks`, over the blocks of the run. A failing block is a drift block. See [drift](concepts/drift.md).

`ledgerCheck` lists the facts a block's `ledger_add` gives a value other than the one the ledger already holds. It does not change whether the block passes.
