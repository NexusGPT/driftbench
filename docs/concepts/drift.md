# Drift

Drift is a block that goes wrong. driftbench looks for it on single blocks and across the succession of blocks, and names its class. The class names are fixed in the schema (`DriftClass`). The runner assigns three of them today, from the checks that fail; the engine that assigns all five is planned, phase 3.

## Five drift classes

A failing block carries one class or more.

| Class | What went wrong | Conversation example | Task example |
|---|---|---|---|
| `X1_local` | a wrong answer or action in this block, while every earlier fact still holds | the reply quotes the wrong price | the total row of the workbook is wrong |
| `X2_contradiction` | the block contradicts a fact established earlier | the agent uses the address the user corrected two blocks before | the user asked for amounts in euros, and the new sheet shows dollars |
| `X3_flow` | the wrong stage: one skipped, one repeated, or a known fact asked again | the agent submits the order before the recap | the agent writes the summary before it loads the data |
| `X4_format` | a format or persona rule breaks | a double send, card misuse, a reply in the wrong language | the final reply narrates internal steps |
| `X5_tool` | a tool call, a skill or a guard is missing, extra or repeated, or a call has wrong parameters | `submit_order` runs twice | the `xlsx` skill never loads, or a guard denies a command the step needed |

## How a class is assigned

Today the runner gives a block a class by the checks its failing verdicts come from: `tools`, `forbidden`, `skills` and `guards` give `X5_tool`; `lang` and `cards` give `X4_format`; `stage`, which reads the stage the runtime reports, gives `X3_flow`. The other checks give no class yet. See [running](../running.md#drift).

The engine of phase 3 assigns the classes this way:

* The stage classifier labels the stage the agent reaches in the block: a system 1 judge, or a table of regular expressions per flow when the spec provides one. When the label differs from `expect.stage`, the block gets `X3_flow`. A runtime that reports its own stages lists them in the block's runtime trace, and that report is the observed stage; the classifier runs only when the trace carries none.
* The ledger check asks a judge whether the block contradicts any fact in the ledger, and quotes the fact. A contradiction gives `X2_contradiction`.
* Tool, skill and guard checks give `X5_tool`, the action-level class. Format and channel checks give `X4_format`: language, cards, one message per turn.
* Any other failing check or criterion, with the ledger intact, gives `X1_local`.

The ledger is the set of facts from `given.ledger`, plus each block's `ledger_add`. See [Given, When, Then](given-when-then.md). The checks are listed in [checks](../reference/checks.md), and the judges in [judges](judges.md).

## Across the succession

Each run gets these metrics.

| Metric | Meaning |
|---|---|
| `firstDriftBlock` | the index of the first failing block |
| `driftCount` | the number of failing blocks |
| `driftRate` | `driftCount` divided by the number of blocks in the run |
| `longestClean` | the longest stretch of passing blocks |
| `minOverBlocks` | true when every block passes; the run passes only then |

The runner computes them on every run, phase 1, from whether each block passed, injected blocks included. A failing block counts as drift whatever its class. See [running](../running.md#the-run-record).

One conversation, or one task, with a single wrong block fails `minOverBlocks`. The other metrics say where and how often it went wrong.

## Drift between versions and over time

Comparing two versions of an agent on the same specs, and watching a live agent over time, are statistics. See [statistics](statistics.md).
