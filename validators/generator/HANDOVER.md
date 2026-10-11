# Handover: validator generator

Rewritten by the executor every iteration (docs/validators.md section 10). A stranger continues from this file alone. The level table is written by `driftbench validate generator --journal <row.json>` from the last journal row.

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
<!-- level-table:end -->

No executor iteration has run yet, so the table is empty. The lane's own run (`pnpm driftbench validate generator --seeds 1..20 --hidden`, before the first executor) reached level 1 of 7 on seeds 1 to 20 and on the hidden seed. Level 2 (cheater resistance) failed on every seed, between 0.603 and 0.778 against the bar of 0.8.

## Floor

See `validators/floors.json`; `pnpm driftbench validate floors` prints it. The lane proposed a floor of 1 for generator (a root change for the maintainer).

## Open items

Level 2, cheater resistance: 20 to 37 complete blocks per seed are passed by at least one cheater. Over seeds 1 to 20 the passed blocks come from the seeders as follows: boundary 348, twise 143, metamorphic 30, deviation 13. The causes the items show:

1. A boundary block on a tool answer expects only `count: { min: 1 }` on the tool, so the every-tool and replay-suite cheaters pass it (`packages/generate/src/seed/seeders.ts#boundarySeeder`).
2. A boundary block on an invalid input expects only `count: 0`, so every cheater that calls no tool passes it (constant, echo, copy-given).
3. `rules.one_message_per_turn`, added for a D7 probe, applies to every block of the spec, so the opener of a D7 carrier reads `format` and every one-message cheater passes it (`seeders.ts#addDeviation`).
4. A deviation probe anchored at the start stage expects the start stage, which every cheater reports (`seeders.ts#probeDraft`).
5. A D5 carrier block expects only `lang: EN`, which the constant English reply passes.

What lies above, measured by computing every level without the stop on seeds 1 to 20 (the ladder itself stops at level 2):

* Level 3 (green on the reference): 1.0 on every seed.
* Level 4 (every class killed): 0.5 to 0.917. Never killed: X2_contradiction on all 20 seeds (no Then reads the reply's facts), D2_goal_shift on all 12 seeds that hold it (D2 is not a detour, so its probe states no stage), D8_tool_failure on all 11 seeds that hold it (the generated tool failure is a perturbation, which the free-running runner never applies).
* Level 5 (mutation score): 0 on every seed because of X2; X1_local and X5_tool are below 0.9 on all 20 seeds and X4_format on 16 (on seed 1 the survivors are the every-second-time instances).
* Level 6 (coverage of the hidden cells): 0.8 to 1.0; the stage axis is below the hand-written baseline on 19 seeds (graph specs carry no `covers`).
* Level 7 (stability): 1.0 on every seed.

## Hypotheses tried

None yet. Each entry: the hypothesis, the evidence, and why it was rejected.

## Next actions

1. Run `pnpm driftbench validate generator --seed 1` and read the level 2 items; start with cause 1 (boundary output blocks), the largest group: give such a block a Then a cheater cannot meet, for example the tool input the turn implies or a must on the answer, in `packages/generate/src/seed/seeders.ts#boundarySeeder`.
2. Re-run on seed 1, then `--seeds 1..20 --hidden`, and record the row with `--journal`.
3. Take cause 2, then 3 to 5, one per iteration, until level 2 passes on every seed.

## Pitfalls

* The validator scores only blocks whose Then a machine decides (`thenFields` not empty). Blocks with judged criteria only are left out of levels 2, 3, 5 and 7, because a validator holds no model; their count is the difference between the blocks and the machine blocks of a seed (about 40 percent over seeds 1 to 20).
* Runs are free-running with the scripted driver, as `driftbench gate` runs them: perturbations are never applied. A generated tool failure (D8 without a phrase) is a perturbation, so no D8 fault ever fires.
* Each class is planted three times, so a class score is 0, 1/3, 2/3 or 1: level 5 at 0.9 asks every scored instance to die.
* `rules.one_message_per_turn` is a spec rule: every block of a D7 spec reads `format`.
* The follower reads each turn by its exact phrase text. A generator that rewrites phrases (it never does today) would make the follower answer "I did not understand that".
* Level 3 tolerates 5 percent of wrong expectations: a defect that touches few blocks (only the at-maximum partition, for example) stays green there.
* One seed runs in about one second: the hidden map is generated twice, and its complete specs (83 per seed on average, 1660 over seeds 1 to 20) run on the follower 5 times, on the 5 cheaters, and on 27 to 39 faults (three per planted class).

## How to run

```
pnpm driftbench validate generator --seeds 1..20 --hidden
pnpm driftbench validate generator --seed 1 --json
pnpm driftbench validate generator --brief
```

## Fixtures

* The hidden specification of each seed is drawn by `hiddenSpec(seed)` in `packages/validators/src/ladders/generator/hidden.ts` and rendered by `render.ts` into a temporary folder; seed 1 is kept in `packages/validators/fixtures/generator/seed-1/` and compared byte for byte by `packages/validators/test/generator/hidden.test.ts` (refresh: `pnpm exec tsx --tsconfig tsconfig.json packages/validators/fixtures/generator/refresh.ts`).
* The rule follower is `follower.ts`, the fault family `faults.ts`, the cheaters `cheaters.ts`, the hand-written baseline `baseline.ts`, the runs `measure.ts`, the levels and the fixed component table (`GENERATOR_COMPONENTS`, `CLASS_COMPONENT`) `index.ts`, all in `packages/validators/src/ladders/generator/`.
