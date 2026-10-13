# JudgeBench cell table

Pool: 270 Claude-response pairs. 159 source-question IDs overlap earlier GPT evaluations, including 91 exact texts.

| Model | Coverage | Ledger accuracy (Wilson 95%) | promptfoo accuracy (Wilson 95%) | Wins / losses | Exact p | Holm p | USD per 100 ledger / peer | Noise ledger / peer | Status |
|---|---|---|---|---|---|---|---|---|---|
| claude-haiku-5-5 | 0/270 | pending | pending | pending | pending | pending global family | pending / pending | pending / pending | PENDING_CORE |
| gpt-6-luna | 0/270 | pending | pending | pending | pending | pending global family | pending / pending | pending / pending | PENDING_CORE |
| gemini-3.8-flash | 0/270 | pending | pending | pending | pending | pending | pending | pending | PENDING_BILLING |

Measured spend: 0.00000000 USD. Completed calls: 0. Unresolved calls: 0.

TIE-only: fewer than 440 pairs; no powered per-cell WIN claim expected.

Claude-generated responses share the Anthropic family with the Haiku judge. Luna has no response-family overlap.

Holm correction awaits the full 18-cell family. Missing cells never count as ties or wins.

Inputs and all measured quantities: data/seal.json and results/cells.json. Per-item decisions: results/items-<model>.json.
