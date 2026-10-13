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
* Models left out of a chart were not final: Gemini 3.8 Flash stopped on a provider quota or ran in part; Claude Haiku 5.5 was still running on RubricBench and pending on verify.
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

* Design and results: `research/moj/RESULTS.md` on `research/system1-judge` at `06fd0edb`, section "Sealed confirmation (run once)". MoJ runs from that research harness; the package's opt-in escalation API (`createEscalation`) is on main.
* The sealed ids were drawn before any call and the primary configuration (`r9-two-step`) was frozen before any sealed score existed. All contestants run GPT-6 Luna at medium effort. Sealed pairs: JudgeBench 100, MM-Eval 294, writing 300.
* Results: JudgeBench (strict both-order rule) MoJ 85.0 [77, 91], promptfoo 84.0 [76, 90]; MM-Eval 94.9 [92, 97] against 94.7 [92, 97]; writing 65.2 [60, 70] against 57.0 [51, 62]. Paired tests with a Holm correction over six comparisons: ties on JudgeBench and MM-Eval, a win on writing against promptfoo (+8.2 points, Holm p 0.047). On writing a rule that picks the longer reply scores 69.7, above MoJ.
* Reasoning (System-2) calls per 100 pairs: MoJ 57, 21 and 10 on JudgeBench, MM-Eval and writing; promptfoo 200 on each. MoJ also makes 246 to 347 System-1 calls per 100 pairs, whose price is not published.
* Inspect's scorer cascade is cited from its [multiple scorers page](https://inspect.aisi.org.uk/multiple-scorers.html); judge choice and ensembles in the other tools from row 11 of the [comparison](../comparison.md).

## Synthetic tests, written by code

* Coverage: `pnpm driftbench generate --map examples/acme/map/approved.yaml --out generated --t 2` on main prints `complete specs 637 of 637 (100.0%)` and writes 333 files. It exits 1 because some map values have no approved phrase yet; their specs go to `incomplete/`.
* Covering arrays (pairwise and t-wise) and sliced Latin hypercube sampling (`slicedLhs`, for approved numeric settings in budget mode) are described in [generating tests](../generating.md#sliced-numeric-sampling).
* The budget figures (9.00, 8.00, 8.37 of 13 at 20 tests) are means over 30 seeds from [the budget study](../../comparisons/budget/full-study.md); see [faults found on a budget](#faults-found-on-a-budget).
* `pnpm driftbench select --cover examples/acme/map/space.yaml --specs examples/acme/gated/specs --out golden` prints `114 conversations cover every cell the pool covers (592 of 637)` and `Faults turned red: 13 of the 13 the pool turns red`.
* The DeepEval synthesizer is cited from row 19 of the [comparison](../comparison.md).

## Blocks: a failure you can diagnose

* The example is a recorded run on main: the golden Acme suite on the planted fault `x3-skips-recap` (`driftbench ci ... --target fault:x3-skips-recap --faults examples/acme/faults --route flow:price-sheet=process:acme-ops`), then `campaign status <campaign> --detail` and `--json`. In `gen-twise-066`, block 3 (counted from 0, the fourth block) fails `stage.reached` with `reached order_placed, expected recap` and `forbidden.order.create` with `order.create called 1 time (call-1); the block expects it 0 times`. Block 4 then fails `tools.order.create.count` with `order.create called 0 times, expected exactly 1; calls in this block: none`. The other five blocks pass.
* That each of the 13 scored Acme faults turns specific blocks red is read from the committed gate report `examples/acme/gated/gate-report.json`; the red block count of each fault is listed in the blast radius containment test.
* The units the other tools score are cited from row 1 of the [comparison](../comparison.md#where-driftbench-is-ahead).

## Blast radius: rerun only what a change touches

* The numbers come from `docs/concepts/blast-radius.md` on the blast radius pull requests ([PR 238](https://github.com/achammah/driftbench/pull/238), commit `916220c5`), measured on the Acme gated suite: 195 specs, 867 blocks sent in all, 861 scored.
* End to end (`packages/cli/test/radius-carry.test.ts` on that branch, no model call): a baseline runs the agents as `acme-v1`; the sales assistant then suffers the planted fault that skips the recap. The radius campaign of the recap change sends 606 of 867 blocks and carries 93 cells (261 blocks): 30.1 percent saved. A full campaign of the same faulty agent fails on 102 cells, the same 102 the radius campaign fails on, none of them carried.
* By change, the share of blocks not sent ranges from 0 (the reply-language rule, a tool no block names) to 95.9 percent (the price sheet task family). These are counts of blocks, not seconds.
* For every scored Acme fault, a test asserts that every block the full suite turns red lies inside the radius of its change.
* Caching in the other tools is cited from row 22 of the [comparison](../comparison.md).

## A judge that shows its work

* The pair ledger is opt-in (`answerContract: 'ledger'`), merged in PR 168.
* RubricBench, Claude Haiku 5.5, 790 test pairs, 1,580 games: 1,306 correct (82.7 percent) against promptfoo select-best's 1,194 (75.6 percent); game McNemar p = 6.9e-10, with a correction across the full family of cells still pending. The test split was evaluated before. The result file is a copy of `examples/judge-benchmarks/experiments/ledger-rb/live-summary.json` on `research/ledger-rb` at `fe76cd48`, in [docs/assets/data/sealed/rubricbench-haiku.json](../assets/data/sealed/rubricbench-haiku.json). In the same file, Gemini 3.8 Flash is partial (116 of 790 pairs) and scores below promptfoo.

## The other innovation figures

* Drift and recovery: `pnpm driftbench perturb examples/acme/specs/conversations/plan-upgrade.yaml --class D2_goal_shift --at 2` prints `Recovery: immediate, 0 blocks to come back (the spec allows 1 block), collateral 0`. Row 15 of the comparison.
* Statistics: the Acme gate prints `this suite cannot show parity under 15 points (the all-pass flag needs 27.8 points); about 22 goldens would.` with 10 goldens paired. Row 17 of the comparison.
* Code agents: `pnpm driftbench estate lint examples/estates/fixture/approved.yaml` reads 125 atoms and prints 6 findings, all planted in the fixture. The code-agent benchmarks are cited from the comparison page.
* Self-tests: see [driftbench tests itself](#driftbench-tests-itself).
* Replay: `pnpm exec tsx examples/escalation/replay.ts` reproduces the MM-Eval development score of 91.16 from recordings, with no provider call.
