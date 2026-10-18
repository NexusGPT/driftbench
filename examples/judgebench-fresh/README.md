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
6. Split: a seeded hash order puts 150 pairs in `pool/dev.jsonl` and the rest in `pool/confirm.jsonl`. The hash orders pairs, not questions, so MMLU-Pro questions that the source holds twice under two ids can land in both splits. One question does: see Sensitivity.

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

## Results (claude-haiku-5-5 for every contestant)

Confirmation split, 1,061 pairs, judged once after both freezes (`freeze.json` for the pool, `judge-freeze.json` for the judge). The driftbench judge is the shipped pair ledger with no change. Rule: JudgeBench official pair-net score; a missing decision counts wrong. Test: exact two-sided McNemar on the pairs where exactly one contestant is right. Holm over the five tools.

| Contestant | Grader | Score | driftbench minus this | Wins / losses | Exact p | Holm p | Missing | Verdict |
|---|---|---:|---:|---:|---:|---:|---:|---|
| driftbench | pair ledger, default | 83.88% (890/1061) |  |  |  |  | 0 |  |
| promptfoo | select-best (promptfoo 8014282) | 77.38% (821/1061) | +6.50 pts | 108 / 39 | 1.1e-08 | 2.21e-08 | 0 | win |
| deepeval | ArenaGEval (DeepEval 4.2.8) | 78.98% (838/1061) | +4.90 pts | 90 / 38 | 4.92e-06 | 4.92e-06 | 1 | win |
| inspect | model_graded_qa (inspect_ai 0.3.278), pointwise grader, higher score wins | 72.95% (774/1061) | +10.93 pts | 151 / 35 | 2.27e-18 | 9.09e-18 | 1 | win |
| langfuse | Answer Critic (Langfuse 64ba74f9), pointwise grader, higher score wins | 70.12% (744/1061) | +13.76 pts | 178 / 32 | 9.53e-26 | 4.77e-25 | 0 | win |
| langwatch | Comparison, swap and reconcile (LangWatch e683dd9e) | 77.10% (818/1061) | +6.79 pts | 113 / 41 | 5.61e-09 | 1.68e-08 | 1 | win |

driftbench scores above each tool, and every Holm p is below 0.05. Full numbers: `results-confirm.json`; dev numbers: `results-dev.json`; sensitivity rows: `results-sensitivity.json`.

Missing: the API refused one pair (`eb921cf3`, stop reason refusal) for DeepEval, Inspect and LangWatch on every attempt. It counts wrong for them. Dropping it leaves every p below 1e-5.

### Transport switch during the run

The run started on the claude command (`claude -p`). Host load made it slow, so it moved to the Anthropic Messages API for the same model, with the exact system and user text, no temperature (the command sends none) and retries on 429 and 5xx. Every answer already recorded was kept. The switch added a transport option to `judge.mjs` and `run_peers.py` (`--transport api`, `api_transport.py`) after `judge-freeze.json` recorded their hashes; the judge code in `packages/judges` and every prompt are unchanged. The transport of every answered call is in the journals (`cells/calls.jsonl.gz`, `cells/peer-calls.jsonl.gz`). Per confirmation pair, by the calls that graded it (driftbench and promptfoo keys replayed from the journal, peer keys from each decision's `callKeys`; DeepEval's shared evaluation-step call, used by every pair, is left out):

| Contestant | Command pairs | API pairs | Mixed pairs | Command calls | API calls |
|---|---:|---:|---:|---:|---:|
| driftbench | 828 | 226 | 7 | 1,665 | 463 |
| promptfoo | 616 | 438 | 7 | 1,239 | 883 |
| deepeval | 514 | 541 | 5 | 1,033 | 1,087 |
| inspect | 508 | 546 | 6 | 1,022 | 1,098 |
| langfuse | 529 | 529 | 3 | 1,061 | 1,061 |
| langwatch | 520 | 535 | 5 | 1,045 | 1,075 |

API answers start at 11:02:01 UTC in the call journal.

Parity before the switch (`parity/`): every contestant on the first 30 dev pairs, twice through the API, against its recorded command answers. Games identical out of 30:

| Contestant | command vs API run 1 | command vs API run 2 | API run 1 vs run 2 |
|---|---:|---:|---:|
| driftbench | 28 | 27 | 27 |
| promptfoo | 22 | 27 | 24 |
| deepeval | 24 | 24 | 24 |
| langwatch | 23 | 21 | 22 |
| inspect | 24 | 25 | 26 |
| langfuse | 25 | 24 | 20 |

The command and the API agree as often as two API runs agree with each other. On the pairs where driftbench and the tool each ran on one transport and it was the same one (mixed pairs left out), every comparison is still a win after Holm; the largest Holm p is DeepEval's, 9.06e-05. Table under Sensitivity.

### Sensitivity

`sensitivity.py` recomputes the confirmation result on subsets, with the rule and test above and Holm over the five tools. No model call. Command: `python examples/judgebench-fresh/sensitivity.py --markdown` (it runs `transport_keys.mjs` with `node --import tsx`).

Question overlap. A question is identified by its stem: the text before the first `(A)` option line, lowercased, letters and digits only. dev and confirmation share one question: `mmlu-pro:6618` (dev line 84) and `mmlu-pro:6619` (confirmation line 680), the same text with its ten options reordered. No other confirmation stem is in dev. Inside confirmation, five questions occur twice: 6634/6635, 6672/6673 and 1396/1397 (same options, reordered), 352/556 and 4207/11895 (same stem, different options).

Rows. Without the dev overlap: `mmlu-pro:6619` left out. Also one pair per repeated question: the first of each repeated question in pool order kept. Same transport: per tool, only the pairs where driftbench and the tool were each graded on one transport, and on the same one.

| Rows | Tool | Pairs | driftbench right | Tool right | Wins / losses | Exact p | Holm p | Verdict |
|---|---|---:|---:|---:|---:|---:|---:|---|
| without the dev overlap | promptfoo | 1,060 | 890 | 820 | 108 / 38 | 5.78e-09 | 1.16e-08 | win |
| | deepeval | 1,060 | 890 | 838 | 90 / 38 | 4.92e-06 | 4.92e-06 | win |
| | inspect | 1,060 | 890 | 774 | 151 / 35 | 2.27e-18 | 9.09e-18 | win |
| | langfuse | 1,060 | 890 | 744 | 178 / 32 | 9.53e-26 | 4.77e-25 | win |
| | langwatch | 1,060 | 890 | 817 | 113 / 40 | 2.95e-09 | 8.84e-09 | win |
| also one pair per repeated question | promptfoo | 1,055 | 887 | 818 | 107 / 38 | 8.6e-09 | 1.72e-08 | win |
| | deepeval | 1,055 | 887 | 836 | 89 / 38 | 6.97e-06 | 6.97e-06 | win |
| | inspect | 1,055 | 887 | 772 | 150 / 35 | 3.7e-18 | 1.48e-17 | win |
| | langfuse | 1,055 | 887 | 740 | 177 / 30 | 1.46e-26 | 7.28e-26 | win |
| | langwatch | 1,055 | 887 | 814 | 112 / 39 | 2.27e-09 | 6.81e-09 | win |
| same transport | promptfoo | 830 | 701 | 638 | 91 / 28 | 5.8e-09 | 1.74e-08 | win |
| | deepeval | 727 | 616 | 579 | 62 / 25 | 9.06e-05 | 9.06e-05 | win |
| | inspect | 721 | 611 | 537 | 99 / 25 | 1.3e-11 | 5.19e-11 | win |
| | langfuse | 743 | 631 | 516 | 135 / 20 | 3.75e-22 | 1.88e-21 | win |
| | langwatch | 733 | 623 | 566 | 81 / 24 | 2.08e-08 | 4.16e-08 | win |

The frozen pool files are unchanged; the overlap is reported, not repaired.

### Spend

OpenAI (pool build): 2.14 USD. Haiku (dev, confirmation, parity, dev experiments): about 13.2 USD, of which 2.9 USD are conservative holds on calls that returned no answer.
