## Additive Sonnet and GPT-6.1 writing cells

- Authorization: separate budgets on top of the original 35 USD. GPT-6.1 cap is 32 USD including holds after the network recovery amendment; Sonnet cap is 45 USD after the cache-only runtime fix and five-call recalibration. Existing reservations stay unchanged.
- Both contestants use the same model inside each cell. Gemini 3.8 remains parked. Reader-first stays in its separate legacy rows.
- Recovery: 12 named exhausted no-answer calls receive at most three fresh submissions. Two consecutive connection failures stop new calls across both models. Any connection failure during TEST stops before a TEST retry.
- Frozen core, pool, order, schema re-ask and scoring remain fixed. Five pilot calls calibrate cost before fixtures, validity, DEV and the full TEST.
- Both models use medium reasoning and a 4096 total output-token cap. Sonnet uses the lean Haiku CLI route with alias sonnet and empty working directory.
- GPT-6.1 uses Responses without temperature. Standard USD per million tokens: input 2, cached input 0.10, cache writes 2.50, output 10. Source: https://developers.openai.com/api/docs/pricing, read 2026-10-13.
- Sonnet cost comes from native total_cost_usd. Fixed thinking budget 2048 may be ignored by adaptive reasoning; total output is capped at 4096. Source: https://code.claude.com/docs/en/env-vars.

| Model | Our TEST score | Promptfoo TEST score | Longer-wins | Paired p | Actual / held USD | Status |
| --- | --- | --- | --- | --- | --- | --- |
| claude-sonnet-5-5 | 0/0 | 0/0 | 234/346 | None | 0.87138640 / 1.25000000 | pending |

### claude-sonnet-5-5
- Freeze SHA256: `1e82a019194e78d94cd6546e8ea4855ee4ddbbd296955a5a02524d6ceee05fe7`. Artifact folder: `examples/ledger-wp/cells/claude-sonnet-5-5/`.
- Calibration projection: {"model": "claude-sonnet-5-5", "at": "2026-10-13T13:44:47.091650+00:00", "answeredCalls": 5, "calibrationUsd": 0.155604, "callsPerContestant": {"pair-ledger": 3, "promptfoo": 2}, "meanUsdPerCall": {"pair-ledger": 0.038233333333333334, "promptfoo": 0.020451999999999998}, "projectedPrimaryCalls": 713.0, "projectedPromptfooCalls": 602, "planningRate": 2.3687707641196014, "method": "Five calls from sealed pilot prefix; per-contestant mean cost times 301 comparisons. Primary calls per comparison use completed Flash Lite runtime counts. No calibration outcome drives tuning.", "projectedCellUsd": 39.98480506666667, "worstContractCallCountUsd": 81.7738384, "capUsd": 45, "separateFromOld35UsdCap": true}
- pair-ledger: TEST cost 0.00000000 USD; all-phase cost 0.65421240 USD; output-cap calls 0; lost TEST items 0; missing TEST items 173; schema re-asks 0/46 costing 0.00000000 USD; HTTP 429 0; tokens {"input": 105907, "output": 31274, "cacheRead": 1824, "cacheWrite": 32369}.
- promptfoo: TEST cost 0.00000000 USD; all-phase cost 0.21717400 USD; output-cap calls 0; lost TEST items 0; missing TEST items 173; schema re-asks 0/0 costing 0.00000000 USD; HTTP 429 0; tokens {"input": 61056, "output": 779, "cacheRead": 0, "cacheWrite": 21818}.
| gpt-6.1-sol | 0/0 | 0/0 | 234/346 | None | 2.88363830 / 14.50000000 | pending |

### gpt-6.1-sol
- Freeze SHA256: `2cc6722bd3641b5b2657219e88a789115bdcbf6758a8d39d423ac9ce7b9823ec`. Artifact folder: `examples/ledger-wp/cells/gpt-6.1-sol/`.
- Calibration projection: {"model": "gpt-6.1-sol", "at": "2026-10-13T13:42:43.978901+00:00", "answeredCalls": 5, "calibrationUsd": 0.0918455, "callsPerContestant": {"pair-ledger": 3, "promptfoo": 2}, "meanUsdPerCall": {"pair-ledger": 0.0183345, "promptfoo": 0.018421}, "projectedPrimaryCalls": 713.0, "projectedPromptfooCalls": 602, "planningRate": 2.3687707641196014, "method": "Five calls from sealed pilot prefix; per-contestant mean cost times 301 comparisons. Primary calls per comparison use completed Flash Lite runtime counts. No calibration outcome drives tuning.", "projectedCellUsd": 24.253786, "worstContractCallCountUsd": 44.2933945, "capUsd": 25, "separateFromOld35UsdCap": true}
- pair-ledger: TEST cost 0.00000000 USD; all-phase cost 1.80340040 USD; output-cap calls 0; lost TEST items 0; missing TEST items 173; schema re-asks 0/172 costing 0.00000000 USD; HTTP 429 0; tokens {"input": 767143, "output": 84848, "cacheRead": 389204, "cacheWrite": 320244}.
- promptfoo: TEST cost 0.00000000 USD; all-phase cost 1.08023790 USD; output-cap calls 0; lost TEST items 0; missing TEST items 173; schema re-asks 0/0 costing 0.00000000 USD; HTTP 429 0; tokens {"input": 648797, "output": 5648, "cacheRead": 246699, "cacheWrite": 389784}.
