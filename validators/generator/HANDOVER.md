# Handover: validator generator

Rewritten by the executor every iteration (docs/validators.md section 10). A stranger continues from this file alone. The level table is written by `driftbench validate generator --journal <row.json>` from the last journal row.

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
| 1 | 4 |
| 2 | 4 |
| 3 | 4 |
| 4 | 4 |
| 5 | 4 |
| 6 | 4 |
| 7 | 4 |
| 8 | 4 |
| 9 | 4 |
| 10 | 4 |
| 11 | 4 |
| 12 | 4 |
| 13 | 4 |
| 14 | 4 |
| 15 | 4 |
| 16 | 4 |
| 17 | 4 |
| 18 | 4 |
| 19 | 4 |
| 20 | 4 |
| hidden | 4 |
<!-- level-table:end -->

The bank holds 2033 items in 26 families, ordered in 22 levels; a level passes when every item of it passes on every seed. After iteration 12 every seed passes levels 1 to 4 and fails level 5 (cheater resistance). Bank: 1325 of 2033 pass on every seed.

## Floor

See `validators/floors.json`; `pnpm driftbench validate floors` prints it. The lane proposes a floor of 1 for generator, ladder version 2 (a maintainer change after the merge).

## Open items

Failing items per family: {'interaction-pair': 369, 'modes': 58, 'minimality': 53, 'report': 40, 'fault-code': 20, 'adequacy': 20, 'behaviours': 15, 'fault-drift': 14, 'boundary': 13, 'interaction-triple': 13, 'sequence': 11, 'scale': 10, 'allocation': 10, 'gate': 10, 'cheaters': 9, 'perturbation': 9, 'coverage': 9, 'stability': 8, 'phrases': 7, 'paths': 5, 'contrast': 3, 'fault-deviation': 2}.

First failing level, 5 cheaters, 9 items on seed 1:
- `cheater.{constant,echo,copy-given}.{twise,deviation,metamorphic}`: probe blocks of the classes D5_language_switch, D6_instruction_in_data, D9_out_of_scope and D1_off_topic on the first turn are passed by a constant reply. They pass through `forbidden.*`, `lang.expected`, `stage.reached` and `must`/`must_not`, all of which a do-nothing agent that reports the start stage satisfies. Component: `packages/generate/src/seed/scenario.ts#buildScenario` (the probe block's Then) and `deviation.ts`. Lead: the first-turn probe of pilot 10 stays on the start stage, so `stage.reached` cannot fail; a Then that needs the agent to say a word of the map's recovery (`must` from the recovery relation, not an echo of the user turn) kills constant and echo.
- Later levels: `kill.X1..X4.*` (fault classes the suite never kills), `adequacy.*`, `modes.*`, `minimality.*`, `report.*`, and `interaction-pair` (about 400 items sharing the kill causes). List all with `pnpm driftbench validate generator --seeds 1..20 --hidden --items`.

## Hypotheses tried

Iterations 1 to 10 are the pilot (journal rows 1 to 10, branch `exec/generator-pilot`, merged into this branch): path fallback for rows without a path, strength 3 default, recovery ends the walk, side-effecting boundary values through a path, every other tool 0 times in a boundary block, tool-failure words, invariance families, concrete value on path boundaries, perturbation on clean walks, first-turn probes.

11. Commit `47a20773`-ancestor, bank 1209 to 1219 (before the pilot merge). The t-wise report counted tuples no possible cell holds (diff.twise.allowed: 156 reported, 125 by brute force). `packages/generate/src/seed/possible.ts` rules out pairs of a stage or a deviation with another axis that no path event can match; the covering array counts with them as extra constraints; `twise.unreachable` lists them. The Acme suite is regenerated at t 2 (207 complete specs). The merge with the pilot raised every seed to level 4 (bank 1323).
12. Bank 1323 to 1325. A boundary block whose every tool count is 0 (an invalid tool input, a side-effecting tool asked alone) is passed by a constant, echo or copy-given reply. It has no machine Then, so it goes to incomplete/ with the reason. Test `packages/generate/test/seed/boundary.test.ts` (red run saved in `.exec/red12.txt`, untracked). The three boundary cheater items now pass; the twise, deviation and metamorphic ones remain.

## Next actions

1. Fix the cheaters on probe blocks: read one failing block (`pnpm driftbench generate --map packages/validators/fixtures/generator/seed-1/approved.yaml --out .exec/g --seed 1 --force`, then `.exec/g/specs/twise/gen-twise-021.yaml`), name which assertions a constant reply passes, and give the block a Then drawn from the map's recovery that a constant cannot satisfy.
2. Then level 6 (the validity gate) and the `kill.*` causes.
3. Every third iteration run the handover test: `pnpm driftbench validate generator --brief --fresh`.

## Pitfalls

* Never edit the validator or bank (`packages/validators/**`, the rest of `validators/`).
* Acme items read `examples/acme`; regenerate with `pnpm -s driftbench generate --map examples/acme/map/approved.yaml --out examples/acme/generated --baseline examples/acme/specs --t 2 --force` then `pnpm -s biome check --write examples`, and update the pinned counts in `packages/generate/test/enumerate/acme.test.ts` and `test/gate/acme-generated.test.ts`.
* Memory is tight: vitest with `--maxWorkers=2`, bank-run with `--jobs 2`, one sweep at a time. A full sweep takes about 20 to 25 minutes.
* Measurements live in `.exec/` (untracked, excluded in the git common dir).
* Items sharing a cause count once.

## How to run

```
pnpm driftbench validate generator --seed 1 --items
node --import tsx packages/validators/src/ladders/generator/bank-run.ts .exec/after.json --seeds 1..20 --hidden --jobs 2
node --import tsx packages/validators/src/ladders/generator/bank-row.ts .exec/after.json .exec/row.json --iteration <n> --before .exec/before.json --hypothesis "<text>" --files <a,b> --commit <sha> --tests "<names>" --minutes <n> --model sonnet
pnpm driftbench validate generator --journal .exec/row.json
```

## Fixtures

* The hidden specification of each seed: `hiddenSpec(seed)` in `packages/validators/src/ladders/generator/hidden.ts`, rendered by `render.ts`; seed 1 is kept in `packages/validators/fixtures/generator/seed-1/`.
* Rule follower `follower.ts`, faults `faults.ts`, cheaters `cheaters.ts`, items `bank*.ts` and `acme.ts`.
