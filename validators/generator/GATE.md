# Gate: validator generator

The hardness gate of docs/validators.md section 12.4, measured on ladder version 2 (2033 items), seeds 1 to 20 and the hidden seed. Owner decision, 2026-10-12: validator design stops here. The generator validator merges with the lowered bar below, which its bank meets. It does not meet the section 12 contract (forecast 100, score after the pilot 0.4, 100 distinct causes), and no item was added to reach it.

## The recorded bar

Max score after the pilot: 0.67
Min forecast: 50
Min distinct failing causes: 100

The owner's fallback, verbatim: "If you cannot do it, lower the bar per validator". The generator bar is a forecast of at least 50 iterations (measured 51.0), a score after the pilot of at most 0.67 (measured 0.661) and at least 100 distinct failing causes (measured 296), the section 12.4 term kept. `driftbench validate generator --hardness` reads the lines above (`parseGate` in `packages/validators/src/hardness.ts`, which takes a value only when it lowers a term, so the causes line keeps the contract's 100). With this bar the command reads all three terms as held; its gate line still says NOT MET for one reason, the audit of section 12.7: the four seats in `audit.md` are pending. The figures below are historical builder evidence; they do not certify the current planner-v2 bank or a fresh independent pilot. Pilot row 10 of `journal.jsonl` records the 296 causes its bank run measured (`failingCauses`), so the reader sees them.

## The numbers

| Measure | Value | Gate |
|---|---|---|
| Bank | 2033 items, 26 families, every tier present, no family under 20 | holds |
| Score at iteration 0 | 0.595 (1209 of 2033) | |
| Score after the ten pilot iterations | 0.661 (1344 of 2033) | at most 0.67 (lowered from 0.4): holds |
| Items fixed per iteration | 13.5 | |
| Forecast | 51.0 iterations (689 failing / 13.5) | at least 50 (lowered from 100): holds |
| Distinct causes among the failing items | 296 | at least 100: holds |

Pilot scores, iterations 0 to 10: 1209, 1236, 1246, 1253, 1252, 1262, 1264, 1274, 1275, 1295, 1344. The rows are `journal.jsonl` rows 0 to 10; the pilot commits are on branch `exec/generator-pilot`.

## Why the contract is not met

A fix clears 13.5 items on average, because many items share a cause: a class the suite never kills fails its fault, adequacy, minimality, stability and interaction items together. The causes are shallow relative to the bank's size. Raising the gate needs items whose causes each need their own work (task-kind scenario generation, covering-array optimality, constraint soundness on contradictory maps, holdout leakage), and the owner chose product work over more validator design.

## Bar this validator merges at

The bank and the ladder as they stand, with floor 1 on ladder version 2. An executor climbs it from the open items in `HANDOVER.md`. Any later bank extension starts a new ladder version and a new measurement.
