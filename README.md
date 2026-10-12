<h1 align="center">driftbench. Every exchange is a unit test.</h1>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/hero-dark.webp">
    <img src=".github/readme/hero-light.webp" alt="driftbench, an agent evaluation framework by Nexus. Every exchange is a unit test. Every number carries an interval; drift and recovery are measured, block by block. Beside the title, driftbench drawn as one machine, an indexing test line on a bench, with eight callouts. Test generation: a hopper fed from a prompt, a spec or past conversations. Validity gate: invalid blocks never run. Agent under test: chat or code, through one adapter. Machine checks: nine pins, and a fail is final. Judge council: system 1 and system 2 balances that earned their criteria. Drift and recovery: a chart pen leaves the line, then comes back. Pass rate and interval: a dial reads 0.38, between 0.14 and 0.69. CI gate: an arm that lifts only when the candidate is noninferior." width="100%" />
  </picture>
</p>

<p align="center">
  <a href="#get-started">Get started</a> ·
  <a href="#what-you-get">What you get</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#roadmap">Roadmap</a> ·
  <a href="docs/index.md">Docs</a> ·
  <a href="#contributing">Contributing</a> ·
  <a href="https://agent.nexus">agent.nexus</a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="licence Apache 2.0" src="https://img.shields.io/badge/licence-Apache--2.0-2F5FD0?style=flat" /></a>
  <a href="#roadmap"><img alt="status pre alpha" src="https://img.shields.io/badge/status-pre--alpha-1B2A44?style=flat" /></a>
  <img alt="language TypeScript" src="https://img.shields.io/badge/language-TypeScript-2F5FD0?style=flat" />
  <img alt="Node 22 or newer" src="https://img.shields.io/badge/node-22%2B-1B2A44?style=flat" />
  <a href="https://github.com/achammah/driftbench/actions/workflows/ci.yml"><img alt="CI status" src="https://github.com/achammah/driftbench/actions/workflows/ci.yml/badge.svg" /></a>
</p>

---

driftbench evaluates AI agents one exchange at a time. Each exchange is a **block**: one user message and everything the agent does before the next one. Each block is a unit test with a Given, a When and a Then. A conversation is a succession of blocks, so a failure has an address, drift has a first block, and recovery has a count. Every rate comes with its interval.

It targets conversational agents and code interpreter agents, the ones that write code, use a workspace and load skills. Both run through the same blocks and the same checks. Any agent plugs in through an adapter. Open source, Apache 2.0, written in TypeScript.

> [!NOTE]
> **Not on npm yet.** Version 0.1.0 is prepared ([CHANGELOG.md](CHANGELOG.md)). Run it from source.

---

## Get started

Node 22 or newer and pnpm. No API key: every example below runs on Acme Telecom, a synthetic sales assistant with no model.

```bash
git clone https://github.com/achammah/driftbench
cd driftbench
pnpm install
pnpm driftbench spec validate examples/acme/specs
```

```
Checked 7 specs: 7 valid, 0 invalid, 0 warnings.
```

A spec is one golden conversation, written as blocks in YAML. These are the first two of the five blocks in [`plan-upgrade.yaml`](examples/acme/specs/conversations/plan-upgrade.yaml):

```yaml
id: acme-plan-upgrade
title: An existing customer moves to a plan with more data
channel: chat
lang: EN
target: { adapter: function, agent: acme-sales }
ledger_seed:
  customer: existing
  lang: EN
stages: [identify, offer, recap, order_placed, callback, handover, closing]

criteria:
  - name: one_question_per_turn
    rubric: The reply asks the customer at most one question.
    judge_class: system1
  - name: no_invented_data
    rubric: >
      Every plan, price, order number and account fact in the reply
      comes from a tool result or from the customer. Nothing is guessed.
    gating: true
    judge_class: system2

blocks:
  - user: Hi, I'm already an Acme customer and I keep running out of data on my phone.
    expect:
      stage: identify
      tools:
        - { label: catalog.search, count: 0 }
      must: ['Acme Telecom', 'email address']
      criteria: [one_question_per_turn]

  - user: It's sam.rivera@example.com
    expect:
      stage: offer
      ledger_add: { customer_id: cust-001, current_plan: mobile-s }
      tools:
        - label: catalog.search
          count: 1
          input:
            category: mobile
            customer_email: sam.rivera@example.com
            address_id: { absent: true }
      must: ['Acme Mobile M', 'Acme Mobile L', '\$25', '\$35']
      must_not: ['Fiber', 'Air 5G']
      criteria: [no_invented_data@gating, one_question_per_turn]
```

Run the six Acme conversations on the chat agent, free running, twice each, then the price sheet task on the code agent:

```bash
pnpm driftbench campaign run examples/acme/specs/conversations --target function:acme --mode F --repeats 2
pnpm driftbench campaign run examples/acme/specs/tasks --target process:acme-ops --mode F
```

The first line, one cell and the summary of the first, then the second:

```
Campaign c-79250892ac75: 12 cells, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
✓ acme-new-customer-coverage · function:acme · F · repeat 0  pass  4 blocks
12 cells: 12 pass, 0 fail, 0 failed. Spent $0.00.

✓ acme-price-sheet · process:acme-ops · F · repeat 0  pass  2 blocks
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
```

Check that the agent answers the same way every time:

```bash
pnpm driftbench smoke examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme
```

```
Smoke: acme-plan-upgrade on function:acme, 3 runs, cache off.
  run 1  completed  5 blocks  transcript 9ec7c3e69cd4
  run 2  completed  5 blocks  transcript 9ec7c3e69cd4
  run 3  completed  5 blocks  transcript 9ec7c3e69cd4
✓ The transcripts are identical.
```

---

## What you get

Four areas, all built.

<a href=".github/readme/areas-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/areas-dark.png">
    <img alt="Four areas on four cards: scenarios and simulated users, checks and judges, drift and recovery, statistics and CI gates." src=".github/readme/areas-light.png" width="100%">
  </picture>
</a>

- **[Scenarios and users](docs/simulated-user.md)**: YAML specs, a scripted user, a simulated user that plays a persona, an [adaptive attacker](docs/attack.md), ten deviation classes, and specs drafted from [production traces](docs/traces.md) or [a spreadsheet](docs/datasets.md).
- **[Checks and judges](docs/reference/checks.md)**: 24 machine checks, among them `similarity`, `relevancy`, `knowledge_retention` and `tools_offered`; a judge council calibrated on hand labels you set in a [local viewer](docs/viewer.md).
- **[Drift and recovery](#drift-and-recovery)**: five drift classes, turns to recover after a deviation, and a [monitor](docs/traces.md) that watches production traces for drift.
- **[Statistics and CI gates](#numbers-with-intervals)**: an interval on every rate, `pass^k`, paired tests, and a noninferiority gate whose margin defaults to the smallest the suite can show.

## Things you can do with driftbench

1. **Write a golden as blocks** and validate it: `driftbench spec validate`.
2. **Run it three ways**, teacher forced, free running and perturbed, with retries and a budget cap: `driftbench campaign run` ([running](docs/running.md), [retries](docs/retries.md)).
3. **Play a simulated user** from a persona, on a model or a recording: `driftbench simulate`.
4. **Attack adaptively**: each deviation is picked from the agent's last replies: `driftbench attack`.
5. **Start from production**: draft specs from OpenTelemetry, Nexus or Claude Code traces, then watch the same traces for drift: `driftbench import traces`, `driftbench monitor --source traces`.
6. **Label blocks by hand** in a local viewer, and calibrate the judges on your labels: `driftbench view`, `driftbench judge calibrate`.
7. **Version datasets and prompts**, immutable and restorable byte for byte: `driftbench dataset`, `driftbench prompt`.
8. **Gate a change in CI**: `driftbench ci` and the GitHub Action, or [pytest](docs/python.md) and [vitest](docs/vitest.md) from your own tests.
9. **Test a code agent as an estate**: map its instructions, skills and guards, generate tests, replay recorded sessions, run it live, and mutate it: `driftbench estate`, `driftbench replay` ([estates](docs/estate.md)).
10. **Generate the tests** from a map a person approves, gate them, pick the fewest that cover it: `driftbench extract`, `generate`, `gate`, `select` ([generating](docs/generating.md)).

---

## How it works

Everything in this section runs today, except the runtime battery. The [docs](docs/index.md) hold the detail: concepts, the spec reference, the CLI and the adapters.

### A block is a unit test

<a href=".github/readme/block-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/block-dark.png">
    <img alt="The second block of the plan upgrade spec in three parts. Given: the first block, an existing customer, the Acme store, the chat channel. When: the user gives the email on their account. Then: stage offer, one catalogue search, both larger plans named, no home plans, the customer id added to the ledger, the no invented data criterion. Below, every observed field passes and the block passes." src=".github/readme/block-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub>Given the state so far, when the user speaks, then the agent must reach the right stage, call the right tools and say nothing it must not.</sub></p>

A block holds everything the agent does between two user messages: text, cards, tool calls and tool results. The spec fixes what must be true after it. driftbench reads what happened, compares it field by field, and keeps the evidence behind every verdict. Run one block many times from the same Given and you get its own pass rate, free of the blocks before it.

<a href=".github/readme/kinds-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/kinds-dark.png">
    <img alt="The same block model for two agents. Left, the Acme sales assistant at block four: the user replies CONFIRM, the agent places the order and gives its order number; stage, tool call, confirmation guard, text and end state are checked. Right, a code interpreter agent at the first block of the price sheet task: it loads the xlsx skill, runs code that exits with 0, creates the price sheet workbook and leaves the other files untouched; sheets and cells, the formula, the workspace diff and no destructive operation are checked." src=".github/readme/kinds-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub>One block model for both kinds of agent. Left, the Acme agent's real reply. The same checks read a reply, a tool call or a file.</sub></p>

When the agent writes code, uses a workspace and loads skills, a block is one task step, run in a sandbox. The same checks then read what the step left behind:

- **Artifacts**, opened and read: spreadsheet cells and formulas, document sections, slide titles, PDF text, test runs.
- **Workspace**: what was created, changed and deleted. Every other file stays as it was.
- **Execution**: the commands run, their exit codes, bounded output.
- **Safety**: a delete, an overwrite, a send, a payment or a push is flagged unless the block confirms it.
- **Skills and budget**: the right skills in the right order, within the step, cost and time budget.
- **References and helpers**: the files the agent read, and the helpers it dispatched, on which model.

A task step reads the same way as a chat block. This is the whole of [`price-sheet-build.yaml`](examples/estates/sessions/specs/price-sheet-build.yaml): a recorded Claude Code session in which a code agent builds the Acme price sheet, replayed with no model call. The step starts from a seeded workspace, loads the `xlsx` skill, reads the skill and one of its references, edits `build_sheet.py` only after reading it, runs it, and has a reviewer helper check the workbook on a named model:

```yaml
id: replay-price-sheet-build
kind: task
title: Build the Acme price sheet, reviewed by a helper
target: { adapter: claude-code }
workspace_seed: examples/estates/sessions/price-sheet-build/before
stages: [plan, build_sheet, report]
metadata:
  replay:
    session: price-sheet-build
    before: price-sheet-build/before
    after: price-sheet-build/after
rules:
  forbidden_tools: [WebFetch]
  custom:
    ordered:
      pairs:
        - { before: Read, after: Edit, key: file_path, reset: compaction }
blocks:
  - id: build
    user: >
      Build a price sheet from catalog.csv: one sheet per category, named Mobile and Home, with a yearly
      price by formula. Save it as out/acme-price-sheet.xlsx and have the sheet reviewer check it.
    expect:
      stage: build_sheet
      skills:
        - { name: xlsx, count: 1 }
      references:
        - { path: '**/skills/xlsx/SKILL.md', count: 1 }
        - { path: '**/skills/xlsx/reference/*.md' }
      subagents:
        - { name: sheet-reviewer, model: sonnet, count: 1 }
      guards:
        - { name: read-before-write, verdict: deny, count: 0 }
      execution: { ran_code: true, exit_code: 0, max_commands: 3 }
      workspace:
        created: [out/acme-price-sheet.xlsx]
        changed: [build_sheet.py]
        deleted: []
        others_untouched: true
      artifacts:
        - path: out/acme-price-sheet.xlsx
          kind: xlsx
          checks:
            - sheets: [Mobile, Home]
            - cells: { sheet: Mobile, column: C, from_row: 2, values: [15, 25, 35] }
            - formula: { sheet: Mobile, cell: D2, regex: '^=C2\s*\*\s*12$' }
      safety: { max_destructive_ops: 0, confirm_before: [delete] }
      must: ['acme-price-sheet\.xlsx']
```

`references` and `subagents` check what the agent read and whom it dispatched. `rules.custom.ordered` holds the agent to reading a file before it edits it. The artifact checks open the workbook the session left behind:

```bash
S=examples/estates/sessions
pnpm driftbench replay $S/price-sheet-build.jsonl --suite $S/specs/price-sheet-build.yaml \
  --decisions $S/price-sheet-build.decisions.jsonl --steps $S/price-sheet-build.steps.jsonl
```

```
✓ replay-price-sheet-build  session price-sheet-build from block 0 (metadata)
1 spec replayed: 1 pass, 0 fail. Campaign replay-5e6ed50f72fb (in memory).
```

Not built yet: the runtime battery for agent harnesses (hook replay, skill loading gates, process step order, speed budgets).

In the docs: [Block](docs/concepts/block.md) · [Given, When, Then](docs/concepts/given-when-then.md) · [Checks](docs/reference/checks.md) · [Spec reference](docs/reference/spec.md)

### One golden, three runs

<a href=".github/readme/modes-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/modes-dark.png">
    <img alt="One golden, the plan upgrade spec, feeds three runs. Teacher forced: each block starts from the golden, so a miss stays local; it measures local accuracy. Free running: the agent's own replies carry forward, one miss leads to another; it measures compounding. Perturbed: a deviation lands at block two and the agent is back one block later; it measures recovery." src=".github/readme/modes-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub>Teacher forced isolates each block. Free running lets errors compound. Perturbed injects a deviation and measures the way back.</sub></p>

The gap between teacher forced and free running on the same golden is the **compounding index**. An agent can pass every block on its own and still fail the whole conversation. Only free running shows it.

In the docs: [Run modes](docs/concepts/run-modes.md)

### Drift and recovery

<a href=".github/readme/perturbed-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/perturbed-dark.png">
    <img alt="Six blocks of an order flow. A goal shift is injected at block three: make it two lines. At block three the agent asks for ID and skips the change: flow drift. At block four it says one line: contradiction. At block five it is back on the expected path, and the end state matches. Turns to recover: two blocks, label late, collateral zero." src=".github/readme/perturbed-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub>A goal shift lands at block 3. The agent skips the change, then contradicts it, then comes back. Two blocks to recover.</sub></p>

Every failing block gets one or more drift classes:

| Class | What drifted |
|---|---|
| `X1` local error | a wrong answer or a wrong tool, facts intact |
| `X2` contradiction | the reply contradicts a fact already established |
| `X3` flow drift | the wrong stage: skipped, repeated, or a known fact asked again |
| `X4` format drift | narration, a language leak, a double send, channel rules broken |
| `X5` tool drift | a call that is missing, extra, duplicated or wrongly filled |

Ten deviation classes can be injected at any block, in a conversation or in a code task: off topic question, goal shift, contradiction, loose confirmation, language switch, instruction in data, silence or burst, tool failure, out of scope request, and return after a deviation.

After an injection, driftbench reports the **turns to recover**, a recovery label (immediate, late or never), the **collateral** failures after recovery, the safe action rate on risky injections, and how often the agent asked instead of guessing.

```bash
pnpm driftbench perturb examples/acme/specs/conversations/plan-upgrade.yaml --class D2_goal_shift --at 2
```

The injected row and the verdict:

```
  pos  block                       stage         pass  failing
  2    injected d2-cheaper-plan@2  offer         ✓
✓ Recovery: immediate, 0 blocks to come back (the spec allows 1 block), collateral 0, safe action yes, asked first yes.
```

In the docs: [Drift](docs/concepts/drift.md) · [Recovery](docs/concepts/recovery.md)

### Judges earn their criteria

<a href=".github/readme/council-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/council-dark.png">
    <img alt="The judge council. Machine checks run first and a machine fail is final. Then three system 1 judges, such as Jev and the OpenAI Decisions API, or three system 2 judges, chat models from OpenAI, Google and Anthropic, vote. Majority wins, a split goes to the other class, inconclusive is judged again and never counted. Below: assignment is earned through a fixture pair, separation three times out of three, and a kappa of 0.8 or more against hand labels." src=".github/readme/council-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub>Machine checks run first and cannot be overruled. Each criterion goes to the judge class that earned it on a fixture pair.</sub></p>

- **Machine checks first.** Tool labels, counts and arguments, patterns on visible text, language, personal data, end state, and the files a task step leaves. A machine fail is final.
- **Two judge classes.** System 1 judges, such as Jev and the OpenAI Decisions API, answer one fixed yes or no question: cheap, fast, low variance. System 2 judges are chat models from OpenAI, Google or Anthropic. They read across blocks and keep their reasoning. A judge never shares the agent's model family.
- **Earned on evidence.** Each gating criterion has a fixture pair: one failing transcript, one clean. A judge owns the criterion only if it separates the pair 3 times out of 3 and agrees with hand labels at a kappa of 0.8 or more. Below that, the rubric is rewritten and the threshold stays. Task artifacts are judged the same way.
- **Strict verdicts.** Majority of three. A split goes to the other class. Inconclusive is judged again and never counted. The judged text sits in a data tag, and instructions inside it are ignored.

In the docs: [Judges](docs/concepts/judges.md)

### Numbers with intervals

One run proves nothing. driftbench treats evaluation as a statistics problem.

- **Intervals on every rate.** Wilson for proportions, a clustered bootstrap for anything aggregated over blocks, one conversation per cluster.
- **Repeats.** `pass^k` when every run passes, `pass@k` when at least one does, and unreliability: the spread between the 90th and the 10th percentile.
- **Paired comparisons** on the same goldens: McNemar, Wilcoxon, and a Benjamini Hochberg correction across criteria before any criterion is called a regression.
- **Power first.** The minimum detectable effect is printed before a campaign spends anything.
- **A verdict CI can gate on.** The candidate is noninferior when the upper bound of every gating regression stays under the margin. A criterion decided on fewer than 30 goldens is reported as underpowered and does not block parity. New flags always block. The margin defaults to the smallest one the suite can show for the agent compared with itself. Too few goldens reads `not-shown-non-inferior`, a verdict on the size of the suite.
- **Where results vary.** The variance pilot (`driftbench pilot`) splits the spread by source (the agent's own run to run randomness, the wording, the persona, the conversation and the judge) with a share for each. The run to run spread sets a noise floor, and a difference between two versions smaller than the floor is read as noise.

The gate, on a planted fault: a baseline campaign on the ten Acme goldens, then `ci` on a fault that skips the recap:

```bash
pnpm driftbench campaign run examples/acme/golden/specs --target function:acme-sales --store ci.db --campaign baseline
pnpm driftbench ci --specs examples/acme/golden/specs --target fault:x3-skips-recap --faults examples/acme/faults --baseline baseline --store ci.db
```

```
Margin auto: 28 points, the smallest half point at which the baseline compared with itself is non-inferior (set by the all-pass flag, 27.75 points).
Warning: this suite cannot show parity under 15 points (the all-pass flag needs 27.8 points); about 22 goldens would.
  all-pass regression effect                   +70.00 points
  95% interval                                 [+28.89, +89.22] points
Verdict: REGRESSION. Exit 1.
```

The same gate on the agent compared with itself reads `Verdict: PARITY. Exit 0.`

In the docs: [Statistics](docs/concepts/statistics.md)

### Generating tests

The aim: about ten goldens that cover every kind of block, instead of two hundred conversations picked by hand. driftbench builds them from what the agent is specified to do. Built, from map to golden set ([generating](docs/generating.md)).

- **A map a person approves.** A model reads the prompt, the behaviour inventory and the tool schemas and proposes what varies, quoting its source. Nothing counts until a person approves it: `driftbench extract`.
- **Code writes the blocks.** From the approved map, code enumerates paths through the stages, pairs and triples of values, boundary values and one probe per deviation class: `driftbench generate`.
- **Every test passes a validity gate.** A planted fault fails it, a reference agent passes it, its expected values are not leaked into its stimulus, and a constant reply cannot pass it: `driftbench gate`.
- **The fewest that cover the map**, coverage and completeness counted, and a sealed holdout scored once per query: `driftbench select`, `driftbench space`, `driftbench holdout`.
- **Spread by source.** A pilot splits the spread between the agent, the wording, the persona, the conversation and the judge, and sets the noise floor: `driftbench pilot`.

In the repo: [the Acme map proposal](examples/acme/map/README.md)

## The anatomy of driftbench

<a href=".github/readme/anatomy-light.webp">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/anatomy-dark.webp">
    <img alt="driftbench drawn as one machine, an indexing test line on a bench. On the left, a hopper takes generated blocks from three inlets on its lid, a stack of prompt cards, a specification binder and a reel of past conversations, with a coverage pegboard on its magazine and a validity gate that sends rejected blocks down a chute into a tray. Each block is a carriage carrying its Given as a state capsule or a workspace of files, its When as a card, and its Then as a plate of nine test pads. The carriages index along a track through a deviation punch whose lamp is lit, the agent cell with a conversation adapter and a code interpreter adapter with its workspace drawer, a gantry of nine check pins, and a council of six judge balances with a fixture pair, then into a store. A mode lever at the front, beside a rack of golden Givens, sets teacher forced, free running or perturbed. On the console at the back, a chart pen traces drift and recovery, a dial shows a pass rate of 0.38 with its interval from 0.14 to 0.69 and the gate threshold, counters show 3 of 8 runs passed, a pass^3 of 0.02 and 7 of 8 recovered, and the CI gate arm stays down until the tenth run." src=".github/readme/anatomy-light.webp" width="100%">
  </picture>
</a>
<p align="center"><sub>One block per carriage: generated blocks pass the agent, nine machine checks and the judge council, and the console turns what they leave into drift, recovery and the interval the CI gate reads.</sub></p>

[Open the interactive figure (from a clone)](.github/readme/anatomy/index.html) to run the campaign in each mode and hover a part to see what it does.

---

## Integrations

Every adapter passes the same [contract suite](docs/adapters/index.md). The system 1 judge clients (Jev, the OpenAI Decisions API) follow the providers' public descriptions; no live call has confirmed them yet.

**Agents, 13 adapters:** [function](docs/adapters/function.md) · [HTTP](docs/adapters/http.md) · [Nexus](docs/adapters/nexus.md) · [process](docs/adapters/process.md) · [OpenAI Agents](docs/adapters/openai-agents.md) · [Anthropic](docs/adapters/anthropic.md) · [Google](docs/adapters/google.md) · [LangGraph](docs/adapters/langgraph.md) · [CrewAI](docs/adapters/crewai.md) · [Vercel AI SDK](docs/adapters/vercel-ai.md) · [Pydantic AI](docs/adapters/pydantic-ai.md) · [LiteLLM](docs/adapters/litellm.md) · [Claude Code, replayed or live](docs/adapters/claude-code.md)<br/>
**Judges:** Jev · OpenAI Decisions API · OpenAI · Google · Anthropic · any HTTP endpoint<br/>
**Traces in:** OpenTelemetry · Nexus · Claude Code sessions<br/>
**Reports:** HTML scorecard · run diff (`driftbench compare`) · JUnit XML · a local viewer with hand labels<br/>
**CI and tests:** exit codes on the verdict · GitHub Action · [pytest plugin](docs/python.md) · [vitest](docs/vitest.md)<br/>
**Store:** SQLite · versioned JSON export · immutable dataset and prompt versions

## How it compares

What the other tools' docs describe, read on 11 October 2026, and what driftbench does today:

| Tool, and what its docs describe | driftbench, built |
|---|---|
| **[LangWatch Scenario](https://langwatch.ai/scenario/advanced/how-judging-works/)**<br/>A judge that marks each criterion passed, failed or inconclusive. | The same three outcomes, per block. Inconclusive is judged again and never counted. |
| **[promptfoo](https://www.promptfoo.dev/docs/configuration/expected-outputs/)**<br/>Trajectory assertions: which tools ran, with which arguments, in which order. | Tool checks on label, count, arguments and order, the tools offered, plus end state, workspace and file checks. |
| **[DeepEval](https://deepeval.com/docs/conversation-simulator)**<br/>A conversation simulator that plays a user from a scenario and a persona. | A simulated user from a persona, plus deviations at a chosen block and an adaptive attacker. |
| **[Inspect](https://inspect.aisi.org.uk/metrics.html)**<br/>Wilson intervals for binary scores, clustered standard errors, and a [scorer cascade](https://inspect.aisi.org.uk/multiple-scorers.html) that stops at the first scorer that settles a sample. | Intervals on every rate with one conversation per cluster, paired tests, and judges that run cheapest first. |
| **[Langfuse](https://langfuse.com/docs/evaluation/overview)**<br/>A GitHub Action that fails the job when a score violates your threshold. | A noninferiority verdict with an auto margin, as an exit code and a GitHub Action. |
| **[Opik](https://www.comet.com/docs/opik/evaluation/evaluate_threads)**<br/>A function that scores whole conversation threads. | Verdicts per block, then drift and recovery across them. |

The [comparison page](docs/comparison.md) covers seven tools and six code agent benchmarks over 30 capabilities, every cell with a source, every driftbench cell with the test that proves it, and [where driftbench is ahead](docs/comparison.md#where-driftbench-is-ahead): the block model, validators that check driftbench's own numbers, estate testing and measured recovery.

---

## Roadmap

Each phase has a command that shows it working on the bundled examples, in the [docs index](docs/index.md#roadmap).

| Phase | Status |
|---|---|
| **0** · Foundations: spec format, validation, coverage, the Acme example | built |
| **1** · Runner, checks, store, sandbox, adapters | built |
| **2** · Judge council and calibration | built |
| **3** · Simulated user, perturbation, drift and recovery | built |
| **4** · Statistics, scorecard, CI gate, monitor, viewer | built; the runtime battery is not |
| **G** · Test generation: map, generate, gate, select, pilot | built |
| **E** · Estates: scan, plan, generate, replay, live runner, mutants | built; the unit runner is not |
| **V** · Validators | in progress: version 2 ladders, each merged only after an independent audit |
| **Release** · SDK adapters, Python package, docs site, 0.1.0 | in progress: built; publishing to npm and PyPI is next |

---

## Contributing

Issues and pull requests are welcome. The project is young, so the most useful contributions right now are specs, checks and adapters.

1. Fork the repo and run `pnpm install`.
2. Make your change with its tests, then run `pnpm lint`, `pnpm typecheck` and `pnpm test`.
3. Open a pull request. CI runs the same checks, the build, the docs checks and a leak guard. Keep every example synthetic: no real customer, prompt or conversation data.

Questions and ideas go in [GitHub issues](https://github.com/achammah/driftbench/issues).

## Security

Report a vulnerability privately through [GitHub security advisories](https://github.com/achammah/driftbench/security). Public issues are for everything else.

---

## Made by Nexus

<p>
  <a href="https://agent.nexus">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset=".github/readme/nexus-logo-white.svg">
      <img src=".github/readme/nexus-logo-ink.svg" alt="Nexus" height="28" />
    </picture>
  </a>
</p>

Nexus makes Self Operating Procedures: what your best people know, turned into procedures that run themselves. We built driftbench to test the agents we build, and we share it under Apache 2.0.

## Licence

Apache 2.0. See [LICENSE](LICENSE).
