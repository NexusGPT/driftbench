# Writing held-out pool and length check

Status: the default judge gains nothing honest on writing (below). The owner then asked for a declared preference for long, structured replies: `judgePairLedger(..., { preference: 'long-structured' })`, off by default. The setting prefers the longer reply: it picks it in 93.8 percent of fresh games and 96.5 percent of TEST games, and it is right on 11.5 and 1.8 percent of games where the human chose the shorter reply. Its results, labelled "driftbench, long-structured setting", are in `results/RESULTS.md`: on the fresh pool it is a significant win against all five peers after Holm; on the recorded TEST against four of five (DeepEval is a tie).

The setting replayed on each model's recorded TEST verdicts (`replay_test.ts`, data in `docs/assets/data/sealed/writing-long-structured.json`, no model call): Claude Haiku 5.5 65.3, GPT-6 Luna 65.3, Gemini 3.5 Flash-Lite 65.9. The default judge scores 61.3, 53.8 and 59.0 on the same games.

## What is here

- `seal.json`, `exclusions.json`, `seal.py`: 144 WritingPreferenceBench pairs that no lane has used as an item, sealed before any model call. No request-fresh pool remains: every request outside the ledger-wp TEST seal was already used by another lane, so these pairs share prompts with used items. The practice pool (203 pairs) shares no request with them.
- `run.ts`, `contestants.ts`: driftbench variants and promptfoo on a split, Claude Haiku through the claude command. `peers_heldout.py`: the unchanged all-peers-public peers on a split.
- `score.py`: accuracy split by whether the human-chosen reply is the longer one. `length_check.py`: the same split on the recorded PR 351 writing results.
- `packages/judges/src/writing-requirements.ts`: the writing request compiler of the recorded driftbench cell. It reproduces the frozen Python compiler byte for byte on all 2,063 WritingPreferenceBench and LongJudge questions.

## Result

Length-controlled accuracy is the mean of the accuracy on pairs where the chosen reply is longer and on pairs where it is shorter. A rule that always picks the longer reply scores 50 on it.

Practice, Haiku, 203 pairs (406 games):

| Contestant | Accuracy | Picks longer | Chosen longer | Chosen shorter |
|---|---:|---:|---:|---:|
| driftbench, recorded rows | 56.2 | 57.6 | 61.2 | 45.3 |
| plus a "delivers the commission" row | 56.7 | 57.1 | 61.2 | 46.9 |
| plus commission and "substance" rows | 61.1 | 68.0 | 71.2 | 39.1 |
| longer reply wins | 68.5 | 100 | 100 | 0 |

The only gain (+4.9 points) comes from pairs where the chosen reply is longer, and accuracy on the other pairs falls. It is a length lean, so it is not proposed. The holistic row alone has a length-controlled accuracy of 47 to 50 on practice.

Recorded PR 351 TEST, Haiku, 173 pairs (346 games), from `python3 length_check.py <ledger-wp seals/test.json>`:

| Contestant | Accuracy | Picks longer | Chosen longer | Chosen shorter | Length-controlled |
|---|---:|---:|---:|---:|---:|
| driftbench | 61.3 | 58.4 | 65.0 | 53.6 | 59.3 |
| driftbench reader-first | 67.6 | 100.0 | 100.0 | 0.0 | 50.0 |
| promptfoo | 56.9 | 55.8 | 59.4 | 51.8 | 55.6 |
| DeepEval | 58.4 | 53.2 | 58.5 | 58.0 | 58.3 |
| Inspect | 11.6 | 8.1 | 11.1 | 12.5 | 11.8 |
| Langfuse | 14.5 | 9.8 | 12.0 | 19.6 | 15.8 |
| LangWatch | 52.6 | 48.6 | 54.7 | 48.2 | 51.5 |
| longer reply wins | 67.6 | 100.0 | 100.0 | 0.0 | 50.0 |

The recorded driftbench lead on writing is not a length lean: its length-controlled accuracy stays at or above every peer. The reader-first variant picks the longer reply on every pair; its 67.6 equals the longer-wins rule.

## Power

Simulated with the TEST discordance rates, exact McNemar on games, Holm over the five peers. Without a gain, 144 pairs give about a 9 percent chance that all three close peers (promptfoo, DeepEval, LangWatch) are significant wins; 500 pairs give about 37 percent. More pairs cannot be built the way the benchmark builds them: its labels come from three human annotators per response.
