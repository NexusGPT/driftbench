# Judge benchmarks

driftbench's judge prompt and five competitors' judge prompts, run on the same model over public judge benchmarks, each scored with the metric of its own paper. The results and how to read them are on the [judge benchmarks](../../docs/judge-benchmarks.md) page.

## What runs

| Benchmark | Paper | Items | Format | Metric |
|---|---|---|---|---|
| JudgeBench, GPT-4o pairs | arXiv 2410.12784 | 350 | pairwise, objective correctness | accuracy; each pair judged in both orders; right when the two orders net in favour of the right response |
| MM-Eval, five core subsets | arXiv 2410.17578 | 4,981 | pairwise, chosen against rejected, 18 languages | accuracy, 1 right, 0 wrong, 0.5 tie, per subset; the total is the mean of the subsets |
| LongJudgeBench wp_bench | arXiv 2606.01629 | 263 | pairwise, long-form writing preference, English and Chinese | accuracy over games, both orders |
| LongJudgeBench verify_bench_hard | arXiv 2606.01629 | 316 | pointwise, is the final answer correct | accuracy; balanced accuracy beside it |
| RubricBench | arXiv 2603.01562 | 1,147 | pairwise, with expert-written atomic rubrics given to every contestant | accuracy over all items; here over games, both orders |

RubricEval (arXiv 2603.25133) is not run: its data is not published.

The data is downloaded from its published source on first use and cached outside the repository (`DRIFTBENCH_BENCH_CACHE`, by default a folder under the system temporary folder). It is not committed. RubricBench's dataset card names no licence, so only results and recorded answers are committed, never its rows.

## Contestants

| Contestant | Pairwise form | Pointwise form | Source |
|---|---|---|---|
| driftbench | `pairwiseRequest` | the judge request | `packages/judges` |
| DeepEval | ArenaGEval | GEval | 4598fe8, `deepeval/metrics/{arena_g_eval,g_eval}/templates` |
| promptfoo | select-best | llm-rubric | 8014282, `src/prompts/grading.ts` |
| Inspect | none | model_graded_qa | a1dbea8, `src/inspect_ai/scorer/_model.py` |
| LangWatch Scenario | none | the judge agent | ad220e6, `python/scenario/judge_agent.py` |
| Langfuse | none | the managed evaluator "Simple Criteria" | cb2ceba, `worker/src/constants/managed-evaluators.json` |

Every competitor template is copied verbatim into `src/contestants.ts`, with the variables filled in. Every contestant that takes a criterion gets the same criterion text. A contestant with no pairwise form scores each response of a pair on its own, and the higher score wins (JudgeBench's single game for scorers).

Three mechanisms differ from the competitor's own runtime, because every call goes through the `claude` command with no tool:

- DeepEval draws random contestant names; here Alice holds position A and Bob position B.
- Scenario and Langfuse ask for a tool call or structured output; here the same schema is asked for as a JSON object.
- DeepEval's GEval weights its score by token probabilities when the provider gives them; the command does not, so the plain score is used.

## The dev and test split, and driftbench's tuned judge

Every item is in the dev or the test split, by a hash of the benchmark and the item id (about 30 percent dev), fixed before any run. driftbench's judge is tuned on dev only: each candidate in `CANDIDATES` (`src/contestants.ts`) is one change to the shipped prompt (reasoning rules, symmetric pairwise rules, a reference answer, three judgements with a majority, a route that asks first whether the question has a checkable answer, both orders pooled into one verdict). One candidate is chosen on dev results and runs unchanged on the test split. The charts and the docs tables show the test split only. The competitors' templates are never changed.

## Running

```sh
npx tsx examples/judge-benchmarks/src/run.ts --bench judgebench --model haiku [--sample 100] \
  [--contestants driftbench,deepeval] [--cap-usd 1] [--concurrency 8] [--replay-only] [--out report.json]
```

`--bench` takes `judgebench`, `mmeval`, `longjudge-wp`, `longjudge-verify` or `rubricbench`. `--split dev` or `--split test` keeps one split. `--sample N` draws a stratified sample by the benchmark's group (source, subset or language), the same items for the same `--seed`.

Every answer is recorded in `recordings/<bench>/<model>.jsonl`, keyed by a hash of the model and the exact prompt, with its cost as the command reported it. A rerun of the same prompts reads the recordings and costs nothing. `--replay-only` refuses to call the model and reproduces the published numbers from the recordings alone. Any change to a prompt, a template or a criterion misses the recording.

Calls go through the local `claude` command (`claude -p --output-format json`, no tool, no settings, no session), so they spend the account's subscription. `--cap-usd` stops new calls once the run has spent that much; the cap is checked before each call, so concurrent calls can pass it slightly.

The charts and the docs tables come from the recordings alone, test split, with no model call:

```sh
npx tsx examples/judge-benchmarks/src/charts.ts --model haiku --ours driftbench-adaptive [--bench mmeval] [--sample 60] --doc
```

It writes `docs/comparison/benchmarks/<bench>-<model>.svg` and, with `--doc`, the ranked tables in `docs/judge-benchmarks.md`. MM-Eval runs on a stratified 1,500 of its 4,981 items unless `--sample` says otherwise. Before committing new recordings, `npx tsx examples/judge-benchmarks/src/guard-allow.ts` marks the lines where a number in a public benchmark item has the shape of a phone number, so the leak guard passes; a denylist finding is never marked.

## Tests

`pnpm -s vitest run examples/judge-benchmarks` checks the metrics, the parsers, the loaders on rows in each source's format, the stratified sample, and the runner on a fake command, recordings and replay included. No model is called.
