# CLI

`driftbench` is the command line. It checks spec files (`spec validate`, `spec lint`, `spec coverage`), plans and runs campaigns (`campaign plan`, `campaign run`, `campaign status`, `campaign resume`), checks that an agent is deterministic (`smoke`), measures the specs against a map of situations (`space coverage`, `space complete`, `space declare`), and proposes that map (`extract`). The campaign and smoke commands, their options, their output and their exit codes are on the [running](../running.md) page.

## Running it

The package is not on npm yet; publishing is planned, release phase. From a clone of the repository:

```sh
pnpm install
pnpm driftbench spec validate path/to/specs
```

Relative paths are read from the folder where you type the command. `pnpm -s driftbench` prints only what driftbench prints, without pnpm's own lines.

The Acme example runs `spec validate`, `spec lint` and `spec coverage` on seven specs and an inventory: [`examples/acme`](../../examples/acme/README.md) shows the commands and their output.

## Paths

Every command takes one or more files or folders.

* A folder is searched recursively for `*.yaml`, `*.yml` and `*.spec.json` files, in sorted order.
* Entries whose name starts with a dot, `node_modules` and `dist` are skipped.
* A file ending in `.json` is read as JSON. Every other file is read as YAML.
* A path that does not exist is reported as an invalid spec with the code `SPEC_PARSE`.

## `driftbench spec validate`

```
driftbench spec validate <paths...> [--json]
```

Parses, normalises and validates every spec, then prints one line per spec and a summary.

```
✓ specs/plan-upgrade.yaml  plan-upgrade · 2 blocks · hash bac3281387f6
✓ specs/sales-workbook.yaml  sales-workbook · 2 blocks · hash 26966d51ea11
Checked 2 specs: 2 valid, 0 invalid, 0 warnings.
```

An invalid spec lists every error with its path in the spec and its code:

```
✗ broken/semantic.yaml
    blocks.0.expect.must.0  REGEX_INVALID  Invalid regular expression: /(/m: Unterminated group
    blocks.0.expect.criteria.0  CRITERION_UNDEFINED  criterion "c2" is not defined in this spec's criteria
    blocks.0.expect.stage  STAGE_UNKNOWN  stage "b" is not in the spec's stages
```

The hash is the first 12 hex characters of the SHA-256 of the spec's canonical JSON, with keys sorted at every depth. Equal content gives an equal hash. The hash, not the spec's `version`, is part of the runner's cache key and of every run id; `version` is a free label. See [running](../running.md#the-cache-and-replay).

| Option | Effect |
|---|---|
| `--json` | print one JSON document: an array with one entry per spec |

| Exit code | When |
|---|---|
| 0 | every spec is valid |
| 1 | a spec is invalid, or no spec file was found |
| 2 | usage error, such as a missing path or an unknown option |

## `driftbench spec lint`

```
driftbench spec lint <paths...> [--json] [--strict]
```

Validates every spec like `spec validate`, then prints the warnings of the valid ones.

```
✓ specs/no-checks.yaml  no-checks · 1 block · hash 5a9e8dbe0f0c
  ! blocks.0  BLOCK_NO_EXPECTATION  this block checks nothing
Checked 1 spec: 1 valid, 0 invalid, 1 warning.
```

| Option | Effect |
|---|---|
| `--json` | print one JSON document |
| `--strict` | treat warnings as failures |

| Exit code | When |
|---|---|
| 0 | every spec is valid; warnings are allowed without `--strict` |
| 1 | a spec is invalid, no spec file was found, or a warning was printed with `--strict` |
| 2 | usage error |

## `driftbench spec coverage`

```
driftbench spec coverage <paths...> --inventory <file> [--channel <name>] [--json]
```

Reads a behaviour inventory and the specs, then prints two matrices. The inventory format is in the [spec reference](spec.md#inventory).

* Behaviours by channel: one row per behaviour, one column per channel. A cell is `covered` when a valid spec on that channel, or on no channel, lists the behaviour in `covers`. It is `missing` when no spec does, and `n/a` when the behaviour does not apply on that channel.
* Flows by required deviation: one row per flow. A spec belongs to a flow when it carries the tag `flow:<id>` or covers one of the flow's behaviours. A required deviation class is covered when a member spec has a perturbation of that class, or a block whose stimulus is an injection of that class.

Task behaviours and task specs are rows of the same matrices as conversations.

The channels are the inventory's `channels`. Without them, they are every channel named by a behaviour or a valid spec, sorted; without any, the one channel `default`. `--channel` narrows the matrix to one channel, and then only specs on that channel, or on no channel, count. Invalid specs are listed and never count as coverage. Warnings never change the verdict.

On the test fixtures in [`packages/core/test/coverage/fixtures`](../../packages/core/test/coverage/fixtures/inventory.yaml), run from the repository root:

```
$ pnpm driftbench spec coverage packages/core/test/coverage/fixtures/specs --inventory packages/core/test/coverage/fixtures/inventory.yaml
Behaviours by channel
     id     kind          chat     whatsapp  title
  ✓  B-001  conversation  covered  covered   Greets the customer once and names the assistant
  ✓  B-002  conversation  covered  covered   Looks up the available plans before quoting a price
  ✓  B-003  conversation  covered  n/a       Sends the offer card once
  ✗  B-004  conversation  covered  missing   Asks for an explicit yes before submitting the order
  ✓  T-001  task          covered  covered   Builds the monthly usage sheet with one tab per line
     total                5 of 5   3 of 4

Flows by required deviation
  ✓  plan-upgrade  2 specs  D1_off_topic covered · D4_loose_confirmation covered  Plan upgrade from greeting to submission
  ✗  usage-report  1 spec   D2_goal_shift covered · D8_tool_failure missing       Monthly usage report built in the workspace
  -  offer-card    1 spec   no deviation required                                 Offer card on chat

Warnings
  ! B-099  UNKNOWN_BEHAVIOUR  covered by stray, but the inventory has no behaviour B-099

Invalid specs, not counted
  ✗ packages/core/test/coverage/fixtures/specs/broken.yaml  blocks.0  BLOCK_STIMULUS_MISSING  a block needs `user`, `burst` or `when`

Coverage: 4 of 5 behaviours covered, 3 of 4 flow deviations covered.
```

The command exits 1 here: B-004 is missing on whatsapp, and the usage-report flow misses D8_tool_failure.

| Option | Effect |
|---|---|
| `--inventory <file>` | the behaviour inventory, in YAML or JSON; required |
| `--channel <name>` | only this channel; an unknown channel is a usage error |
| `--json` | print one JSON document |

| Exit code | When |
|---|---|
| 0 | every applicable behaviour and every required deviation is covered |
| 1 | a behaviour is missing on a channel where it applies, or a required deviation is missing |
| 2 | usage or input error: an invalid inventory, a path that does not exist, no spec file found, or an unknown channel |

`--json` prints one document with the keys `inventory`, `channels`, `behaviours` (each with its cells and the ids of the covering specs), `perChannel`, `flows` (each with its member specs and, per required deviation, the perturbations and injection blocks that cover it), `warnings`, `invalidSpecs`, `summary` and `ok`.

Warnings:

| Code | Meaning |
|---|---|
| `UNKNOWN_BEHAVIOUR` | a spec covers a behaviour id the inventory does not list |
| `UNKNOWN_FLOW` | a spec carries the tag `flow:<id>` for a flow the inventory does not list |
| `UNLISTED_CHANNEL` | a spec runs on a channel the inventory's `channels` do not list, so it counts for no channel |
| `KIND_MISMATCH` | a behaviour is covered only by specs of the other kind: a task behaviour by conversation specs, or the reverse |

Inventory errors. Any of them stops the command before coverage is computed:

| Code | Meaning |
|---|---|
| `INVENTORY_PARSE` | the file cannot be read, or it is not valid YAML or JSON |
| `INVENTORY_NOT_OBJECT` | the file does not hold one mapping with behaviours and flows |
| `INVENTORY_DUPLICATE` | an id, a channel, a behaviour of a flow or a deviation class is listed twice |
| `INVENTORY_UNKNOWN_BEHAVIOUR` | a flow names a behaviour the inventory does not list |
| `INVENTORY_UNKNOWN_CHANNEL` | a behaviour names a channel that is not in the inventory's `channels` |
| `SCHEMA_*` | the schema refuses a value, as for specs |

## JSON output

`spec validate --json` and `spec lint --json` print one array. A valid spec:

```json
{
  "path": "specs/no-checks.yaml",
  "ok": true,
  "id": "no-checks",
  "hash": "5a9e8dbe0f0c",
  "blocks": 1,
  "warnings": [
    {
      "level": "warning",
      "code": "BLOCK_NO_EXPECTATION",
      "path": "blocks.0",
      "message": "this block checks nothing"
    }
  ]
}
```

An invalid spec:

```json
{
  "path": "specs/bad.yaml",
  "ok": false,
  "errors": [
    {
      "level": "error",
      "code": "BLOCK_STIMULUS_MISSING",
      "path": "blocks.0",
      "message": "a block needs `user`, `burst` or `when`"
    }
  ],
  "warnings": []
}
```

`path` inside an issue is the dotted path in the spec, such as `blocks.2.expect.tools.0.label`. It is empty when the issue concerns the whole file.

## Issue codes

Every problem has a stable code, so tools and tests can branch on it. An error makes a spec invalid. A warning is advice on a valid spec; `spec lint` prints it.

| Code | Level | Meaning |
|---|---|---|
| `SPEC_PARSE` | error | the file cannot be read, or it is not valid YAML or JSON |
| `SPEC_NOT_OBJECT` | error | the file does not hold one mapping at the top level |
| `SPEC_ALIAS_CONFLICT` | error | a shorthand and its long form are both set: `ledger_seed` with `given.ledger`, or `workspace_seed` with `given.world.workspace` |
| `BLOCK_STIMULUS_MISSING` | error | a block has none of `user`, `burst` and `when` |
| `BLOCK_STIMULUS_AMBIGUOUS` | error | a block has more than one of `user`, `burst` and `when` |
| `REGEX_INVALID` | error | a pattern in `must`, `must_not` or a `regex` assertion does not compile |
| `CRITERION_REF_INVALID` | error | a criterion reference is not a name, optionally followed by `@gating` |
| `CRITERION_UNDEFINED` | error | the spec defines `criteria`, and a block names one that is not there |
| `CRITERION_DUPLICATE` | error | two criteria share a name |
| `PERTURBATION_OUT_OF_RANGE` | error | `inject_at` is past the last position |
| `PERTURBATION_EMPTY` | error | a perturbation has none of `user`, `burst` and `world` |
| `DUPLICATE_BLOCK_ID` | error | two blocks share an id |
| `DUPLICATE_PERTURBATION_ID` | error | two perturbations share an id |
| `TOOL_COUNT_CONTRADICTION` | error | a tool is expected 0 times but has input assertions |
| `COUNT_RANGE_INVALID` | error | a count has a `min` greater than its `max` |
| `MUST_CONFLICT` | error | the same pattern is in `must` and in `must_not` |
| `STAGE_UNKNOWN` | error | the spec lists `stages`, and `expect.stage` or `recovery.stage_after` names a stage that is not there |
| `TOOL_FORBIDDEN_EXPECTED` | error | a block expects a tool that the rules forbid, in `forbidden_tools` or with `max_calls` at 0 |
| `SCHEMA_*` | error | the schema refuses a value; the suffix is the zod issue code, such as `SCHEMA_UNRECOGNIZED_KEYS`, `SCHEMA_INVALID_TYPE`, `SCHEMA_INVALID_VALUE` or `SCHEMA_TOO_SMALL` |
| `CRITERION_UNRESOLVED` | warning | blocks name criteria and the spec defines none; they must come from a shared catalogue |
| `BLOCK_NO_EXPECTATION` | warning | a block checks nothing |
| `TASK_WITHOUT_OUTCOME` | warning | a task spec checks none of `artifacts`, `workspace`, `execution` and `end_state` |
| `PERTURBATION_NO_RECOVERY` | warning | a perturbation has no `recovery`, so its recovery is not measured |

## Global options

| Option | Effect |
|---|---|
| `--version` | print the version |
| `--help` | print the usage of the program or of a command |

## Campaigns and smoke

These commands run specs on a target. Each has its options, its output and its exit codes on the [running](../running.md) page.

| Command | Does |
|---|---|
| [`campaign plan`](../running.md#driftbench-campaign-plan) | expands specs, targets, modes and repeats into cells, projects their cost and prints the minimum detectable effect |
| [`campaign run`](../running.md#driftbench-campaign-run) | runs every cell and prints pass or fail per cell |
| [`campaign status`](../running.md#driftbench-campaign-status) | prints the state of every cell of a stored campaign |
| [`campaign resume`](../running.md#driftbench-campaign-resume) | runs the cells of a stored campaign that have no completed run, and reuses the others |
| [`smoke`](../running.md#driftbench-smoke) | runs one spec several times with the cache off and reports whether the transcripts differ |

## `driftbench space`

The space commands read a map of the situations an agent can face, and count how much of it the specs cover. The map is a YAML or JSON file, usually beside the agent's inventory; [`packages/space/test/fixtures/acme-space.yaml`](../../packages/space/test/fixtures/acme-space.yaml) is the Acme map. Every key is checked strictly.

| Key | Holds |
|---|---|
| `version`, `agent` | the map's version and the agent it describes |
| `inventory` | optional: the behaviour inventory, relative to the map; the flow deviations it requires become required cells |
| `dimensions` | each with an `id`, a `title`, a `kind` (`stage`, `behaviour`, `deviation`, `persona`, `channel`, `data` or `task`) and its `values`. A value has an `id`, a `title`, an optional relative `weight`, and `required: true` when it must be covered. |
| `constraints` | combinations that cannot happen: `forbid` names a value per dimension, with a `reason` |
| `prior` | `declared` or `fitted` (a fitted prior names its `source`), with optional `weights` per dimension |

A cell is one value per dimension. The value `none` is reserved: it collects a block or a spec that names no value of the dimension. A spec is placed by its blocks and perturbations: the stage from a block's `expect.stage` (a deviation sits on the stage the conversation has reached when it arrives), the deviation from an injection or a perturbation, the behaviours from `covers`, the channel from `channel`, and persona, data and task from the tags `persona:<id>`, `data:<id>` and `task:<id>`.

### `driftbench space coverage`

```
driftbench space coverage <paths...> --map <file> [--t <n>] [--json]
```

Counts the cells of the map the specs cover: per dimension, on every subset of `t` dimensions (the full grid without `--t`), weighted by the prior, and for each required cell. A cell the constraints forbid counts in neither the covered cells nor the allowed ones.

```
$ pnpm -s driftbench space coverage --map packages/space/test/fixtures/acme-space.yaml examples/acme/specs --t 2
Map acme-sales, version 1: 6 dimensions, 54432 cells, 5 constraints, prior declared (Owner estimate for the fictional Acme example)

Dimensions
  id         kind       values  covered  not covered
  stage      stage      12      12
  behaviour  behaviour  14      13       B-007
  deviation  deviation  9       7        D2_goal_shift, D3_contradiction
  channel    channel    2       2
  persona    persona    3       0        cooperative, terse, sceptical
  data       data       6       1        fiber, no-fiber, check-fails, portable, locked

Grid at t = 2: 15 subsets of 2 dimensions
  cells     818 allowed of 823 (5 forbidden by the constraints)
  covered   196 (24.0%)
  weighted  34.0% of the declared user mix, effective sample size 6.3 of 7 specs

t-wise coverage
  t = 2  196 of 818 allowed pairs (24.0%)
  t = 3  390 of 7082 allowed triples (5.5%)

Required cells
  ✓  stage=recap · deviation=D4_loose_confirmation  acme-order-loose-confirmation, acme-plan-upgrade
  ✓  flow new-home · D1_off_topic                   acme-new-customer-coverage, acme-off-topic-return
  ✗  flow new-home · D5_language_switch             no spec
  ✓  flow new-home · D6_instruction_in_data         acme-new-customer-coverage
  ✓  flow new-home · D8_tool_failure                acme-order-loose-confirmation, acme-tool-failure
  ✓  flow new-home · D10_return                     acme-off-topic-return
  ✗  flow order · D2_goal_shift                     no spec
  ✗  flow order · D3_contradiction                  no spec
  ✓  flow order · D4_loose_confirmation             acme-order-loose-confirmation, acme-plan-upgrade
  ✓  flow order · D8_tool_failure                   acme-order-loose-confirmation, acme-tool-failure
  ✓  flow price-sheet · D6_instruction_in_data      acme-price-sheet

Warnings
  ! D7_silence_or_burst  UNKNOWN_VALUE  deviation D7_silence_or_burst is named by acme-number-porting, but no deviation dimension of the map lists it
  ! D9_out_of_scope  UNKNOWN_VALUE  deviation D9_out_of_scope is named by acme-plan-upgrade, but no deviation dimension of the map lists it

Coverage: 8 of 11 required cells covered, 196 of 818 cells at t = 2 (24.0%).
```

The command exits 1 here: three required flow deviations have no spec.

### `driftbench space complete`

```
driftbench space complete <paths...> --map <file> [--t <n>] [--json]
```

Treats the specs as a sample of conversations and prints how complete it is: the share of the cells that have appeared, and the chance that the next conversation shows a new one, with bootstrap intervals and the Hill numbers of the cells seen. The line prints only when there are at least as many conversations as allowed cells at strength `t`; otherwise the command says why.

```
$ pnpm -s driftbench space complete examples/acme/specs --map packages/space/test/fixtures/acme-space.yaml --t 1
Completeness at t = 1: 46 cells, 7 conversations
  seen          35 cells; f1 15, f2 11
  Hill numbers  q0 35 · q1 28.1 · q2 22.7

No completeness line: the estimate needs at least as many conversations as cells, and there are 7 for 46.
```

### `driftbench space declare`

```
driftbench space declare <paths...> --inventory <file> --out <file> [--agent <name>]
```

Writes a first map from the inventory and the specs, for the owner to edit: the stages of the specs, the behaviours, the deviations the flows require, and the channels. Persona, data and task dimensions are left to the owner. An existing file is never overwritten.

| Option | Effect |
|---|---|
| `--map <file>` | the map, in YAML or JSON; required by `coverage` and `complete` |
| `--t <n>` | cells on every subset of `n` dimensions, from 1 to the number of dimensions; default the full grid |
| `--json` | print one JSON document |
| `--inventory <file>` | the behaviour inventory; required by `declare` |
| `--out <file>` | where `declare` writes the map; required |
| `--agent <name>` | the agent the declared map describes |

| Exit code | When |
|---|---|
| 0 | `coverage`: every required cell is covered; `complete`: the line printed; `declare`: the map written |
| 1 | `coverage`: a required cell is empty; `complete`: too few conversations for the line |
| 2 | usage or input error: an invalid map, an unreadable inventory, `t` out of range, a missing path, no spec file, a full grid over 250000 cells, or a `declare` target that exists |

Warnings never change the exit code:

| Code | Meaning |
|---|---|
| `UNKNOWN_VALUE` | a spec names a value no dimension of that kind lists |
| `UNPLACED_SPEC` | a spec falls in no allowed cell, and the warning says why |
| `FORBIDDEN_CELL` | a spec reaches a cell the constraints forbid; it is not counted |
| `PRIOR_EMPTY` | the prior gives no weight to any allowed cell, so no weighted share is computed |

A map that does not load stops the command with its issues: `SPACE_PARSE`, `SPACE_NOT_OBJECT`, `SPACE_DUPLICATE`, `SPACE_KIND_REPEATED`, `SPACE_AMBIGUOUS_VALUE`, `SPACE_UNKNOWN_DEVIATION`, `SPACE_EMPTY_CONSTRAINT`, `SPACE_UNKNOWN_DIMENSION`, `SPACE_UNKNOWN_VALUE`, `SPACE_PRIOR_INCOMPLETE`, `SPACE_PRIOR_ZERO`, `SPACE_PRIOR_SOURCE`, `SPACE_GRID_EMPTY`, or `SCHEMA_*`, each with its path in the map.

## `driftbench extract`

```
driftbench extract --prompt <file> [--prompt <file>] --inventory <file> [--tools <file>] --out <file> [--no-model] [--provider anthropic|openai] [--replay <file>] [--agent <name>] [--force]
driftbench extract approve <proposal> [--all]
```

Proposes the map of situations from an agent's prompt or policy, its inventory and its tool schemas, for a person to approve. Code reads the inventory and the tools first; a model then proposes stages, rules, personas, data and phrases, each value quoting the text that justifies it. The proposal is a valid space map. Nothing counts until a person approves it.

| Option | Effect |
|---|---|
| `--prompt <file>` | the agent prompt or policy; repeat it for several files |
| `--inventory <file>` | the behaviour inventory |
| `--tools <file>` | tool schemas, or a spec whose `metadata.tool_schemas` lists them |
| `--out <file>` | where to write the proposal, in YAML |
| `--no-model` | run only the code pass on the inventory and the tools |
| `--provider <name>` | `anthropic` or `openai`; default the first whose key is set in the environment |
| `--replay <file>` | replay recorded answers instead of calling a model |
| `--agent <name>` | the agent name; default the folder of the inventory |
| `--force` | replace an existing proposal; the approvals in it are lost |

`extract approve <proposal>` lists the entries not approved yet; `--all` approves every entry. A person approves an entry by setting `approved: true` on it. [`examples/acme/map`](../../examples/acme/map/README.md) holds the Acme proposal and the command that made it.

| Exit code | `extract` | `extract approve` |
|---|---|---|
| 0 | the proposal is written and complete | listed, or approved |
| 1 | written, with a section that failed or an entry refused | the proposal is invalid |
| 2 | usage or input error; nothing is written | the file is not found, or a usage error |

## Planned commands

Each lands in the phase shown. `generate` and `intake` are registered already: each prints that it is not built yet and exits 2.

| Command | Does | Phase |
|---|---|---|
| `campaign run --mode T`, `campaign run --mode P` | campaigns in teacher-forced and perturbed modes | 3 |
| `generate`, `intake` | not built yet; the commands are placeholders | G |
| `judge calibrate`, `judge assign` | test every judge on fixture pairs and hand labels, then write the assignment table | 2 |
| `stats`, `compare --baseline --candidate` | statistics and the parity verdict | 4 |
| `report scorecard`, `report diff`, `report junit` | the scorecard page, a run diff, JUnit XML | 4 |
| `ci` | exit 0 or 1 on the parity verdict and the gating failures | 4 |
| `battery run` | the runtime battery on agent traces | 4 |
| `replay <cell>` | run one stored cell again | no phase assigned |
| `init` | start a project | no phase assigned |
| `spec import`, `spec synth` | specs from recorded conversations, or from traffic clusters | no phase assigned |
