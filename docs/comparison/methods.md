# How the README numbers were measured

The README shows charts and one line of result under each. This page holds what sits behind them: the sets, the rules, the limits and the commands. Every charted number, with the file it was read from, is listed in [chart-facts.csv](../assets/data/chart-facts.csv).

The charts are drawn from data that [`tools/readme-charts.mjs`](../../tools/readme-charts.mjs) reads from result files of this repository. The script recomputes every Wilson interval and stops when one differs from its source. `node tools/readme-charts.mjs --check` exits 1 when the committed chart data no longer matches its sources. `.github/readme/render.mjs` renders the figures in light and dark.

## The capability matrix

The matrix counts what each tool's public docs or source show, one cited page per cell, read on 11 October 2026. "Not found" means the page where a capability would be documented does not show it. It is not proof that the tool lacks it. Every cell and its source is on the [comparison page](../comparison.md). In six rows no other tool shows the capability in full in the pages read: end state assertions, judge calibration, drift across turns, recovery metrics, intervals with significance tests, and multi-language handling.

## MM-Eval: a panel, only when unsure

* The 1,212 items were sealed before the first call and scored once. The seal, the exclusions and every recorded call are in the [research write-up](https://github.com/achammah/driftbench/blob/a7800af8d82459d2850f6478b0d3e5e5fde6edfb/research/astra-mm/RESULT.md); provenance of the copied result file is in [docs/assets/data](../assets/data/README.md).
* The gain is 2.05 points, 95 percent interval 1.02 to 3.29, from a paired bootstrap with 20,000 draws; 36 items won and 2 lost.
* Three of the five subset gains have intervals that touch zero.
* Both arms are driftbench: the chart shows what escalation adds. It is not a comparison with another tool.
* The first judge is Claude Haiku 5.5; the panel has three other model families.
* The development-set replay on main runs with no model call: `pnpm exec tsx examples/escalation/replay.ts` (89.65 to 91.16 on 400 items).

## Faults found on a budget

* The study runs on the fictional Acme agent with 13 scripted faults, over selection seeds 1 to 30, with scripted reference and faulty agents and no model call.
* At 20 tests the exact two-sided paired test gives p = 1.86e-09 against pairwise covering. The value is unadjusted.
* From 50 tests up the three methods tie.
* Four of the 13 faults cannot be reached by conversations at all: they need task specs, which the full generator adds.
* This is one map with scripted faults. It is not a result on other agents.
* `pnpm exec tsx comparisons/budget/check-analysis.ts` checks the analysis, and [the study](../../comparisons/budget/full-study.md) lists the commands that rerun it.

## The judge on hard cases

* Same model on both sides (Claude Haiku 5.5), same cases, labels fixed before the run, each tool's own default prompt copied unchanged. The driftbench side is the judge that ships, not a candidate.
* The cases are fictional and built to be hard: near misses, paraphrases, long distractors. They share construction templates, so the intervals describe these sets, not every agent.
* "Ahead" and "behind" mean the two 95 percent Wilson intervals do not overlap. "Level" means they overlap.
* Goal success (promptfoo) and task completion (DeepEval) give both judges the same evidence. With each tool's default inputs the other tools score 36 and 44 of 72.
* The Langfuse set was already known when this judge version was measured. The Langfuse side uses the best of the template's two reported settings.
* On DeepEval the shipped judge trails by one case on knowledge retention and by five on strict G-Eval; both are inside the intervals.
* The fact ledger of PR 163 has not been measured on the Inspect set. Its strict mode, which also demands a matching quote, abstains on more than half of its replay cases.
* The candidate judge that scores 60 of 60 on three Inspect rows is not the default.
* The README charts the DeepEval, promptfoo and Langfuse sets. On the Inspect set the shipped judge scores 59 against 59, 48 against 57, 48 against 59 and 49 against 60, of 60: behind on two of four tests. The rows are on the [Inspect page](inspect.md).
* Reproduce from recorded answers, with no model call: `python3 comparisons/promptfoo/hard/score.py`, and the replay commands in [comparisons/deepeval/hard](../../comparisons/deepeval/hard/README.md), [comparisons/langfuse/hard](../../comparisons/langfuse/hard/README.md) and [comparisons/inspect/hard](../../comparisons/inspect/hard/README.md).

## Public benchmarks, against promptfoo

The result files are copies from the research branches, listed with their commits in [docs/assets/data](../assets/data/README.md).

* The driftbench side is the pair ledger, an opt-in judge mode in review (PR 168), and on the verify benchmark the frozen verify cascade. Neither is the shipped default.
* promptfoo runs its select-best template (llm-rubric on verify) at its pinned commit `8014282`.
* Each set was frozen before the first model call. JudgeBench: 159 of the 270 pairs share a source question with earlier evaluations. Verify and RubricBench are previously evaluated splits. MM-Eval items were never scored before.
* A correction across the whole family of cells is pending, so no cell is called a win or a loss. On JudgeBench with Claude Haiku 5.5 the uncorrected p is 0.0139; on MM-Eval with Haiku 0.00061, and with Gemini 3.5 Flash-Lite 0.042 in promptfoo's favour.
* MM-Eval with Haiku scores 591 of the 600 pairs; the nine missing are safety items.
* Gemini 3.8 Flash was dropped by the owner and is left out of every chart. Models left out for another reason were not final: Claude Haiku 5.5 was still running on RubricBench and pending on verify.
* On verify a judge that always says fail scores 78.7 percent, above both judges. On writing a rule that picks the longer reply scores 67.6 percent, above both judges, and the three models did not pass the development check against such rules.
* Every comparison chart uses one score axis, 0 to 100.
* The README shows the JudgeBench chart. The MM-Eval, RubricBench, verify and writing results against promptfoo are not charted in the README for now; their numbers are in the result files named above and in [chart-facts.csv](../assets/data/chart-facts.csv):

| Benchmark | Model | driftbench | promptfoo |
|---|---|---|---|
| MM-Eval | Claude Haiku 5.5 | 88.9 | 86.5 |
| MM-Eval | GPT-6 Luna | 88.1 | 89.0 |
| MM-Eval | Gemini 3.5 Flash-Lite | 81.4 | 83.8 |
| RubricBench | GPT-6 Luna | 82.3 | 81.5 |
| RubricBench | Gemini 3.5 Flash-Lite | 80.8 | 80.8 |
| verify | GPT-6 Luna | 74.7 | 72.4 |
| writing | Claude Haiku 5.5 | 61.3 | 56.9 |
| writing | GPT-6 Luna | 53.8 | 56.9 |
| writing | Gemini 3.5 Flash-Lite | 59.0 | 60.4 |

## What a judgement costs

Recorded model spend per 100 held-out cases, Claude Haiku 5.5 on both sides, one run. Cost is not accuracy: on three of the Inspect rows the cheaper judge is also the less accurate one. On the Langfuse row driftbench costs slightly more.

## driftbench tests itself

A suite runs as a ladder of levels, cheapest check first. A floor is the level every seed must reach in CI, for the ladder version named in `validators/floors.json`. The suites are built to find gaps in driftbench. Two suites have no floor yet, and no pass rate is quoted until a suite passes an independent audit. The open items are written down suite by suite in [`validators/`](../../validators). `pnpm driftbench validate floors` prints the floors; `pnpm driftbench validate judges --seed 1` runs one suite.

## The tool by tool tallies

Each row of a per-tool page is measured head to head, measured against our own earlier version, or read from the other tool's docs or code, and says which. The judged rows for DeepEval, Inspect and promptfoo count the candidate judge, not the shipped one. Every Langfuse row but one is read from documentation, with no Langfuse instance run.

## Mixture of Judges

The MoJ numbers in the README are practice data: no sealed test item was read. On writing, a rule that picks the longer reply scores 68.7 against MoJ's 64.8. The design and the full results are on the [research branch](https://github.com/achammah/driftbench/blob/9be7b75133e31a2f5d81f1dec0ef15c517be5d21/research/moj/RESULTS.md).
