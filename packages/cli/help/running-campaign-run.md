---
title: Run a campaign
summary: Run every cell of a campaign (specs x targets x modes x repeats) on the agent, check every block, print pass or fail per cell and keep the runs in a store.
commands:
  - campaign run
see_also:
  - running-campaign-plan
  - running-outcomes
  - running-cells-and-repeats
  - running-targets
  - running-modes
  - running-store
  - running-cache
  - running-budget-and-prices
  - running-retries
  - running-campaign-config
  - running-campaign-resume
  - running-change-carry
  - running-simulate
  - running-process-and-sandboxes
  - running-realized-text
next:
  - running-outcomes
---

## What it is

`driftbench campaign run` is the command that tests an agent. It reads spec files, makes one cell per spec, target, mode, repeat and (in mode P) perturbation, and runs every cell: the runner sends each block of the spec to the agent through an adapter, applies every machine check to the agent's answer, and records the run. It prints one line per cell (pass, fail, failed or stopped) and a summary. With `--store <file>` the campaign, its specs, its runs and a cache of observed blocks go into a SQLite file, so you can read the results again (`campaign status`), finish an interrupted campaign (`campaign resume`), report on it or compare it with another campaign.

## When to use it

* To test an agent against a suite of specs, once or with repeats, in one or more run modes.
* To produce a stored campaign that later commands read: `campaign status`, `campaign resume`, `campaign export`, `report`, `compare`, `ci`.
* To run only what a change can affect and carry the rest from an earlier campaign: `--change` (topic running-change-carry).
* To let a simulated user write the user turns instead of the spec: `--driver simulated` (topic running-simulate).
* Not to preview cells or cost: use `campaign plan` (topic running-campaign-plan). Not to check determinism: use `smoke` (topic running-smoke). Not to finish a stored campaign: use `campaign resume`, because `run` always creates a new campaign.

## Commands and every option

```text
driftbench campaign run [paths...] [--dataset <name[@version]>] [--prompt <name[@version]>] [--target <adapter[:agent]>]... [--route <tag=target>]... [--mode <modes>] [--repeats <n>] [--agent-version <label>] [--change <manifest> --from <campaign> [--audit <n>] [--audit-seed <n>] [--max-carry <n>] [--max-age <days>] [--block-reruns]] [--record-end-state-snapshots] [--record-realized-text] [--campaign <id>] [--store <file>] [--no-cache] [--cache-suite <name>] [--concurrency <n>] [--budget-usd <usd>] [--prices <file>] [--process-command <command>] [--driver <driver>] [--persona <file>]... [--recording <file>]... [--model] [--agent-family <family>] [--judge-family <family>]... [--retry-attempts <n>] [--retry-base-ms <ms>] [--retry-max-ms <ms>] [--json] [--config <file>]
```

What to run:

| Option | Default | Effect |
|---|---|---|
| `[paths...]` | none | spec files or folders. A folder is searched recursively for `*.yaml`, `*.yml` and `*.spec.json`. With no path and no `--dataset`, the `specs:` and `dataset:` of the config's `campaign:` key are used. |
| `--dataset <name[@version]>` | none | run the specs of this dataset version of the store (beside any paths) and record the version in the campaign. Needs `--store`. Without `@version`, the latest version. |
| `--prompt <name[@version]>` | none | the agent runs with this prompt version of the store: every target carries its text in `target.prompt`, and the campaign records the version. Give it once only, and the version must hold one UTF-8 text file. Needs `--store`. |
| `--target <adapter[:agent]>` | none: each spec on its own target | run every spec on this target; repeat for several (topic running-targets). |
| `--route <tag=target>` | none | with `--target`: a spec carrying the tag runs on this target instead; repeat for several. |
| `--mode <modes>` | `F` | `T`, `F`, `P`, or several separated by commas (topic running-modes). |
| `--repeats <n>` | `1` | runs per spec, target and mode; at least 1 (topic running-cells-and-repeats). |
| `--agent-version <label>` | none | the version of the agent under test. It goes into every block cache key, it is written as the `variant` of every target that names none (so it is part of the cell id), and the campaign stores it. Change it whenever the agent changes behind the same target name. |

Running only a change (topic running-change-carry):

| Option | Default | Effect |
|---|---|---|
| `--change <manifest>` | none | run only the blast radius of this change manifest and carry the stored runs of the other cells. Needs `--from` and `--store`. |
| `--from <campaign>` | none | with `--change`: the stored campaign the carried runs come from. |
| `--audit <n>` | none | with `--change`: run n of the cells about to be carried and compare each with its stored run; one miss carries nothing and exits 1. |
| `--audit-seed <n>` | `1` | with `--audit`: the seed of the draw. |
| `--max-carry <n>` | `5` | with `--change`: the most campaigns in a row a result may be carried. |
| `--max-age <days>` | `7` | with `--change`: the most days since a carried result was measured. |
| `--block-reruns` | off | with `--change` and mode T: send only the blocks a change can affect and keep the other stored blocks of a cell. |
| `--record-end-state-snapshots` | off | store the raw end-state values each mode T block reads, so a later `--block-reruns` can rerun cells that check an end state. The values may be sensitive. |
| `--record-realized-text` | off | store the text a driver sent where it differs from the spec (a simulated user, a red-team attacker) as `realized.text`, for replay and audit. Off, each such block keeps only the text's hash. The text may be private. A resumed campaign keeps the choice. Whole-run and block carries follow this new campaign’s choice, not the baseline’s; missing source text is never reconstructed. Topic running-realized-text. |

Where results go (topics running-store and running-cache):

| Option | Default | Effect |
|---|---|---|
| `--campaign <id>` | `c-` and a hash of the specs, targets, modes, repeats and the clock | the campaign id. An id the store already holds is refused. |
| `--store <file>` | none: an in-memory store, gone when the command ends | keep the campaign, its specs, its runs and the cache in this SQLite file; made when missing. |
| `--no-cache` | cache on | neither replay runs from the cache nor write to it. |
| `--cache-suite <name>` | none | the cache suite: its name enters every block cache key, so a new name starts from an empty cache and other suites stay in the store. |

How it runs:

| Option | Default | Effect |
|---|---|---|
| `--concurrency <n>` | `4` | cells that run at the same time; at least 1. |
| `--budget-usd <usd>` | none | a hard stop: no cell starts once the campaign has spent this much (topic running-budget-and-prices). |
| `--prices <file>` | the `prices:` key of `driftbench.yaml` | a dated USD token price table, to price adapters that report tokens and no dollars. |
| `--process-command <command>` | none | the command that runs the agent of any `process:<name>` target other than `process:acme-ops`: a JSON list such as `["python3","/abs/agent.py"]`, or words split on spaces. It runs inside a temporary sandbox folder, so give absolute paths (topic running-process-and-sandboxes). |
| `--retry-attempts <n>` | `4` | attempts per model call, the first included, over the spec target's `retry` (topic running-retries). |
| `--retry-base-ms <ms>` | `500` | the wait before the first retry, doubled for each later one. |
| `--retry-max-ms <ms>` | `30000` | the longest wait between two attempts. |

Who writes the user turns (topic running-simulate):

| Option | Default | Effect |
|---|---|---|
| `--driver <driver>` | `scripted` | `scripted`: the spec's own user turns. `simulated`: a simulated user plays a persona. |
| `--persona <file>` | none | with `--driver simulated`: a persona file; it plays the spec its `spec:` field names. One per spec; repeat it. |
| `--recording <file>` | none | with `--driver simulated`: replay the answers of a recording, by turn; repeat for several personas. |
| `--model` | off | with `--driver simulated`: the user speaks through the model port the environment configures. A paid call per turn. |
| `--agent-family <family>` | `none` for the Acme targets; required for any other target with `--driver simulated` | the model family of the agent under test, or `none` for an agent that is not a model. |
| `--judge-family <family>` | none | a model family of the judges; repeat it. The simulated user's model must differ from the agent's and the judges' families. |

Judging and the checks (the judges run only on criteria a block names; topics judging-council, judging-run-judge and judging-machine-checks):

| Option | Default | Effect |
|---|---|---|
| `--judge <kind:model>` | none | judge the judged criteria with this judge, such as `claude:haiku` or `openai:<model>`. Kinds: claude, openai, anthropic, google, openai-decisions, jev, http (`http:<family>@<url>`). Repeat it for a council. Keys come from the environment. Paid calls. |
| `--judge-command <path>` | `claude` | the claude command a claude judge runs. |
| `--judge-budget <usd>` | none | stop judging once the judges have spent this much. A billed claude judge needs it. |
| `--judges <cassette>` | none | add every judge of this recording (a cassette JSON file) as a player: no call. |
| `--judge-mode <mode>` | from the judge classes | the council mode: `system1`, `hybrid` or `llm`. |
| `--assignments <file>` | none | the council assignment table `judge calibrate` wrote. |
| `--cascade` | off | the council runs its cheapest judge first and stops on a sure pass. |
| `--weights <weights>` | none | council vote weights, `judge=weight,...`, or a YAML file of `judge: weight`. |
| `--judge-route <route>` | none | route each call through a label-blind router: `escalation`. |
| `--route-first <judge>` | none | with `--judge-route escalation`: the judge that answers first (`kind:model` or a judge id). |
| `--route-then <judge>` | none | with `--judge-route escalation`: a judge asked when a trigger fires. Repeat for several. |
| `--route-on <triggers>` | `order-split,inconclusive,reference-disagreement,low-confidence` | with `--judge-route escalation`: the triggers, comma separated. |
| `--route-confidence <p>` | `0.5` | with `--judge-route escalation`: the low-confidence bar, from 0 to 1. |
| `--route-decide <rule>` | `majority` | with `--judge-route escalation`: `majority` or `first-stands`. |
| `--panel-weights <weights>` | none | a weighted panel of every judge, `judge=weight,...` or a YAML file. A thin margin abstains. |
| `--panel-margin <share>` | `0.3` | with `--panel-weights`: the smallest winning margin, as a share of the total weight. |
| `--reference-solve <kind:model>` | none | solve each question blind first, and judge against the agreed answer. Kinds: claude, openai, anthropic, google. |
| `--reference-samples <n>` | `5` | with `--reference-solve`: how many solves, from 1 to 20. |
| `--reference-route <route>` | none | with `--reference-solve`: `auto` solves only a question with one checkable answer. |
| `--verify <kind>` | none | check what the reply states before the judge reads it. `arithmetic`: explicit equations, in a bounded sandbox. |
| `--prompt-budget <chars>` | none | drop the oldest transcript entries until the judge prompt fits this many characters. The last block stays. |
| `--record <cassette>` | none | save every live judge answer as a cassette, to replay with `--judges`. |
| `--owner <values...>` | none | the owner's own email, phone, IBAN or national number: the `pii` check leaves exactly these out. |
| `--owner-file <file>` | none | owner values for the `pii` check, one per line. `#` starts a comment line. |
| `--tool-policy <rules>` | none | a run-wide tool policy, a YAML list of `{ pattern, action: allow \| deny \| ask }`. A call a rule denies (ask counts as denied) fails its block's `tool_policy` check. It checks the calls; it does not stop the agent making them. |
| `--embedder <name>` | none | the embedder the `similarity` check scores with, as a plugin registered it. |

Output and config:

| Option | Default | Effect |
|---|---|---|
| `--json` | off | print one JSON document instead of the lines (topic running-outcomes). |
| `--config <file>` | `driftbench.yaml` in the working folder, when it exists | the project config; its `campaign:` key fills every flag the command line does not give (topic running-campaign-config). |
| `--plugin <module>` | none | global option: load a plugin first (topic running-plugins). |

## Inputs

* Spec files, from the paths, from `--dataset`, or from the config's `specs:`. Every spec must be valid; one invalid spec stops the command before anything runs.
* The target of every spec: `--target`, a `--route`, or the spec's own `target:`. Each target must resolve to an adapter (topic running-targets).
* Optionally a store file, a config file, a price file, persona and recording files, a change manifest.
* Environment variables only where a target or the model port needs them, such as `DRIFTBENCH_HTTP_URL` for an `http` target (topic running-targets-from-settings).

## Outputs and how to read them

Text output, on stdout:

1. `Note: <spec> names the <adapter> adapter; --target runs it on <target>.` for each spec a `--target` overrides.
2. With `--driver simulated`: `Driver: simulated, persona <id> on <spec>, <source>.`
3. `Campaign <id>: <n> cells, <c> at a time.[ Budget $<usd>.] Checks: <the machine checks every block gets>.`
4. `Not judged: ...` when the specs name judged criteria and the campaign loads no judge: those criteria get no verdict and count in no pass or fail.
5. With `--change`: the blast radius lines (topic running-change-carry).
6. One line per cell, in cell order: `<mark> <spec> · <target> · <mode> · repeat <n>[ · <perturbation>]  <state>[ (<notes>)]  <detail>`. The mark is `✓` pass, `✗` fail, `!` failed or stopped. A fail lists the gating verdicts that did not pass as `block <index> <verdict id>`. Notes are `reused`, `replayed from the cache` or `carried from <campaign>, age <n> campaigns` (topic running-outcomes).
7. `<n> cells: <p> pass, <f> fail, <e> failed[, <b> stopped by the budget][, <r> reused][, <c> carried]. Spent $<usd>.` The spend counts only the runs of this command that were neither reused nor replayed from the cache.
8. Without `--store`: `The runs are not kept: pass --store <file> to keep them.`

On stderr: errors, and the note that a budget does not count simulated-user or judge calls.

With `--store`, the store gains the campaign record, the specs at their content hash, one run per cell (filed as each finishes), and the cache entries. The run id of a cell is its cell id.

Exit codes: 0 when every cell passes; 1 when a cell fails, failed or was stopped (the budget included), or when a `--change` audit finds a miss; 3 when no cell failed but a cell was not run or blocked (a Given the target cannot apply: no pass, no failure); 2 on bad input, when nothing ran.

## Worked example

Every Acme spec on its own target (the conversation specs on `function:acme-sales`, the price-sheet task on `process:acme-ops`), kept in a store; then the price-sheet task forced onto the chat agent, where it fails. The Acme agents are deterministic code: no model is called.

```sh
driftbench campaign run examples/acme/specs --store acme.db --campaign acme-first
driftbench campaign run examples/acme/specs/tasks/price-sheet.yaml --target function:acme --store acme.db --campaign acme-wrong-target  # exit 1
driftbench campaign status acme-first --store acme.db
```

```text
Campaign acme-first: 7 cells, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, regex, exact, injection, length, markup, starts_with, finish_reason, json, tool_f1, refusal, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
Not judged: 10 criteria in 19 blocks of 7 specs (one_question_per_turn, coverage_before_offer, checks_before_promising, resumes_pending_step, ledger_intact, and 5 more), 7 of them gating. This campaign loads no judge, so these criteria have no verdict and count in no pass or fail. See docs/concepts/judges.md.
✓ acme-new-customer-coverage · function:acme-sales · F · repeat 0  pass  4 blocks
✓ acme-number-porting · function:acme-sales · F · repeat 0  pass  5 blocks
✓ acme-off-topic-return · function:acme-sales · F · repeat 0  pass  5 blocks
✓ acme-order-loose-confirmation · function:acme-sales · F · repeat 0  pass  4 blocks
✓ acme-plan-upgrade · function:acme-sales · F · repeat 0  pass  5 blocks
✓ acme-tool-failure · function:acme-sales · F · repeat 0  pass  3 blocks
✓ acme-price-sheet · process:acme-ops · F · repeat 0  pass  2 blocks
7 cells: 7 pass, 0 fail, 0 failed. Spent $0.00.
```

```text
Note: acme-price-sheet names the process adapter; --target runs it on function:acme.
Campaign acme-wrong-target: 1 cell, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, regex, exact, injection, length, markup, starts_with, finish_reason, json, tool_f1, refusal, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
Not judged: 2 criteria in 3 blocks of 1 spec (sheet_matches_catalog, reports_what_it_did), 1 of them gating. This campaign loads no judge, so these criteria have no verdict and count in no pass or fail. See docs/concepts/judges.md.
✗ acme-price-sheet · function:acme · F · repeat 0  fail  block 0 must.0, block 0 stage.reached, block 0 skills.xlsx, block 0 guards.no_destructive_ops.pass, block 0 execution.ran_code, block 0 execution.exit_code, block 0 execution.max_commands, block 0 workspace.created, block 0 workspace.changed, block 0 workspace.deleted, block 0 workspace.others_untouched, block 0 artifacts.out/acme-price-sheet.xlsx, block 1 stage.reached, block 1 skills.xlsx, block 1 guards.no_destructive_ops.pass, block 1 execution.ran_code, block 1 execution.exit_code, block 1 workspace.created, block 1 workspace.changed, block 1 workspace.deleted, block 1 workspace.others_untouched, block 1 artifacts.out/acme-price-sheet.xlsx
1 cell: 0 pass, 1 fail, 0 failed. Spent $0.00.
```

The second command exits 1: the chat agent writes no workbook and runs no code, so the execution, workspace and artifact verdicts fail. Each entry of the failing list is `block <index> <verdict id>`; the part of the id before the first dot names the check. The third command prints the stored first campaign again from the store, with a `created` time.

## Common errors

Each exits 2, prints on stderr, and runs nothing.

* `Campaign acme-first already exists. Resume it with: driftbench campaign resume acme-first` The store already holds that id. Pick another `--campaign`, drop it to get a fresh id, or resume the stored one.
* `No adapter is set up for <target>. ...` The target resolves to no adapter; the message lists what this install reaches and the setting that is missing (topic running-targets).
* `<spec id> names no target. Give the spec a target, or run with --target <adapter[:agent]>, such as --target function:acme-sales.`
* `No spec files found.` No path and no `--dataset` given, and no `specs:` in the config; or the paths hold no spec file.
* `✗ <path>` with one line per issue, then `Fix the invalid specs first: nothing ran.` An invalid spec. Check it with `driftbench spec validate`.
* `--dataset and --prompt read the registry of a store: add --store <file>.`
* `--prompt names the one prompt the agent runs with: give it once.`
* `No dataset <ref> in <store>. Push it with: driftbench dataset push <name> <path>` (the same for a prompt).
* `--from names the campaign a radius run carries from: it goes with --change <manifest>.` and `--audit sets how a radius run carries: it goes with --change <manifest>.` (also for `--audit-seed`, `--max-carry`, `--max-age`, `--block-reruns`).
* `--change runs a blast radius and carries the rest: it goes with --from <campaign> and --store <file>.`
* `--concurrency takes a whole number of at least 1, not "0".`, `--repeats takes a whole number of at least 1, not "0".`, `--budget-usd takes a number of at least 0, not "-1".`, `--retry-attempts takes a whole number of at least 1, not "0".`
* `Unknown mode "X". The modes are T, F and P, alone or separated by commas.`
* `--driver takes scripted or simulated, not "x".` and `--persona, --recording and --model go with --driver simulated.`
* `--process-command takes a JSON list of strings or a command line, not "[]".`
* `Cannot open the store at <path>: ...` The store file is not a SQLite store, or the folder cannot be written.
* A token price error such as a missing price for a model, when `--budget-usd` is given and an adapter reports tokens only (topic running-budget-and-prices).
