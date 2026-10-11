# CLI

`driftbench` is the command line. Today it checks spec files: `spec validate`, `spec lint` and `spec coverage` work. Commands that run agents are planned, phase 1 and later.

## Running it

The package is not on npm yet; publishing is planned, release phase. From a clone of the repository:

```sh
pnpm install
pnpm driftbench spec validate path/to/specs
```

Relative paths are read from the folder where you type the command.

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

The hash is the first 12 hex characters of the SHA-256 of the spec's canonical JSON, with keys sorted at every depth. Equal content gives an equal hash.

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

On the test fixture [`packages/core/test/coverage/fixtures`](../../packages/core/test/coverage/fixtures/inventory.yaml):

```
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
  ✗ specs/broken.yaml  blocks.0  BLOCK_STIMULUS_MISSING  a block needs `user`, `burst` or `when`

Coverage: 4 of 5 behaviours covered, 3 of 4 flow deviations covered.
```

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

## Planned commands

Each lands in the phase shown.

| Command | Does | Phase |
|---|---|---|
| `campaign plan`, `campaign run`, `campaign resume`, `campaign status` | run specs on targets, modes and repeats, with the run count and projected cost printed first | 1 |
| `campaign plan` printing the minimum detectable effect | the smallest drop the chosen repeats can detect | 4 |
| `smoke` | run a spec three times with the cache off and report whether the transcripts differ | 1 |
| `judge calibrate`, `judge assign` | test every judge on fixture pairs and hand labels, then write the assignment table | 2 |
| `stats`, `compare --baseline --candidate` | statistics and the parity verdict | 4 |
| `report scorecard`, `report diff`, `report junit` | the scorecard page, a run diff, JUnit XML | 4 |
| `ci` | exit 0 or 1 on the parity verdict and the gating failures | 4 |
| `battery run` | the runtime battery on agent traces | 4 |
| `replay <cell>` | run one stored cell again | no phase assigned |
| `init` | start a project | no phase assigned |
| `spec import`, `spec synth` | specs from recorded conversations, or from traffic clusters | no phase assigned |
