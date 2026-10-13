## Additive runtime completion evidence

- Refreshed: 2026-10-13T17:51:44.163270+00:00.
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
- claude-sonnet-5-5 quota-hold.json: {"at": "2026-10-13T16:31:44.972003+00:00", "model": "claude-sonnet-5-5", "reason": "Native CLI session quota", "notBeforeUtc": "2026-10-13T16:50:00Z", "logicalKey": "9ed06d025d3b563090a4b76c9589ff83a2a7998ffd56f59ced3b25bcac2abb9b", "providerConfirmedZeroTokens": true, "costUsd": 0, "savedTestComparisons": 179, "testComparisonsRequired": 346, "status": "Authorized missing-only after GPT-6.1 finishes; reset verified by owner via another helper", "authorizedAt": "2026-10-13T16:51:52.985535+00:00", "authorization": "Yes: Sonnet resumes missing-only after the quota reset (it reset at 16:50 UTC, verified by another helper), under its 45 USD cap, all answered calls kept. Classify a session limit reply as a no-answer with zero cost. One cell at a time."}
- claude-sonnet-5-5: 385 TEST submissions; TEST status partial; transport failures are missing data, never judge errors.
| gpt-6.1-sol | pair-ledger | 4.79437180 | 8.48094870 | 11.00000000 | 0 | 0 |
| gpt-6.1-sol | promptfoo | 2.45831300 | 4.74523540 | 4.75000000 | 0 | 0 |
- gpt-6.1-sol pair-ledger DEV sample 0: 30/60; longer-wins 73.33333333333333%; cheater bar False; fixture seat True; fixture kappa 1.0; repeat-flip rate 11.666666666666666%.
- gpt-6.1-sol promptfoo DEV sample 0: 32/60; longer-wins 73.33333333333333%; cheater bar False; fixture seat True; fixture kappa 1.0; repeat-flip rate 2.5%.
- gpt-6.1-sol test-health-gate.json: {"at": "2026-10-13T16:50:39.575Z", "model": "gpt-6.1-sol", "healthyDev": 153, "required": 20, "passed": true, "epochStart": "2026-10-13T16:36:46.913537+00:00"}
- gpt-6.1-sol: 768 TEST submissions; TEST status complete; transport failures are missing data, never judge errors.
