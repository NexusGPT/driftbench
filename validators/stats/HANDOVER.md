# Handover: validator stats

Rewritten by the executor every iteration (docs/validators.md section 10). A stranger continues from this file alone. The level table is written by `driftbench validate stats --journal <row.json>` from the last journal row.

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
<!-- level-table:end -->

No executor iteration has run yet, so the table is empty. The ladder has six levels (docs/validators.md section 7). The V6 lane's own run (`pnpm driftbench validate stats --seeds 1..20 --hidden`, before the first executor) is in the lane handoff, `docs/lanes/v-stats.md`.

## Floor

See `validators/floors.json`; `pnpm driftbench validate floors` prints it. The floor is 1. The V6 lane did not raise it: raising it is a commit of its own with the evidence run, and levels 2 to 4 each have a measured chance of failing a correct implementation on some seed (see Pitfalls).

## Open items

None at the time of writing: levels 1 to 6 pass on the lane's seeds. Each new failing item at the first failing level becomes an open item here.

## Hypotheses tried

None yet. Each entry: the hypothesis, the evidence, and why it was rejected.

## Next actions

1. Run `pnpm driftbench validate stats --seeds 1..20 --hidden` and record the level per seed with `--journal`.
2. Decide the floor with the owner: 6 makes the margins below a CI risk; 1 is where it stands.
3. If level 5 must score the Chao1 class count (the literal reading of the design), first ask the owner for the population and the conversation multiple it must hold on: Chao1 is a lower bound and errs by more than 10 percent just above the class count on every tail the lane measured (research.md, entry 1).

## Pitfalls

* Levels 2, 3 and 4 are coverage ratios against a bar of 0.93 for nominal 95 percent intervals, so a correct implementation can fail on an unlucky seed. Measured on the committed designs: level 2, seeds 1 to 100, lowest 0.931; level 3, seeds 1 to 30 (prototype of the same draws), pooled coverage 0.938 to 0.956; level 4, seeds 1 to 100, lowest 0.9375 (2 misses of 32), 3 misses would fail.
* A fault in a statistics function usually fails level 1 first, because the reference fixtures call the same function. That is the ladder working: the cheapest diagnosis comes first. A planted fault meant for levels 3 to 6 must stay outside the fixtures' inputs to reach them (see `packages/validators/test/stats/ladder.test.ts`).
* Level 4 scores `analysePilot` of the generate package at its defaults (500 bootstrap draws over cells, then conversations). Changing those defaults changes the level.
* Level 5 scores the coverage estimates (the mass of the classes seen), not the Chao1 class count.
* Level 6 draws 2000 campaigns per design. At 1000, seed 65 gave a gap of 0.061 on the power-0.5 design.
* The validator never edits the reference fixtures or the designs file: both are data the maintainer changes on a maintainer branch.

## How to run

```
pnpm driftbench validate stats --seeds 1..20 --hidden
pnpm driftbench validate stats --seed 1 --json
pnpm driftbench validate stats --brief
```

Seeds 1 to 20 and the hidden seed took 253 seconds of CPU and 6 minutes 47 seconds of wall time on the lane's machine, about 12 seconds of CPU per seed. Level 3, the clustered bootstrap at its default 2000 resamples, is the largest part.

## Fixtures

* Level 1: `packages/stats/test/reference/fixtures.json`, written by `packages/stats/test/reference/make_fixtures.py` from scipy and numpy. The fixed table from each fixture group to the source file an item points at is `STATS_COMPONENTS` in `packages/validators/src/ladders/stats/reference.ts`.
* Level 2: no file. Per seed and per n of 20, 50 and 200, 1000 true rates uniform on 0.1 to 0.9 and a binomial count at each, with `mulberry32`.
* Levels 3 to 6: `packages/validators/fixtures/stats/designs.json`, checked by `StatsDesignsSchema` in `packages/validators/src/ladders/stats/designs.ts`. Level 3: three clustered designs (conversations, blocks per conversation, rho), 1000 draws each. Level 4: one balanced pilot design (12 cells, 8 conversations, 3 wordings, 4 repeats, logit effects), 8 datasets. Level 5: two populations (60 classes with a tail of 5, 120 classes with a tail of 10), multiples 1.5 and 3 above the class count (200 draws), 0.5 and 0.95 below it (50 draws). Level 6: five planned campaigns, 2000 simulated campaigns each.
