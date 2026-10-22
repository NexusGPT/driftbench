---
title: The run store
summary: The SQLite file (--store) that keeps campaigns, the specs they pinned, every run with its blocks and verdicts, the block cache, cost units and versioned datasets and prompts; which commands create it and which only read it.
commands:
  - campaign run
  - campaign plan
  - campaign status
  - campaign resume
  - campaign export
  - campaign import
see_also:
  - running-campaign-run
  - running-campaign-status
  - running-campaign-resume
  - running-campaign-export-import
  - running-cache
  - running-outcomes
next:
  - running-cache
---

## What it is

The store is one SQLite database file that you name with `--store <file>`. It keeps everything a campaign produces: the campaign record, each spec at the exact content the campaign ran (by id and content hash), every run with its blocks, verdicts and events, the cache of observed blocks, measured cost units, and the versioned datasets and prompts of the registry. Without `--store`, `campaign run` uses a store held in memory, and the runs are gone when the command ends. The store uses `node:sqlite`, built into Node.js 22.13 and newer; nothing else needs installing.

## When to use it

* Always give `--store` to a campaign whose results you want to read again, resume, export, report or compare.
* Use one store per project, or one per agent under test: a store holds any number of campaigns, and `status` and `resume` take the latest when no id is given.
* Keep two experiments apart, or start from a clean cache, by giving each its own store file.
* Treat a store as sensitive: it keeps every message the agent sent and received, tool payloads included.

## Commands and every option

| Command | `--store` | When the file does not exist |
|---|---|---|
| `campaign run` | optional | created, with its missing parent folders. Without the flag, an in-memory store. |
| `campaign plan` | optional, read for cost units | created empty. |
| `campaign import` | required | created. |
| `campaign status` | required | refused: `No store at <path>: ...` |
| `campaign resume` | required | refused. |
| `campaign export` | required | refused. |

Other commands that read or write the same file (`report`, `compare`, `ci`, `monitor`, `view`, `dataset`, `prompt`, `pilot run`) are in their own topics.

The project config can name the store for `campaign run` and `campaign plan`: `store:` under `campaign:` (topic running-campaign-config).

## Inputs

A path. A relative path is read from the folder you run the command from. Any file name works; `.db` is a convention.

What the store holds, one table each:

| Table | Holds |
|---|---|
| `campaigns` | one record per campaign: id, the pinned specs (id, hash, own target), targets, modes, repeats per mode, budget (0 means none), agent version, the dataset and prompt versions it ran, provenance, and creation time. A campaign never changes once written. |
| `specs` | each spec a campaign pinned, by id and content hash, as canonical JSON. `status` and `resume` read specs from here, not from disk. |
| `spec_objects` | the identities and hashes of the objects resolved when a spec was stored. Reading a stored spec validates its structure without reopening project files. |
| `runs` | one row per campaign and run id (a run id is a cell id, so the same cell run in two campaigns gives two rows). A run put again under the same campaign and run id replaces the first. |
| `blocks` | one row per block of a run: its Given hash, what the agent did (observed), the verdicts, the drift classes and whether it passed. |
| `cache` | observed blocks and end-state reads by cache key (topic running-cache). |
| `units` | measured cost units per adapter, read by `campaign plan` for its projection. No command records units during a run; code puts them with the store's `putUnit`. |
| `blobs`, `versions` | the registry of datasets and prompts: each file once by its SHA-256, and one immutable row per version (`dataset` and `prompt` commands). |

A run record holds `runId`, `specId`, `specHash`, `identityHash` (the spec hash without its `version` label, which the run id is made from; absent in a run stored before it), `target`, `mode`, `repeat`, `perturbationId`, `status` (`completed`, `failed` or `stopped`), `error`, `blocks`, `succession`, `recovery` (mode P), `endState`, `cost`, `latencyMs`, `startedAt`, `finishedAt`, `cacheHit`, `events`, `provenance`, and `carried` on a run copied by `--change`. More fields are in the table below.

Each block (`blocks[]`) holds `index`, `blockId`, `parent` (the authored parent id, when the block has one), `specIndex` (its authored position, when parent scheduling changes the order), `injected` (true on a block the run added, such as a perturbation), `realized` (present when the text the driver sent differs from the text the spec wrote: `hash`, and `text` only when the run asked for it), `realizedTextStripped` (on a copy whose text was dropped by the destination's privacy policy: `fromRun`, and `fromCampaign` when it is known; topic running-realized-text), `givenHash`, `cacheKey`, `observed`, `verdicts`, `stageObserved`, `provenance` (the stamps below), `resolved` (on newer records: the objects the block was scored with and one hash over them), `diagnoses`, `ledgerCheck` (`ok`, and `contradictions`, the ledger facts that contradict an earlier one), `drift` (the drift classes of a failing block), `skippedForBudget` (diagnostic steps left out for want of budget; below) and `pass`. An unmeasured block also holds `status` (`not_run` or `blocked`) with `notRun` (`kind`, `layer`, `check`, `expected`, `got`) or `blocked` (`by`, `root`, `reason`); topics running-not-run and authoring-parent-blocks. A block copied from another run holds `carried`, and a re-judged block `rejudged`.

Each verdict of a newer record carries `by`: the object (`kind:id@hash8`), the item, the implementation and the layer that produced it. For a tool input decided by a value-check policy, `by.object` names that resolved policy, `by.layer` names the policy's origin, and `by.item` names the deciding rung. An aggregate failure names the first failing value's rung; an inconclusive aggregate names the first inconclusive value's rung. A passing aggregate names the latest (loosest) deciding rung in the policy's item order. `valueCheck[]` retains every value's decision in call and path order. If no rung decides a differing value, `by.item` is `exact_fallback` and `by.impl` is `builtin:value-check/exact`. A policy supplied directly by code carries its resolved reference, or a hash of its contents when no reference is supplied, at the `cli` layer. Verdict IDs and counts do not change. Artifact metadata does not contain file bytes. A partial rerun runs artifact-dependent blocks fresh; whole-cell re-scoring refuses an observation that needs unstored artifact bytes.

### Run record, field by field

The record is JSON in the `json` column of `runs`. A field marked optional is absent when it does not apply. Every hash is the SHA-256 of canonical JSON; the record stores the hash and never the text behind it.

| Field | Holds |
|---|---|
| `endState` | The end state check: `match` (true when the observed end state equals the expected one) and `diff`, a list of `{ field, expected, observed }`, one per field that differs. Optional. |
| `realizedTextStripped` | Present on a copy whose driver text was dropped: `fromRun`, and `fromCampaign` when it is known. Topic running-realized-text. Optional. |
| `endVerdict` | `success`, `failure` or `inconclusive`: the end verdict of the driver or the spec. `inconclusive` means the run could not be judged. Optional. |
| `endStateValue` | The end state the adapter returned for the end-state checks, as the checks saw it. `null` when its source recorded nothing. Absent when no end state was read, and on runs stored before the field existed. |
| `blockRerun` | Present on a run that reran only some blocks (`--block-reruns`) or replayed parent blocks. `selected` lists the block indexes asked for. `downstreamNotRerun` lists the later indexes taken from the baseline instead of rerun. `reason` says why (topic authoring-parent-blocks). |
| `diagnoses` | What the run-scope diagnostics wrote over the whole run: the same entries as a block's `diagnoses`, below. They never change a pass. Absent when none ran. Optional. |
| `skippedForBudget` | A whole number, at least 1: run-scope diagnostic steps skipped because their run or model budget was spent. Absent when none. Optional. |
| `provenance` | The execution stamp, below. Optional; a run without it cannot be carried or re-judged. |
| `provenanceDigest` | A SHA-256 over the run stamp and the stamp of every block (index, `blockId`, `parent`, `specIndex`, `injected`, `realized`, `realizedTextStripped`, `givenHash` and the block `provenance`), and the `realizedTextStripped` of the run. A change to any stamp changes it. Optional. |
| `rejudged` | Present on a run made by `campaign rejudge`: the stamp below. |
| `carried` | Present on a run copied by `--change`: `fromCampaign`, `fromRun`, `agentVersion` (the version that produced the result, when named) and `age` (`campaigns`, `days`). Topic running-change-carry. |
| `succession` | Drift over the blocks: `driftCount` (failing blocks), `driftRate` (failing blocks divided by blocks that passed or failed), `firstDriftBlock` (index of the first failing block; absent when none fails), `longestClean` (longest stretch of passing blocks) and `minOverBlocks` (true when the run has blocks and every one passes). A `not_run` or `blocked` block is left out of the rate and ends a clean stretch. |
| `recovery` | Mode P, when the perturbation writes `recovery`: `injectedAt` (index of the injected block), `turnsToRecover` (blocks after the injection until a block passes every gating check and reaches its target stage; 0 is the injected block itself; absent when it never recovered), `label` (`immediate`, `late` or `never`), `collateral` (with a free-running reference run: blocks after the injection that fail a check they passed there; without one: blocks after the recovery that fail again), `safeAction` (false when a detour block made a call the spec forbids, made a consequential call it does not name, or failed a gating `forbidden` or `safety` verdict) and `clarified` (true when the detour asks a question before its first consequential call, or asks one and makes none). |

`provenance` fields (version 2):

| Field | Holds |
|---|---|
| `driver.idHash` | Hash of the driver id. |
| `driver.seedsHash` | Hash of the seeds the driver declared. `null` when it declared none; a driver that uses no randomness declares `{}`. |
| `adapter.idHash`, `adapter.versionHash` | Hashes of the adapter id and version. |
| `adapter.cacheIdentityHash` | Hash of the adapter's cache identity. `null` when it has none. |
| `adapter.requiresCacheIdentity` | `true` when the adapter or the target's adapter is `process`. |
| `agentVersionHash` | Hash of the agent version taken from the target. `null` with no target. |
| `targetVersionHash` | Hash of the target's `variant` and `prompt`. Optional. |
| `agentVersionLabelHash` | Hash of the `--agent-version` label. `null` when none was given. Optional. |
| `executionHash` | Hash of everything that decides what the agent receives: driver, adapter, the rest of the target, mode, repeat, perturbation id, tool policy, retry and step limit. |

Each block also holds the block `provenance`: `specIndex` (the authored position), `stimulusHash` (hash of the stimulus sent), `ledgerHash` (hash of the ledger at the block), `artifacts` (a list of `{ pathHash, sha256 }`: the hash of the path of each file a check read, and the SHA-256 of its bytes; `sha256` is `null` when no digest is known) and `endState`, the end state a check read, kept when `--record-end-state-snapshots` is on. `endState` is `{ kind: unavailable }` when nothing could be read, or `{ kind: read, values }`, with one `{ source, kind, value }` per source: `kind` is `value` (with the `value`) or `undefined` (the source held nothing). A block taken from another run adds `carried`: `fromCampaign`, `fromRun`, `agentVersion`, `age` (as in the run `carried`) and `measuredAt`, the time it was measured, which `--max-age` reads. The block `rejudged` stamp has the same fields as the run one.

The `rejudged` stamp, on a run and on a block, proves the stored observation still fits the new spec:

| Field | Holds |
|---|---|
| `fromCampaign`, `fromRun` | The campaign and run the observation came from. |
| `oldSpecHash`, `newSpecHash` | The content hashes of the spec before and after the change. |
| `compatibilityHash` | The observation-compatibility hash. It is the same for the old and the new spec, which proves that nothing the agent receives or does has changed (topic judging-campaign-rejudge). |
| `criteria` | The criteria that were judged again. |
| `judgedAt` | When they were judged. |
| `judgeCostUsd` | The cost of the judge calls. Optional. |

### Campaign record, field by field

| Field | Holds |
|---|---|
| `campaignId` | The campaign id. |
| `specs` | The pinned specs, as `{ id, hash, target }`: the spec id, its content hash, and the one target the spec runs on (without it, the spec runs on every target of the campaign). |
| `targets` | The targets of the campaign (adapter, agent, variant and so on). |
| `repeats` | Repeats per mode, as `{ T, F, P }`. |
| `modes` | The run modes of the campaign: `T`, `F`, `P`. |
| `budgetUsd` | The budget in USD; 0 means none. |
| `judge` | How judged criteria are scored: `mode` (`system1`, `hybrid` or `llm`), `judges` (the judge names) and `assignment` (optional). |
| `createdAt` | When the campaign was created. |
| `agentVersion` | The explicit agent version the block cache uses, kept when the campaign resumes. Optional. |
| `sources` | The registry versions the campaign ran, as `{ kind, name, version, hash }`: `kind` is `dataset` or `prompt`, `version` is the registry version, `hash` the SHA-256 of its content. Optional. |
| `provenance` | `version` 2; `endStateSnapshots: true` when the campaign records end-state snapshots; `realizedText: true` when it stores the text a driver sent; `adapters`, one entry per adapter with `idHash`, `versionHash`, `cacheIdentityHash`, `requiresCacheIdentity`, `targetHash` and `agentVersionHash`, hashed as in a run. |
| `rejudged` | One stamp per re-judged run, as above. |
| `diagnoses` | What the campaign-scope diagnostics wrote over the runs, when the command that wrote the record ran them: the same entries as a block's `diagnoses`, in the table below. Optional. |
| `radius` | Present on a campaign run with `--change`: `manifest` (hash of the change manifest), `fromVersion` and `toVersion` (the agent versions the manifest goes between), `changes`, `from` (the campaign the carried runs came from), `whole` (set when the radius was the whole suite: `change` and `reason`), `fresh`, `carried` and `outside` (cell counts), `refused` (why cells outside the radius ran fresh, as `{ reason, cells }`) and `audit` (`sampled`, `misses`, `seed`, and `missed`, the cells whose fresh run disagreed with the stored one, as `{ specId, cellId, differing }`). Topic running-change-carry. |

### Block record: observed, verdicts and events

Each block of a run holds `observed` (what the agent did) and `verdicts` (what the checks and judges made of it). The run holds `events`. A field marked optional is absent when the adapter or the runtime does not report it.

`observed` fields:

| `observed` field | Holds |
|---|---|
| `segments` | What the agent produced, in order. A segment has a `type`: `text` (`text`), `tool_call` (`id`, `label`, `input`), `tool_result` (`id`, `label`, `output`, `error`) or `card` (`name`, `data`). Each may carry `latencyMs` and a `cost`. |
| `text` | The reply text. |
| `toolCalls` | One record per call: `id`, `spanId` (the trace span the call ran in, an OpenTelemetry span id, when the adapter has one), `label`, `input`, `output`, `error`, `startedAt`, `latencyMs`, and for a call a helper made, `actor` (`helper`) and `parentCallId` (the id of the Agent call that began the helper). |
| `helperCalls` | The calls the helpers made, one record per call: `id`, `spanId`, `label`, `input`, `output`, `error`, `startedAt`, `latencyMs`, `actor` (always `helper`) and `parentCallId` (the id of the Agent call that began the helper). Absent when the adapter records none. |
| `runtime` | What the runtime did around the model, below. Optional. |
| `artifacts` | Files the agent left in its workspace: `path`, `kind`, `sha256`, `bytes`. |
| `workspaceDiff` | What changed in the workspace during the block, as three lists of paths: `created`, `changed` and `deleted`. |
| `executions` | One record per command the agent ran, below. |
| `sandbox` | The sandbox of the block, when the adapter owns one: `kind`, `isolation` (`strong` or `weak`; reports say weak isolation from this field) and `root` (where it sits, optional). |
| `cost` | `model` (the pricing key), `inputTokens`, `outputTokens`, `cachedInputTokens` (cache reads, already counted in `inputTokens`), `usd`, and `helperInputTokens` and `helperOutputTokens` (the tokens the helpers used, apart from the agent's own), `helperModel` (the model the helpers ran on, when the records name one) and `helperUsd` (the dollars for the helper tokens, priced with `helperModel` or else the agent's model; `usd` is the total, the agent's and the helpers'). Each is optional. |
| `latencyMs` | The time the block took. |
| `retries` | Every retry the calls of the block took, the adapter's own and the runner's, in order: `call` (which call), `attempt` (the attempt that failed, from 1), `status`, `reason`, `delayMs`, `retryAfterMs` (what the server's Retry-After asked, when it sent one) and `at`. Absent when none. |
| `historyNormalizations` | A history turn a wire serializer left out because its text was empty: `wire` (such as `anthropic` or `google`), `historyIndex` (the turn's zero-based index in the history sent for this block, system messages included), `role` and `kind` (always `omitted-empty-turn`; no placeholder text replaces the turn). Absent when nothing was omitted. |
| `raw` | Whatever the adapter chose to keep from its own response, as it returned it. Optional. |

`observed.runtime` fields:

| Field | Holds |
|---|---|
| `skills` | Skills loaded: `name`, `at`. |
| `guards` | Runtime checks that fired: `name`, `verdict`, `at`, and when the runtime reports them `stdout`, `stderr`, `exitCode` and `outcome` (the runtime's own word for how the guard ended: `success`, `blocking`, `cancelled` or `no_response`). |
| `stages` | Stages reached: `name`, `at`, and `carried: true` for a stage carried into the block instead of reported during it. |
| `references` | Files the agent read, as `{ path, at }`. |
| `finishReason` | Why the model stopped, such as `stop` or `length`. |
| `offered` | The names of the tools the runtime offered the agent in the block. |
| `subagents` | Helpers the agent dispatched: `name`, `model`, `at`. |

An `executions` record holds `command`, `role` (`agent` for the agent's own process, `command` for a command it ran), `exitCode`, `stdout` and `stderr` (bounded), `startedAt`, `latencyMs`, `truncated` (true when the output was cut) and `approval`. `approval` is the decision of the approval policy on this command and its folder, and is absent when no policy is set: `decision` (`allow` or `deny`), `by` (`rule`, `default`, `approver` or `no-approver`), `match` (`command` or `path`), `subject` (what was matched) and `pattern` (the rule that matched, optional).

A `verdicts` entry is one check on one block:

| Field | Holds |
|---|---|
| `id` | The verdict id, such as `must.1` (topic authoring-blocks). |
| `kind` | `machine` (final) or `judge` (carries its votes). |
| `name` | The check or criterion name. |
| `gating` | True when a fail fails the block. |
| `outcome` | `pass`, `fail`, `inconclusive` or `not_applicable` (the run never produced the subject of the check, such as a stage check with no stage record). |
| `score` | A number, when the check gives one. |
| `evidence` | What the check saw. |
| `reasoning` | The judge's reasoning. Optional. |
| `by` | What produced the verdict: the object (`kind:id@hash8`), its item, the implementation and the layer. Absent on older records. |
| `judge` | On a judge verdict: `cls` (`system1` or `system2`) and `votes`. |
| `valueCheck` | On a tool check that compared argument values: one entry per value a rung of the value-check policy decided. `call` is the call, from 1; `path` is the value's path; `rung` is the policy item that decided it, or `exact_fallback`; `outcome` is its outcome. `changedInputsFail` is true on a computed value (`recompute`) that is right on the given inputs and wrong on changed inputs; blame reads it as special-casing. Absent when every value equalled the gold or the assertion compares as written. |

A block of a newer record also holds `resolved`, `diagnoses` and `skippedForBudget`, described next.

`skippedForBudget` is a whole number, at least 1: how many diagnostic steps of cost class `run` were left out because the diagnostic budget was spent. It is absent when none was left out.

The `by` of a verdict or a diagnosis says what produced it:

| Field | Holds |
|---|---|
| `object` | The resolved object as `kind:id@hash8`: a check set, a policy or a diagnostic. |
| `item` | The rule inside the object. Optional. |
| `impl` | The implementation that ran the rule, such as `builtin:check/outcome`. |
| `layer` | The layer that last set the item: `shipped`, `project`, `suite`, `spec`, `block` or `cli`. |

The `resolved` field of a block names the objects the block was scored with:

| Field | Holds |
|---|---|
| `objects` | One entry per `uses` key that resolved. |
| `objects[].key` | The `uses` key, such as `check_set`, `value_check`, `blame` or `diagnostics`. |
| `objects[].kind`, `objects[].id` | The kind and the id of the resolved object. |
| `objects[].hash` | The content hash of that object. |
| `objects[].setAt` | The layer whose reference chose it. It is `shipped` when no layer named one. |
| `hash` | One content hash over `objects`. Equal objects give equal hashes, run after run. |

Each entry of `diagnoses` is what a diagnostic wrote about the block after its checks. A diagnosis explains a verdict. It never changes `pass`. Only `diagnostic`, `summary` and `by` are always present:

| Field | Holds |
|---|---|
| `diagnostic` | `diagnostic:<id>@hash8` of the diagnostic that wrote it. |
| `step` | The step of that diagnostic. Optional. |
| `verdictRef` | The verdict the diagnosis is about. Optional. |
| `rule` | The rule that fired, as `kind:id@hash8#item`. Optional. |
| `fault` | A list of names, the faults the diagnostic attributes. Optional. |
| `fixLocation` | Where the fix goes, a text. Optional. |
| `flags` | A list of names, the flags the diagnostic raised. Optional. |
| `score` | A measure the diagnosis reports, such as the share of expected arguments that matched. Optional. |
| `summary` | One line a reader can act on. |
| `evidence` | A map of what the diagnostic saw. Optional. |
| `rankedCauses` | A list of causes, each with a score. Optional. |
| `rankedCauses[].cause`, `rankedCauses[].score` | The cause, and its score. |
| `rankedCauses[].by` | What ranked it. Optional. |
| `inherits` | On a chained verdict: the id of the verdict it takes its fault from. Optional. |
| `disposition` | Who the fault is attributed to: `agent`, `shared`, `setup`, `excluded`, `credited` or `unassigned`. Optional. |
| `fixTarget`, `fixAction`, `fixForms` | What the fix changes, what it does there, and the forms it may take. Optional. |
| `placement` | The placement rule that chose where the fix goes, as `kind:id@hash8#item`. Optional. |
| `confidence` | How sure the attribution is: `static` (read statically), `undecided` or `confirmed` (by a rerun). Optional. |
| `removeCopies` | The local copies a shared fix makes redundant. Optional. |
| `by` | What produced the diagnosis, as above. |
| `via` | The executing diagnostic step, when `by` names a more specific deciding rule. It has the fields of `by`. Optional. |

A vote in `judge.votes` holds `judge` (its name), `outcome`, `winner` (on a pairwise request: `A`, `B`, `tie` or `inconclusive`; a tie differs from missing evidence), `score`, `reasoning` and `retries`, the retries of the judge call in the shape of `observed.retries`.

`events` are what the runner reported as the run went, in order, when it recorded them. Every event has a `type` and an `at` time:

| `type` | Other fields |
|---|---|
| `block_start` | `index`. |
| `model_call` | `index`, `startedAt`, and when the adapter gives them `inputTokens`, `outputTokens`, `usd` and `latencyMs`. |
| `tool_call` | `index`, `label`, `spanId` (optional), `error` (optional). |
| `retry` | `index`. |
| `block_end` | `index`, `pass`, and `status` (`not_run` or `blocked`) on an unmeasured block. |
| `run_end` | `status`: `completed`, `failed` or `stopped`. |

## Outputs and how to read them

The store prints nothing itself. Commands read it back as text or JSON (`campaign status`, `campaign status --json`, `report`, `view`). The tables are plain SQLite: any SQLite tool can read them, and each row keeps its full record as JSON in a `json` column beside the plain columns used for filters. The schema version is 3; an older store is upgraded when opened, and a store written by a newer driftbench is refused.

Writes are transactional: a run and its blocks land together, and an import lands whole or not at all. A second process waits up to 30 seconds for the file, a read as well as a write: a live holder that is slow is a wait, and a call fails with `database is locked` only after that.

## Worked example

Two campaigns of the same spec go into one store in a new folder. The second replays its run from the cache the first wrote. `status` with no id reads the latest. No model is called.

```sh
driftbench campaign run examples/acme/specs/conversations/tool-failure.yaml --target function:acme --store stores/acme.db --campaign first
driftbench campaign run examples/acme/specs/conversations/tool-failure.yaml --target function:acme --store stores/acme.db --campaign second
driftbench campaign status --store stores/acme.db
driftbench campaign status first --store stores/acme.db
```

```text
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
```

```text
Campaign second, created 2026-10-14T13:54:31.870Z.
✓ acme-tool-failure · function:acme · F · repeat 0  pass (replayed from the cache)  3 blocks
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
```

The folder `stores` was created. The store now holds two campaigns, each with a run whose id is `fab7e9a89a94b309` (the cell id), and the cache entries of the first campaign's blocks.

## Common errors

* `No store at missing.db: this command reads a store and does not make one.` (exit 2) `status`, `resume` or `export` was given a path with no file. Check the path; these commands never create a store, so a typo cannot leave an empty one behind.
* `Cannot open the store at <path>: store: cannot open the store at <path>: ...` (exit 2) The file is not a SQLite database, or the folder is not writable.
* `the store needs Node.js 22.13 or newer for node:sqlite; this is Node.js <version>` Upgrade Node.js.
* `the store at <path> has schema version <n>; this version of driftbench reads 3 and older` The store was written by a newer driftbench. Upgrade driftbench.
* `The store at <path> holds no campaign. Run one with: driftbench campaign run <paths...>` (exit 2) The file exists but holds no campaign; `campaign plan --store` creates such empty files.
* Results from an earlier agent version replayed into a new campaign: the cache lives in the store. Use `--agent-version`, `--cache-suite` or `--no-cache` (topic running-cache).

Every store message starts with `store:` and carries one of these codes. A command prints the message; the code is what code that calls the store branches on (`StoreError.code`).

| Code | Message starts with | Cause | Fix |
|---|---|---|---|
| `NODE_VERSION` | `node:sqlite is not available in Node.js <version>` | This Node.js has no `node:sqlite`. | Use Node.js 22.13 or newer. |
| `OPEN_FAILED` | `cannot open the store at <path>` | The file is not a SQLite database, or the folder cannot be written. | Check the path and the folder. |
| `SCHEMA_VERSION` | `the store at <path> has schema version <n>` (or `the bundle at <folder> has ...`) | The store or an exported bundle was written by a newer driftbench. | Upgrade driftbench. |
| `INVALID_RECORD` | `putSpec refused ...`, `putRun refused ...`, `putCampaign refused ...`, `cachePut refused ...`, `"<name>" is not a registry name ...` | A call passed a record that does not match its schema. Nothing was written. | Fix the record the message names; for a registry name use letters, digits, dots, underscores and hyphens. |
| `CORRUPT_ROW` | `... holds corrupt JSON in column <column>` | A stored row holds JSON that does not parse, does not match its schema, or does not match its key. | Restore the store from a copy or an export; do not edit rows by hand. |
| `CAMPAIGN_CONFLICT` | `campaign <id> is already stored with other content` | A campaign is immutable. `campaign run` reports this as `Campaign <id> already exists. Resume it with: driftbench campaign resume <id>` (exit 2). | Give the re-run a new campaign id, or resume the old one. |
| `CAMPAIGN_MISSING` | `exportCampaign: campaign <id> is not in the store` | The campaign to export is not in the store, or a run is put before its campaign (`putRun: campaign <id> is not in the store; put the campaign before its runs`). | Check the id with `campaign status`; put the campaign before its runs. |
| `VERSION_CONFLICT` | `<dataset or prompt> ... in this store holds other content than the bundle's` | An import would replace a registry version, and versions are immutable. | Import into another store. |
| `RUN_AMBIGUOUS` | `run <id> is in <n> campaigns` | The same run id is held by more than one campaign and the call did not say which. | Name the campaign. |
| `BUNDLE_INVALID` | `the bundle at <folder> is invalid`, `campaign <id> records <kind> <name>@<version>, which this store does not hold`, `runs <a> and <b> would share one file name on a case-insensitive disk` | An exported bundle is incomplete or inconsistent. | Export it again. |
| `CLOSED` | `the store at <path> is closed` | A call used a store after `close`. | Open the store again. |
