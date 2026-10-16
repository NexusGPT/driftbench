# Handover: validator blocks

Rewritten by the executor every iteration (docs/validators.md section 10). A stranger continues from this file alone. The level table is written by `driftbench validate blocks --journal <row.json>` from the last journal row.

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
| 1 | 2 |
| 2 | 2 |
| 3 | 2 |
| hidden | 2 |
<!-- level-table:end -->

## Floor

2 (validators/floors.json, ladder version 1).

## Open items

Level 3 (intervals) fails on every seed, for three causes:

- `intervals/end-state/g{2,4,8}/{three-each,unequal}/*`: `packages/report/src/scorecard.ts` rates the end states with the plain Wilson interval of the runs; over repeated goldens it must be the rate over goldens of docs/concepts/statistics.md (PR 547 states it, PR 528 builds it).
- `intervals/pass-rate/g{2,3,5,12}/{three-each,unequal,large}`: `packages/report/src/aggregate.ts` gives the pass-rate criterion the plain Wilson interval; PR 528 gives it the rate over goldens.
- `intervals/headline/documented-example`: `packages/report/src/headline.ts` computes n_eff 7.33 (design effect 3.68) for the six goldens of docs/concepts/statistics.md, which prints 7.0 (3.87). One of the two is wrong: the code or the example.

Levels 4 to 8 and 10 fail on main because their capabilities are in open pull requests; their items name the missing export or command. Run on the heads of those pull requests, levels 4 to 8 pass, except `objects/cli/explain-unresolved` (docs/reference/cli.md says `explain` exits 1 on an object the spec names that does not resolve; the command exits 2 because the loader refuses the spec first).

## Hypotheses tried

None yet: iteration 0 is the baseline of ladder version 1. Each entry: the hypothesis, the evidence, and why it was rejected.

## Next actions

1. Merge PR 528 (the rate over goldens for the end-state rate and the pass-rate criterion), then run `pnpm driftbench validate blocks --seeds 1..20 --hidden` and record the level per seed.
2. Settle the documented headline example: recompute n_eff for the six goldens of docs/concepts/statistics.md and fix the side that is wrong.
3. Take the next failing level and write one sentence: the component, the cause, the item that proves it; fix one cause with a test that reproduces the item first.

## Pitfalls

- An item reaches the product only through `BlocksProduct` (`packages/validators/src/ladders/blocks/product.ts`); importing a package in a level file bypasses the cheater tests.
- The shipped objects join the registry only after `initializeShippedObjects()` of the checks package; the harness calls it before every load.
- Each check of a test gets its own scratch folder: a cheater run that finds the real run's files passes for the wrong reason.

## How to run

```
pnpm driftbench validate blocks --seeds 1..20 --hidden
pnpm driftbench validate blocks --brief
```

## Fixtures

No fixture files: every input is drawn from the seed by the level files under `packages/validators/src/ladders/blocks/levels/` (the fictional shop Larkspur Cycles is in `harness.ts`). The formula references are in `reference.ts`; the cheating products in `fakes.ts`.
