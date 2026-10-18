# driftbench, long-structured setting: writing results

Claude Haiku 5.5 for every contestant. Unit: game (both presentation orders of each pair). Exact two-sided McNemar on games against each peer, Holm over the five peers. Ties and missing games count wrong. Games files are in `results/`; `compare.py` reproduces the tables.

## Fresh pool, 144 pairs (288 games), run once after freeze f10d68bb3

Spend: driftbench and promptfoo 0.60 USD, the four peers 1.63 USD. Seven peer games had no model answer on the first pass (timeouts, two login errors) and were asked again once; all 144 pairs are decided for every contestant.

driftbench, long-structured setting: 190/288 = 66.0%, picks the longer reply in 93.8% of games
| Peer | Peer score | Minus peer, points | Wins / losses | Exact p | Holm p | Verdict |
|---|---:|---:|---:|---:|---:|---|
| promptfoo | 56.6 (163/288) | +9.4 | 61 / 34 | 0.00731 | 0.00731 | win |
| deepeval | 54.9 (158/288) | +11.1 | 64 / 32 | 0.00142 | 0.00285 | win |
| inspect | 18.8 (54/288) | +47.2 | 148 / 12 | 5.73e-31 | 2.29e-30 | win |
| langfuse | 15.3 (44/288) | +50.7 | 152 / 6 | 1.12e-37 | 5.59e-37 | win |
| langwatch | 46.5 (134/288) | +19.4 | 74 / 18 | 3.1e-09 | 9.3e-09 | win |

## Recorded PR 351 TEST, 173 pairs (346 games)

The setting replayed in code (`replay_test.ts`) on the recorded driftbench pair-ledger verdicts; no model call. Peer games are the recorded PR 351 cells. The recorded default judge on the same games scores 61.3%.

driftbench, long-structured setting: 226/346 = 65.3%, picks the longer reply in 96.5% of games
| Peer | Peer score | Minus peer, points | Wins / losses | Exact p | Holm p | Verdict |
|---|---:|---:|---:|---:|---:|---|
| promptfoo | 56.9 (197/346) | +8.4 | 87 / 58 | 0.0197 | 0.0395 | win |
| deepeval | 58.4 (202/346) | +6.9 | 88 / 64 | 0.0617 | 0.0617 | tie |
| inspect | 11.6 (40/346) | +53.8 | 200 / 14 | 2.56e-43 | 1.28e-42 | win |
| langfuse | 14.5 (50/346) | +50.9 | 198 / 22 | 1.37e-36 | 5.47e-36 | win |
| langwatch | 52.6 (182/346) | +12.7 | 96 / 52 | 0.000373 | 0.00112 | win |

## What the setting measures

The setting prefers longer, structured replies. It picks the longer reply in 93.8 percent of games on the fresh pool and 96.5 percent on the TEST.

| Pool | Right when the human chose the longer reply | Right when the human chose the shorter reply | Length-controlled | Longer-wins rule |
|---|---:|---:|---:|---:|
| Fresh, 288 games | 96.7 (178/184) | 11.5 (12/104) | 54.1 | 63.9 |
| TEST, 346 games | 95.7 (224/234) | 1.8 (2/112) | 48.8 | 67.6 |

Length-controlled is the mean of the two "right when" columns; a longer-wins rule scores 50 on it. The setting wins because these human labels favour longer replies; it is a declared preference, not a measure of writing quality. On the TEST it scores below the longer-wins rule. Without the setting the default judge does not win clearly on writing (`../README.md`).
