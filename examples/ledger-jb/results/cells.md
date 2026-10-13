# JudgeBench cell table

Pool: 270 Claude-response pairs. 159 source-question IDs overlap earlier GPT evaluations, including 91 exact texts.

| Model | Coverage | Ledger accuracy (Wilson 95%) | promptfoo accuracy (Wilson 95%) | Wins / losses | Exact p | Holm p | USD per 100 ledger / peer | Noise ledger / peer | Status |
|---|---|---|---|---|---|---|---|---|---|
| claude-haiku-5-5 | 166/270 | 86.75% (80.75% to 91.08%) | 82.53% (76.04% to 87.55%) | 14 / 7 | 0.18924713134765606 | pending global family | 0.7806 / 0.2931 | 1.67% / 8.33% | PARTIAL |
| gpt-6-luna | 270/270 | 87.04% (82.51% to 90.53%) | 84.81% (80.05% to 88.60%) | 18 / 12 | 0.3615946080535645 | pending global family | 0.1566 / 0.0558 | 0.00% / 4.17% | MEASURED |
| gemini-3.8-flash | 0/270 | pending | pending | pending | pending | pending global family | pending / pending | 0.00% / 2.59% | not run: daily quota |

| Cheater | GPT dev accuracy | Claude test-pool accuracy |
|---|---|---|
| constant-first | 0/121 (0.00%) | 0/270 (0.00%) |
| constant-original-A | 65/121 (53.72%) | 143/270 (52.96%) |
| longer-wins | 55/121 (45.45%) | 118/270 (43.70%) |
| refusal-wins | 0/121 (0.00%) | 0/270 (0.00%) |

Measured spend: 6.27908854 USD. Received calls: 3961. Unpriced or interrupted attempts: 21, reserved liability 2.13521900 USD. Unresolved calls: 2.

TIE-only: fewer than 440 pairs; no powered per-cell WIN claim expected.

Claude-generated responses share the Anthropic family with the Haiku judge. Luna has no response-family overlap.

Holm correction awaits the full 18-cell family. Missing cells never count as ties or wins.

Inputs and all measured quantities: data/seal.json and results/cells.json. Per-item decisions: results/items-<model>.json.
