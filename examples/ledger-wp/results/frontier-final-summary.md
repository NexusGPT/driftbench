## Owner withdrawal: Gemini 3.8

| Model | Status | Pending work |
| --- | --- | --- |
| gemini-3.8-flash | dropped by the owner on 13 Oct 2026, partial data kept, not reported as a score | None |

Flash Lite stays the Gemini result. Raw answers, decisions, costs, holds and historical freezes remain unchanged.
Earlier reset permissions and request estimates are superseded. No new model call is required.

## Final results for Sonnet and GPT-6.1

Measured: 2026-10-13T18:30:53.009006+00:00. Data commit: `def8da23a2a5bc653d26d947cedb14653d913655`. Both cells finish the same 173-pair seal once, with both contestants.

| Model | Our score | Promptfoo | Longer-wins | Paired p | Frozen result |
| --- | ---: | ---: | ---: | ---: | --- |
| claude-sonnet-5-5 | 224/346 | 231/346 | 234/346 | 0.4101027164 | TIE |
| gpt-6.1-sol | 148/346 | 181/346 | 234/346 | 1.312744316e-05 | LOSS |

- GPT-6.1 has a significant loss. Sonnet has no significant difference. Neither cell supports a writing superiority claim.
- The frozen loss rule uses uncorrected p below 0.05. Positive win claims require family Holm correction; neither new cell claims a win.
- Game McNemar is nominal because games share pairs and requests. The request-cluster intervals appear below.
- Reader-first remains the separate PR 157, c50b2dc3 row. Gemini 3.8: dropped by the owner on 13 Oct 2026, partial data kept, not reported as a score. Flash Lite stays the Gemini result. The original 35 USD budget and holds remain unchanged.

| Model | Contestant | TEST USD | USD / 100 TEST games | All phases USD | Holds USD |
| --- | --- | ---: | ---: | ---: | ---: |
| claude-sonnet-5-5 | pair-ledger | 10.31590800 | 2.98147630 | 19.00998040 | 0.00000000 |
| claude-sonnet-5-5 | promptfoo | 4.31682000 | 1.24763584 | 8.72315200 | 0.00000000 |
| gpt-6.1-sol | pair-ledger | 4.79437180 | 1.38565659 | 8.48094870 | 11.00000000 |
| gpt-6.1-sol | promptfoo | 2.45831300 | 0.71049509 | 4.74523540 | 4.75000000 |

- claude-sonnet-5-5: actual 27.73313240 USD + holds 0.00000000 USD, within its separate 45 USD cap.
- gpt-6.1-sol: actual 13.22618410 USD + holds 15.75000000 USD, within its separate 32 USD cap.

| Model | Discordant wins / losses | Difference points | Request-cluster 95% | Tied games, ours |
| --- | ---: | ---: | --- | ---: |
| claude-sonnet-5-5 | 23/30 | -2.0231 | -7.1038 to 3.0303 | 14 |
| gpt-6.1-sol | 12/45 | -9.5376 | -15.2047 to -4.1667 | 76 |

- Both TEST cells have zero missing pairs, zero grader errors and zero items lost to the output or thinking cap.
- Sonnet has one TEST schema re-ask among 386 readings, costing 0.037812 USD. All phases: two among 671, costing 0.078216 USD.
- GPT-6.1 has zero TEST schema re-asks among 422 readings, and zero among 715 readings across all phases.
- Sonnet has one session-limit rejection with explicit zero tokens and zero cost. Its approved recovery answers; no answered call is resent.
- HTTP 429 counts are zero in both new cells. Historical unknown-cost GPT-6.1 holds remain reserved.
- Each offline audit replays all 602 non-pilot comparisons, preserving every prompt, schema, verdict and cost. No provider call occurs during replay.
- Cross-cell audit confirms one active model at a time and at most two simultaneous calls after the serial pacing amendment.
- Sealed item order holds per contestant. At each TEST startup, promptfoo enters HTTP one millisecond before the ledger inside the concurrent group.
- Frozen Stage 0 awaits before HTTP. Audit records these timestamp inversions; no item changes order within a contestant.
- JSON replay normalizes negative zero to zero, exactly as the original recording serialization does. Original failed checks remain in history.

| Model | Final freeze SHA-256 |
| --- | --- |
| claude-sonnet-5-5 | `fdca5960c44c0def2ae733642de05d0a95b749ffec043f025673dcbcbc4b348a` |
| gpt-6.1-sol | `8894d17255c1640403e2e3d51b9332833179013f9bac2925a01d3bcd96aa5026` |

Sources: `examples/ledger-wp/cells/<model>/{report,audit,freeze}.json`, immutable `calls.jsonl` and `decisions.jsonl`, and `results/frontier-cross-cell-audit.json`. Machine-readable disposition: `results/frontier-disposition.json`.
