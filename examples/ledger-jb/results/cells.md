# JudgeBench cell table

Pool: 270 Claude-response pairs. 159 source-question IDs overlap earlier GPT evaluations, including 91 exact texts.

| Model | Coverage | Ledger accuracy (Wilson 95%) | promptfoo accuracy (Wilson 95%) | Wins / losses | Exact p | Holm p | USD per 100 ledger / peer | Noise ledger / peer | Status |
|---|---|---|---|---|---|---|---|---|---|
| claude-haiku-5-5 | 0/270 | pending | pending | pending | pending | pending global family | pending / pending | pending / pending | PENDING_MEASUREMENT |
| gpt-6-luna | 178/270 | 85.39% (79.46% to 89.83%) | 83.71% (77.58% to 88.41%) | 12 / 9 | 0.6636238098144526 | pending global family | 0.1603 / 0.0574 | 0.00% / 4.17% | MEASURED |
| gemini-3.8-flash | 0/270 | pending | pending | pending | pending | pending global family | pending / pending | pending / pending | PENDING_MEASUREMENT |

| Cheater | GPT dev accuracy | Claude test-pool accuracy |
|---|---|---|
| constant-first | 0/121 (0.00%) | 0/270 (0.00%) |
| constant-original-A | 65/121 (53.72%) | 143/270 (52.96%) |
| longer-wins | 55/121 (45.45%) | 118/270 (43.70%) |
| refusal-wins | 0/121 (0.00%) | 0/270 (0.00%) |

Measured spend: 1.32539166 USD. Received calls: 1557. Unpriced or interrupted attempts: 10, reserved liability 0.45450825 USD. Unresolved calls: 4.

TIE-only: fewer than 440 pairs; no powered per-cell WIN claim expected.

Claude-generated responses share the Anthropic family with the Haiku judge. Luna has no response-family overlap.

Holm correction awaits the full 18-cell family. Missing cells never count as ties or wins.

Inputs and all measured quantities: data/seal.json and results/cells.json. Per-item decisions: results/items-<model>.json.
