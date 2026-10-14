# Public judge benchmarks

One chart per public judge benchmark. A chart has one panel per model and, in each panel, driftbench beside every competitor with a recorded result, from the highest score to the lowest, on one scale of 0 to 100. promptfoo is the only competitor with a recorded result on these benchmarks in this repository. "Not run" marks a result that was not run; no value is estimated. The same charts are in the [README](../../../README.md#public-benchmarks-against-promptfoo).

The sets, the rules and the limits of each result, with the result files, are in [how the README numbers were measured](../methods.md#public-benchmarks-against-promptfoo). A correction across the whole family of cells is pending, so no cell is called a win or a loss.

## JudgeBench

Status: three models run, 270 sealed pairs each.

![JudgeBench sealed test, 270 pairs per model, percent correct, one panel per model, bars from highest to lowest. Claude Haiku 5.5: driftbench 88.9, promptfoo 83.0. GPT-6 Luna: driftbench 87.0, promptfoo 84.8. Gemini 3.5 Flash-Lite: promptfoo 79.6, driftbench 79.6.](../../assets/bench-judgebench-light.png)

## LongJudgeBench

Status: the verify half is run with one model, GPT-6 Luna; the writing preference half with three models, 173 pairs each.

![LongJudgeBench verify test split, percent correct, one panel per model. Claude Haiku 5.5: not run for driftbench and promptfoo; a judge that always says fail scores 78.7. GPT-6 Luna, 221 items: a judge that always says fail 78.7, driftbench 74.7, promptfoo 72.4. Gemini 3.5 Flash-Lite: not run; always fail 78.7.](../../assets/bench-verify-light.png)

![LongJudgeBench writing preference test split, 173 pairs per model, percent correct, one panel per model. Claude Haiku 5.5: a rule that picks the longer reply 67.6, driftbench 61.3, promptfoo 56.9. GPT-6 Luna: longer reply 67.6, promptfoo 56.9, driftbench 53.8. Gemini 3.5 Flash-Lite: longer reply 67.6, promptfoo 60.4, driftbench 59.0.](../../assets/bench-writing-light.png)

## MM-Eval

Status: three models run, up to 600 sealed pairs each. Claude Haiku 5.5 scores 591 pairs; the nine missing are safety items.

![MM-Eval sealed test, percent correct, one panel per model, bars from highest to lowest. GPT-6 Luna: promptfoo 89.0, driftbench 88.1. Claude Haiku 5.5: driftbench 88.9, promptfoo 86.5. Gemini 3.5 Flash-Lite: promptfoo 83.8, driftbench 81.4.](../../assets/bench-mm-eval-light.png)

## RubricBench

Status: three models run, 790 pairs each.

![RubricBench test split, 790 pairs per model, percent correct, one panel per model, bars from highest to lowest. Claude Haiku 5.5: driftbench 82.7, promptfoo 75.6. GPT-6 Luna: driftbench 82.3, promptfoo 81.5. Gemini 3.5 Flash-Lite: promptfoo 80.8, driftbench 80.8.](../../assets/bench-rubricbench-light.png)

## RubricEval

Status: data not public. No chart is planned.
