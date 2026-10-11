# CLI

`driftbench` is the command line. Today it checks spec files: `spec validate` and `spec lint` work, and `spec coverage` is being built in phase 0. Commands that run agents are planned, phase 1 and later.

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
✓ specs/plan-upgrade.yaml  plan-upgrade · 2 blocks · hash 5bc711537ede
✓ specs/sales-workbook.yaml  sales-workbook · 2 blocks · hash 97a50643b711
Checked 2 specs: 2 valid, 0 invalid, 0 warnings.
```

An invalid spec lists every error with its path in the spec and its code:

```
✗ broken/semantic.yaml
    blocks.0.expect.must.0  REGEX_INVALID  Invalid regular expression: /(/m: Unterminated group
    blocks.0.expect.criteria.0  CRITERION_UNDEFINED  criterion "c2" is not defined in this spec's criteria
    blocks.0.expect.step  STEP_UNKNOWN  step "b" is not in the spec's steps
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

Being built in phase 0. This is its contract.

```
driftbench spec coverage <paths...> --inventory <file> [--channel <name>] [--json]
```

Reads a behaviour inventory and the specs, then prints two matrices: behaviours by specs (applicable, covered and missing, per channel), and flows by deviation classes, from the perturbations of the specs. Task specs count like conversation specs.

| Option | Effect |
|---|---|
| `--inventory <file>` | the behaviour inventory, in YAML or JSON; required |
| `--channel <name>` | only this channel |
| `--json` | print one JSON document |

| Exit code | When |
|---|---|
| 0 | every applicable behaviour is covered |
| 1 | a required cell is missing |
| 2 | usage or input error |

Until it lands, the command prints `driftbench spec coverage is not available yet.` and exits 2.

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
| `STEP_UNKNOWN` | error | the spec lists `steps`, and `expect.step` or `recovery.step_after` names a step that is not there |
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
