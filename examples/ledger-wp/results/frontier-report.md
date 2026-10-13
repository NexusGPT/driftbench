## Additive Sonnet and GPT-6.1 writing cells

- Authorization: separate budgets on top of the original 35 USD. GPT-6.1 cap is 25 USD; Sonnet conditional cap is 45 USD after a runtime-only fix and five-call recalibration. Existing reservations stay unchanged.
- Both contestants use the same model inside each cell. Gemini 3.8 remains parked. Reader-first stays in its separate legacy rows.
- Frozen core, pool, order, schema re-ask and scoring remain fixed. Five pilot calls calibrate cost before fixtures, validity, DEV and the full TEST.
- Both models use medium reasoning and a 4096 total output-token cap. Sonnet uses the lean Haiku CLI route with alias sonnet and empty working directory.
- GPT-6.1 uses Responses without temperature. Standard USD per million tokens: input 2, cached input 0.10, cache writes 2.50, output 10. Source: https://developers.openai.com/api/docs/pricing, read 2026-10-13.
- Sonnet cost comes from native total_cost_usd. Fixed thinking budget 2048 may be ignored by adaptive reasoning; total output is capped at 4096. Source: https://code.claude.com/docs/en/env-vars.

| Model | Our TEST score | Promptfoo TEST score | Longer-wins | Paired p | Actual / held USD | Status |
| --- | --- | --- | --- | --- | --- | --- |
| claude-sonnet-5-5 | 0/0 | 0/0 | 234/346 | None | 0.25673040 / 0.00000000 | pending |

### claude-sonnet-5-5
- Freeze SHA256: `7debf1ef89074767caaec221ef4e9367eaba65910b13375907486b10e4102834`. Artifact folder: `examples/ledger-wp/cells/claude-sonnet-5-5/`.
- Calibration projection: null
- pair-ledger: TEST cost 0.00000000 USD; all-phase cost 0.16939040 USD; output-cap calls 0; lost TEST items 0; missing TEST items 173; schema re-asks 0/2 costing 0.00000000 USD; HTTP 429 0; tokens {"input": 6, "output": 3972, "cacheRead": 1824, "cacheWrite": 32369}.
- promptfoo: TEST cost 0.00000000 USD; all-phase cost 0.08734000 USD; output-cap calls 0; lost TEST items 0; missing TEST items 173; schema re-asks 0/0 costing 0.00000000 USD; HTTP 429 0; tokens {"input": 4, "output": 6, "cacheRead": 0, "cacheWrite": 21818}.
| gpt-6.1-sol | 0/0 | 0/0 | 234/346 | None | 0.09184550 / 0.00000000 | pending |

### gpt-6.1-sol
- Freeze SHA256: `b7330d4653e8310f164623dd0674ae11a1d8878c7930b219937dbe060800a9f8`. Artifact folder: `examples/ledger-wp/cells/gpt-6.1-sol/`.
- Calibration projection: {"model": "gpt-6.1-sol", "at": "2026-10-13T13:42:43.978901+00:00", "answeredCalls": 5, "calibrationUsd": 0.0918455, "callsPerContestant": {"pair-ledger": 3, "promptfoo": 2}, "meanUsdPerCall": {"pair-ledger": 0.0183345, "promptfoo": 0.018421}, "projectedPrimaryCalls": 713.0, "projectedPromptfooCalls": 602, "planningRate": 2.3687707641196014, "method": "Five calls from sealed pilot prefix; per-contestant mean cost times 301 comparisons. Primary calls per comparison use completed Flash Lite runtime counts. No calibration outcome drives tuning.", "projectedCellUsd": 24.253786, "worstContractCallCountUsd": 44.2933945, "capUsd": 25, "separateFromOld35UsdCap": true}
- pair-ledger: TEST cost 0.00000000 USD; all-phase cost 0.05500350 USD; output-cap calls 0; lost TEST items 0; missing TEST items 173; schema re-asks 0/3 costing 0.00000000 USD; HTTP 429 0; tokens {"input": 23124, "output": 1569, "cacheRead": 7705, "cacheWrite": 15410}.
- promptfoo: TEST cost 0.00000000 USD; all-phase cost 0.03684200 USD; output-cap calls 0; lost TEST items 0; missing TEST items 173; schema re-asks 0/0 costing 0.00000000 USD; HTTP 429 0; tokens {"input": 14366, "output": 93, "cacheRead": 0, "cacheWrite": 14360}.
