# Verify lead: confirmation results

Candidate: `driftbench-v5`, frozen at 1e80d1917 with the freeze record 86f08f6dd before any confirmation call.
Choice record: `candidate.json`. Every contestant ran on Claude Haiku 5.5 with the same item text.
Analysis (pre-registered in `freeze.json`): the item is the unit, a missing or unparsed verdict counts as wrong, an
exact two-sided binomial test on discordant items per peer, Holm over the five peers, alpha 0.05.

## Fresh VerifyBench-Hard confirmation, 544 items

| Contestant | Score | driftbench minus this | driftbench wins / losses | Exact p | Holm p | Verdict | Missing |
|---|---:|---:|---:|---:|---:|---|---:|
| driftbench-v5 | 78.86% (429/544) |  |  |  |  |  | 0 |
| promptfoo | 77.21% (420/544) | +1.65 pts | 40 / 31 | 0.342 | 0.342 | tie | 1 |
| deepeval | 60.85% (331/544) | +18.01 pts | 113 / 15 | 8.93e-20 | 4.47e-19 | win | 40 |
| inspect | 76.84% (418/544) | +2.02 pts | 32 / 21 | 0.169 | 0.338 | tie | 0 |
| langfuse | 75.92% (413/544) | +2.94 pts | 40 / 24 | 0.0599 | 0.18 | tie | 0 |
| langwatch | 75.18% (409/544) | +3.68 pts | 42 / 22 | 0.0169 | 0.0674 | tie | 1 |

One win, four ties, no loss. driftbench has the highest score, but only the deepeval gap holds after Holm.
All calls went through `claude -p`.

## LongJudgeBench verify TEST, 221 items

| Contestant | Score | driftbench minus this | driftbench wins / losses | Exact p | Holm p | Verdict | Missing |
|---|---:|---:|---:|---:|---:|---|---:|
| driftbench-v5 | 76.02% (168/221) |  |  |  |  |  | 0 |
| promptfoo | 75.57% (167/221) | +0.45 pts | 12 / 11 | 1 | 1 | tie | 1 |
| deepeval | 58.82% (130/221) | +17.19 pts | 45 / 7 | 6.97e-08 | 3.49e-07 | win | 30 |
| inspect | 73.30% (162/221) | +2.71 pts | 15 / 9 | 0.307 | 1 | tie | 0 |
| langfuse | 75.11% (166/221) | +0.90 pts | 13 / 11 | 0.839 | 1 | tie | 0 |
| langwatch | 73.30% (162/221) | +2.71 pts | 16 / 10 | 0.327 | 1 | tie | 0 |

One win, four ties, no loss. The PR 351 README row was driftbench 74.2 against Langfuse 75.1; v5 scores 76.0.

How the TEST cells were made (`ljb_test.py`):
- deepeval, inspect, langfuse and langwatch replay the PR 351 call journal for all 221 items, with verdicts
  identical to the PR 351 cells on 221 of 221.
- promptfoo runs this folder's `promptfoo_point` on `claude -p` (221 new calls). The PR 351 promptfoo cell came
  from another transport and scored 159/221; it is not used here.
- driftbench-v5: 59 items on `claude -p`, 160 on the Anthropic Messages API, 2 on both (`api_run.py`).

## Transport switch and parity

The owner moved Claude calls to the Messages API during the TEST run. `api_run.py` keeps the model, the system
and user text and the journal key; it sets no sampling parameter (the CLI sets none) and 16000 max tokens.
Parity check before the switch, on the first 30 practice items, every contestant (180 verdicts), two independent
API runs A and B against the recorded CLI verdicts:

| Pair | Same verdict |
|---|---:|
| API A vs CLI | 164 / 180 |
| API B vs CLI | 163 / 180 |
| API A vs API B (run-to-run noise) | 157 / 180 |

API against CLI agrees at least as often as the API agrees with itself, so the switch stays within run-to-run
noise. For driftbench-v5 alone: 28 and 29 of 30 against the CLI, 27 between A and B. Median output tokens per
call: 443 on the CLI (practice), 563 on the API (run A). Four API replies stopped at 16000 tokens with no text and
stayed missing: three TEST items, answered on the next pass, and one item in parity run B, counted as a
disagreement above.

## Spend

Measured from the journals: confirmation calls 7.44 USD of known cost in the claude-top-verify journal for every
split; TEST new calls 1.86 USD (CLI 1.15, API 0.70); parity runs 0.29 USD.
