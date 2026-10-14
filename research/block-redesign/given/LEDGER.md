# Ledger: given lane (cap 30 USD, stop at 27 USD)

USD from each call's usage fields and the published price: claude-haiku-5-5 0.10 / 0.50 USD per million input / output tokens up to 100K input, 0.50 / 2.50 above (claude-api skill model table, cached 2026-10-06); gpt-6-luna 0.10 / 0.50 (third-party trackers that cite OpenAI's pricing page; that page answered our fetch with 403). Rows come from `calls.jsonl` via `ledger.py`. A call that ended in an API error is not billed and is not logged.

| Batch | Model | Calls | Input tokens | Output tokens | USD | Cumulative USD |
|---|---|---|---|---|---|---|
| m42-wire | claude-haiku-5-5 | 17 | 12747 | 3659 | 0.0031 | 0.0031 |
| m42-wire | gpt-6-luna | 34 | 3503 | 109 | 0.0004 | 0.0035 |
| m42-wire2 | gpt-6-luna | 19 | 4875 | 68 | 0.0005 | 0.0040 |
| h6-pilot | claude-haiku-5-5 | 5 | 6833 | 1577 | 0.0015 | 0.0055 |
| h6-judge-pilot | gpt-6-luna | 4 | 835 | 20 | 0.0001 | 0.0056 |

Unlogged: 3 probe calls to gpt-6-luna chat completions (reasoning_effort none, minimal, low; about 120 input tokens each), under 0.0001 USD.

Projection after the H6 pilot (4 runs, 0.00037 USD per run): H6 900 runs about 0.33 USD; judge about 0.05 USD.
