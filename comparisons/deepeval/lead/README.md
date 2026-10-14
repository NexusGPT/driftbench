# DeepEval: G-Eval strict and knowledge retention on a fresh set

Two rows of the DeepEval hard comparison, measured again on cases no judge has seen.
driftbench and the pinned DeepEval 4.2.8 metrics use the same model (Claude Haiku 5.5) through the same `claude -p` path and flags.

## Result

| Row | driftbench | DeepEval default | Only driftbench right | Only DeepEval right | Exact paired p | Holm (2 rows) |
|---|---|---|---|---|---|---|
| G-Eval strict | 474/480 | 451/480 | 29 | 6 | 0.00012 | 0.00023 |
| Knowledge retention | 480/480 | 477/480 | 3 | 0 | 0.25 | 0.25 |

- G-Eval strict: a significant lead. driftbench uses the opt-in setting `response-relevance` (`assessment: { kind: 'response-relevance' }`, PR 179). It is off by default.
- Knowledge retention: the intervals overlap. driftbench uses the shipped criterion with no option.
- DeepEval misses on G-Eval strict: 29 negatives accepted (partial answers, acknowledgements, values for another product).
- driftbench misses on G-Eval strict: 6 `correction` positives. The reply says "using the number you supplied"; the judge asks for the number itself. One of the six also has no parsed answer.
- Knowledge retention: in the first pass 9 calls timed out at 180 seconds (5 driftbench, 4 DeepEval), in 8 cases, and the row read 475 against 473 (p 0.75). Those calls were called once more with the frozen settings at concurrency 3 (`replay.py --retry-failures`, 9 calls, 0.005 USD). Every other case replays unchanged. The table shows the row after the retries (`fresh-retry.json`); `fresh.json` keeps the first pass.
- Cases are related constructions of one generator. The intervals describe this set, not every conversation.

## How the set was built and kept fresh

- Generator: `../hard/generate.py`, unchanged. Seed 20261114, 20 pairs per family: 480 cases per set, 240 per label, 480 distinct inputs.
- Earlier sets used seeds 20261012, 20261019 and 20261020.
- `run.py --corpus fresh` refuses any driftbench request already present in an earlier recording.
- `fresh-freeze.json` was committed before the first fresh call. It hashes the corpus, the generator, both criteria, every file of `packages/judges/src`, this harness, the rendered driftbench prompts and the settings. The run stops on any difference.

## How the settings were chosen

- Design used only the seen sets: hard v3 (120 per set) and the old held-out set (72 per set).
- G-Eval strict, `response-relevance`: free replay on current main matches 190 of 192 recorded requests byte for byte, all correct. The 2 others were never recorded (`dev-relevance-replay.json`).
- Knowledge retention, shipped criterion: 192/192 (`dev-knowledge-default.json`).
- DeepEval on the same sets, free threaded replay of the hard recordings: 189/192 and 184/192 (`dev-theirs-replay.json`), identical to the recorded predictions.
- No rule, prompt or setting was changed for this run. Nothing is keyed on a model, vendor or size.

## Where the earlier README numbers came from

- `../hard/baseline-heldout-scores.json` (commit a3e61f6b5): driftbench prompts frozen at commit 12801e1, 72 cases per row.
- G-Eval strict 65 against 70; knowledge retention 68 against 69.
- PR 179 (opt-in `response-relevance`) and PR 175 (new knowledge criterion) were merged later and never reached the chart.

## Reproduce

From the repository root, with `deepeval==4.2.8` in `.venv`:

```sh
.venv/bin/python comparisons/deepeval/lead/replay.py --corpus fresh --tag replay-fresh-retry
.venv/bin/python comparisons/deepeval/lead/score.py
.venv/bin/python -m unittest discover -s comparisons/deepeval/lead -p 'test_lead.py'
node tools/readme-charts.mjs --check
```

Free replay reads `calls-000.jsonl` and `calls.jsonl`. A missing recording stops the run.
`replay.py` runs `run.py` unchanged with two replay rules. A recorded failure replays as that failure.
With 12 workers, the two cases of a pair sent the same first DeepEval knowledge prompt at once 6 times; each got its own answer, and both are recorded. The replay gives each case the answer its own next prompt was built from.
The replay reproduces all 960 predictions of `fresh-retry.json` with zero fresh calls; it writes `replay-fresh-retry.json`, not committed. The retried cases now replay their retried answers, so the first pass is kept only as the recorded `fresh.json`.
The recorded run: `--corpus fresh --side both --tag fresh --record --cap-usd 10 --workers 12`, 1,966 fresh calls, 1.31 USD.
