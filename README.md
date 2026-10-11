<h1 align="center">driftbench. Every exchange is a unit test.</h1>

<p align="center">
  <img src=".github/readme/hero.jpg" alt="driftbench, an agent evaluation framework by Nexus. Every number carries an interval. Drift and recovery are measured, block by block. On the right, a perturbed run: a goal shift lands at block three, the observed path leaves the expected one and rejoins it two blocks later." width="100%" />
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
> **Not released yet.** Phase 0 is in progress: the spec format, the validator, the coverage tool and a synthetic Acme Telecom example. The runner, judges and statistics on this page are designed and planned. The [roadmap](#roadmap) shows what each phase delivers.

---

## Get started

driftbench is not on npm yet. Run it from source with Node 22 or newer and pnpm.

```bash
git clone https://github.com/achammah/driftbench
cd driftbench
pnpm install
pnpm driftbench spec validate examples/acme/specs
```

The last command loads the Acme Telecom specs and validates them against the spec schema. Acme Telecom is the synthetic sales assistant behind every example. No API key needed.

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

Until the Phase 1 runner lands, `pnpm vitest run examples/acme` drives every Acme conversation through the agent and checks tools, text, stages, guards, the end state and the recovery after each deviation.

---

## What you get

Four areas. Each bullet names the phase that delivers it.

<a href=".github/readme/areas-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/areas-dark.png">
    <img alt="Four areas on four cards: scenarios and simulated users, checks and judges, drift and recovery, statistics and CI gates." src=".github/readme/areas-light.png" width="100%">
  </picture>
</a>

- **[Scenarios and simulated users](#a-block-is-a-unit-test)**: YAML specs, scripted turns, simulated users with a persona and a goal, ten deviation classes to inject at any block. <sub>Phases&nbsp;0,&nbsp;1&nbsp;and&nbsp;3</sub>
- **[Checks and judges](#judges-earn-their-criteria)**: machine checks on tools, text, language, personal data, end state and files, then a council of judges that earn each criterion. <sub>Phases&nbsp;1&nbsp;and&nbsp;2</sub>
- **[Drift and recovery](#drift-and-recovery)**: five drift classes, the first drift block, the drift rate, and the turns to recover after an injected deviation. <sub>Phase&nbsp;3</sub>
- **[Statistics and CI gates](#numbers-with-intervals)**: an interval on every rate, `pass^k`, paired tests, a noninferiority verdict and an exit code for CI. <sub>Phase&nbsp;4</sub>

## Things you can do with driftbench

1. **Write a golden as blocks** and validate it with `driftbench spec validate`. <sub>Phase&nbsp;0&nbsp;·&nbsp;in&nbsp;progress</sub>
2. **Run one golden three ways** on the same agent. Teacher forced against free running gives the compounding index. <sub>Phases&nbsp;1&nbsp;and&nbsp;3&nbsp;·&nbsp;planned</sub>
3. **Inject a goal shift at block 4**, or a language switch, or an instruction hidden in data, and count the blocks the agent needs to come back. <sub>Phase&nbsp;3&nbsp;·&nbsp;planned</sub>
4. **Let a cheap judge own a criterion** once it matches your hand labels as well as a chat model does. <sub>Phase&nbsp;2&nbsp;·&nbsp;planned</sub>
5. **Gate a prompt change in CI**: noninferiority against the baseline, with a margin you set. <sub>Phase&nbsp;4&nbsp;·&nbsp;planned</sub>
6. **Check a code interpreter agent on what it leaves behind**: the cells of a spreadsheet, the slides of a deck, the files it touched. <sub>Phase&nbsp;1&nbsp;·&nbsp;planned</sub>

---

## How it works

This section describes the design. Phase 0 builds the spec format now. The runner, checks, judges and statistics arrive in phases 1 to 4. The [docs](docs/index.md) hold the detail: concepts, the spec reference, the CLI and the adapters.

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

Agent harnesses add a runtime battery: hook replay with negative controls, skill loading gates, process step order, mutation tests that must fail first, speed budgets and a reply style check.

In the docs: [Block](docs/concepts/block.md) · [Given, When, Then](docs/concepts/given-when-then.md) · [Checks](docs/reference/checks.md) · [Spec reference](docs/reference/spec.md)

### One golden, three runs

<a href=".github/readme/modes-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/modes-dark.png">
    <img alt="One golden, the plan upgrade spec, feeds three runs. Teacher forced: each block starts from the golden, so a miss stays local; it measures local accuracy. Free running: the agent's own replies carry forward, one miss leads to another; it measures compounding. Perturbed: a deviation lands at block two and the agent is back one block later; it measures recovery." src=".github/readme/modes-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub>Teacher forced isolates each block. Free running lets errors compound. Perturbed injects a deviation and measures the way back.</sub></p>

| Mode, and where each block starts | What it isolates |
|---|---|
| **Teacher forced**<br/>from the golden's own earlier blocks | local accuracy, block by block |
| **Free running**<br/>from the agent's own earlier replies | compounding: one wrong block poisons the next |
| **Perturbed**<br/>free running, plus a deviation at block k | recovery: whether it comes back, how fast, at what cost |

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
- **A verdict CI can gate on.** The candidate is noninferior when the upper bound of every gating regression stays under your margin.

In the docs: [Statistics](docs/concepts/statistics.md)

---

## Integrations

All planned. Every adapter must pass the same contract suite. The [adapter contract](docs/adapters/index.md) is in the docs.

**Agents:** [function](docs/adapters/function.md) · [HTTP](docs/adapters/http.md) · [Nexus](docs/adapters/nexus.md) · [a command line agent in a sandbox](docs/adapters/process.md) · OpenAI Agents · Anthropic · Google · LangGraph<br/>
**Judges:** Jev · OpenAI Decisions API · OpenAI · Google · Anthropic · any HTTP endpoint<br/>
**Reports:** HTML scorecard · run diff · JUnit XML · Markdown summary<br/>
**CI:** exit codes on the verdict · GitHub Action<br/>
**Store:** SQLite · versioned JSON export

## How it compares

driftbench builds on ideas other tools document well. What their docs describe as of 11 October 2026, and where driftbench takes each one:

| Tool, and what its docs describe | driftbench, by design |
|---|---|
| **[LangWatch Scenario](https://langwatch.ai/scenario/advanced/how-judging-works/)**<br/>A judge that marks each criterion passed, failed or inconclusive. | The same three outcomes, per block. Inconclusive is judged again and never counted. <sub>Phase&nbsp;2</sub> |
| **[promptfoo](https://www.promptfoo.dev/docs/configuration/expected-outputs/)**<br/>Trajectory assertions: which tools ran, with which arguments, in which order. | Tool checks on label, count, arguments and order, plus an end state check. <sub>Phase&nbsp;1</sub> |
| **[DeepEval](https://deepeval.com/docs/conversation-simulator)**<br/>A conversation simulator that plays a user from a scenario and a persona. | Simulated users with a goal, plus deviations injected at a chosen block. <sub>Phase&nbsp;3</sub> |
| **[Inspect](https://inspect.aisi.org.uk/metrics.html)**<br/>Wilson intervals for binary scores, clustered standard errors, and a [scorer cascade](https://inspect.aisi.org.uk/multiple-scorers.html) that stops at the first scorer that settles a sample. | Intervals on every rate with one conversation per cluster, paired tests, and judges that run cheapest first. <sub>Phases&nbsp;2&nbsp;and&nbsp;4</sub> |
| **[Langfuse](https://langfuse.com/docs/evaluation/overview)**<br/>A GitHub Action that fails the job when a score violates your threshold. | A noninferiority verdict with a margin, as an exit code. <sub>Phase&nbsp;4</sub> |
| **[Opik](https://www.comet.com/docs/opik/evaluation/evaluate_threads)**<br/>A function that scores whole conversation threads. | Verdicts per block, then drift and recovery across them. <sub>Phase&nbsp;3</sub> |

The [comparison page](docs/comparison.md) sets driftbench beside seven evaluation tools and six code agent benchmarks, capability by capability, with a source and a read date for every cell.

---

## Roadmap

| Phase and status | What it delivers |
|---|---|
| **Phase 0** · Foundations<br/>`in progress` | Monorepo and CI, a leak guard, spec schemas and loader, `spec validate`, the coverage tool, the Acme Telecom example, docs |
| **Phase 1** · Runner, checks and store<br/>`planned` | Free running mode, scripted users, the function, HTTP, Nexus and process adapters, the sandbox, machine checks including artifacts, workspace, execution and safety, a SQLite store, cost per segment |
| **Phase 2** · Judge council<br/>`planned` | Judge clients, majority and cascade, fixture pairs, kappa, earned assignment, task artifacts judged the same way |
| **Phase 3** · Perturbation, drift and recovery<br/>`planned` | Simulated users, ten deviation classes on conversations and on code tasks, drift classes, recovery metrics, teacher forced mode |
| **Phase 4** · Statistics, scorecard, CI gate and runtime battery<br/>`planned` | Intervals and paired tests, the noninferiority verdict, HTML scorecard, JUnit XML, `driftbench ci`, a GitHub Action, the runtime battery |
| **Release**<br/>`planned` | SDK adapters for OpenAI Agents, Anthropic, Google and LangGraph, the docs site, version 0.1.0 on npm |

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
