# JudgeBench recipe, fresh pool

A new set of response pairs built with the published JudgeBench construction recipe, from MMLU-Pro and LiveBench questions that appear in neither published JudgeBench split. It is not ScalerLab/JudgeBench and is never reported as JudgeBench. Every pair carries `"dataset": "JudgeBench recipe, fresh pool"`.

Why it exists: every public JudgeBench pair has been used before. The 270 Claude-response pairs are our sealed test, and 349 of the 350 GPT-4o pairs appear in earlier recordings. A confirmation run on items never used before needs a new pool.

## Recipe

Source: Tan et al. 2024, "JudgeBench: A Benchmark for Evaluating LLM-Based Judges", arXiv 2410.12784, section 3 and appendix A.3 to A.5.

1. Questions: MMLU-Pro test (TIGER-Lab/MMLU-Pro, revision b189ec76) and LiveBench math and reasoning (livebench/math bb66571c, livebench/reasoning 6fc6498a). A question is dropped when its MMLU-Pro id or its text appears in either published JudgeBench file. LiveBench olympiad questions are dropped, as in the paper.
2. Responses: K = 4 samples per question from one response model, `gpt-6-luna`, at its default temperature.
3. Answer check, twice:
   - the source's own check: MMLU-Pro takes the last capital letter A to J written five times in a row; LiveBench runs its official graders, vendored in `vendor/livebench`;
   - a checker model (`gpt-6-luna`, the paper's checker prompt) reads the question, the response and the correct answer.
   A response is used only when both checks agree. The checker runs only on questions whose source checks are mixed, because only those can give a pair.
4. One pair per question with at least one correct and one incorrect response left. A generator seeded by the question picks the two responses and their order.
5. Strata: MMLU-Pro is balanced over its 14 categories (a target of 90 pairs each, fewer where a category runs out). LiveBench keeps every pair it gives. Questions are visited in a seeded order per stratum, and a stratum stops at its target.
6. Split: a seeded hash order puts 150 pairs in `pool/dev.jsonl` and the rest in `pool/confirm.jsonl`.

`freeze.json` records the seed, every setting, the hashes of both pool files and of the build inputs. It is committed before any judge reads a pair. Design work reads `pool/dev.jsonl` only; `pool/confirm.jsonl` is judged once.

## Differences from the published pools

- Response model: `gpt-6-luna` with reasoning effort `none`, not GPT-4o or Claude 3.5 Sonnet. It has no family overlap with the Claude judge used in our comparisons.
- A system line asks the response model to show its reasoning step by step. Without it the model often answers with the letter string alone. Responses are still much shorter than in the published pools.
- No coding pairs: LiveCodeBench needs a code sandbox this script does not run. LiveBench AMPS_Hard is left out because its official check needs a symbolic algebra stack this script does not vendor.
- The checker prompt is the paper's prompt. For LiveBench answers that are not options, its multiple-choice words are replaced by "question" and "correct answer".

## Rebuild

```sh
uv run examples/judgebench-fresh/build.py sources
uv run examples/judgebench-fresh/build.py plan
uv run examples/judgebench-fresh/build.py run --cap-usd 5
uv run examples/judgebench-fresh/build.py freeze
```

`run` reads `~/.nexus-secrets/openai.key` inside the process. Sampling is not deterministic, so a rebuild gives a new pool made the same way, not these exact pairs. The committed pool files are the measured set.

## Judging

- `judge.mjs` runs driftbench's default pair judge (the pair ledger, as in the JudgeBench ledger cell) and promptfoo select-best.
- `run_peers.py` runs the PR 351 peer graders: DeepEval ArenaGEval, LangWatch Comparison, and Inspect and Langfuse pointwise (higher score wins).
- `stats.py` scores each pair with the JudgeBench official pair-net rule and tests driftbench against each tool with an exact two-sided McNemar test, Holm over the five tools.

Every contestant runs on `claude-haiku-5-5` through the claude command with the ledger-cell flags.
