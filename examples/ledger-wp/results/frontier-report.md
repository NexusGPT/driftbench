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
| claude-sonnet-5-5 | 0/0 | 0/0 | 234/346 | None | 1.86121840 / 0.00000000 | pending |

### claude-sonnet-5-5
- Freeze SHA256: `9f80de887df299dfedb0cf599b5e72f9075579ae60986455dadb1f74b936783b`. Artifact folder: `examples/ledger-wp/cells/claude-sonnet-5-5/`.
- Calibration projection: {"model": "claude-sonnet-5-5", "at": "2026-10-13T13:44:47.091650+00:00", "answeredCalls": 5, "calibrationUsd": 0.155604, "callsPerContestant": {"pair-ledger": 3, "promptfoo": 2}, "meanUsdPerCall": {"pair-ledger": 0.038233333333333334, "promptfoo": 0.020451999999999998}, "projectedPrimaryCalls": 713.0, "projectedPromptfooCalls": 602, "planningRate": 2.3687707641196014, "method": "Five calls from sealed pilot prefix; per-contestant mean cost times 301 comparisons. Primary calls per comparison use completed Flash Lite runtime counts. No calibration outcome drives tuning.", "projectedCellUsd": 39.98480506666667, "worstContractCallCountUsd": 81.7738384, "capUsd": 45, "separateFromOld35UsdCap": true}
- pair-ledger: TEST cost 0.00000000 USD; all-phase cost 1.37610040 USD; output-cap calls 0; lost TEST items 0; missing TEST items 173; schema re-asks 0/91 costing 0.00000000 USD; HTTP 429 0; tokens {"input": 287796, "output": 67085, "cacheRead": 1824, "cacheWrite": 32369}.
- promptfoo: TEST cost 0.00000000 USD; all-phase cost 0.48511800 USD; output-cap calls 0; lost TEST items 0; missing TEST items 173; schema re-asks 0/0 costing 0.00000000 USD; HTTP 429 0; tokens {"input": 186808, "output": 2423, "cacheRead": 0, "cacheWrite": 21818}.
| gpt-6.1-sol | 0/0 | 0/0 | 234/346 | None | 3.39736520 / 15.75000000 | pending |

### gpt-6.1-sol
- Freeze SHA256: `b895a4ebb1bb5689c9ff73370d2a5a83ddd510435b524df3631d3d4990012a6e`. Artifact folder: `examples/ledger-wp/cells/gpt-6.1-sol/`.
- Calibration projection: {"model": "gpt-6.1-sol", "at": "2026-10-13T13:42:43.978901+00:00", "answeredCalls": 5, "calibrationUsd": 0.0918455, "callsPerContestant": {"pair-ledger": 3, "promptfoo": 2}, "meanUsdPerCall": {"pair-ledger": 0.0183345, "promptfoo": 0.018421}, "projectedPrimaryCalls": 713.0, "projectedPromptfooCalls": 602, "planningRate": 2.3687707641196014, "method": "Five calls from sealed pilot prefix; per-contestant mean cost times 301 comparisons. Primary calls per comparison use completed Flash Lite runtime counts. No calibration outcome drives tuning.", "projectedCellUsd": 24.253786, "worstContractCallCountUsd": 44.2933945, "capUsd": 25, "separateFromOld35UsdCap": true}
- pair-ledger: TEST cost 0.00000000 USD; all-phase cost 2.14486360 USD; output-cap calls 0; lost TEST items 0; missing TEST items 173; schema re-asks 0/210 costing 0.00000000 USD; HTTP 429 0; tokens {"input": 996943, "output": 101545, "cacheRead": 555856, "cacheWrite": 383308}.
- promptfoo: TEST cost 0.00000000 USD; all-phase cost 1.25250160 USD; output-cap calls 0; lost TEST items 0; missing TEST items 173; schema re-asks 0/0 costing 0.00000000 USD; HTTP 429 0; tokens {"input": 745477, "output": 6478, "cacheRead": 279081, "cacheWrite": 454043}.
