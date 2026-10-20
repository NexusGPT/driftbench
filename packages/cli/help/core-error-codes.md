---
title: Error codes and warning fixes
summary: Find the cause and fix for spec, coverage, estate file and model response codes.
commands:
  - spec validate
  - spec lint
  - estate approve
  - estate plan approve
see_also:
  - authoring-spec-check
  - authoring-given-checks
  - authoring-inventory
  - authoring-space-coverage
  - authoring-prompt-sections
  - validate-estate-scan
  - validate-estate-plan
  - core-exit-codes
---

## What it is

An error code names a particular problem. Read its message and path to locate the value that needs a fix.
Codes are case sensitive. Spec and estate codes use capitals. Model response codes use lower case.

Some codes are warnings, not invalid files. For example, `BLOCK_NO_EXPECTATION` describes a valid block
that checks nothing. `GIVEN_UNMET` is a lint warning, but prevents that block from running.

This topic covers spec, coverage, estate file and model response problems. The linked topics describe
the full formats and the other codes, including schema errors and parent block errors.

## When to use it

* A spec fails validation or strict lint.
* A coverage report excludes a spec or reports a misleadingly small covered share.
* An estate map or plan refuses to load or approve.
* A model request produces no usable text.

## Commands and every option

These commands check local files. None calls a model. Global options are in `core-global-options`.

### spec validate and spec lint

```text
driftbench spec validate <paths...> [--json]
driftbench spec lint <paths...> [--json] [--strict] [--summaries] [--sections <registries...>]
```

| Input or option | Default | Meaning |
|---|---|---|
| `<paths...>` | Required | Spec files or folders. Folders are searched recursively for YAML and `.spec.json` files. |
| `--json` | Off | Print an array of file results with structured issues. |
| `--strict` | Off | Lint only. Exit 1 for warnings as well as invalid specs. |
| `--summaries` | Off | Lint only. Check summaries of named session states and workspace folders. |
| `--sections <registries...>` | None | Lint only. Check prompt section links against these registry files. |

See `authoring-spec-check` for file discovery rules and complete output shapes.

### estate approve

```text
driftbench estate approve <map> [--kind <kind>]... [--atom <id>]... [--all] [--to <file>]
```

| Input or option | Default | Meaning |
|---|---|---|
| `<map>` | Required | Estate map to read and validate. With no selection, list waiting atoms. |
| `--kind <kind>` | None | Approve atoms of this kind. Repeat for more kinds. |
| `--atom <id>` | None | Approve this atom. Repeat for more atoms. |
| `--all` | Off | Approve every atom. |
| `--to <file>` | In place | Write the approved map to another file in the same folder. |

See `validate-estate-scan` for atom kinds and the scan and approval process.

### estate plan approve

```text
driftbench estate plan approve <plan> [--all] [--row <id>]... [--strike] [--out <file>]
```

| Input or option | Default | Meaning |
|---|---|---|
| `<plan>` | Required | Plan to read and validate. With no selection, count rows by status. |
| `--all` | Off | Approve proposed rows. Leave struck rows struck. |
| `--row <id>` | None | Approve this row. Repeat for more rows. |
| `--strike` | Off | Strike the named rows instead of approving them. |
| `--out <file>` | In place | Write the result here and keep the source file unchanged. |

See `validate-estate-plan` for generating plans, row weights and approval results.

## Inputs

* Specs hold blocks, their starting state and their expectations.
* Inventory coverage reads behaviours, flows and channels. Space coverage reads dimensions, constraints and priors.
* Estate maps hold atoms, evidence and graph edges. Plans hold rows derived from a map.
* Model errors describe a request or response. They are not spec validation results.

## Outputs and how to read them

For spec commands, `--json` prints one result per file. Invalid results hold `errors`; valid results hold
`warnings`. Each issue has `level`, `code`, `path` and `message`. A dotted path counts list entries from zero.

Validation exits 1 for invalid specs. Lint also exits 1 for warnings when `--strict` is set. Warnings
alone otherwise allow exit 0. Incorrect command usage exits 2.

Estate file errors print the file, the code, the path within it and the message. An invalid map or plan
exits 1. Approval of an unknown atom or row changes nothing.

Coverage warnings name a subject and the affected specs. They describe why coverage does not mean what
the author intended. They do not prove the agent passed or failed.

A model error may include an HTTP status and whether retrying may help. The HTTP model port retries
temporary transport failures. Exhausted HTTP retries retain the last error code, such as `network`.
The separate `exhausted` code belongs to the fake model port.

## Worked example

Create a fictional Acme spec with duplicate block ids and contradictory expectations:

```yaml file=out/error-codes/invalid.yaml
id: acme-invalid-checks
blocks:
  - id: greeting
    user: Hello, Acme.
    expect:
      must: [hello]
      must_not: [hello]
  - id: greeting
    user: Hello again.
    expect:
      must: [hello]
```

Create a valid task spec that checks no outcome and names a state without a summary:

```yaml file=out/error-codes/warnings.yaml
id: acme-weak-task
kind: task
given:
  vars: { session_state: acme-report-started }
blocks:
  - user: Write the Acme report.
  - user: Summarize the result.
    expect:
      criteria: [reports_what_it_did]
```

Create the corrected version. It checks an output artifact and describes the starting state:

```yaml file=out/error-codes/fixed.yaml
id: acme-report-checked
kind: task
given:
  vars: { session_state: acme-report-started }
  summary: An empty Acme report folder is ready for the report.
blocks:
  - user: Write the Acme report.
    expect:
      artifacts:
        - path: report.txt
          kind: text
```

Check the broken files, then check the fix:

```sh
driftbench spec validate out/error-codes/invalid.yaml --json # exit 1
driftbench spec lint out/error-codes/warnings.yaml --summaries --json
driftbench spec lint out/error-codes/warnings.yaml --summaries --strict # exit 1
driftbench spec lint out/error-codes/fixed.yaml --summaries --strict
```

The invalid file reports `DUPLICATE_BLOCK_ID` and `MUST_CONFLICT`. The warning file reports
`BLOCK_NO_EXPECTATION`, `CRITERION_UNRESOLVED`, `TASK_WITHOUT_OUTCOME` and `GIVEN_SUMMARY_MISSING`.
The corrected file passes strict lint. Lint checks the spec; it does not create `report.txt` or run an agent.

An estate map must be a mapping. A plan must be valid YAML. These deliberately broken files show their
separate error families without a scan or a model call:

```yaml file=out/error-codes/not-a-map.yaml
- acme
```

```yaml file=out/error-codes/broken-plan.yaml
rows: [
```

```sh
driftbench estate approve out/error-codes/not-a-map.yaml # exit 1
driftbench estate plan approve out/error-codes/broken-plan.yaml # exit 1
```

The map reports `MAP_NOT_OBJECT`. The plan reports `PLAN_PARSE`. Neither command writes an approval.

## Common errors

### Specs and starting state

| Code | Cause | Fix |
|---|---|---|
| `SPEC_SCHEMA_VERSION` | The spec names a newer format version than this installation supports. | Upgrade driftbench to a version that supports the format. Do not change the version number without converting the spec. |
| `DUPLICATE_BLOCK_ID` | Two blocks use the same id. | Give each block a unique id and update references to renamed blocks. |
| `DUPLICATE_PERTURBATION_ID` | Two perturbations use the same id. | Give each perturbation a unique id. |
| `MUST_CONFLICT` | The same pattern appears in both `must` and `must_not`. | Decide whether the response must contain or avoid it, then remove the conflicting entry. |
| `BLOCK_NO_EXPECTATION` | A block has no nonempty expectation. | Add a check for the intended response or outcome. |
| `CRITERION_UNRESOLVED` | A block or perturbation names criteria, but the spec has no local definitions. | Define them in `criteria`, or supply the shared catalogue when judging. |
| `TASK_WITHOUT_OUTCOME` | A task checks no artifacts, workspace, execution or `end_state`. | Add a check for what the task produces, not just its reply. |
| `GIVEN_UNMET` | A starting-state check fails: tool pairing, known tools, forced results or shared facts. | Read the check in the message. Correct the recorded result, tool name, ledger value or message reference. The runner skips the block until fixed. |
| `GIVEN_CANONICAL_UNPAIRED` | A canonical prefix has a tool call with no output or error. | Record its result when available. This warning alone does not stop the block. |
| `GIVEN_CHAIN` | `expect.ledger_add` contradicts a fact already in the starting ledger. | Correct the starting fact or the expected addition. This warning alone does not stop the block. |
| `GIVEN_SUMMARY_MISSING` | With `--summaries`, a named session state or workspace folder lacks a summary. | Add `given.summary` for the state or `world.workspace.summary` for the folder. |
| `LINK_TARGET_UNKNOWN` | A prompt has no supplied registry, or its registry has no referenced section. | Pass the matching registry with `--sections`; correct the section id when it is absent. Missing registries warn; missing sections in supplied registries fail. |
| `LINK_STALE` | A link declares `stale`, or its section no longer resolves in the registry version. | Declare the section span again and review the link before updating its status. |

### Inventory and space coverage

| Code | Cause | Fix |
|---|---|---|
| `UNKNOWN_BEHAVIOUR` | A spec's `covers` names a behaviour absent from the inventory. | Correct the id or add the intended behaviour to the inventory. |
| `UNKNOWN_FLOW` | A `flow:` tag names a flow absent from the inventory. | Correct the tag or define the flow in the inventory. |
| `UNLISTED_CHANNEL` | A spec's channel is absent from the inventory's declared channel list. | Correct the channel or add it to the list. These specs count for no listed channel. |
| `KIND_MISMATCH` | A behaviour is covered only by specs of a different kind. | Add a spec matching the behaviour's kind, or correct a mistaken kind declaration. |
| `UNPLACED_SPEC` | A spec reaches no allowed cell at the requested coverage strength. | Supply missing dimension values or correct constraints that exclude every cell it reaches. |
| `FORBIDDEN_CELL` | A spec reaches cells forbidden by the space constraints. Those cells are not counted. | Correct the spec's placement or the constraint, according to the intended test space. |
| `PRIOR_EMPTY` | The prior assigns no weight to any allowed cell. No weighted share is computed. | Give allowed values positive prior mass and check the constraints. |

### Estate maps and plans

| Code | Cause | Fix |
|---|---|---|
| `MAP_PARSE` | The map cannot be read or its YAML cannot be parsed, including duplicate keys. | Correct the path, access or YAML syntax named in the message. |
| `MAP_NOT_OBJECT` | The map's top level is not one mapping. | Use the estate map file emitted by `estate scan`, not a list or a scalar. |
| `MAP_DUPLICATE_ATOM` | The map lists an atom id twice. | Regenerate the map from the estate. Do not patch hashed atoms by hand. |
| `MAP_UNKNOWN_ATOM` | An edge names an absent atom, or approval selects an unknown atom id. | For approval, copy an id from the map. For a broken graph edge, regenerate the map. |
| `PLAN_PARSE` | The plan cannot be read or its YAML cannot be parsed, including duplicate keys. | Correct the path, access or YAML syntax named in the message. |
| `PLAN_NOT_OBJECT` | The plan's top level is not one mapping. | Use the plan file emitted by `estate plan`, not a list or a scalar. |
| `PLAN_DUPLICATE_ROW` | The plan repeats a row id. | Regenerate the plan from its map into a new file, then review its approvals. |
| `PLAN_UNKNOWN_ROW` | Approval names a row absent from the plan. | Copy the row id from that plan. No rows change when a requested id is unknown. |

An event edge may target an event node instead of an atom. That exception does not permit other edges
to name missing atoms. See `validate-estate-scan` for hash and quote drift errors.

### Model responses

These are model port errors, not scores for an agent response. A failed model request is not evidence
that the agent failed its task. Do not print API keys while diagnosing these errors.

| Code | Cause | Fix |
|---|---|---|
| `bad_response` | A successful HTTP response is not JSON, or lacks the provider's expected response structure. | Check the endpoint and its API compatibility. Inspect the response structure without credentials. |
| `empty` | The response has no usable nonblank text. | Check the selected model and endpoint support text output. Review the request before retrying. |
| `exhausted` | A fake model port has no recorded answer left for the next request. | Add a fixture answer for each expected call, or fix an unexpected extra call. This is not an HTTP retry limit. |
| `network` | The transport cannot reach the model endpoint. | Check the base URL, DNS, proxy and connection. Retry after connectivity is restored. |
| `refusal` | The provider refuses the request or reports a content filter stop. | Review the request and remove unintended sensitive content. Do not treat a refusal as generated test text. |
| `reasoning-budget-exhausted` | The `claude` judge ran out of output budget before it wrote an answer, and the one recovery with a lower effort did not settle it. The recovery is skipped when it would pass the spend cap or the submission ceiling. | Run again with a smaller request (fewer or shorter entries per call), or a higher `--judge-budget` when the cap skipped the recovery. |
| `truncated` | The provider stops at the answer's token limit. | Reduce the requested output, or raise the output limit where the calling operation supports it. |
| `config` | The model port lacks required configuration, such as an API key or OpenAI model name. | Set the required environment values for that provider. See `core-configuration`. |
| `http` | The provider returns an unsuccessful HTTP status. | Read the status and provider message. Fix credentials or request details for permanent errors; retry temporary failures later. |
| `timeout` | A model request exceeds its transport timeout. | Check endpoint health and request size before retrying. Other commands can also use this word for their own time limits. |
