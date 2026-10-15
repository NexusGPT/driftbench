# Ledger: framework persona lane (cap 10 USD, stop at 9.0 USD)

USD is computed from each response's usage fields and the prices in the `research/block-sim` LEDGER header
(claude-haiku-5-5 0.10 in / 0.50 out per 1M, cache read 0.01, cache write 0.125; gpt-5.4-nano 0.20 in /
0.02 cached / 1.25 out). Per-call rows are in each run folder's `usage.jsonl` (kept outside the repository).

| # | When | Batch | Model(s) | Calls | Tokens in / out | USD | Cumulative |
|---|---|---|---|---|---|---|---|
