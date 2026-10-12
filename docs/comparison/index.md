# Comparison with other evaluation tools

These pages compare driftbench with five evaluation tools, one page per tool. Every row names its result, its basis, an example, and a way to reproduce it. Rows where another tool is ahead, or where the two are equal, are stated as such.

## Results at a glance

| Tool | Ahead | Equal | Behind | In progress | Page |
|---|---|---|---|---|---|
| promptfoo | 9 | 13 | 7 | 4 | [promptfoo](promptfoo.md) |
| LangWatch | 7 | 1 | 2 | 2 | [LangWatch](langwatch.md) |
| DeepEval | 9 | 0 | 0 | 2 | [DeepEval](deepeval.md) |
| Inspect | 18 | 7 | 2 | 3 | [Inspect](inspect.md) |
| Langfuse | 5 | 3 | 0 | 0 | [Langfuse](langfuse.md) |

## How each row was checked

A row has one of these bases:

* **Measured head-to-head:** both tools ran on the same input, and the example shows both outputs.
* **Measured against our earlier version:** we measured our own before and after. The other tool was not run.
* **Compared against their docs or code:** the comparison rests on reading the other tool's public documentation or its source. Nothing was run on their side.

Langfuse rows are all of the last kind, because no Langfuse instance was run. Most promptfoo and Inspect rows are also of that kind.

## What "in progress" means

A row is in progress when its evidence is incomplete: a measurement was not run, or a test that reproduces it is not yet merged. Such a row states what is still open. No result is assumed for it.

## Reproducing a row

Each row names a command or a test file in this repository. A row marked "not reproducible from main yet" cites a test that is awaiting merge. It does not count as reproducible until that test is on the main branch.
