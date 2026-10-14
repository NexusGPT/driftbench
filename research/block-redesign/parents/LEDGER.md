# Ledger, lane parents (cap 15 USD, stop at 13.50 USD)

Price basis: stand-in of 1.00 USD per million input tokens and 5.00 per million output tokens (pessimistic), because the published price of `claude-haiku-5-5` was not available to this lane. No cached tokens were used. The token columns let the USD be recomputed at the published price: USD = input x p_in / 1e6 + output x p_out / 1e6.

| Batch | Experiment | Model | API calls | Input tokens | Output tokens | USD (stand-in) | Cumulative USD |
|---|---|---|---|---|---|---|---|
| H12 simulations | H12 | none (offline) | 0 | 0 | 0 | 0.00 | 0.00 |
| H13 pilot, 5 items, 46 turns (discarded from the sample after two fixes, kept in `h13/results/pilot-arms.jsonl`) | H13 | claude-haiku-5-5 | 63 | 206,142 | 6,183 | 0.2371 | 0.2371 |
| H13 main run, 114 items (94 natural, 10 planted positives, 10 planted negatives), 282 conversations, 1,140 turns | H13 | claude-haiku-5-5 | 1,615 | 5,298,995 | 151,664 | 6.0573 | 6.2944 |

- Tiny-sample projection (protocol item 3), written after the pilot and before the main run: 0.00515 USD per turn, 1,140 planned turns, about 5.9 USD. Measured: 0.00531 USD per turn, 6.06 USD.
- Total at the stand-in price: 6.29 USD, 42% of the 15 USD cap. The stop level (13.50 USD) was never reached.
- Requests that the API refused (the pilot's first five calls, `temperature` not accepted) returned no completion and no usage and are not in the table. The harness retries 429 and 5xx answers; none of those answers carry usage, so no retry is in the table, and the run log shows no failed item.
