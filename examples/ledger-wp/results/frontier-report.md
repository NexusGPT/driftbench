## Additive Sonnet and GPT-6.1 writing cells

- Authorization: separate budgets on top of the original 35 USD. GPT-6.1 cap is 32 USD including holds after the network recovery amendment; Sonnet cap is 45 USD after the cache-only runtime fix and five-call recalibration. Existing reservations stay unchanged.
- Both contestants use the same model inside each cell. Gemini 3.8 remains parked. Reader-first stays in its separate legacy rows.
- Runtime amendment: ten consecutive healthy probes 30 seconds apart on the active provider; concurrency two, one model cell at a time. Three consecutive connection failures pause ten minutes before a fresh gate. Missing-only transport recovery has no cycle limit, including the 12 formerly exhausted calls. Returned answers are never submitted again.
- The 16:00 UTC cutoff is removed for these two new cells because of the host network pause; no TEST result was seen before this amendment. Unknown holds remain reserved. Explicit zero-token provider errors settle at their real zero cost. TEST starts only after 20 consecutive healthy DEV calls; transport-missing items prevent final status.
- Frozen core, pool, order, schema re-ask and scoring remain fixed. Five pilot calls calibrate cost before fixtures, validity, DEV and the full TEST.
- Both models use medium reasoning and a 4096 total output-token cap. Sonnet uses the lean Haiku CLI route with alias sonnet and empty working directory.
- GPT-6.1 uses Responses without temperature. Standard USD per million tokens: input 2, cached input 0.10, cache writes 2.50, output 10. Source: https://developers.openai.com/api/docs/pricing, read 2026-10-13.
- Sonnet cost comes from native total_cost_usd. Fixed thinking budget 2048 may be ignored by adaptive reasoning; total output is capped at 4096. Source: https://code.claude.com/docs/en/env-vars.

| Model | Our TEST score | Promptfoo TEST score | Longer-wins | Paired p | Actual / held USD | Status |
| --- | --- | --- | --- | --- | --- | --- |
| claude-sonnet-5-5 | 110/178 | 116/180 | 234/346 | 0.5715881884098053 | 20.75912640 / 0.00000000 | pending |

### claude-sonnet-5-5
- Freeze SHA256: `ead1bb79d939a1c01d38637dee38a534d922e0c13bee65bdac61c40249e61d1c`. Artifact folder: `examples/ledger-wp/cells/claude-sonnet-5-5/`.
- Calibration projection: {"model": "claude-sonnet-5-5", "at": "2026-10-13T13:44:47.091650+00:00", "answeredCalls": 5, "calibrationUsd": 0.155604, "callsPerContestant": {"pair-ledger": 3, "promptfoo": 2}, "meanUsdPerCall": {"pair-ledger": 0.038233333333333334, "promptfoo": 0.020451999999999998}, "projectedPrimaryCalls": 713.0, "projectedPromptfooCalls": 602, "planningRate": 2.3687707641196014, "method": "Five calls from sealed pilot prefix; per-contestant mean cost times 301 comparisons. Primary calls per comparison use completed Flash Lite runtime counts. No calibration outcome drives tuning.", "projectedCellUsd": 39.98480506666667, "worstContractCallCountUsd": 81.7738384, "capUsd": 45, "separateFromOld35UsdCap": true}
- pair-ledger: TEST cost 5.42256600 USD; all-phase cost 14.11663840 USD; output-cap calls 0; lost TEST items 0; missing TEST items 84; schema re-asks 2/485 costing 0.07821600 USD; HTTP 429 0; tokens {"input": 3711410, "output": 656416, "cacheRead": 1824, "cacheWrite": 32369}.
- promptfoo: TEST cost 2.23615600 USD; all-phase cost 6.64248800 USD; output-cap calls 0; lost TEST items 0; missing TEST items 83; schema re-asks 0/0 costing 0.00000000 USD; HTTP 429 0; tokens {"input": 2920118, "output": 71498, "cacheRead": 0, "cacheWrite": 21818}.
- Paired test: {"matchedPairs": 89, "wins": 12, "losses": 16, "deltaPoints": -2.247191011235955, "requestCluster95": [-9.659090909090908, 4.7368421052631575], "mcnemarTwoSided": 0.5715881884098053, "holm18": null, "holmStatus": "pending full cross-benchmark family; reader-first excluded from primary family"}. Game McNemar is nominal; interpret with the request-cluster interval. Any positive claim awaits family multiplicity handling.
| gpt-6.1-sol | 0/0 | 0/0 | 234/346 | None | 3.39736520 / 15.75000000 | pending |

### gpt-6.1-sol
- Freeze SHA256: `6ff7ef223366f6da535e9c497ad51d58cff96ee9049fb9057605ebbc26b2f054`. Artifact folder: `examples/ledger-wp/cells/gpt-6.1-sol/`.
- Calibration projection: {"model": "gpt-6.1-sol", "at": "2026-10-13T13:42:43.978901+00:00", "answeredCalls": 5, "calibrationUsd": 0.0918455, "callsPerContestant": {"pair-ledger": 3, "promptfoo": 2}, "meanUsdPerCall": {"pair-ledger": 0.0183345, "promptfoo": 0.018421}, "projectedPrimaryCalls": 713.0, "projectedPromptfooCalls": 602, "planningRate": 2.3687707641196014, "method": "Five calls from sealed pilot prefix; per-contestant mean cost times 301 comparisons. Primary calls per comparison use completed Flash Lite runtime counts. No calibration outcome drives tuning.", "projectedCellUsd": 24.253786, "worstContractCallCountUsd": 44.2933945, "capUsd": 25, "separateFromOld35UsdCap": true}
- pair-ledger: TEST cost 0.00000000 USD; all-phase cost 2.14486360 USD; output-cap calls 0; lost TEST items 0; missing TEST items 173; schema re-asks 0/210 costing 0.00000000 USD; HTTP 429 0; tokens {"input": 996943, "output": 101545, "cacheRead": 555856, "cacheWrite": 383308}.
- promptfoo: TEST cost 0.00000000 USD; all-phase cost 1.25250160 USD; output-cap calls 0; lost TEST items 0; missing TEST items 173; schema re-asks 0/0 costing 0.00000000 USD; HTTP 429 0; tokens {"input": 745477, "output": 6478, "cacheRead": 279081, "cacheWrite": 454043}.
