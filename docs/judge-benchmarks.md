# Judge benchmarks

driftbench's judge beside five competitors' judges, on public judge benchmarks, each scored with its own paper's metric. Every contestant runs on the same model, the same items and the same criterion text, through the same `claude` command. The competitors run with their own default judge templates, copied verbatim from their source at a named commit and not changed.

The reproduce script, its tests and every recorded answer are in [`examples/judge-benchmarks`](../examples/judge-benchmarks/README.md).

## Benchmarks

| Benchmark | Paper | Items | Format | Metric (the paper's) |
|---|---|---|---|---|
| JudgeBench, GPT-4o pairs | arXiv 2410.12784 | 350 | pairwise, objective correctness | accuracy; each pair judged in both orders, right when the two orders net in favour of the right response |
| MM-Eval, five core subsets | arXiv 2410.17578 | 4,981 (a stratified sample is run) | pairwise, chosen against rejected, 18 languages | accuracy, 1 right, 0 wrong, 0.5 tie, per subset; the total is the mean of the five subsets |
| LongJudgeBench wp_bench | arXiv 2606.01629 | 263 | pairwise, long-form writing preference, English and Chinese | accuracy over games, both orders |
| LongJudgeBench verify_bench_hard | arXiv 2606.01629 | 316 | pointwise, is the final answer correct | accuracy |
| RubricBench | arXiv 2603.01562 | 1,147 | pairwise, with expert-written atomic rubrics | accuracy, per domain, the total the mean of the domains |

RubricEval (arXiv 2603.25133) is not run: its data is not published. The arXiv abstract and HTML give no data link, and the Hugging Face and GitHub repositories named RubricEval are other projects (for example `BITS-Pilani-GRC/RubricEval`, a 50-item Java grading set).

## Contestants

| Contestant | Pairwise form | Pointwise form |
|---|---|---|
| driftbench | the judge prompt of `@driftbench/judges` through `pairwiseRequest`, with the configuration chosen on the dev split | the same judge on one response |
| DeepEval | ArenaGEval | GEval |
| promptfoo | select-best | llm-rubric |
| Inspect | none | model_graded_qa |
| LangWatch Scenario | none | the judge agent |
| Langfuse | none | the managed evaluator "Simple Criteria" |

A contestant with no pairwise form scores each response of a pair on its own, and the higher score wins (JudgeBench's single game for scorers). An equal score is a tie, which every metric here counts as not right (or half right on MM-Eval and RubricBench).

## The dev and test split

Each benchmark is split once, before any run, by a hash of the benchmark and the item id: 30 percent dev, 70 percent test. Every change to driftbench's judge (a rule, a reasoning step, a reference answer, a number of judgements) is chosen on dev results only. The charts show test results only. The competitors' templates are never tuned.

## driftbench's judge on these charts

The bar named driftbench is `driftbench-adaptive`, chosen on the dev splits. It is the shipped judge prompt with four additions, each one a rule or a call around the same prompt:

- It first asks the model whether the question has one checkable correct answer (a number, a choice, a fact, a proof result, the behaviour of code).
- When it does, the model answers the question itself once, and that answer is given to the judge as a reference, with rules to solve first and compare final answers.
- Every prompt is judged three times and the majority decides.
- Pairwise prompts carry symmetric rules: the same standard for both replies, whatever their position.

Dev results that chose it (haiku; the best competitor on each dev split in brackets):

| Candidate | JudgeBench | verify_bench_hard | wp_bench | RubricBench |
|---|---|---|---|---|
| shipped driftbench | 86.0 | 63.2 | 60.0 | 77.0 |
| reasoning rules | 85.1 | 65.3 | not run | not run |
| symmetric pairwise rules | 82.6 | not pairwise | not run | not run |
| reasoning, symmetric and no-abstain rules | 86.0 | 73.7 | not run | not run |
| a reference answer, one judgement | 90.9 | 76.8 | not run | not run |
| a reference answer, three judgements | 91.7 | 76.8 | 52.8 | not run |
| a checked reference, three judgements | 90.9 | 71.6 | not run | not run |
| adaptive (chosen) | 90.9 | 76.8 | 62.2 | 81.2 |
| adaptive, both orders pooled | 90.9 | not run | 56.7 | not run |
| best competitor | 89.3 (DeepEval) | 71.6 (Inspect) | 62.2 (DeepEval) | 80.7 (DeepEval) |

A reference answer helps where the question has one right answer and hurts writing preference (52.8 against 60.0 on wp_bench dev), so the adaptive judge asks for one only when the question is checkable. Pooling both orders into one verdict lost on wp_bench dev and was dropped.

MM_EVAL_DEV_NOTE

## Results

The script writes the tables below from the recordings, test split only, with `--doc`. driftbench's row is the one configuration chosen on dev, named in the next section.

### Haiku, every item of the test split

<!-- results-haiku:start -->
<!-- results-haiku:end -->

### Sonnet, a stratified sample of the test split

<!-- results-sonnet:start -->
<!-- results-sonnet:end -->
