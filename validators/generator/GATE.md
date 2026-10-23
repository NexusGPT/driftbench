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

## Floor of ladder version 3 (2026-10-23)

The floor of the generator on ladder version 3 is 8 of 23, the level the product reaches on the gate seeds 1, 2, 3 and the recorded hidden seed 727268607 (derived from commit `2b49fabf9`). It is a guard against regression, not the top. The owner's rule "If you cannot do it, lower the bar per validator" applies; no item is weakened.

Measured on GitHub, run 39898383741 (branch `train/gen-bar-measure`, head `2b49fabf9`: `train/cluster-37` with #1446, #1334 and #1342): level reached per seed is 8 on seed 1, 17 on seeds 2 and 3, 17 on the hidden seed. The evidence block of `validators/floors.json` is that result; the legs ran the levels in three slices, so the level of a seed is the level below its first failing item. Seed 9, levels 20 to 23: unmeasured (the job hung, run 39898383741 cancelled).

The named causes, by the first failing level, over seeds 1 to 20 and hidden (the failing items are in the run's artifacts):

- Level 2 and level 14, seeds 5, 8 and 14 (level 1 on those three): the product places messaging blocks for flows whose behaviours are all web-only. `inventory.yaml` gives each behaviour a channels list, and the choice of the channel for a walk does not apply it. The oracle is right under the rule of constrained combinatorial testing (a partial cell is allowed only if an allowed full cell holds it, the behaviour axis included; `packages/generate/src/seed/feasible.ts`). Evidence: run 39904037971 (the three seeds fail levels 2 and 14); run 39905293618 (the same train with the oracle change of #1437 reverted: seeds 5 and 8 are clean to level 14). The product fix is sonnet-gen-climb's and raises the bar later.
- Level 9, eight seeds (1, 4, 6, 7, 9, 13, 15, 18, and 14 once the channel gap is cleared): `phrases.metamorphic`, no complete metamorphic family for a value with two or more phrases.
- Level 16, seeds 12 and 20: `allocation.behaviour.ratio` (most placed value over least placed above 3).
- Level 18, every seed: the minimality items (`minimal.*`). The reducer keeps blocks the oracle calls repeats.
- Level 23, 20 of 21 seeds: `scale.100x.time`, normalised times of 81 to 194 s against the 60 s budget.

The minimum level over all 21 seeds is 1, because of the first cause; the floor is not held to the three seeds 5, 8 and 14 until that fix lands.
