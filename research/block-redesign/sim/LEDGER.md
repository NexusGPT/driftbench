# Ledger: simulated lane (cap 25 USD, stop at 22.5 USD)

USD is computed from each response's usage fields and the published price read on 2026-10-14:
claude-haiku-5-5 0.10 in / 0.50 out per 1M (cache read 0.01, cache write 5m 0.125, assumed at the usual
0.1x and 1.25x of input; the skill table gives only input and output) ;
gpt-5.4-nano 0.20 in / 0.02 cached / 1.25 out; gemini-3.5-flash-lite 0.30 in / 2.50 out (thinking billed
as output); text-embedding-3-small 0.02 in.

| # | When | Batch | Model(s) | Calls | Tokens in / out | USD | Cumulative |
|---|---|---|---|---|---|---|---|
| 0 | 2026-10-14 | Key check before PREREG (one "Say hi") | claude-haiku-5-5 | 1 | 12 / 14 | 0.00001 | 0.00001 |
