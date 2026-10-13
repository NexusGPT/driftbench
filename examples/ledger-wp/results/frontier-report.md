## Additive Sonnet and GPT-6.1 writing cells

- Authorization: two separate 25 USD budgets, on top of the original 35 USD. Existing reservations stay unchanged.
- Both contestants use the same model inside each cell. Gemini 3.8 remains parked. Reader-first stays in its separate legacy rows.
- Frozen core, pool, order, schema re-ask and scoring remain fixed. Five pilot calls calibrate cost before fixtures, validity, DEV and the full TEST.
- Both models use medium reasoning and a 4096 total output-token cap. Sonnet uses the lean Haiku CLI route with alias sonnet and empty working directory.
- GPT-6.1 uses Responses without temperature. Standard USD per million tokens: input 2, cached input 0.10, cache writes 2.50, output 10. Source: https://developers.openai.com/api/docs/pricing, read 2026-10-13.
- Sonnet cost comes from native total_cost_usd. Fixed thinking budget 2048 may be ignored by adaptive reasoning; total output is capped at 4096. Source: https://code.claude.com/docs/en/env-vars.

| Model | Our TEST score | Promptfoo TEST score | Longer-wins | Paired p | Actual / held USD | Status |
| --- | --- | --- | --- | --- | --- | --- |
| claude-sonnet-5-5 | 0/0 | 0/0 | 234/346 | None | 0.00000000 / 0.00000000 | pending |

### claude-sonnet-5-5
- Freeze SHA256: `5de0cb6241bb5a2821e3d2c0327cd691ed3efffced55c012fae890a288a50ab2`. Artifact folder: `examples/ledger-wp/cells/claude-sonnet-5-5/`.
- Calibration projection: null
- pair-ledger: TEST cost 0.00000000 USD; all-phase cost 0.00000000 USD; output-cap calls 0; lost TEST items 0; missing TEST items 173; schema re-asks 0/0 costing 0.00000000 USD; HTTP 429 0; tokens {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}.
- promptfoo: TEST cost 0.00000000 USD; all-phase cost 0.00000000 USD; output-cap calls 0; lost TEST items 0; missing TEST items 173; schema re-asks 0/0 costing 0.00000000 USD; HTTP 429 0; tokens {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}.
| gpt-6.1-sol | 0/0 | 0/0 | 234/346 | None | 0.00000000 / 0.00000000 | pending |

### gpt-6.1-sol
- Freeze SHA256: `218e2317dd502d1037f239c7fca1f7f88906ce9038840536b6f9ce5cc01dfd28`. Artifact folder: `examples/ledger-wp/cells/gpt-6.1-sol/`.
- Calibration projection: null
- pair-ledger: TEST cost 0.00000000 USD; all-phase cost 0.00000000 USD; output-cap calls 0; lost TEST items 0; missing TEST items 173; schema re-asks 0/0 costing 0.00000000 USD; HTTP 429 0; tokens {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}.
- promptfoo: TEST cost 0.00000000 USD; all-phase cost 0.00000000 USD; output-cap calls 0; lost TEST items 0; missing TEST items 173; schema re-asks 0/0 costing 0.00000000 USD; HTTP 429 0; tokens {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}.
