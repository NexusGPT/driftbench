# What it does

Every feature of driftbench, grouped by what you do with it. The [README](../README.md#everything-it-can-do) shows each group with an example you can copy.

<a href="../.github/readme/areas-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../.github/readme/areas-dark.png">
    <img alt="Four things driftbench tests, on four cards. Test conversations: replay a real conversation, let a simulated user talk, or throw in a surprise at any step. Rules and judges: rules check what code can check, and a judge decides the rest once it has proved it can. Going off track: where the agent first went wrong, and how many steps it took to get back. Numbers you can trust: every rate with its range, and a yes or no your CI can act on." src="../.github/readme/areas-light.png" width="100%">
  </picture>
</a>

**Write and generate tests**
- [Specs](reference/spec.md): one conversation or task as blocks. Each carries a starting point (Given), a user turn (When) and an expected result (Then).
- [Generated tests](generating.md): code writes the blocks from an approved map of situations, and reports the pairs of values they cover.
- [Tests from production](traces.md): draft specs from OpenTelemetry, Nexus or Claude Code traces, or from [a spreadsheet](datasets.md).

**Run agents**
- [13 adapters](adapters/index.md): a function, an HTTP endpoint, a command, and the common agent SDKs.
- [Three run modes](concepts/run-modes.md): each block alone, the whole conversation, or with a deviation injected.
- [Simulated users](simulated-user.md) and an [adaptive attacker](attack.md) that picks its next move from the agent's last replies.

**Check and judge**
- [37 machine checks](reference/checks.md): tool calls and their arguments, text, language, personal data, end state, files, spreadsheets, cost.
- [Judges](concepts/judges.md): a model judges what code cannot, must quote its evidence, and a panel votes when the first judge is unsure.
- [Hand labels](viewer.md): label blocks in a local viewer and measure each judge against them.
- [Block rules and fault finding](innovations.md#blocks-test-each-step-and-find-the-fix): trace a verdict to its rule file and a failure to its fix.

<sub>Fault finding ships as rule files and a runner; no command runs it yet (see [Fixing the block that failed](how-it-works.md#fixing-the-block-that-failed)).</sub>

**Measure variance**
- [Intervals on every rate](concepts/statistics.md), repeats, and the share of runs that pass every time.
- [Where results vary](concepts/statistics.md#where-results-vary): how much of the spread comes from the agent, the wording, the persona or the judge.
- [Drift](concepts/drift.md) and [recovery](concepts/recovery.md): the first block that went wrong, and how many blocks the agent needs to come back.

**Compare runs**
- [Paired comparison](concepts/statistics.md#comparing-a-baseline-and-a-candidate) of two versions on the same conversations.
- [A CI gate](reference/cli.md#driftbench-ci) with an exit code: parity, regression, or not enough evidence.
- [Scorecards](scorecards.md): one HTML file, JUnit XML, and a [monitor](traces.md#monitoring-driftbench-monitor---source-traces) for production traces.

**Record and replay**
- [Replay recorded sessions](estate.md#replay-built) offline, with no model call.
- [Cached blocks](running.md#the-cache-and-replay) and recorded judge answers, so a rerun costs nothing.
- [Versioned datasets and prompts](datasets.md#the-registry), restorable byte for byte.

**Validate the evaluator**
- [Planted-truth suites](validators.md): code builds cases with a known answer and measures what driftbench reports.
- [A validity gate](generating.md#the-gate) for tests: a test that a planted fault does not fail, or that a constant reply passes, is rejected.

**Only here, in full.** We read seven other evaluation tools against 30 capabilities. Six are found in full in none of them:

| Only here, in full | What you get | Proof |
|---|---|---|
| [Recovery metrics](concepts/recovery.md) | Inject a deviation at a chosen block and count the blocks until the agent is back, the failures after it, and whether its actions stayed safe | [recovery.test.ts](../packages/core/test/runner/recovery.test.ts) |
| [Drift across turns](concepts/drift.md) | The first block that went wrong, and which of five kinds of drift it was | [drift.test.ts](../packages/core/test/runner/drift.test.ts) |
| [Judge calibration](concepts/judges.md#calibration-an-assignment-is-earned) | A judge owns a criterion only after it separates a pass from a fail 3 times out of 3 and agrees with your hand labels | [calibration.test.ts](../packages/judges/test/calibration.test.ts) |
| [Intervals and significance tests](concepts/statistics.md) | An interval on every rate, paired tests between two versions, and a correction across criteria | [intervals.test.ts](../packages/stats/test/intervals.test.ts) |
| [End state assertions](reference/checks.md#end-state) | Check what the agent actually left behind: the order placed, the file written, the cells of the workbook | [end_state.test.ts](../packages/checks/test/end_state.test.ts) |
| [Multi-language handling](reference/checks.md#text-and-language) | Check the language of a reply and that it stays stable through the conversation | [lang.test.ts](../packages/checks/test/lang.test.ts) |

<a href="../.github/readme/capability-matrix-light.png">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../.github/readme/capability-matrix-dark.png">
    <img alt="Of 30 evaluation capabilities: driftbench 30. In full, in part, not found: deepeval 12, 14, 4. langwatch 12, 11, 7. promptfoo 10, 15, 5. langfuse 10, 7, 13. inspect_ai 9, 14, 7. opik 9, 10, 11. braintrust 2, 11, 17." src="../.github/readme/capability-matrix-light.png" width="100%">
  </picture>
</a>
<p align="center"><sub>Every cell with its source: <a href="comparison.md">comparison page</a>. <a href="comparison/methods.md#the-capability-matrix">How we measured</a>.</sub></p>

## How it compares

The capability matrix is above. One page per tool, row by row:

| Tool | Page |
|---|---|
| promptfoo | [promptfoo](comparison/promptfoo.md) |
| Inspect | [Inspect](comparison/inspect.md) |
| DeepEval | [DeepEval](comparison/deepeval.md) |
| Langfuse | [Langfuse](comparison/langfuse.md) |
| LangWatch | [LangWatch](comparison/langwatch.md) |

What driftbench does not do: retrieval metrics for RAG, promptfoo's catalogue of red-team plugins, a hosted platform with a team UI. → [how each row was checked](comparison/methods.md#the-tool-by-tool-tallies)
