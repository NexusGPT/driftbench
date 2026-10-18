# Comparison with other evaluation tools

These pages compare driftbench with five evaluation tools, one page per tool. Every row names its result, its basis, an example, and a way to reproduce it. Rows where another tool is ahead, or where the two are equal, are stated as such.

## Results at a glance

| Tool | Ahead | Equal | Behind | In progress | Limit | Page |
|---|---|---|---|---|---|---|
| promptfoo | 22 | 5 | 1 | 1 | 7 | [promptfoo](promptfoo.md) |
| LangWatch | 8 | 5 | 0 | 1 | 2 | [LangWatch](langwatch.md) |
| DeepEval | 11 | 1 | 0 | 0 | 2 | [DeepEval](deepeval.md) |
| Inspect | 20 | 0 | 0 | 0 | 3 | [Inspect](inspect.md) |
| Langfuse | 10 | 2 | 0 | 0 | 3 | [Langfuse](langfuse.md) |

DeepEval judged-row counts use the comparison-only candidate, which is not yet the shipped default. Its page also reports the shipped judge.

The counts come from each tool's comparison table in the repository's evidence record. Each page follows its table row for row.

## Public judge benchmarks

Each benchmark has a section on its own page, with its chart. A section says "data not public" where the benchmark's data is not published.

| Benchmark | Status | Page |
|---|---|---|
| JudgeBench | charted, three models | [JudgeBench](benchmarks/index.md#judgebench) |
| LongJudgeBench | charted, verify with one model and writing with three | [LongJudgeBench](benchmarks/index.md#longjudgebench) |
| MM-Eval | charted, three models | [MM-Eval](benchmarks/index.md#mm-eval) |
| RubricBench | charted, three models | [RubricBench](benchmarks/index.md#rubricbench) |
| RubricEval | data not public | [RubricEval](benchmarks/index.md#rubriceval) |

The method behind every chart of the README is on [how the README numbers were measured](methods.md).

## Harder held-out cases

Three result pages score harder fictional cases with the same model on every side:

* [promptfoo, Langfuse and DeepEval](hard-peers-heldout.md)
* [LangWatch](hard-peers-langwatch.md)
* [Today's judge on the earlier held-out sets](hard-peers-existing-sets.md)

## How each row was checked

A row has one of these bases:

* **Measured head-to-head:** both tools ran on the same input, and the example shows both outputs.
* **Measured against our earlier version:** we measured our own before and after. The other tool was not run.
* **Compared against their docs or code:** the comparison rests on reading the other tool's public documentation or its source. Nothing was run on their side.

Langfuse rows are all of the last kind, because no Langfuse instance was run. Most promptfoo and Inspect rows are also of that kind.

## What the results mean

* **Ahead:** driftbench does the thing better on the stated case.
* **Equal:** both do it the same way on the stated case.
* **Behind:** the other tool does it better. Each such row says what is missing.
* **In progress:** the evidence is incomplete, and the work is still going on. The row says what is still open.
* **Limit:** the row is not being worked, and the reason is stated: for example, the host has no container runtime, or the other tool runs its own tools, so our gate cannot see the call before it is made.

## Reproducing a row

Each row names a command or a test file in this repository. A row marked "not reproducible from main yet" cites a test that is awaiting merge. It does not count as reproducible until that test is on the main branch.
