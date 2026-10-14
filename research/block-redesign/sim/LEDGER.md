# Ledger: simulated lane (cap 25 USD, stop at 22.5 USD)

USD is computed from each response's usage fields and the published price read on 2026-10-14:
claude-haiku-5-5 0.10 in / 0.50 out per 1M (cache read 0.01, cache write 5m 0.125, assumed at the usual
0.1x and 1.25x of input; the skill table gives only input and output) ;
gpt-5.4-nano 0.20 in / 0.02 cached / 1.25 out; gemini-3.5-flash-lite 0.30 in / 2.50 out (thinking billed
as output); text-embedding-3-small 0.02 in.

| # | When | Batch | Model(s) | Calls | Tokens in / out | USD | Cumulative |
|---|---|---|---|---|---|---|---|
| 0 | 2026-10-14 | Key check before PREREG (one "Say hi") | claude-haiku-5-5 | 1 | 12 / 14 | 0.00001 | 0.00001 |
| 1 | 2026-10-14 | API probes after PREREG (one call each) | gpt-5.4-nano, gemini-3.5-flash-lite | 2 | 40 / 92 | 0.00019 | 0.00020 |
| 2 | 2026-10-14 | H11 tiny sample: 2 blocks x 2 families x 1 trial (4 conversations). Found and fixed a tool-spec gap (verify-identity lacked phone and email fields the guidelines name); pilot data not used | claude-haiku-5-5, gpt-5.4-nano, gemini-3.5-flash-lite | 33 + 11 + 14 | haiku 108 in, 816,215 cache read, 115,534 cache write / 4,279 out; nano 5,162 / 195; gemini 9,170 / 305 | 0.02954 | 0.02974 |

Projection after row 2: 0.0074 USD per conversation. H11 320 conversations about 2.4 USD; H10 300 about 2.5 USD (plus the engine's classifier and realiser calls, small); H14 up to 180 conversations about 1.4 USD plus facets and embeddings. Lane total about 7 USD, under the 22.5 USD stop.
| 3 | 2026-10-14 | H10 tiny sample: 2 scenarios x 3 arms (6 conversations); found and fixed a stale-act engine bug; not used as data | claude-haiku-5-5, gpt-5.4-nano | 53 + 49 | haiku 174 in, 1,334,237 cache read, 172,479 cache write / 5,098 out; nano 28,975 (+1,792 cached) / 1,546 | 0.04523 | 0.07497 |

Projection after row 3: H10 0.0075 USD per conversation, 300 conversations about 2.3 USD.
| 4 | 2026-10-14 | H14 suite generation (1 call) and 5-facet tiny sample | gpt-5.4-nano | 6 | 19,374 / 459 | 0.00445 | 0.07942 |

Projection after row 4: facets 0.0008 USD each, 1,000 about 0.8 USD.

| 5 | 2026-10-15 | H14 remaining 995 facets, 30 cluster names, embeddings of 1,000 summaries and 15 suite lines | gpt-5.4-nano, text-embedding-3-small | 1,030 + 4 | nano 340,635 / 26,262; embed 23,263 | 0.10142 | 0.18084 |
| 6 | 2026-10-15 | H14 blocks tiny sample: 2 blocks x 1 run; not used as data | claude-haiku-5-5, gpt-5.4-nano | 16 + 13 | haiku 54 in, 393,746 cache read, 57,614 cache write / 1,731 out; nano 7,150 / 377 | 0.01391 | 0.19475 |

Projection after row 6: U = 17 uncovered clusters, so M = 17 blocks per arm, 102 runs at about 0.007 USD, about 0.7 USD.
