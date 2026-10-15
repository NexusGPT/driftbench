---
title: Test a chat agent from its prompt
summary: From a chat agent's prompt to a stored, passing campaign and a scorecard, on the Acme sales assistant.
commands:
  - extract
  - extract approve
  - extract map
  - space coverage
  - generate
  - spec validate
  - campaign run
  - campaign status
  - report
see_also:
  - core-getting-started
  - core-configuration
  - core-exit-codes
  - recipes-tests-from-past-conversations
next:
  - recipes-test-a-code-agent
---

## Goal

You have a chat agent: a prompt or policy, a list of the behaviours it must show, and its tool schemas. You
want tests that cover the situations it can face, a run of those tests on the agent, and a scorecard.

The chain is: propose a map of situations from the prompt, approve it, generate specs from the approved map
by code, run the specs as a campaign kept in a store, then read the result. A model may propose the map;
code writes every test and derives every expected result (the Then) from the approved map, never from the
agent's replies.

## Before you start

* A checkout of driftbench, built: `pnpm install`, then `pnpm build`. Run every command from the repository
  root as `pnpm -s driftbench <command>`. See `driftbench help core-getting-started`.
* The Acme sales assistant stands in for your agent. It is deterministic code behind the target
  `function:acme-sales`: no model, no key, no network.
* Your agent's inputs, which the Acme example already holds:
  * the prompt or policy: `examples/acme/src/policy.ts`, `examples/acme/README.md`, `examples/acme/src/store.ts`;
  * the behaviour inventory: `examples/acme/inventory.yaml` (14 behaviours, 5 flows, 2 channels);
  * the tool schemas as JSON Schema: `examples/acme/map/tools.yaml`.
* Only step 1 can call a paid model, and it shows that call as text. Every command in a `sh` block below runs
  with no model and no key, and writes only to new paths in the folder you run it in.

## Steps

### 1. Propose the map of situations from the prompt

The map lists what varies between situations (stages, behaviours, deviations, personas, channels, data
cases) and what links them to tools and end states; every later step reads it.

The full proposal needs a model, one call per section (stages, rules, personas, data, phrases, relations).
This command calls a paid model. It needs `ANTHROPIC_API_KEY`, or `OPENAI_API_KEY` with `OPENAI_MODEL`, read
from a file you keep outside the repository, never typed on the command line:

```text
ANTHROPIC_API_KEY="$(cat ~/.secrets/anthropic.key)" driftbench extract \
  --prompt examples/acme/src/policy.ts --prompt examples/acme/README.md --prompt examples/acme/src/store.ts \
  --inventory examples/acme/inventory.yaml --tools examples/acme/map/tools.yaml --out map/proposal.yaml
```

`--provider anthropic|openai` picks the client; the default is the first whose key is set. Without a key it
prints `no model key: set ANTHROPIC_API_KEY, or OPENAI_API_KEY with OPENAI_MODEL. Pass --no-model to run the
code pre-pass only.` and exits 2. The Acme example ships the output of this step, made from recorded answers:
`examples/acme/map/proposal.yaml`. The steps below continue from it.

The part code proposes needs no model. `--no-model` runs it alone: the inventory and the tool schemas become
dimensions, values and constraints.

```sh
driftbench extract --prompt examples/acme/src/policy.ts --prompt examples/acme/README.md \
  --prompt examples/acme/src/store.ts --inventory examples/acme/inventory.yaml \
  --tools examples/acme/map/tools.yaml --no-model --out proposal.yaml
```

```text
Wrote proposal.yaml: 34 dimensions, 91 values, 55 constraints, 0 phrases, 7 relations, none approved.
  Code pre-pass: 34 dimensions, 91 values, 55 constraints, 7 relations.
  Roles: 3 axes (behaviour, deviation, channel), 31 details; the axes make a full grid of 252 cells.
  No model call: the code pre-pass alone (--no-model).
Notes:
  catalog.search output: no partition stated for customer.id, customer.name, customer.current_plan_id
  ...
Next: driftbench extract approve proposal.yaml lists the decisions; approve by --dimension <id> or --all.
```

An axis is crossed with the other axes in the space map; a detail is varied inside a cell. A note names a
tool field whose schema states no partition, so it gives no value. An existing proposal is never replaced
without `--force`, which drops its approvals.

### 2. Review the decisions and approve them

Nothing in a proposal counts until a person approves it, entry by entry or all at once.

With no option, `extract approve` lists the open decisions. On the full Acme proposal:

```sh
driftbench extract approve examples/acme/map/proposal.yaml
```

```text
examples/acme/map/proposal.yaml: 291 of 291 decisions are open (51 dimensions, 111 constraints, 55 phrases, 74 relations).
Axes: 7 of 51 dimensions, a full grid of 113568 cells (the space commands accept 250000).
  dimension   behaviour  behaviour axis, by code, 14 values: The behaviours the inventory lists
  dimension   flow  behaviour detail, by code, 5 values: The flows the inventory lists
  dimension   deviation  deviation axis, by code, 12 values: The deviation classes the flows must be perturbed with
  ...
Approve a dimension and its values with --dimension <id>, or every entry with --all. In the file, set
approved: true; a value may set its own flag, and role: axis or detail decides what enters the space map.
```

Each line is one decision with its kind, its role and who proposed it (code or model); each relation line
also shows the quote from your sources that justifies it. Approve one dimension with `--dimension <id>`
(repeatable), or every flag with `--all`. `--to <file>` writes the approved copy beside the proposal instead
of over it. On the proposal of step 1:

```sh
driftbench extract approve proposal.yaml --all --to approved-nomodel.yaml
```

```text
Approved 96 flags in approved-nomodel.yaml; 0 were already set.
```

The code part alone has no phrases and no relations, so it cannot give complete tests. The Acme example
ships the full proposal approved with `--all`: `examples/acme/map/approved.yaml`. The steps below read it.

### 3. Write the space map and measure what your current tests cover

The space map holds the approved axes, the cells the constraints allow and the required cells; coverage is
counted on it.

```sh
driftbench extract map examples/acme/map/approved.yaml --to space.yaml
driftbench space coverage examples/acme/specs --map space.yaml --t 2  # exit 1
```

```text
Wrote space.yaml: 7 axes (behaviour, deviation, channel, stage, user_type, coverage_result, workspace_start), 380 constraints, a full grid of 212940 cells.

Map acme, version 1: 7 dimensions, 212940 cells, 380 constraints, prior uniform (no weight declared)
...
t-wise coverage
  t = 2  237 of 708 allowed pairs (33.5%)
  t = 3  551 of 4064 allowed triples (13.6%)

Required cells
  ✓  flow new-home · D1_off_topic               acme-new-customer-coverage, acme-off-topic-return
  ✗  flow new-home · D5_language_switch         no spec
...
Coverage: 7 of 10 required cells covered, 237 of 708 cells at t = 2 (33.5%).
```

`--t 2` counts every pair of values on every two dimensions; without `--t` the full grid is counted. The seven
hand-written Acme specs cover 237 of 708 allowed pairs and miss three required cells, so the command exits
1. That gap is what the next step fills.

### 4. Generate the specs from the approved map

Code enumerates the specs and derives every Then from the approved relations: the next stage, the tool
calls and their inputs, what the reply must state, the end state, the recovery from each deviation.

```sh
driftbench generate --map examples/acme/map/approved.yaml --out generated --t 2  # exit 1
```

```text
Actual axis-map coverage (written complete specs): pairs 708 of 708 (100.0%); triples 2928 of 4064 (72.0%).
...
Seeder        specs  blocks  complete  incomplete
graph            12      48        12           0
twise           156     793       153           3
boundary         85     183        13          72
deviation        21     111        21           0
metamorphic      42     192        42           0
task             67      71        67           0
cover            24     135        24           0
...
Wrote 504 files to generated.
```

`generated/specs/<seeder>/` holds the complete specs, `generated/incomplete/` the specs with a block the map
gives no machine Then for or a value with no approved phrase, and `generated/generate-report.json` the
reasons. Exit 1 means the suite was written with incomplete specs; complete specs here still cover all 708
allowed pairs. `--t` is the strength of the covering array (default 3), `--seed` (default 1) fixes every
seeded choice, so the same map and seed give the same files.

Check the specs you are about to run. The `graph` seeder wrote one spec per approved path through the stages:

```sh
driftbench spec validate generated/specs/graph
```

```text
✓ generated/specs/graph/gen-graph-001.yaml  gen-graph-001 · 5 blocks · ...
...
Checked 12 specs: 12 valid, 0 invalid, 0 warnings.
```

### 5. Run the specs as a campaign and keep the runs

A campaign runs every spec on a target, block by block, applies the machine checks to each block, and keeps
every run in a store, a SQLite file.

Generated specs name no target, so pass one. Without `--target` the command refuses them with exit 2.

```sh
driftbench campaign run generated/specs/graph --target function:acme-sales --store acme.db
```

```text
Campaign c-01d90c025dd3: 12 cells, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, ...
Not judged: 4 criteria in 12 blocks of 12 specs (flow.upgrade, flow.new-home, flow.porting, flow.order), none of them gating. This campaign loads no judge, so these criteria have no verdict and count in no pass or fail. See docs/concepts/judges.md.
✓ gen-graph-001 · function:acme-sales · F · repeat 0  pass  5 blocks
✓ gen-graph-002 · function:acme-sales · F · repeat 0  pass  2 blocks
...
✓ gen-graph-012 · function:acme-sales · F · repeat 0  pass  6 blocks
12 cells: 12 pass, 0 fail, 0 failed. Spent $0.00.
```

One line per cell: spec, target, mode (`F` free-running by default), repeat, outcome, block count. A failing
cell lists the verdicts that did not hold, as `block <index> <verdict id>`. The campaign id changes with each
run. Point the same command at the whole `generated/specs` folder to run every complete spec, and add
`--route flow:price-sheet=process:acme-ops` to send its code-agent task specs to the ops agent. `--mode T,F,P`
adds teacher-forced and perturbed cells, `--repeats <n>` repeats every cell.

### 6. Read the result

`campaign status` reads a stored campaign back; `report` writes its scorecard as one HTML file and its JUnit
XML for a CI system.

```sh
driftbench campaign status --store acme.db
driftbench report --store acme.db --out scorecard.html --junit junit.xml
```

```text
Campaign c-01d90c025dd3, created 2026-10-14T14:15:39.098Z.
✓ gen-graph-001 · function:acme-sales · F · repeat 0  pass  5 blocks
...
12 cells: 12 pass, 0 fail, 0 failed. Spent $0.00.

Margin auto: 24.5 points, the smallest half point at which the baseline compared with itself is non-inferior (set by the all-pass flag, 24.2 points).
Warning: this suite cannot show parity under 15 points (the all-pass flag needs 24.2 points); about 22 goldens would.
Campaign c-01d90c025dd3: 12 runs, 12 pass, 0 fail, 0 did not complete.
Suite pass rate, mode F: 100.0% [75.3%, 100.0%] (hierarchical 95% interval); 12 goldens, n_eff 12.0 runs (every run agrees, so each golden counts once), detectable drop 49.3 points at 80% power.
Wrote scorecard.html and junit.xml.
```

Without a campaign id, both commands take the latest campaign of the store. Open `scorecard.html` in a
browser. The warning says that 12 specs are too few to show that a later version is no worse than this one
within 15 points; a larger suite narrows that margin.

## What you have at the end

* `proposal.yaml` and `approved-nomodel.yaml`: the code part of a map, proposed and approved.
* `space.yaml`: the space map, the cells coverage is counted on.
* `generated/`: the generated suite, `specs/` by seeder, `incomplete/`, and `generate-report.json`.
* `acme.db`: the store, with the campaign, its specs and every run.
* `scorecard.html` and `junit.xml`: the scorecard and the JUnit XML of that campaign.

The generated specs are candidates. Before you trust them as your suite, pass them through the validity gate
and choose a golden set: `driftbench help recipes-tests-from-past-conversations` shows both.

## When a step fails

* `no model key: set ANTHROPIC_API_KEY, or OPENAI_API_KEY with OPENAI_MODEL` (exit 2) from `extract`: load
  the key from its file, or pass `--no-model` for the code part alone.
* `extract` exits 1: the proposal was written, but a model section failed or an entry was refused; each is
  listed with its reason. Run it again, or fix the source the quote was taken from.
* `extract approve` exits 1: an entry's evidence was removed, or its quote is no longer in its source. Fix the
  source or the entry, then approve again.
* `space coverage` exits 1: a required cell has no spec. The output marks each with a cross; generate or
  write a spec for it.
* `generate` exits 1: specs went to `incomplete/`. `generate-report.json` names each value with no approved
  phrase (`no_phrase`) and each block with no machine Then and why (`no_then`). Approve more phrases or
  relations, then generate again with `--force` into the same folder.
* `... name no target. Give the spec a target, or run with --target <adapter[:agent]>` (exit 2) from
  `campaign run`: generated specs name no target; pass `--target`.
* `campaign run` exits 1: a cell failed. Read the `block <index> <verdict id>` list on its line;
  `campaign status --store acme.db --json` prints every verdict of every block with its evidence.
* `error: required option '--out <file.html>' not specified` (exit 2) from `report`: pass `--out`.
