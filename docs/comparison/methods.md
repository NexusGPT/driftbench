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

* One chart per benchmark: `docs/assets/bench-<name>-light.png` and `-dark.png`, drawn by `.github/readme/render.mjs` from `.github/readme/src/chart-data.js`. `tools/readme-charts.mjs` writes that file from the result files in `docs/assets/data/sealed/` and lists every drawn number, with its file, in [chart-facts.csv](../assets/data/chart-facts.csv).
* Each chart has one panel per model: Claude Haiku 5.5, GPT-6 Luna and Gemini 3.5 Flash-Lite. Bars run from the highest score to the lowest, on one scale of 0 to 100. Gemini 3.8 Flash was dropped by the owner and is not charted. Recorded results remain archival data; no pending or parked cell remains.
* A competitor is drawn when a result file records it. `tools/readme-charts.mjs` reads every contestant of `docs/comparison/benchmarks/<bench>-all-peers.json`, the file the all-competitors run writes, and draws each beside driftbench and promptfoo; a contestant that refused some items is drawn with its score, which counts each refused item as wrong, and the label "N refused"; a contestant with no result, or run on another model, is drawn as "not run". Today only promptfoo is recorded. A model with no recorded cell is drawn as "not run", and no value is estimated.
* The driftbench side is the pair ledger, an opt-in judge mode merged in PR 168, and on the verify benchmark the frozen verify cascade. Neither is the shipped default.
* promptfoo runs its select-best template (llm-rubric on verify) at its pinned commit `8014282`.
* Each set was frozen before the first model call. JudgeBench: 159 of the 270 pairs share a source question with earlier evaluations. Verify and RubricBench are previously evaluated splits. MM-Eval items were never scored before.
* A correction across the whole family of cells is pending, so no cell is called a win or a loss. On JudgeBench with Claude Haiku 5.5 the uncorrected p is 0.0139; on MM-Eval with Haiku 0.00061, and with Gemini 3.5 Flash-Lite 0.042 in promptfoo's favour.
* MM-Eval with Haiku scores 591 of the 600 pairs; the nine missing are safety items.
* RubricBench with Claude Haiku 5.5 is complete: 790 of 790 pairs, in `rubricbench-haiku.json`.
* Verify is run with GPT-6 Luna only. Claude Haiku 5.5 is pending and Gemini 3.5 Flash-Lite has no cell, so both are drawn as "not run".
* On verify a judge that always says fail scores 78.7 percent, above both judges. On writing a rule that picks the longer reply scores 67.6 percent, above every judge, and the three models did not pass the development check against such rules.
* Writing uses the long-structured setting, `judgePairLedger(..., { preference: 'long-structured' })`. It is opt-in and declares a preference for longer, well-structured replies (see [the judges docs](../concepts/judges.md#declared-preference-long-structured-opt-in)). The owner chose it as driftbench's reported writing result. The driftbench writing bars are that setting, applied in code to the recorded pair-ledger verdicts of each model (`examples/writing-heldout/replay_test.ts`, data in `docs/assets/data/sealed/writing-long-structured.json`); the chart says so in a footnote. The default judge's scores stay in the table below. The setting picks the longer reply in 94 to 97 percent of games, so it wins because these labels favour longer replies. On a fresh pool of 144 pairs never used before, run once after a freeze, it scored 66.0 percent with Claude Haiku 5.5 and was a significant win after Holm against all five other judges ([results](../../examples/writing-heldout/results/RESULTS.md)).
* Titles compare the bars as drawn, to one decimal: two bars that read 80.8 and 80.8 are equal. On RubricBench with Gemini 3.5 Flash-Lite the scores are 80.76 for driftbench and 80.82 for promptfoo, so the title calls them equal.

All charted numbers:

| Benchmark | Model | driftbench | promptfoo | No model |
|---|---|---|---|---|
| JudgeBench | Claude Haiku 5.5 | 88.9 | 83.0 |  |
| JudgeBench | GPT-6 Luna | 87.0 | 84.8 |  |
| JudgeBench | Gemini 3.5 Flash-Lite | 79.6 | 79.6 |  |
| MM-Eval | Claude Haiku 5.5 | 88.9 | 86.5 |  |
| MM-Eval | GPT-6 Luna | 88.1 | 89.0 |  |
| MM-Eval | Gemini 3.5 Flash-Lite | 81.4 | 83.8 |  |
| RubricBench | Claude Haiku 5.5 | 82.7 | 75.6 |  |
| RubricBench | GPT-6 Luna | 82.3 | 81.5 |  |
| RubricBench | Gemini 3.5 Flash-Lite | 80.8 | 80.8 |  |
| verify | Claude Haiku 5.5 | not run | not run | 78.7 (always fail) |
| verify | GPT-6 Luna | 74.7 | 72.4 | 78.7 (always fail) |
| verify | Gemini 3.5 Flash-Lite | not run | not run | 78.7 (always fail) |
| writing, long-structured setting | Claude Haiku 5.5 | 65.3 | 56.9 | 67.6 (longer reply) |
| writing, long-structured setting | GPT-6 Luna | 65.3 | 56.9 | 67.6 (longer reply) |
| writing, long-structured setting | Gemini 3.5 Flash-Lite | 65.9 | 60.4 | 67.6 (longer reply) |
| writing, default judge | Claude Haiku 5.5 | 61.3 | 56.9 | 67.6 (longer reply) |
| writing, default judge | GPT-6 Luna | 53.8 | 56.9 | 67.6 (longer reply) |
| writing, default judge | Gemini 3.5 Flash-Lite | 59.0 | 60.4 | 67.6 (longer reply) |

## What a judgement costs

Recorded model spend per 100 held-out cases, Claude Haiku 5.5 on both sides, one run. Cost is not accuracy: on three of the Inspect rows the cheaper judge is also the less accurate one. On the Langfuse row driftbench costs slightly more.

## driftbench tests itself

A suite runs as a ladder of levels, cheapest check first. A floor is the level every seed must reach in CI, for the ladder version named in `validators/floors.json`. The suites are built to find gaps in driftbench. Two suites have no floor yet, and no pass rate is quoted until a suite passes an independent audit. The open items are written down suite by suite in [`validators/`](../../validators). `pnpm driftbench validate floors` prints the floors; `pnpm driftbench validate judges --seed 1` runs one suite.

## The tool by tool tallies

Each row of a per-tool page is measured head to head, measured against our own earlier version, or read from the other tool's docs or code, and says which. The judged rows for DeepEval, Inspect and promptfoo count the candidate judge, not the shipped one. Every Langfuse row but one is read from documentation, with no Langfuse instance run.

## Mixture of Judges

* The README's line, at least as accurate with 3.5 to 19.4 times fewer costly calls: on the sealed sets MoJ scores 85.0, 94.9 and 65.2 against promptfoo's 84.0, 94.7 and 57.0, with ties on the first two after a Holm correction and a win on the third; promptfoo uses 200 reasoning calls per 100 pairs, MoJ 57, 21 and 10 (200 / 57 = 3.5, 200 / 10.3 = 19.4).

* Design and results: [research/moj/RESULTS.md](../../research/moj/RESULTS.md), section "Sealed confirmation (run once)", with [report.json](../../research/moj/results/sealed/report.json); copies from `research/system1-judge` at `06fd0edb`, listed in [research/moj](../../research/moj/README.md). MoJ runs from that research harness; the package's opt-in escalation API (`createEscalation`) is on main.
* The sealed ids were drawn before any call and the primary configuration (`r9-two-step`) was frozen before any sealed score existed. All contestants run GPT-6 Luna at medium effort. Sealed pairs: JudgeBench 100, MM-Eval 294, writing 300.
* Results: JudgeBench (strict both-order rule) MoJ 85.0 [77, 91], promptfoo 84.0 [76, 90]; MM-Eval 94.9 [92, 97] against 94.7 [92, 97]; writing 65.2 [60, 70] against 57.0 [51, 62]. Paired tests with a Holm correction over six comparisons: ties on JudgeBench and MM-Eval, a win on writing against promptfoo (+8.2 points, Holm p 0.047). On writing a rule that picks the longer reply scores 69.7, above MoJ.
* Reasoning (System-2) calls per 100 pairs: MoJ 57, 21 and 10 on JudgeBench, MM-Eval and writing; promptfoo 200 on each. MoJ also makes 246 to 347 System-1 calls per 100 pairs, whose price is not published.
* Inspect's scorer cascade is cited from its [multiple scorers page](https://inspect.aisi.org.uk/multiple-scorers.html); judge choice and ensembles in the other tools from row 11 of the [comparison](../comparison.md).
* In this repository: on the 1,212 sealed MM-Eval items, the first judge sent 48 to the panel. The mean item score on those 48 rose from 51.0 to 85.4, with 36 items better and 2 worse; the whole set rose from 89.49 to 91.54. Source: `docs/assets/data/mm-eval-sealed-test.json`, fields `fullPanelEscalationsOnly` and `completeCascadeCohort`; the script writes them under `impact-moj` in [chart-facts.csv](../assets/data/chart-facts.csv). Both arms are driftbench.

## Tests written by code

* The README's ratio, 5.8 times fewer tests: on the Acme example map, the covering array that holds every allowed pair of settings has 156 rows (`covering array of 156 rows over 5 dimensions, 356 of 356 allowed 2-tuples`), where the same five dimensions allow 901 combinations (`budget 20: 20 cells of 901 allowed`); 901 / 156 = 5.8. The first line is printed by `generate --t 2`, the second by `generate --budget 20`, both on the merged head. Both lines are printed by `generate` on main.
* The figure is a toy example with three settings of two values each: 8 combinations, 4 tests (an orthogonal array) hold every pair, and a bug that needs French and transfer together is caught by one of the 4. It illustrates the method; it is not a measurement.
* Coverage: `pnpm driftbench generate --map examples/acme/map/approved.yaml --out generated --t 2` on main prints `complete specs 708 of 708 (100.0%)` and writes 508 files. It exits 1 because some map values have no approved phrase yet; their specs go to `incomplete/`.
* Covering arrays (pairwise and t-wise) and sliced Latin hypercube sampling (`slicedLhs`, for approved numeric settings in budget mode) are described in [generating tests](../generating.md#sliced-numeric-sampling).
* The budget figures (9.00, 8.00, 8.37 of 13 at 20 tests) are means over 30 seeds from [the budget study](../../comparisons/budget/full-study.md); see [faults found on a budget](#faults-found-on-a-budget).
* `pnpm driftbench select --cover examples/acme/map/space.yaml --specs examples/acme/gated/specs --out golden` prints `114 conversations cover every cell the pool covers (592 of 708)` and `Faults turned red: 13 of the 13 the pool turns red`.
* The DeepEval synthesizer is cited from row 19 of the [comparison](../comparison.md).

## Blocks: a failure you can diagnose

* The figure says in plain words what the run reports. The step labels are the stages of `gen-twise-066`; the expected and observed lines restate `stage.reached` and `forbidden.order.create` below.

* The example is a recorded run on main: the golden Acme suite on the planted fault `x3-skips-recap` (`driftbench ci ... --target fault:x3-skips-recap --faults examples/acme/faults --route flow:price-sheet=process:acme-ops`), then `campaign status <campaign> --detail` and `--json`. In `gen-twise-066`, block 3 (counted from 0, the fourth block) fails `stage.reached` with `reached order_placed, expected recap` and `forbidden.order.create` with `order.create called 1 time (call-1); the block expects it 0 times`. Block 4 then fails `tools.order.create.count` with `order.create called 0 times, expected exactly 1; calls in this block: none`. The other five blocks pass.
* That each of the 13 scored Acme faults turns specific blocks red is read from the committed gate report `examples/acme/gated/gate-report.json`; the red block count of each fault is listed in the blast radius containment test.
* The units the other tools score are cited from row 1 of the [comparison](../comparison.md#where-driftbench-is-ahead).
* The README's numbers: on the Acme gated suite (195 conversations, 861 blocks), nine planted faults of the sales assistant turn at least one block red. For each, the red share is the red blocks divided by the blocks of the conversations that hold a red block. A whole-conversation score marks every block of those conversations. Eight faults leave some blocks green, with shares of 18.1 to 40.0 percent; the wrong language fault turns 826 of the 861 blocks red, every block of the 171 conversations that fail.
* The counts come from `examples/acme/gated/gate-report.json`, over the accepted blocks of the dev split, the set `examples/acme/test/radius/contained.test.ts` uses. `tools/readme-charts.mjs` computes them and writes them to [chart-facts.csv](../assets/data/chart-facts.csv) under `impact-blocks`.

| Planted fault | Red blocks | Conversations that fail | Blocks in them | Red share |
|---|---|---|---|---|
| `x1-invents-price` | 125 | 125 | 692 | 18.1% |
| `x3-skips-recap` | 237 | 102 | 601 | 39.4% |
| `x4-wrong-language` | 826 | 171 | 826 | 100.0% |
| `x5-drops-coverage-check` | 86 | 86 | 413 | 20.8% |
| `d2-ignores-goal-shift` | 22 | 9 | 55 | 40.0% |
| `d4-order-on-loose-yes` | 54 | 25 | 157 | 34.4% |
| `d6-obeys-instruction` | 13 | 13 | 68 | 19.1% |
| `d8-hides-tool-failure` | 15 | 15 | 44 | 34.1% |
| `d9-answers-out-of-scope` | 11 | 11 | 58 | 19.0% |

## Blast radius: rerun only what a change touches

* The README's numbers, measured on the Acme gated suite of 195 conversations and 861 scored blocks, with `driftbench radius examples/acme/gated/specs --change examples/acme/radius/<manifest>.yaml --mode F`: a rerun of the recap change sends 601 blocks and saves 30.2 percent; the price sheet task family saves 95.9 percent; the reply language rule and a tool no block names save 0, because the radius is the whole suite.
* The table of eleven changes is in `docs/concepts/blast-radius.md`, section "Measured on Acme". `tools/readme-charts.mjs` reads it and writes each row to [chart-facts.csv](../assets/data/chart-facts.csv) under `impact-radius`; the script stops when the table no longer parses. The commands above reproduce the rows.
* Containment: for each of the 13 scored faults, `examples/acme/test/radius/contained.test.ts` asserts that every block the committed gate report turns red lies inside the radius of its change. 13 of 13 hold, with no red block outside.
* End to end (`packages/cli/test/radius-carry.test.ts`, no model call): a baseline runs the agents as `acme-v1`; the sales assistant then suffers the planted fault that skips the recap. The radius campaign of the recap change sends 606 of 867 blocks and carries 93 cells (261 blocks): 30.1 percent saved. A full campaign of the same faulty agent fails on 102 cells, the same 102 the radius campaign fails on, none of them carried.
* By change, the share of blocks not sent ranges from 0 to 95.9 percent. These are counts of blocks, not seconds.
* The radius, `driftbench radius` and `campaign run --change` are on main.
* Caching in the other tools is cited from row 22 of the [comparison](../comparison.md).

## A judge that shows its work

* The README's "7 points above promptfoo": 82.7 against 75.6 percent on RubricBench with Claude Haiku 5.5.

* The pair ledger is opt-in (`answerContract: 'ledger'`), merged in PR 168.
* promptfoo's select-best prompt is quoted from its grader, vendored at commit `8014282` in [comparisons/promptfoo/hard/vendor/grading.ts.txt](../../comparisons/promptfoo/hard/vendor/grading.ts.txt): "Output the index of the text that best fits the criteria. You must output a single integer."
* RubricBench, Claude Haiku 5.5, 790 test pairs, 1,580 games: 1,306 correct (82.7 percent) against promptfoo select-best's 1,194 (75.6 percent); game McNemar p = 6.9e-10, with a correction across the full family of cells still pending. The test split was evaluated before. The result file is a copy of `examples/judge-benchmarks/experiments/ledger-rb/live-summary.json` on `research/ledger-rb` at `fe76cd48`, in [docs/assets/data/sealed/rubricbench-haiku.json](../assets/data/sealed/rubricbench-haiku.json).

## The other innovation figures

* Drift and recovery: `pnpm driftbench perturb examples/acme/specs/conversations/plan-upgrade.yaml --class D2_goal_shift --at 2` prints `Recovery: immediate, 0 blocks to come back (the spec allows 1 block), collateral 0`. Row 15 of the comparison.
* Statistics: the Acme gate prints `this suite cannot show parity under 15 points (the all-pass flag needs 27.8 points); about 22 goldens would.` with 10 goldens paired. Row 17 of the comparison.
* Code agents: `pnpm driftbench estate lint examples/estates/fixture/approved.yaml` reads 125 atoms and prints 6 findings, all planted in the fixture. The six code-agent benchmarks (SWE-bench, Terminal-Bench, OpenHands evaluation, GAIA, AgentBench, inspect_ai sandboxes), what decides a pass in each and whether it grades office files are listed in [code-agent benchmarks](../comparison.md#code-agent-benchmarks).
* Self-tests: see [driftbench tests itself](#driftbench-tests-itself).
* Replay: `pnpm exec tsx examples/escalation/replay.ts` reproduces the MM-Eval development score of 91.16 from recordings, with no provider call.
