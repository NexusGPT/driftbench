# Links lane ledger (H5, H7)

Lane cap 40 USD; stop at 36 USD. Prices per million tokens: claude-haiku-5-5 input 0.10, output 0.50, cache write 0.125, cache read 0.01. USD is computed from each response's usage fields.

| Date | Batch | Model | Calls | Input / cache write / cache read / output tokens | USD | Cumulative USD | Note |
|---|---|---|---|---|---|---|---|
| 2026-10-14 | pilot-0 | claude-haiku-5-5 | 12 | 5379 / 6764 / 33820 / 1039 | 0.0022 | 0.0022 | pilot, 2 conversations, excluded from analysis |
| 2026-10-14 | sample-0 | claude-haiku-5-5 | 66 | 26332 / 0 / 223212 / 6834 | 0.0083 | 0.0105 | tiny sample: 1 full suite run (19 conversations) = 0.0083 USD per suite run; projection 456 runs + 10% confirmations = 4.2 USD, under 30 USD, no scaling |
