# Chart data

`tools/readme-charts.mjs` reads the README chart numbers from result files of this repository. This folder holds the files that are not result files of a comparison.

## chart-facts.csv

Written by the script on every run. It lists the title sentence of each chart and every number drawn, with the file the number was read from. The rows `impact-blocks`, `impact-radius` and `impact-moj` are the numbers the README quotes in prose for blocks, blast radius and mixture of judges. `node tools/readme-charts.mjs --check` exits 1 when a chart or this file no longer matches its sources.

## mm-eval-sealed-test.json

A copy of `research/astra-mm/data/test-paired.json`, with the same values and this repository's JSON formatting, at commit `a7800af8d82459d2850f6478b0d3e5e5fde6edfb` of the branch `research/astra-mm-replicate`. That branch is not merged into main, so the file is copied here for the chart to read.

* What it measures: the MM-Eval benchmark (arXiv 2410.17578), five core subsets, scored with the benchmark's own rule. The first judge is Claude Haiku 5.5. When its two readings of a pair do not agree decisively, a panel of three other model families votes.
* Items: 1,212, every remaining test item that no earlier run had scored. The list was sealed at commit `2154225b`, before the first call, and scored once.
* Result: 89.49 alone, 91.54 with the panel, a paired gain of 2.05 points, 95 percent interval 1.02 to 3.29 (paired bootstrap, 20,000 draws).
* Limits stated by the source: three of the five subset intervals touch zero. Three safety items were provider refusals that the panel recovered; without them the gain is 1.75, interval 0.77 to 2.96. Both arms are driftbench; no other tool is run.

The full write-up, the seal and every recorded call are in [RESULT.md](https://github.com/NexusGPT/driftbench/blob/a7800af8d82459d2850f6478b0d3e5e5fde6edfb/research/astra-mm/RESULT.md) on that commit. The development-set replay that ships on main is in [examples/escalation](../../../examples/escalation/README.md).

## sealed/

Copies of result files from research branches that are not merged into main, with the same values and this repository's JSON formatting. In `sealed/verify.json` the field `key` is renamed to `cellId` in the published copy; its 10 values, which are cache cell hashes, are unchanged.

| File | Branch, commit | Path on that branch |
|---|---|---|
| `sealed/judgebench.json` | `research/ledger-jb`, `ed4412072de2f7904879cbb397ecd2306673d7f6` | `examples/ledger-jb/results/cells.json` |
| `sealed/mm-eval.json` | `research/ledger-mm`, `c61e2b24a6be30758ea776edf9185babc138bba2` | `research/ledger-mm/test-results.json` |
| `sealed/rubricbench-luna.json` | `research/ledger-rb`, `d36a01002409fd23f91a234078d5c95559741e86` | `examples/judge-benchmarks/experiments/ledger-rb/luna-complete-check.json` |
| `sealed/rubricbench-flash-lite.json` | `research/ledger-rb`, `d36a01002409fd23f91a234078d5c95559741e86` | `examples/judge-benchmarks/experiments/ledger-rb/flash-lite/live-summary.json` |
| `sealed/verify.json` | `research/ledger-verify`, `1f94d87ed373790819fa2565e4f63a65ebff76f1` | `examples/ledger-verify/evidence/cells.json` |
| `sealed/writing.json` | `research/ledger-wp`, `5db7e7adaae3b2c7d669630e12c0c9eb1548f6d7` | `examples/ledger-wp/results/cells.json` |
| `sealed/rubricbench-haiku.json` | `research/ledger-rb`, `fe76cd48b9078924d4404e5af94ff5f0cd494ca8` | `examples/judge-benchmarks/experiments/ledger-rb/live-summary.json` |

What they measure and their limits: [how the README numbers were measured](../../comparison/methods.md#public-benchmarks-against-promptfoo).
