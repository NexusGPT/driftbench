# Handover: validator variables

Rewritten by the executor every iteration (docs/validators.md section 10). A stranger continues from this file alone. The level table is written by `driftbench validate variables --journal <row.json>` from the last journal row.

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

## Floor

No variables floor is committed in `validators/floors.json`; the measured baseline level is 0.

## Open items

Iteration 0 is measured on the real product (the adapter of PR 861 at head 132194901, which maps `validate`, `quotes` and `plan`): 142 of 536 items pass on every seed, 134 distinct failing causes (candidate labels), level 0 on all 21 seeds. In the first level (`store`), 205 of 248 items fail: sources 61, quotes 54, values 35 and boundaries 55. Items that need `buildStore`, `weightInterval` or `coverage` fail by function name: those functions have no product yet and stay unmapped, so the readers, the interval and the counter are the roadmap, not a defect. Real gaps seen while measuring:

- `values.file.references.ambiguous-axis-value` fails on every seed: the loader accepts a value id that sits in two axes.
- `weights.plan-shares` (both variants) fails on every seed, and the `seeds.kept-with-warnings` and `impossible.general-forbid` items fail on many seeds. On seed 4 the uncovered tuples I looked at are all pairs of the shared axes, which fits the strength-2 axis floor of planner PR 807 being open. This is unconfirmed.

## Hypotheses tried

None yet: no executor iteration has run on the real product. The earlier history of the bank (the constant empty implementation, the second bank of PR 762 folded in, the quote-item leak) is in `audit.md`.

## Next actions

1. Run the pilot: fix one cause per iteration from the first failing level (`store`), starting with the real gaps under Open items, and record each iteration with `measure-row.ts`.
2. Map `buildStore`, `weightInterval` and `coverage` in `adapter.ts` when their products land (the readers, the interval, the counter).
3. Complete the four independent gates in `audit.md`; all remain pending.

## Pitfalls

A full run of 21 seeds takes about two hours on the real product, even with the single quote worker: measure one seed first. The hidden seed comes from the commit measured, so it changes with every commit. Candidate cause labels do not prove independent fixes; see `audit.md`.

## How to run

```
pnpm driftbench validate variables --seeds 1..20 --hidden
pnpm driftbench validate variables --brief
```

## Fixtures

The seeded fixtures live in `packages/validators/src/ladders/variables/bank/families/`; their item definitions and causes live in `bank/manifest/`. Reproducible limited witnesses and mutants live in `packages/validators/test/variables/`. No private conversation set is read.

## Iteration 0 and reproduction

`evidence/iteration0.json` summarises the measurement of iteration 0 at `132194901e2c5bdd7e04a6c02d7a7ae7269fc8f5`; `journal.jsonl` holds its row. To repeat it, run `pnpm driftbench validate variables --seeds 1..20 --hidden --items --json > run.json`, then `pnpm exec tsx validators/variables/measure-row.ts --before run.json --after run.json --iteration 0 --executor builder --commit <sha> > row.json`, then `pnpm driftbench validate variables --journal row.json`. The measurement of the empty adapter (`baseline.ts`, `evidence/baseline.json`) is history: it holds for an adapter that provides no operation.
