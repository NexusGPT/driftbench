# Condition label: dev and held-out files, fixed before any labelling run

Lane: pointer-chain. Committed before the baseline ran. The files are the prose files of `examples/estates/fixture`, sorted by path; the files at even positions (0, 2, 4, ...) are the development set, those at odd positions the held-out set. No file was looked at to choose.

The question: how often the shipped labeler (`system2:anthropic`, `claude-haiku-5-5`, three runs per window) gives an answer the check of the answer refuses, on the windows of each set: a `condition` with no target in the window, a target on a label that takes none, a `condition` that points at a unit that holds no atom. Fixes (the instructions of the label, or the request) are tuned on the development set only; the held-out set is run once per fixed candidate chosen, at the end, and is never used to pick between candidates.

## Development files
* `.claude/agents/inbox-triager.md`
* `.claude/agents/route-planner.md`
* `.claude/memory/MEMORY.md`
* `.claude/skills/invoice-reconcile/SKILL.md`
* `.claude/skills/invoice-reconcile/references/matching-rules.md`
* `.claude/skills/shipment-tracker/SKILL.md`
* `.claude/skills/weekly-report/SKILL.md`
* `CLAUDE.md`

## Held-out files
* `.claude/agents/ledger-auditor.md`
* `.claude/guards/CHECK-REGISTRY.md`
* `.claude/memory/supplier-languages.md`
* `.claude/skills/invoice-reconcile/references/currency-table.md`
* `.claude/skills/invoice-reconcile/references/old-tolerances.md`
* `.claude/skills/supplier-email/SKILL.md`
* `.claude/skills/weekly-report/templates/report.md`
* `README.md`

## Budget

USD 1.00 for the whole row, counted per call from the usage recorded in each cassette (`cost.json`). The run stops there.
