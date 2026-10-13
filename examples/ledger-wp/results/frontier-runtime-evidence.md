## Additive runtime completion evidence

- Refreshed: 2026-10-13T16:28:28.644014+00:00.
- Sonnet initial five-call projection: 66.80452213 USD. Cache-only runtime fix: DISABLE_PROMPT_CACHING=1. Fresh five-call cost: 0.155604 USD; projection: 39.98480507 USD.
- The active provider requires ten consecutive healthy unauthenticated probes spaced 30 seconds apart. One model runs at a time, concurrency two. TEST requires 20 consecutive healthy DEV calls before its first submission.
- Three consecutive connection failures pause ten minutes before another gate. Missing-only transport recovery has no cycle or schedule limit. Returned answers stay immutable; unknown-cost holds stay reserved. Explicit zero-token provider errors settle at zero.

| Model | Contestant | TEST known USD | All-phase known USD | All-phase held USD | TEST missing pairs | TEST cap-loss pairs |
| --- | --- | --- | --- | --- | --- | --- |
| claude-sonnet-5-5 | pair-ledger | 5.42256600 | 14.11663840 | 0.00000000 | 84 | 0 |
| claude-sonnet-5-5 | promptfoo | 2.23615600 | 6.64248800 | 0.00000000 | 83 | 0 |
- claude-sonnet-5-5 pair-ledger DEV sample 0: 36/60; longer-wins 73.33333333333333%; cheater bar False; fixture seat True; fixture kappa 1.0; repeat-flip rate 3.3333333333333335%.
- claude-sonnet-5-5 promptfoo DEV sample 0: 35/60; longer-wins 73.33333333333333%; cheater bar False; fixture seat False; fixture kappa 0.945945945945946; repeat-flip rate 6.666666666666667%.
- claude-sonnet-5-5 test-health-gate.json: {"at": "2026-10-13T16:01:26.464Z", "model": "claude-sonnet-5-5", "healthyDev": 71, "required": 20, "passed": true, "epochStart": "2026-10-13T15:56:49.864400+00:00"}
- claude-sonnet-5-5: 385 TEST submissions; TEST status partial; transport failures are missing data, never judge errors.
| gpt-6.1-sol | pair-ledger | 0.00000000 | 2.14486360 | 11.00000000 | 173 | 0 |
| gpt-6.1-sol | promptfoo | 0.00000000 | 1.25250160 | 4.75000000 | 173 | 0 |
- gpt-6.1-sol pair-ledger DEV sample 0: 30/60; longer-wins 73.33333333333333%; cheater bar False; fixture seat True; fixture kappa 1.0; repeat-flip rate None%.
- gpt-6.1-sol promptfoo DEV sample 0: 32/60; longer-wins 73.33333333333333%; cheater bar False; fixture seat True; fixture kappa 1.0; repeat-flip rate None%.
- gpt-6.1-sol: 0 TEST submissions; TEST status not run; transport failures are missing data, never judge errors.
