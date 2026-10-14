---
title: The judge of a run
summary: The --judge, --judge-command and --judge-budget options of driftbench replay and driftbench estate run, which judge the criteria blocks name with one judge on the local claude command; without --judge every judged criterion is inconclusive and a gating one fails its block.
commands:
  - replay
  - estate run
see_also:
  - judging-criteria
  - judging-default-judge
  - judging-council
  - judging-machine-checks
  - judging-families
---

## What it is

Two commands that run specs can judge the criteria a block names (`expect.criteria`): `driftbench replay` (recorded sessions, offline) and `driftbench estate run` (an estate run live). They take one judge, not a council: `--judge claude:<model>` asks the local `claude` command (Claude Code in print mode), one call per criterion per block. The judge's cost is added to the run's cost.

Without `--judge`, the judge check still runs, and every criterion a block names gets an inconclusive verdict with the evidence `no judge is configured for this run: pass --judge claude:<model> to judge it`. That verdict gates as the criterion does (`gating: true` on the definition, or `name@gating` in the block), so a block whose result hangs on a gating criterion fails without a judge. It never passes by the judge's absence.

A judge command is billed unless it is a stand-in: a file that carries the line `@driftbench-stand-in` in its first 2048 bytes. A billed judge needs `--judge-budget`.

## When to use it

* To judge the criteria of recorded sessions (`replay`) or of a live estate run (`estate run`).
* To test the judge wiring for free, with the stand-in judge `examples/estates/fixture/live/fake/judge.cjs`.
* For a council of several judges with calibrated assignments, there is no command option yet: `campaign run` loads no judge, and prints a `Not judged:` line instead. A council is built in code (see `judging-council`) or replayed on fixtures with `judge run`.

## Commands and every option

```
driftbench replay <sessions...> --suite <dir> [...] [--judge <judge>] [--judge-command <path>] [--judge-budget <usd>]
driftbench estate run <specs...> [...] [--judge <judge>] [--judge-command <path>] [--judge-budget <usd>]
```

The other options of those commands belong to other topics. The judge options, the same on both:

| Option | Meaning | Default |
|---|---|---|
| `--judge <judge>` | Judge the judged criteria with `claude:<model>`, such as `claude:haiku`. The model name takes letters, digits, `.`, `_` and `-`. Only `claude:` is accepted. Paid calls, unless the command is a stand-in. | none: no judge |
| `--judge-command <path>` | The command the judge runs instead of `claude`. A path is resolved from the current folder. A `.js`, `.cjs` or `.mjs` file is run with the current Node. Needs `--judge`. | `claude` |
| `--judge-budget <usd>` | Stop judging once the judge has spent this much, in US dollars. Every later criterion is inconclusive, with the evidence that the budget is spent. Required for a billed judge; also passed to the command as `--max-budget-usd`. A positive number. Needs `--judge`. | none |

The `pii` check uses the same judge, and the same budget and cost, for a block that sets `expect.pii_judge: true`.

How the judge answers:

* Each criterion a block names is one request: the transcript (for `scope: block`, the last 2 messages of the prefix, then the block), the Given, the produced files of a task block, and the criterion's `inputs`. See `judging-default-judge` for the prompt and the answer contract.
* An answer that breaks the criterion ledger contract is asked again once with the large budget.
* An unparsed answer, an error, or a criterion the spec does not define is inconclusive, never a pass.
* The verdict id is `judge.<name>`, kind `judge`, with the evidence `single judge <id>, <cost> USD`. It says it came from a single judge, so it is never read as a council's verdict.
* A single judge has no family check: the run does not know the agent's family. Choose a judge model of another family than the agent's (see `judging-families`).

## Inputs

* The specs the command runs. A block names criteria with `expect.criteria: [name, other@gating]`, and the spec defines them under `criteria` (see `judging-criteria`).
* For a live judge: the `claude` command, installed and signed in. It needs no API key. The judge process runs in an empty folder with no tools, no settings and no MCP server.
* The environment variable `CLAUDE_JUDGE_MODEL` is set to the model for the judge process.

## Outputs and how to read them

`replay`:

* `note: <spec>: judged criteria are not run in replay` is printed for every spec that defines criteria. On main this note is out of date: the judge check runs, as the worked example shows by its cost.
* Per spec: `✓` or `✗`, the spec id, the session and block, then `failing: block <i>: judge.<name> (inconclusive)` when a judge verdict fails the spec.
* Last line: `<n> spec(s) replayed: <p> pass, <f> fail. Judge <claude:model or none>, <usd> USD. Campaign <id> (in memory).`
* With `--json`: `judge` and `judgeCostUsd` sit beside the runs.

`estate run`:

* Per spec, a line `judged <criterion>: <outcome>` for each judged criterion, and the cost in the spec line.
* Last line: `... Cost <usd> USD over <n> run(s) that report one, judge <claude:model> <usd> USD of it.`
* Without a judge, the note `<spec>: no judge, so its judged criteria are inconclusive (pass --judge claude:<model>)`.
* With `--json`: `judge`, `judgeCostUsd`, and per run `judgeCostUsd` and `judged` (each `criterion`, `outcome`).

Both store the campaign with `judge: { mode: llm, judges: [claude:<model>] }`, or `{ mode: system1, judges: [] }` without a judge.

## Worked example

The stand-in judge accepted on a replay, and a billed judge refused without a budget (no model call):

```sh
driftbench replay examples/estates/sessions/clean-build.jsonl --decisions examples/estates/sessions/clean-build.decisions.jsonl --steps examples/estates/sessions/clean-build.steps.jsonl --suite examples/estates/sessions/specs/clean-build.yaml --judge claude:haiku --judge-command examples/estates/fixture/live/fake/judge.cjs
driftbench replay examples/estates/sessions/clean-build.jsonl --suite examples/estates/sessions/specs/clean-build.yaml --judge claude:haiku  # exit 2
```

```text
$ driftbench replay examples/estates/sessions/clean-build.jsonl --decisions examples/estates/sessions/clean-build.decisions.jsonl --steps examples/estates/sessions/clean-build.steps.jsonl --suite examples/estates/sessions/specs/clean-build.yaml --judge claude:haiku --judge-command examples/estates/fixture/live/fake/judge.cjs
✓ replay-clean-build  session clean-build from block 0 (metadata)
1 spec replayed: 1 pass, 0 fail. Judge claude:haiku, 0.0000 USD. Campaign replay-b17abeb8a490 (in memory).
(exit 0)
$ driftbench replay examples/estates/sessions/clean-build.jsonl --suite examples/estates/sessions/specs/clean-build.yaml --judge claude:haiku  # exit 2
error: a judge on a command that is not a stand-in is billed: pass --judge-budget <usd>
(exit 2)
```

A copy of the replay spec `examples/estates/sessions/specs/clean-build.yaml` with one gating criterion added to its first block. Without a judge, the gating criterion is inconclusive and fails the spec; with the stand-in judge, it is judged and passes, at the stand-in's reported 0.0015 USD:

From a repository checkout, not run by the help test:

```text
$ mkdir -p out/judging/run-judge/suite
$ python3 -c "p='examples/estates/sessions/specs/clean-build.yaml'; t=open(p).read().replace('      stage: verify\n', '      stage: verify\n      criteria: [states_the_change@gating]\n', 1); t += 'criteria:\n  - name: states_the_change\n    rubric: Does the reply say what changed in src/invoice.ts?\n    pass: The reply names the change.\n    fail: The reply does not name the change.\n'; open('out/judging/run-judge/suite/clean-build.yaml', 'w').write(t)"
$ driftbench replay examples/estates/sessions/clean-build.jsonl --decisions examples/estates/sessions/clean-build.decisions.jsonl --steps examples/estates/sessions/clean-build.steps.jsonl --suite out/judging/run-judge/suite
note: replay-clean-build: judged criteria are not run in replay
✗ replay-clean-build  session clean-build from block 0 (metadata)
    failing: block 0: judge.states_the_change (inconclusive)
1 spec replayed: 0 pass, 1 fail. Judge none, 0.0000 USD. Campaign replay-a3621f6f756d (in memory).
(exit 1)
$ driftbench replay examples/estates/sessions/clean-build.jsonl --decisions examples/estates/sessions/clean-build.decisions.jsonl --steps examples/estates/sessions/clean-build.steps.jsonl --suite out/judging/run-judge/suite --judge claude:haiku --judge-command examples/estates/fixture/live/fake/judge.cjs
note: replay-clean-build: judged criteria are not run in replay
✓ replay-clean-build  session clean-build from block 0 (metadata)
1 spec replayed: 1 pass, 0 fail. Judge claude:haiku, 0.0015 USD. Campaign replay-8434622d4213 (in memory).
(exit 0)
```

The campaign id changes on every run. The stand-in reads the prompt, answers fail when it holds the words `public holiday`, else pass, and reports 0.0015 USD per call. It makes no model call.

An estate run on the fixture estate, with its stand-in agent and the stand-in judge:

From a repository checkout, not run by the help test:

```text
$ driftbench estate run examples/estates/fixture/generated/specs/live/obligation/estate.obligation.instruction.route-planner.no-delivery-planned-on-a-public.yaml --estate examples/estates/fixture --runtime claude-code --command examples/estates/fixture/live/fake/claude.mjs --set-env FAKE_MANIFEST=$PWD/examples/estates/fixture/live/fake/manifest.json --store out/judging/run-judge/runs.db --states examples/estates/fixture/live/states/library.json --judge claude:haiku --judge-command examples/estates/fixture/live/fake/judge.cjs
note: the estate copy is not pinned to a map hash; pass --map to pin it
✗ estate.obligation.instruction.route-planner.no-delivery-planned-on-a-public  (0.0015 USD)
    failing: block 0: subagents.route-planner, block 0: judge.instruction.route-planner.no-delivery-planned-on-a-public
    judged instruction.route-planner.no-delivery-planned-on-a-public: fail
1 spec run live on a stand-in: 0 pass, 1 fail. Cost 0.0015 USD over 1 run that report one, judge claude:haiku 0.0015 USD of it. Campaign estate-run-bda78d9d7365.
(exit 1)
```

The judge fails the criterion: the reply plans a delivery on a public holiday.

## Common errors

* `error: a judge on a command that is not a stand-in is billed: pass --judge-budget <usd>` (exit 2). The real `claude` command costs money. Add `--judge-budget <usd>`, or point `--judge-command` at a stand-in.
* `error: --judge takes claude:<model>, such as claude:haiku, not "gpt:4"` (exit 2). Only the claude command judge exists on the command line.
* `error: --judge-command and --judge-budget need --judge claude:<model>` (exit 2).
* `error: --judge-budget takes a positive number of US dollars, not "0"` (exit 2).
* `failing: block 0: judge.<name> (inconclusive)` (exit 1). No judge was given, or the judge gave no answer, or the budget was spent, for a gating criterion. Pass `--judge` with a budget, or make the criterion non-gating.
* An estate run whose stand-in agent fails with `ENOENT: no such file or directory, open 'examples/estates/fixture/live/fake/manifest.json'`. The stand-in runs in another folder: give `FAKE_MANIFEST` as an absolute path, as `$PWD/...` does above.
