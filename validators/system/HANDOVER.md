# Handover: validator system

Rewritten by the executor every iteration (docs/validators.md section 10). A stranger continues from this file alone. The level table is written by `driftbench validate system --journal <row.json>` from the last journal row.

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
| 1 | 0 |
| 2 | 0 |
| 3 | 0 |
| 4 | 0 |
| 5 | 0 |
| 6 | 0 |
| 7 | 0 |
| 8 | 0 |
| 9 | 0 |
| 10 | 0 |
| 11 | 0 |
| 12 | 0 |
| 13 | 0 |
| 14 | 0 |
| 15 | 0 |
| 16 | 0 |
| 17 | 0 |
| 18 | 0 |
| 19 | 0 |
| 20 | 0 |
| hidden | 0 |
<!-- level-table:end -->

No executor iteration has run yet, so the table is empty. The lane's own runs, before the first executor:

* On the fork point 9b40040: level 3 of 8 on seeds 1 to 20 and the hidden seed. Level 4 fails on every seed with the X1 and X2 plants only.
* On a copy of main at 3aa0513 (the run-modes work merged): levels 1 to 4 pass on seeds 1 to 20; level 5 fails on 15 of 20 seeds. Computed one by one past the failing level 5, levels 6, 7 and 8 pass on all 20 seeds.

## Floor

See `validators/floors.json`; `pnpm driftbench validate floors` prints it. The system validator has no floor yet.

## Open items

On main at 3aa0513, level 5 (recovery), every item has the same shape: `label: recorded "immediate", planted "late"`. The run records label a recovery `immediate` when it came back within `recovery.within_blocks` (packages/core/src/runner/recovery.ts). docs/concepts/recovery.md defines `immediate` as the injected block itself and `late` as a later block. The plant follows the page. One of the two must change; the choice is the owner's, not the executor's. With the code changed to the page's rule (one line, tried on a copy), level 5 passes on seeds 1, 6, 7 and 19.

On the fork point, level 4 (drift class): the X1 plants (x1-invents-price, d9-answers-out-of-scope) carry no class, and the X2 plant (x2-keeps-first-email) carries X5_tool only. The runner there assigns three of the five classes. The run-modes merge closes this.

## Hypotheses tried

None yet. Each entry: the hypothesis, the evidence, and why it was rejected.

## Next actions

1. Get the owner's ruling on the recovery label: either docs/concepts/recovery.md or `recoveryOf` in packages/core/src/runner/recovery.ts changes. If the page changes, the plant's `plantedRecord` in packages/validators/src/ladders/system/levels.ts follows it, on a maintainer branch: the ladder is protected on `exec/` branches.
2. Run `pnpm driftbench validate system --seeds 1..20 --hidden` and record the level per seed with `--journal`.
3. Raise the floor to 4 with `pnpm driftbench validate floors --raise system 4 --evidence <run.json>` once a `--json` run on seeds 1 to 20 and the hidden seed reaches level 4 on every seed.

## Pitfalls

* The ladder stops at the first failing level, so levels 6 to 8 are not computed while level 5 fails. To see them, call the level functions of packages/validators/src/ladders/system/levels.ts directly on `runChain` and `runEffect` (the tests do this).
* Level 6 can fail on a correct chain by chance: at the design point (50 pairs, a true rate of 0.93) the Wilson interval's exact coverage is 0.97799, so fewer than 93 of 100 campaigns hold the truth with a chance of 0.0017 per seed. The design effect check uses a 99.9 percent bootstrap interval for the same reason. packages/validators/fixtures/system/design.json holds the numbers, and a test recomputes them.
* The planted versions of level 7 are threshold agents with no run noise: a spec passes when its seeded difficulty is under the version's ability. With 2 percent run noise, 50 pairs and a true rate of 0.9, the non-inferiority verdict false-alarmed more than 5 times in 100 on 8 of 200 simulated seeds (stats functions alone, no runner): the paired interval is wide when there are few discordant pairs. More noise needs more pairs.
* The clustered campaigns draw run r of a spec as the r-th answer the agent gives to it, so their cells run one at a time, in order. Do not raise their concurrency.
* A fault class with no operator in `OPERATORS` (packages/validators/src/ladders/system/family.ts) stops the plant with an error that names the fault: a new fault in the family needs a new operator row first.
* The X2 operator also fails the runner's ledger check where the runner has one; the operator row lists `ledger` under `also`. Any other failing check family on a planted block is a precision fault of the chain.

## How to run

```
pnpm driftbench validate system --seeds 1..20 --hidden
pnpm driftbench validate system --seed 1 --json
pnpm driftbench validate system --brief
```

One seed takes about 2 seconds while the ladder stops at level 4 or 5. Levels 6 and 7 add 200 planted-effect campaigns, 23 000 runs: about 6 seconds on the fork point and about 2 on main at 3aa0513, measured on one laptop. The ladder must be registered in packages/validators/src/ladders/index.ts (a root file).

## Fixtures

* The fault family: examples/acme/faults (read through the gate's `importFaultSet`; only the `function:acme-sales` faults compose into one agent). The operator of each class, the check that must catch it and the class the block must carry: `OPERATORS` in packages/validators/src/ladders/system/family.ts.
* packages/validators/fixtures/system/plant-seed-1.json: the planted defects and recoveries of seed 1, so a change to the plant shows in a diff.
* packages/validators/fixtures/system/design.json: the design point of the planted effect and its exact numbers.
* Everything else is drawn per seed by code (packages/validators/src/ladders/system/plant.ts) and run in a temporary SQLite file that is removed at the end.
