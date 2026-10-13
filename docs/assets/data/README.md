# Chart data

The README charts are drawn by `tools/readme-charts.mjs` from result files of this repository. This folder holds the two files that are not result files of a comparison.

## chart-facts.csv

Written by the script on every run. It lists the title sentence of each chart and every number drawn, with the file the number was read from. `node tools/readme-charts.mjs --check` exits 1 when a chart or this file no longer matches its sources.

## mm-eval-sealed-test.json

A copy of `research/astra-mm/data/test-paired.json`, with the same values and this repository's JSON formatting, at commit `a7800af8d82459d2850f6478b0d3e5e5fde6edfb` of the branch `research/astra-mm-replicate`. That branch is not merged into main, so the file is copied here for the chart to read.

* What it measures: the MM-Eval benchmark (arXiv 2410.17578), five core subsets, scored with the benchmark's own rule. The first judge is Claude Haiku 5.5. When its two readings of a pair do not agree decisively, a panel of three other model families votes.
* Items: 1,212, every remaining test item that no earlier run had scored. The list was sealed at commit `2154225b`, before the first call, and scored once.
* Result: 89.49 alone, 91.54 with the panel, a paired gain of 2.05 points, 95 percent interval 1.02 to 3.29 (paired bootstrap, 20,000 draws).
* Limits stated by the source: three of the five subset intervals touch zero. Three safety items were provider refusals that the panel recovered; without them the gain is 1.75, interval 0.77 to 2.96. Both arms are driftbench; no other tool is run.

The full write-up, the seal and every recorded call are in [RESULT.md](https://github.com/achammah/driftbench/blob/a7800af8d82459d2850f6478b0d3e5e5fde6edfb/research/astra-mm/RESULT.md) on that commit. The development-set replay that ships on main is in [examples/escalation](../../../examples/escalation/README.md).
