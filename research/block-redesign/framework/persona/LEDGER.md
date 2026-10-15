# Ledger: framework persona lane (cap 10 USD, stop at 9.0 USD)

USD is computed from each response's usage fields and the prices in the `research/block-sim` LEDGER header
(claude-haiku-5-5 0.10 in / 0.50 out per 1M, cache read 0.01, cache write 0.125; gpt-5.4-nano 0.20 in /
0.02 cached / 1.25 out). Per-call rows are in each run folder's `usage.jsonl` (kept outside the repository).

| # | When | Batch | Model(s) | Calls | Tokens in / out | USD | Cumulative |
|---|---|---|---|---|---|---|---|
| 1 | 2026-10-15 | Tiny sample: HF10 2 blocks x 4 persona ids x 1 trial (8 conversations), HF11 2 conversations (fr base, fr negate, block 5440); found the English polite-word line in the French persona's turns (amendment 1); not data | claude-haiku-5-5, gpt-5.4-nano | 88 + 112 | haiku 278 in, 2,199,690 cache read, 287,304 cache write / 9,341 out; nano 45,803 / 3,832 | 0.07656 | 0.07656 |

Projection after row 1: 0.0077 USD per conversation. HF10 640 conversations about 4.9 USD; HF11 275 about
2.1 USD; lane total about 7.1 USD, under the 9.0 USD stop. No size reduction needed.
