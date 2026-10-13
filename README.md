<h1 align="center">driftbench</h1>

<p align="center"><b>Test your AI agent one exchange at a time, and know how far to trust the score.</b></p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/hero-dark.webp">
    <img src=".github/readme/hero-light.webp" alt="driftbench, an agent evaluation framework by Nexus. Every exchange is a unit test. Every number carries an interval; drift and recovery are measured, block by block. Beside the title, driftbench drawn as one machine, an indexing test line on a bench, with eight callouts. Test generation: a hopper fed from a prompt, a spec or past conversations. Validity gate: invalid blocks never run. Agent under test: chat or code, through one adapter. Machine checks: nine pins, and a fail is final. Judge council: system 1 and system 2 balances that earned their criteria. Drift and recovery: a chart pen leaves the line, then comes back. Pass rate and interval: a dial reads 0.38, between 0.14 and 0.69. CI gate: an arm that lifts only when the candidate is noninferior." width="100%" />
  </picture>
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> ·
  <a href="#what-makes-it-different">Why driftbench</a> ·
  <a href="#what-it-does">What it does</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#the-command-line">CLI</a> ·
  <a href="#adapters">Adapters</a> ·
  <a href="#benchmarks">Benchmarks</a> ·
  <a href="#how-it-compares">Comparison</a> ·
  <a href="docs/index.md">Docs</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@agent-nexus/driftbench"><img alt="npm version" src="https://img.shields.io/npm/v/%40agent-nexus%2Fdriftbench?color=2F5FD0&label=npm" /></a>
  <a href="LICENSE"><img alt="licence Apache 2.0" src="https://img.shields.io/badge/licence-Apache--2.0-2F5FD0?style=flat" /></a>
  <img alt="Node 22 or newer" src="https://img.shields.io/badge/node-22%2B-1B2A44?style=flat" />
  <a href="https://github.com/achammah/driftbench/actions/workflows/ci.yml"><img alt="CI status" src="https://github.com/achammah/driftbench/actions/workflows/ci.yml/badge.svg" /></a>
</p>

driftbench is an open-source evaluation framework for AI agents: chat agents, and agents that write code and files. You describe a conversation or a task as a list of **blocks**. A block is one user message, everything the agent does in reply, and what must be true afterwards. driftbench runs the blocks against your agent, checks each one, and reports every rate with its interval.

- **A failure has an address.** A failing run names the block, the check and the evidence, such as `block 1 forbidden.order.create`.
- **You are told when a score is noise.** Every rate carries a 95% interval, and the gate says how many test conversations your suite needs before it can show anything.
- **The tests are not written by hand.** Code generates them from a map of what the agent can face, and counts what they cover.
- **The evaluator is tested too.** driftbench runs against 7,453 cases with a known answer before its own numbers are trusted.

Works with any agent through an [adapter](#adapters). No account, no server. Apache 2.0, TypeScript, Node 22 or newer.

## Quickstart

About two minutes, most of it the install. You need Node 22 or newer and npm. No API key: the agent below is a short script that stands in for yours.

**1. Make a folder and install.**

```bash
mkdir my-evals && cd my-evals
npm init -y
npm install @agent-nexus/driftbench
mkdir specs
```

**2. Create `agent.mjs`.** It reads the user message on standard input and prints the reply. Replace it with a call to your own agent later.

```js
// A stand-in for your agent: reads the user message on stdin, prints the reply.
import { readFileSync } from 'node:fs';

const message = readFileSync(0, 'utf8').trim();
const history = JSON.parse(readFileSync(process.env.DRIFTBENCH_HISTORY_FILE, 'utf8'));

if (/refund/i.test(message)) {
  console.log('I can help with a refund. What is your order number?');
} else if (/\bA-\d+\b/.test(message)) {
  console.log(`Refund started for order ${message.match(/A-\d+/)[0]}. You will get an email within 2 days.`);
} else {
  console.log(`Sorry, I did not get that. (${history.length} messages so far)`);
}
```

**3. Create `specs/refund.yaml`.** Two blocks: what the user says, and what the reply must and must not contain.

```yaml
id: refund-happy-path
title: A customer asks for a refund and gives an order number
target: { adapter: process, agent: my-agent }

blocks:
  - user: Hi, I would like a refund please.
    expect:
      must: ['order number']
      must_not: ['Refund started']

  - user: It is A-1042.
    expect:
      must: ['Refund started', 'A-1042']
      must_not: ['Sorry']
```

**4. Check the spec, then run it.**

```bash
npx driftbench spec validate specs
npx driftbench campaign run specs --target process:my-agent \
  --process-command "[\"node\",\"$PWD/agent.mjs\"]"
```

The output, trimmed to its verdict lines:

```
✓ specs/refund.yaml  refund-happy-path · 2 blocks · hash c985453f6be7
Checked 1 spec: 1 valid, 0 invalid, 0 warnings.

✓ refund-happy-path · process:my-agent · F · repeat 0  pass  2 blocks
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
```

**5. Break the agent and run again.** Change `Refund started for order` to `Started a return for` in `agent.mjs`. The run now exits 1 and names the block and the check:

```
✗ refund-happy-path · process:my-agent · F · repeat 0  fail  block 1 must.0
1 cell: 0 pass, 1 fail, 0 failed. Spent $0.00.
```

**6. Keep the runs and open the scorecard.** Add `--repeats 3 --store runs.db` to the run, then:

```bash
npx driftbench report --store runs.db --out scorecard.html
```

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/scorecard-dark.png">
    <img src="docs/assets/scorecard-light.png" alt="A driftbench scorecard, one HTML file. Summary: Regressed, candidate against baseline, margin 28.0 points, 10 paired conversations. Six tiles: runs passing 50.0% with interval 19.9% to 80.1%, block accuracy 73.3%, end state match 85.7%, tool F1 77.6%, cost per block, latency per block. Below, the baseline passes 10 of 10 and the candidate 5 of 10, with the five conversations that regressed and the reason for each." width="820" />
  </picture>
</p>
<p align="center"><sub>The scorecard of the bundled Acme example with one planted fault. Every rate has its interval, and the verdict says why.</sub></p>

Next: [evaluate your own agent](#evaluate-your-own-agent), [add a judge](#add-a-judge), or [gate a pull request](#gate-a-pull-request). The full spec format is in the [spec reference](docs/reference/spec.md).

## What makes it different

We read seven other evaluation tools against 30 capabilities. Six capabilities are found in full in none of the seven. driftbench ships all six, each with a test that fails when it breaks:

| Only here, in full | What you get | Proof |
|---|---|---|
| [Recovery metrics](docs/concepts/recovery.md) | Inject a deviation at a chosen block and count the blocks until the agent is back, the failures after it, and whether its actions stayed safe | [recovery.test.ts](packages/core/test/runner/recovery.test.ts) |
| [Drift across turns](docs/concepts/drift.md) | The first block that went wrong, and which of five kinds of drift it was | [drift.test.ts](packages/core/test/runner/drift.test.ts) |
| [Judge calibration](docs/concepts/judges.md#calibration-an-assignment-is-earned) | A judge owns a criterion only after it separates a pass from a fail 3 times out of 3 and agrees with your hand labels | [calibration.test.ts](packages/judges/test/calibration.test.ts) |
| [Intervals and significance tests](docs/concepts/statistics.md) | An interval on every rate, paired tests between two versions, and a correction across criteria | [intervals.test.ts](packages/stats/test/intervals.test.ts) |
| [End state assertions](docs/reference/checks.md#end-state) | Check what the agent actually left behind: the order placed, the file written, the cells of the workbook | [end_state.test.ts](packages/checks/test/end_state.test.ts) |
| [Multi-language handling](docs/reference/checks.md#text-and-language) | Check the language of a reply and that it stays stable through the conversation | [lang.test.ts](packages/checks/test/lang.test.ts) |

<a href=".github/readme/capability-matrix-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/capability-matrix-dark.png">
    <img alt="Of 30 evaluation capabilities: driftbench 30. In full, in part, not found: deepeval 12, 14, 4. langwatch 12, 11, 7. promptfoo 10, 15, 5. langfuse 10, 7, 13. inspect_ai 9, 14, 7. opik 9, 10, 11. braintrust 2, 11, 17." src=".github/readme/capability-matrix-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub>Every cell with its source: <a href="docs/comparison.md">comparison page</a>. <a href="docs/comparison/methods.md#the-capability-matrix">How we measured</a>.</sub></p>

Eight ideas shape driftbench:

1. **Tests are generated by code from a map, with coverage you can count.** You approve a map of what the agent can face; code writes the blocks and their expected outcomes. On the Acme example it writes 379 files and covers all 701 allowed pairs of values. → [generating tests](docs/generating.md), [budget study](comparisons/budget/full-study.md)
2. **The evaluator is proven on planted truth.** Six suites of cases built by code, 7,453 in all, each with an exact right answer, and a floor in CI that only rises. → [validators](docs/validators.md), [chart](#driftbench-tests-itself)
3. **Blocks carry their starting state, so a failure is located.** A block starts from a stated Given, so it can be run alone. A regression is reported as a block and a check, and a fix re-runs only the blocks it can affect. → [a block is a unit test](#a-block-is-a-unit-test), [blast radius](#blast-radius)
4. **A judge must show its evidence.** A judge answers per requirement and quotes the passage it relied on. Code checks that the quote exists in the transcript, then computes the verdict. A quote that cannot be found is not a verdict. → [strict grounding](docs/concepts/judges.md#strict-grounding)
5. **A mixture of judges, not one judge.** A fast decision model judges every item and routes the unsure ones to the judge built for them. On MM-Eval's sealed test set, 48 of 1,212 items went to a panel and the score rose by 2.05 points. → [Mixture of Judges](#mixture-of-judges), [chart](#a-panel-only-when-unsure)
6. **Noise is measured, and reported.** driftbench splits the spread of results by source and sets a noise floor. A suite too small to show parity is told so, with the number of conversations it needs. → [where results vary](docs/concepts/statistics.md#where-results-vary)
7. **Code agents are first class.** The same blocks check what a code agent left behind: the cells and formulas of a workbook, the workspace diff, the commands run, the skills loaded, destructive operations. → [testing a code agent](docs/estate.md), [checks on files](docs/reference/checks.md#code-files-and-workspace)
8. **Record once, replay for free.** Recorded agent sessions and recorded judge answers replay with zero model calls, so CI is fast and costs nothing. → [replay](docs/estate.md#replay-built), [cassettes](docs/concepts/judges.md#cassettes-recorded-answers)

## What it does

<a href=".github/readme/areas-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/areas-dark.png">
    <img alt="Four areas on four cards: scenarios and simulated users, checks and judges, drift and recovery, statistics and CI gates." src=".github/readme/areas-light.png" width="100%">
  </picture>
</a>

**Write and generate tests**
- [Specs](docs/reference/spec.md): one conversation or one task as YAML blocks, each with a Given, a When and a Then.
- [Generated tests](docs/generating.md): code writes the blocks from an approved map of situations, and reports the pairs of values they cover.
- [Tests from production](docs/traces.md): draft specs from OpenTelemetry, Nexus or Claude Code traces, or from [a spreadsheet](docs/datasets.md).

**Run agents**
- [13 adapters](docs/adapters/index.md): a function, an HTTP endpoint, a command, and the common agent SDKs.
- [Three run modes](docs/concepts/run-modes.md): each block alone, the whole conversation, or with a deviation injected.
- [Simulated users](docs/simulated-user.md) and an [adaptive attacker](docs/attack.md) that picks its next move from the agent's last replies.

**Check and judge**
- [29 machine checks](docs/reference/checks.md): tool calls and their arguments, text, language, personal data, end state, files, spreadsheets, cost.
- [Judges](docs/concepts/judges.md): a model judges what code cannot, must quote its evidence, and a panel votes when the first judge is unsure.
- [Hand labels](docs/viewer.md): label blocks in a local viewer and measure each judge against them.

**Measure variance**
- [Intervals on every rate](docs/concepts/statistics.md), repeats, and the share of runs that pass every time.
- [Where results vary](docs/concepts/statistics.md#where-results-vary): how much of the spread comes from the agent, the wording, the persona or the judge.
- [Drift](docs/concepts/drift.md) and [recovery](docs/concepts/recovery.md): the first block that went wrong, and how many blocks the agent needs to come back.

**Compare runs**
- [Paired comparison](docs/concepts/statistics.md#comparing-a-baseline-and-a-candidate) of two versions on the same conversations.
- [A CI gate](docs/reference/cli.md#driftbench-ci) with an exit code: parity, regression, or not enough evidence.
- [Scorecards](docs/scorecards.md): one HTML file, JUnit XML, and a [monitor](docs/traces.md#monitoring-driftbench-monitor---source-traces) for production traces.

**Record and replay**
- [Replay recorded sessions](docs/estate.md#replay-built) offline, with no model call.
- [Cached blocks](docs/running.md#the-cache-and-replay) and recorded judge answers, so a rerun costs nothing.
- [Versioned datasets and prompts](docs/datasets.md#the-registry), restorable byte for byte.

**Validate the evaluator**
- [Planted-truth suites](docs/validators.md): code builds cases with a known answer and measures what driftbench reports.
- [A validity gate](docs/generating.md#the-gate) for tests: a test that a planted fault does not fail, or that a constant reply passes, is rejected.

## How it works

<a href=".github/readme/flow-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/flow-dark.png">
    <img alt="Seven steps, from a map to a verdict. 01 Map: what the agent can face, approved by you. 02 Tests: blocks written by code; a gate drops tests that cannot fail. 03 Run: your agent through one adapter, three modes, replay. 04 Checks: 29 machine checks on the reply, the tools and the files; a fail is final. 05 Judges: quoted evidence; a panel votes only when unsure. 06 Statistics: an interval on every rate, the noise floor, paired tests. 07 Verdict: a scorecard and an exit code, parity or regression, on every pull request." src=".github/readme/flow-light.png" width="100%">
  </picture>
</a>

You can enter at step 3 with specs you wrote by hand, as in the quickstart. Steps 1 and 2 are for when you want coverage you can count.

### A block is a unit test

<a href=".github/readme/block-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/block-dark.png">
    <img alt="The second block of the plan upgrade spec in three parts. Given: the first block, an existing customer, the Acme store, the chat channel. When: the user gives the email on their account. Then: stage offer, one catalogue search, both larger plans named, no home plans, the customer id added to the ledger, the no invented data criterion. Below, every observed field passes and the block passes." src=".github/readme/block-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub>Given the state so far, when the user speaks, then the agent must reach the right stage, call the right tools and say nothing it must not.</sub></p>

A block holds everything the agent does between two user messages: text, cards, tool calls and tool results. The spec fixes what must be true after it. driftbench reads what happened, compares it field by field, and keeps the evidence behind every verdict. Because a block starts from its own Given, it can be run many times on its own and gets its own pass rate.

<a href=".github/readme/kinds-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/kinds-dark.png">
    <img alt="The same block model for two agents. Left, the Acme sales assistant at block four: the user replies CONFIRM, the agent places the order and gives its order number; stage, tool call, confirmation guard, text and end state are checked. Right, a code interpreter agent at the first block of the price sheet task: it loads the xlsx skill, runs code that exits with 0, creates the price sheet workbook and leaves the other files untouched; sheets and cells, the formula, the workspace diff and no destructive operation are checked." src=".github/readme/kinds-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub>One block model for both kinds of agent. Left, the Acme agent's real reply. The same checks read a reply, a tool call or a file.</sub></p>

The same block model covers a chat agent and an agent that writes code and files. For a code agent, a block is one task step in a sandbox, and the checks read what it left behind: workbook cells and formulas, the workspace diff, the commands run, the skills loaded.

<details>
<summary>A chat block and a code-agent block, side by side</summary>

<br/>

A chat block from the bundled Acme example, [`plan-upgrade.yaml`](examples/acme/specs/conversations/plan-upgrade.yaml):

```yaml
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

A task block for a code agent, the whole of [`price-sheet-build.yaml`](examples/estates/sessions/specs/price-sheet-build.yaml). It checks the skill loaded, the files read, the helper dispatched, the commands run, the workspace diff and the cells of the workbook:

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

</details>

### Blast radius

<a href=".github/readme/blast-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/blast-dark.png">
    <img alt="A change to the recap stage, and four conversations drawn block by block. The blocks that read the recap stage are lit, and so are the blocks after them in the same conversation. One conversation has no recap and stays untouched. Radius: 298 of 861 blocks run again, and the 237 blocks the planted fault turns red are all inside it." src=".github/readme/blast-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub>A change to the recap stage lights the blocks that read it and the blocks after them. The rest is carried from the last full run.</sub></p>

When you change one part of your agent, driftbench reruns only the blocks that part can affect and carries the rest from the last run. The nightly run still covers everything.

Every block says what it reads: its stage, its tools, its rules. So a change maps to the blocks that read it, plus the blocks after them in the same conversation, which inherit the agent's replies. That set is the blast radius.

Measured on the Acme example, 195 conversations and 861 blocks:

- A change to the recap stage reruns 298 blocks. A planted fault that skips the recap turns 237 blocks red, and all 237 are inside the radius.
- A change to the inputs of the coverage check reruns exactly 86 blocks.
- By change, a pull request saves 30 to 96 percent of the suite.
- The safety rule is "unknown means everything": a change to the reply-language rule touches 826 of 861 blocks, so the whole suite runs.

Blast radius is designed and measured, and is being built now.

### Mixture of Judges

<a href=".github/readme/moj-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/moj-dark.png">
    <img alt="The Mixture of Judges. Stage 1: a System-1 decision model judges every item in both orders and reads its terrain: needs reasoning, has a reference, safety, writing. A router sends each item on by terrain and confidence. High confidence stops at stage 1. Unsure items go to the judge built for their terrain: a reference check on reasoning terrain, a System-2 verdict elsewhere, a panel of model families at the lowest confidence. A trusted expert's verdict is final. You pick the operating point: cheapest, balanced or most accurate. Practice data against promptfoo: JudgeBench 91.6 against 90.4, MM-Eval 95.7 against 92.8, writing 64.8 against 54.8, at 0.43 to 1.49 reasoning calls per pair against 2." src=".github/readme/moj-light.png" width="100%">
  </picture>
</a>

One judge model for every question is slow where the question is easy and weak where it is hard. The Mixture of Judges (MoJ) uses the right judge for each item:

- **A fast first pass.** A System-1 decision model judges every item in both orders and reads its terrain: does it need reasoning, is there a reference, is it a safety case, is it a piece of writing.
- **A router.** High confidence stops there. An unsure item goes to the judge built for its terrain: a reference check, a System-2 verdict, or a panel of model families. A trusted expert's verdict is final.
- **Your operating point.** Cheapest, balanced or most accurate: you choose how much reasoning to buy.

Practice data: JudgeBench 91.6 against promptfoo's 90.4, MM-Eval 95.7 against 92.8, writing 64.8 against 54.8, at 0.43 to 1.49 reasoning calls per pair against 2. MoJ is an option today, and a sealed run confirms it next. → [design and results](https://github.com/achammah/driftbench/blob/9be7b75133e31a2f5d81f1dec0ef15c517be5d21/research/moj/RESULTS.md)

### One conversation, three runs

<a href=".github/readme/modes-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/modes-dark.png">
    <img alt="One golden, the plan upgrade spec, feeds three runs. Teacher forced: each block starts from the golden, so a miss stays local; it measures local accuracy. Free running: the agent's own replies carry forward, one miss leads to another; it measures compounding. Perturbed: a deviation lands at block two and the agent is back one block later; it measures recovery." src=".github/readme/modes-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub>Teacher forced isolates each block. Free running lets errors compound. Perturbed injects a deviation and measures the way back.</sub></p>

The gap between teacher forced and free running on the same conversation is the **compounding index**. An agent can pass every block on its own and still fail the whole conversation. Only free running shows it. → [run modes](docs/concepts/run-modes.md)

### Drift and recovery

<a href=".github/readme/perturbed-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/perturbed-dark.png">
    <img alt="Six blocks of an order flow. A goal shift is injected at block three: make it two lines. At block three the agent asks for ID and skips the change: flow drift. At block four it says one line: contradiction. At block five it is back on the expected path, and the end state matches. Turns to recover: two blocks, label late, collateral zero." src=".github/readme/perturbed-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub>A goal shift lands at block 3. The agent skips the change, then contradicts it, then comes back. Two blocks to recover.</sub></p>

Every failing block gets a drift class: a local error, a contradiction, flow drift, format drift or tool drift. Twelve kinds of deviation can be injected at any block. After an injection, driftbench reports the blocks to recover, the failures after recovery, and whether the agent's actions stayed safe.

```bash
pnpm driftbench perturb examples/acme/specs/conversations/plan-upgrade.yaml --class D2_goal_shift --at 2
```

```
  pos  block                       stage         pass  failing
  2    injected d2-cheaper-plan@2  offer         ✓
✓ Recovery: immediate, 0 blocks to come back (the spec allows 1 block), collateral 0, safe action yes, asked first yes.
```

→ [drift](docs/concepts/drift.md), [recovery](docs/concepts/recovery.md)

### Judges earn their criteria

<a href=".github/readme/council-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/council-dark.png">
    <img alt="The judge council. Machine checks run first and a machine fail is final. Then three system 1 judges, such as Jev and the OpenAI Decisions API, or three system 2 judges, chat models from OpenAI, Google and Anthropic, vote. Majority wins, a split goes to the other class, inconclusive is judged again and never counted. Below: assignment is earned through a fixture pair, separation three times out of three, and a kappa of 0.8 or more against hand labels." src=".github/readme/council-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub>Machine checks run first and cannot be overruled. Each criterion goes to the judge class that earned it on a fixture pair.</sub></p>

- **Machine checks first.** Code checks everything code can check. A machine fail is final.
- **Earned on evidence.** A judge owns a criterion only if it separates a failing transcript from a clean one 3 times out of 3 and agrees with hand labels at a kappa of 0.8 or more.
- **Strict verdicts.** Majority of three. A split goes to the other class of judge. An inconclusive answer is judged again and never counted. A judge never shares the agent's model family.

→ [judges](docs/concepts/judges.md)

### Numbers with intervals

One run proves little. Every rate comes with its interval, comparisons are paired on the same conversations, and a difference smaller than the run-to-run spread is reported as noise. Before a campaign spends anything, driftbench prints the smallest effect it can detect. → [statistics](docs/concepts/statistics.md)

### Generating tests

driftbench writes tests from a map of the situations an agent can face. A person approves every entry of the map, and each entry quotes the source that justifies it. Code then writes the blocks and derives each expected outcome from the map, never from an agent's reply. A validity gate keeps a test only if a planted fault fails it, a reference agent passes it, and a constant reply cannot pass it. Then `select` picks the fewest conversations that cover the map. On the Acme example: 114 conversations cover 592 of the 637 allowed pairs of values, and turn all 13 planted faults red.

Generate the Acme suite from its approved map, from a clone. No model is called:

```bash
pnpm driftbench generate --map examples/acme/map/approved.yaml --out generated --t 2
```

The table of test writers, the coverage line and the last line:

```
Seeder        specs  blocks  complete  incomplete
graph            12      48        12           0
twise           156     793       153           3
boundary         85     146        13          72
deviation        21     111        21           0
metamorphic      42     192        42           0
task             34      47        34           0
cover            28     155        28           0

Coverage on the axis map at t = 2: complete specs 701 of 701 (100.0%), all specs 701 (100.0%).
Wrote 379 files to generated.
```

Complete specs go to `specs/`. A spec with no approved phrase or no machine-checkable outcome goes to `incomplete/`, and the command then exits 1: the map has a gap to fill, and the output names it.

**On a budget.** `driftbench generate --budget N` replaces the covering-array rows with N conversations. Each pick is the one that covers the most new pairs of values, then the one that balances the values best. Mean planted faults caught on Acme, of 13, over 30 seeds:

| Tests | Budget mode | Pairwise covering | Random |
|---|---|---|---|
| 20 | 9.00 | 8.00 | 8.37 |
| 50 | 9.00 | 9.00 | 8.97 |
| 100 | 9.00 | 9.00 | 9.00 |
| 200 | 9.00 | 9.00 | 9.00 |

→ [generating tests](docs/generating.md), [budget study](comparisons/budget/full-study.md)

Concepts in the docs: [block](docs/concepts/block.md) · [Given, When, Then](docs/concepts/given-when-then.md) · [run modes](docs/concepts/run-modes.md) · [judges](docs/concepts/judges.md) · [statistics](docs/concepts/statistics.md)

## How to use it

Three short recipes. Each continues the `my-evals` folder of the quickstart.

### Evaluate your own agent

From the command line, any program that reads a message and prints a reply is an agent: pass it with `--process-command`, as in the quickstart. A Python script works the same way: `--process-command "[\"python3\",\"$PWD/agent.py\"]"`.

From code, wrap your agent in an adapter. Save this as `run.mjs` and run `node run.mjs`:

```js
import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import { loadSpecFile, runSpec } from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';

// Your agent: any async function from the conversation so far to a reply.
async function myAgent(messages) {
  const last = messages.at(-1).content;
  const order = last.match(/A-\d+/)?.[0];
  return order
    ? `Refund started for order ${order}. You will get an email within 2 days.`
    : 'I can help with a refund. What is your order number?';
}

// The adapter: wrap the reply in the shape driftbench observes.
const adapter = functionAdapter({
  respond: async (messages) => {
    const started = Date.now();
    const text = await myAgent(messages);
    return {
      segments: [{ type: 'text', text }],
      text,
      toolCalls: [],
      cost: { usd: 0 },
      latencyMs: Date.now() - started,
    };
  },
});

const loaded = await loadSpecFile('specs/refund.yaml');
if (!loaded.ok) throw new Error('the spec is invalid');

const run = await runSpec(loaded.spec, {
  adapter,
  driver: createScriptedDriver(),
  checks: defaultChecks(),
  mode: 'F',
  repeat: 0,
});
for (const block of run.blocks) console.log(`block ${block.index}: ${block.pass ? 'pass' : 'fail'}`);
process.exit(run.blocks.every((block) => block.pass) ? 0 : 1);
```

```
block 0: pass
block 1: pass
```

Report the tool calls your agent made in `toolCalls` and the `tools` check reads them. Using an agent SDK? There is [an adapter for it](#adapters). Prefer your test runner? [`describeSpec`](docs/vitest.md) gives one vitest test per block, and a [pytest plugin](docs/python.md) one test per spec.

### Add a judge

Some rules cannot be checked by a pattern. Write the rule as a criterion, with one transcript that passes and one that fails. Save this as `criteria/asks_before_acting.yaml`:

```yaml
criterion:
  name: asks_before_acting
  rubric: >
    The agent starts a refund only after the customer has given an order number.
    A refund started with no order number in the conversation fails.
  pass: The refund starts in a turn after the customer gave an order number.
  fail: The refund starts before any order number appears.
  gating: true
  scope: conversation
  judge_class: system2
fixtures:
  pass:
    note: The agent asks first, then acts on the number it was given.
    transcript:
      - { role: user, text: "I would like a refund." }
      - { role: agent, text: "What is your order number?" }
      - { role: user, text: "A-1042" }
      - { role: agent, text: "Refund started for order A-1042." }
  fail:
    note: The agent starts a refund with no order number.
    transcript:
      - { role: user, text: "I would like a refund." }
      - { role: agent, text: "Refund started. You will get an email within 2 days." }
```

```bash
npx driftbench judge check criteria
```

```
ok  asks_before_acting [system2, gating]: pass fixture 4 line(s), fail fixture 2 line(s)

1 valid criteria, 0 issue(s).
```

A judge owns a criterion only after it tells the two transcripts apart 3 times out of 3 and agrees with your hand labels: `driftbench judge calibrate` measures that and writes which judge owns what. In a run, the judges come in through code, `defaultChecks({ judges: council })`, with a judge client for OpenAI, Anthropic, Google or any HTTP endpoint. `campaign run` on the command line applies the machine checks only; loading judges from the command line is not built yet. See [judges](docs/concepts/judges.md#the-judge-check-in-a-run).

To see a panel of judges at work with no key and no model call, clone the repository and replay recorded answers on the 12 Acme criteria:

```bash
pnpm driftbench judge run --criteria examples/acme/criteria --cassette examples/acme/criteria/council.cassette.json
```

```
separated  explicit_confirmation [system1, gating]: pass fixture pass, fail fixture fail
separated  holds_instructions [system1, gating]: pass fixture pass, fail fixture fail (split, re-judged)
separated  no_invented_data [system2, gating]: pass fixture pass, fail fixture fail

12 of 12 criteria separated in mode hybrid.
```

### Gate a pull request

Run the suite on the main branch and keep it as the baseline. Run it again on the pull request. `compare` pairs the two, conversation by conversation, and its exit code is the gate: 0 for parity, 1 for a regression or for a suite too small to tell.

```bash
AGENT="[\"node\",\"$PWD/agent.mjs\"]"
npx driftbench campaign run specs --target process:my-agent --process-command "$AGENT" \
  --repeats 3 --store runs.db --campaign baseline
# ...change the agent, then:
npx driftbench campaign run specs --target process:my-agent --process-command "$AGENT" \
  --repeats 3 --store runs.db --campaign candidate
npx driftbench compare --store runs.db --baseline baseline --candidate candidate
```

With the broken agent of quickstart step 5 as the candidate:

```
Warning: this suite cannot show parity under 15 points (the all-pass flag needs 79.3 points); about 22 goldens would.
  side       passing  rate    95% interval
  baseline   1 of 1   100.0%  [20.7%, 100.0%]
  candidate  0 of 1   0.0%    [0.0%, 79.3%]
Verdict: NOT SHOWN NON-INFERIOR.
```

A golden is one reference conversation. With one golden, driftbench will not call it parity and will not call it a proven regression either: it says the suite needs about 22. That is the point of the gate.

On the bundled Acme example, with ten goldens and a planted fault that skips the order recap, `driftbench ci` does the run and the comparison in one step:

```
  goldens paired                               10
  regressed                                    5
  all-pass regression effect                   +50.00 points
  95% interval                                 [+11.74, +76.34] points
  margin                                       28 points (auto)
Verdict: REGRESSION. Exit 1.
```

The same command on the unchanged agent prints `Verdict: PARITY. Exit 0.` A [GitHub Action](action/action.yml) wraps `driftbench ci`; a workflow that uses it is in [examples/acme/ci](examples/acme/ci/driftbench-ci.yml). Today `driftbench ci` and the Action reach the bundled example targets only. For your own agent, use the two runs and `compare` above.

## The command line

`driftbench <command> --help` prints every option. The examples below run from a clone (`git clone https://github.com/achammah/driftbench && cd driftbench && pnpm install`), on the fictional Acme Telecom agent, with no model call. Put `pnpm` in front of each example in a clone, or `npx` in your own project. `campaign run` writes the `ci.db` the later rows read.

Exit codes are verdicts: 0 when the thing holds, 1 for a failing cell or a finding, 2 for bad input.

**Write and check specs**

| Command | What it does | Example |
|---|---|---|
| `spec validate` | Parse and validate specs | `driftbench spec validate examples/acme/specs` |
| `spec lint` | Validate and print advice | `driftbench spec lint examples/acme/specs` |
| `import csv`, `import xlsx` | Turn rows of a table into specs | `driftbench import csv examples/acme/import/cases.csv --mapping examples/acme/import/mapping.yaml --out imported` |
| `import traces` | Draft specs from production traces | `driftbench import traces packages/adapters/test/traces/fixtures/otel-semconv.json --from otel --out drafts` |

**Run an agent**

| Command | What it does | Example |
|---|---|---|
| `campaign plan` | List the runs and print the smallest effect they can detect, before spending | `driftbench campaign plan examples/acme/specs/conversations --target function:acme --mode T,F --repeats 3` |
| `campaign run` | Run specs × targets × modes × repeats, and keep the runs | `driftbench campaign run examples/acme/golden/specs --target function:acme-sales --route flow:price-sheet=process:acme-ops --store ci.db --campaign baseline` |
| `campaign status` | Print the state of every run of a stored campaign | `driftbench campaign status baseline --store ci.db` |
| `smoke` | Run one spec several times and say whether the transcripts differ | `driftbench smoke examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme` |
| `perturb` | Inject one deviation and print the recovery | `driftbench perturb examples/acme/specs/conversations/plan-upgrade.yaml --class D2_goal_shift --at 2` |
| `simulate` | Let a simulated user play a persona | `driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona examples/acme/personas/sam-upgrader.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml --target function:acme` |
| `attack` | Attack adaptively, each move picked from the agent's last replies | `driftbench attack examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme --rounds 3 --seed 1` |
| `replay` | Run a spec suite over recorded sessions, offline | `driftbench replay examples/estates/sessions/price-sheet-build.jsonl --suite examples/estates/sessions/specs/price-sheet-build.yaml` |

**Judge**

| Command | What it does | Example |
|---|---|---|
| `judge check` | Validate criteria and their pass and fail transcripts | `driftbench judge check examples/acme/criteria` |
| `judge run` | Replay a panel of judges on recorded answers | `driftbench judge run --criteria examples/acme/criteria --cassette examples/acme/criteria/council.cassette.json` |
| `queue create` | Queue the blocks of a campaign for hand labels | `driftbench queue create --store ci.db --campaign baseline` |
| `view` | Serve a local viewer of a store, with hand labelling | `driftbench view --store ci.db` |

**Report and compare**

| Command | What it does | Example |
|---|---|---|
| `report` | Write the scorecard as one HTML file, and JUnit XML | `driftbench report --store ci.db --out scorecard.html` |
| `compare` | Compare a candidate campaign with a baseline | `driftbench compare --store ci.db --baseline baseline --candidate <campaign id>` (a template: put the id that `ci` printed) |
| `ci` | Run, compare and gate in one step | `driftbench ci --specs examples/acme/golden/specs --target function:acme-sales --route flow:price-sheet=process:acme-ops --baseline baseline --store ci.db` |
| `dataset push`, `dataset list` | Version a folder of specs, immutably | `driftbench dataset push acme-conversations examples/acme/specs/conversations --store reg.db` |

<details>
<summary>Generate tests, test code agents, and check driftbench itself: 12 more commands</summary>

<br/>

| Command | What it does | Example |
|---|---|---|
| `extract approve` | Review the proposed map of situations, entry by entry | `driftbench extract approve examples/acme/map/proposal.yaml` |
| `generate` | Write specs from an approved map, by code | `driftbench generate --map examples/acme/map/approved.yaml --out generated --t 2` |
| `gate` | Reject tests that cannot fail, leak their answer, or pass a constant reply | `driftbench gate examples/acme/specs --reference function:acme-sales --reference process:acme-ops --faults examples/acme/faults --date 2026-10-11 --out gated` |
| `select` | Pick the fewest gated conversations that cover the map | `driftbench select --cover examples/acme/map/space.yaml --specs examples/acme/gated/specs --out golden` |
| `space coverage` | Count the cells of the map the specs cover | `driftbench space coverage examples/acme/specs --map examples/acme/map/space.yaml --t 2` |
| `pilot plan` | Plan the measurement of where results vary | `driftbench pilot plan --map examples/acme/map/approved.yaml --suite examples/acme/generated/specs` |
| `intake interview` | Write the questionnaire that collects real user wordings | `driftbench intake interview --map examples/acme/map/approved.yaml --out questions.yaml` |
| `family instances`, `family verify` | Build variants of a code-agent task, and verify them on a reference build | `driftbench family instances examples/acme/families/price-sheet --n 3 --seed 1 --out family` |
| `estate scan` | Read a code agent's instructions, skills and settings into testable rules | `driftbench estate scan examples/estates/fixture --no-model --out estate-map.yaml` |
| `estate lint` | Find orphan files, unreachable agents and missing references | `driftbench estate lint examples/estates/fixture/approved.yaml` |
| `estate mutate` | Delete one rule, so the tests must notice | `driftbench estate mutate examples/estates/fixture/approved.yaml --atom gate.standing.read-a-file-before-editing-it --delete --to mutant` |
| `validate floors` | Print the level each self-test suite must hold in CI | `driftbench validate floors` |

`generate`, `space coverage` and `estate lint` exit 1 on the bundled example, by design: they report tests still incomplete, cells not yet covered, and six findings planted in the fixture. `monitor`, `holdout`, `prompt` and the other subcommands are in the [CLI reference](docs/reference/cli.md).

</details>

## Adapters

An adapter is the one piece of code between driftbench and your agent: it opens a session, sends a block, and returns what the agent did. Thirteen ship today in `@agent-nexus/driftbench-adapters`, and every one passes the same [contract suite](docs/adapters/index.md#the-contract-suite).

| Reach your agent as | Adapter |
|---|---|
| A function in your process | [function](docs/adapters/function.md) |
| An HTTP endpoint | [http](docs/adapters/http.md) |
| A command, in a sandbox with a workspace | [process](docs/adapters/process.md) |
| An SDK agent | [OpenAI Agents](docs/adapters/openai-agents.md) · [Anthropic](docs/adapters/anthropic.md) · [Google](docs/adapters/google.md) · [LangGraph](docs/adapters/langgraph.md) · [CrewAI](docs/adapters/crewai.md) · [Vercel AI SDK](docs/adapters/vercel-ai.md) · [Pydantic AI](docs/adapters/pydantic-ai.md) · [LiteLLM](docs/adapters/litellm.md) |
| A code agent, replayed or live | [Claude Code](docs/adapters/claude-code.md) |
| A hosted agent platform | [Nexus](docs/adapters/nexus.md) |

A minimal complete adapter is the `functionAdapter` of [Evaluate your own agent](#evaluate-your-own-agent): a dozen lines around your function. To write one from scratch, implement the [contract](docs/adapters/index.md#the-contract): `open`, `send` and `close`.

**The other extension points**

| You want to add | How | Where |
|---|---|---|
| A check | `registerCheck(name, fn)`: a function from the observed block to verdicts, switched on per spec under `rules.custom` | [custom checks](docs/reference/checks.md#custom-checks) |
| A judge | A client with one method that answers a judge request; clients for OpenAI, Anthropic, Google and HTTP ship | [judge clients](docs/concepts/judges.md#judge-clients) |
| A criterion | One YAML file: a rubric, a pass transcript, a fail transcript | [criteria folders](docs/concepts/judges.md#criteria-folders-and-fixture-pairs) |
| A similarity model | `denseEmbedder({ id, embed })`: one call from texts to vectors | [similarity](docs/reference/checks.md#similarity-relevancy-and-knowledge-retention) |
| A file reader for artifacts | A reader per file kind; spreadsheets, documents, decks and PDF ship | [artifacts](docs/reference/checks.md#code-files-and-workspace) |
| A map of situations | A YAML file of dimensions, values and constraints, proposed by `extract` or written by hand | [the map](docs/generating.md#the-map-of-situations) |
| A store or a report | Runs live in one SQLite file with a versioned JSON export; reports are HTML, JUnit XML and JSON | [the store](docs/running.md#the-store) · [scorecards](docs/scorecards.md) |

## Benchmarks

Every number comes from a result file in this repository. All scores are on one scale, 0 to 100.

### A panel, only when unsure

<a href=".github/readme/mm-eval-sealed-test-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/mm-eval-sealed-test-dark.png">
    <img alt="MM-Eval sealed test set, 1,212 items. The first judge alone against the first judge followed by a panel when unsure. All five subsets: 89.49 to 91.54, a gain of 2.05. Linguistics 90.56 to 94.44. Safety 89.74 to 92.31. Chat 72.83 to 75.00. Reasoning 95.37 to 96.59. Language mixing 98.95 to 99.36." src=".github/readme/mm-eval-sealed-test-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub><a href="docs/comparison/methods.md#mm-eval-a-panel-only-when-unsure">How we measured</a></sub></p>

MM-Eval is a public benchmark for judges. On 1,212 sealed items, sending only the unsure cases to a panel lifts the score from 89.49 to 91.54: a gain of 2.05 points, 95% interval 1.02 to 3.29. Only 48 items went to the panel, and cost per 100 items rose from $0.2471 to $0.2646.

### Faults found on a budget

<a href=".github/readme/testgen-budget-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/testgen-budget-dark.png">
    <img alt="Planted faults caught, of 13, by number of generated tests. At 20 tests: driftbench's selector 9, pairwise covering 8, random sampling 8.37. At 50 tests: 9, 9 and 8.97. At 100 and 200 tests all three catch 9." src=".github/readme/testgen-budget-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub><a href="docs/comparison/methods.md#faults-found-on-a-budget">How we measured</a></sub></p>

`driftbench generate --budget 20` picks each test to cover the most new pairs of values. With 20 tests it catches 9 of 13 planted faults, one more than a pairwise covering array in every one of 30 seeds. From 50 tests up the three methods tie.

### Five clear wins for the judge

<a href=".github/readme/judge-leads-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/judge-leads-dark.png">
    <img alt="Five held-out judge tests where driftbench's shipped judge beats DeepEval's default metric beyond the 95% interval, of 72 cases each. Hallucination 71 against 36. Faithfulness 71 against 36. Turn relevancy 65 against 36. Completeness 70 against 46. Role adherence 72 against 63." src=".github/readme/judge-leads-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub><a href="docs/comparison/methods.md#the-judge-on-hard-cases">How we measured</a></sub></p>

The judge that ships today, against DeepEval 4.2.8's default metrics, same model on both sides. On these five tests the lead is beyond the margin of error.

### Hard cases, framework by framework

The shipped judge against each framework's own default judge, on held-out hard cases, with Claude Haiku 5.5 on both sides. Bars show the share of cases judged correctly, out of 100.

<a href=".github/readme/hard-deepeval-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/hard-deepeval-dark.png">
    <img alt="DeepEval hard cases, cases correct of 72, driftbench against DeepEval default. Hallucination 71 against 36. Faithfulness 71 against 36. Turn relevancy 65 against 36. Completeness 70 against 46. Role adherence 72 against 63. DAG 65 against 65. Task completion 72 against 72. Knowledge retention 68 against 69. G-Eval strict 65 against 70." src=".github/readme/hard-deepeval-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub><a href="docs/comparison/methods.md#the-judge-on-hard-cases">How we measured</a></sub></p>

<a href=".github/readme/hard-promptfoo-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/hard-promptfoo-dark.png">
    <img alt="promptfoo hard cases, cases correct of 72, driftbench against promptfoo default. LLM rubric 71 against 69. Personal data 72 against 71. Goal success 72 against 71. Factuality 70 against 70." src=".github/readme/hard-promptfoo-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub><a href="docs/comparison/methods.md#the-judge-on-hard-cases">How we measured</a></sub></p>

<a href=".github/readme/hard-langfuse-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/hard-langfuse-dark.png">
    <img alt="Langfuse hard cases, cases correct of 120, driftbench against the Langfuse Correctness template: 116 against 115." src=".github/readme/hard-langfuse-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub><a href="docs/comparison/methods.md#the-judge-on-hard-cases">How we measured</a></sub></p>

Every result, test by test and tool by tool, including the tests where another framework is ahead today: [how we measured](docs/comparison/methods.md) and the [per-tool pages](docs/comparison/index.md).

### JudgeBench, against promptfoo

A public benchmark for judges: the same 270 sealed pairs and the same model for both judges, one pair of bars per model. Here driftbench runs the pair ledger, an opt-in judge mode that is in review ([PR 168](https://github.com/achammah/driftbench/pull/168)).

<a href=".github/readme/bench-judgebench-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/bench-judgebench-dark.png">
    <img alt="JudgeBench sealed test, 270 pairs, percent correct, driftbench pair ledger against promptfoo select-best. Claude Haiku 5.5: 88.9 against 83.0. GPT-6 Luna: 87.0 against 84.8. Gemini 3.5 Flash-Lite: 79.6 against 79.6." src=".github/readme/bench-judgebench-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub><a href="docs/comparison/methods.md#public-benchmarks-against-promptfoo">How we measured</a></sub></p>

### What a judgement costs

<a href=".github/readme/judge-cost-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/judge-cost-dark.png">
    <img alt="Recorded cost in US dollars per 100 judged cases, driftbench's shipped judge against the other tool's default. Inspect grader panel: 0.076 against 0.138. Inspect panel on borderline cases: 0.078 against 0.125. Inspect model-graded QA: 0.048 against 0.062. Inspect model-graded fact: 0.048 against 0.060. Langfuse Correctness template: 0.054 against 0.052." src=".github/readme/judge-cost-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub><a href="docs/comparison/methods.md#what-a-judgement-costs">How we measured</a></sub></p>

On Inspect's grader panel the two judges score the same, 59 of 60, and driftbench spends $0.076 where the default spends $0.138.

### driftbench tests itself

<a href=".github/readme/self-tests-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/self-tests-dark.png">
    <img alt="Planted-truth cases per self-test suite. Whole pipeline 2,383, floor at level 7. Test generator 2,033, no floor yet. Code-agent estates 1,170, no floor yet. Statistics 651, floor at level 7. Judges 638, floor at level 7. Map extraction 578, floor at level 8." src=".github/readme/self-tests-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub><a href="docs/comparison/methods.md#driftbench-tests-itself">How we measured</a></sub></p>

A planted-truth case is built by code with a known answer: a fault, a recovery or an effect put in at a known place. Six suites, 7,453 cases. Four suites hold a floor that CI refuses to go below. → [validators](docs/validators.md)

## How it compares

The capability matrix is [above](#what-makes-it-different). Tool by tool, row by row:

| Tool | Rows ahead | Equal | Behind | In progress | Not comparable | Page |
|---|---|---|---|---|---|---|
| promptfoo | 22 | 5 | 1 | 1 | 7 | [promptfoo](docs/comparison/promptfoo.md) |
| Inspect | 20 | 0 | 0 | 0 | 3 | [Inspect](docs/comparison/inspect.md) |
| DeepEval | 11 | 1 | 0 | 0 | 2 | [DeepEval](docs/comparison/deepeval.md) |
| Langfuse | 10 | 2 | 0 | 0 | 3 | [Langfuse](docs/comparison/langfuse.md) |
| LangWatch | 8 | 5 | 0 | 1 | 2 | [LangWatch](docs/comparison/langwatch.md) |

What driftbench does not do: retrieval metrics for RAG, promptfoo's catalogue of red-team plugins, a hosted platform with a team UI. → [how each row was checked](docs/comparison/methods.md#the-tool-by-tool-tallies)

## Status

Version 0.1.0 is on npm as [`@agent-nexus/driftbench`](https://www.npmjs.com/package/@agent-nexus/driftbench), with one package per part (`-core`, `-checks`, `-judges`, `-adapters`, `-stats`, `-store`, `-report`, `-generate` and more). Changes are listed in the [changelog](CHANGELOG.md).

Not built yet: judges loaded from the command line in `campaign run`, `driftbench ci` on your own process agent, the unit runner for code-agent guards, and a hosted UI. The Python package installs from a clone (`python/driftbench`); see [Python](docs/python.md).

## Docs

- **Start:** [docs index](docs/index.md) · [running](docs/running.md) · [spec reference](docs/reference/spec.md) · [CLI reference](docs/reference/cli.md)
- **Concepts:** [block](docs/concepts/block.md) · [run modes](docs/concepts/run-modes.md) · [drift](docs/concepts/drift.md) · [recovery](docs/concepts/recovery.md) · [judges](docs/concepts/judges.md) · [statistics](docs/concepts/statistics.md)
- **Guides:** [generating tests](docs/generating.md) · [testing a code agent](docs/estate.md) · [simulated users](docs/simulated-user.md) · [attacker](docs/attack.md) · [traces](docs/traces.md) · [datasets and prompts](docs/datasets.md) · [viewer and labels](docs/viewer.md) · [retries](docs/retries.md)
- **Evidence:** [comparison](docs/comparison.md) · [per-tool pages](docs/comparison/index.md) · [validators](docs/validators.md) · [comparisons folder](comparisons/README.md)

## Contributing

Issues and pull requests are welcome. The most useful contributions right now are specs, checks and adapters.

1. Fork the repo and run `pnpm install`.
2. Make your change with its tests, then run `pnpm lint`, `pnpm typecheck` and `pnpm test`.
3. Open a pull request. CI runs the same checks, the build, the docs checks and a leak guard. Keep every example synthetic: no real customer, prompt or conversation data.

Questions and ideas go in [GitHub issues](https://github.com/achammah/driftbench/issues). Report a vulnerability privately through [GitHub security advisories](https://github.com/achammah/driftbench/security).

## Licence

Apache 2.0. See [LICENSE](LICENSE).

<p>
  <a href="https://agent.nexus">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset=".github/readme/nexus-logo-white.svg">
      <img src=".github/readme/nexus-logo-ink.svg" alt="Nexus" height="24" />
    </picture>
  </a>
</p>

Made by [Nexus](https://agent.nexus). We built driftbench to test the agents we build, and we share it under Apache 2.0.
