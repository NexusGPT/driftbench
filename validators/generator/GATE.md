# Gate: validator generator

The hardness gate of docs/validators.md section 12.4, measured on ladder version 2 (2033 items), seeds 1 to 20 and the hidden seed. Owner decision, 2026-10-12: validator design stops here; the generator validator merges with the gate measured and not met, and the numbers below are its record.

| Measure | Value | Gate |
|---|---|---|
| Bank | 2033 items, 26 families, every tier present, no family under 20 | holds |
| Score at iteration 0 | 0.595 (1209 of 2033) | |
| Score after the ten pilot iterations | 0.661 (1344 of 2033) | at most 0.4: not met |
| Items fixed per iteration | 13.5 | |
| Forecast | 51.0 iterations (689 failing / 13.5) | at least 100: not met |
| Distinct causes among the failing items | 296 | at least 100: holds |

Pilot scores, iterations 0 to 10: 1209, 1236, 1246, 1253, 1252, 1262, 1264, 1274, 1275, 1295, 1344. The rows are `journal.jsonl` rows 0 to 10; the pilot commits are on branch `exec/generator-pilot`.

## Why it is not met

A fix clears 13.5 items on average, because many items share a cause: a class the suite never kills fails its fault, adequacy, minimality, stability and interaction items together. The causes are shallow relative to the bank's size. Raising the gate needs items whose causes each need their own work (task-kind scenario generation, covering-array optimality, constraint soundness on contradictory maps, holdout leakage), and the owner chose product work over more validator design.

## Bar this validator merges at

The bank and the ladder as they stand, with floor 1 on ladder version 2. An executor climbs it from the open items in `HANDOVER.md`. Any later bank extension starts a new ladder version and a new measurement.
