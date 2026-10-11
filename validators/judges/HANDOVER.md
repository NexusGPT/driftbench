# Handover: validator judges

Rewritten by the executor every iteration (docs/validators.md section 10). A stranger continues from this file alone. The level table is written by `driftbench validate judges --journal <row.json>` from the last journal row.

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
| 1 | 1 |
| 2 | 1 |
| 3 | 1 |
| 4 | 1 |
| 5 | 1 |
| 6 | 1 |
| 7 | 1 |
| 8 | 1 |
| 9 | 1 |
| 10 | 1 |
| 11 | 1 |
| 12 | 1 |
| 13 | 1 |
| 14 | 1 |
| 15 | 1 |
| 16 | 1 |
| 17 | 1 |
| 18 | 1 |
| 19 | 1 |
| 20 | 1 |
| hidden | 1 |
<!-- level-table:end -->

This is ladder version 2 (docs/validators.md section 12): `judgesLadderV2()` in `packages/validators/src/ladders/judges/v2/`, 574 deterministic items in 19 levels, each level's threshold 1. Level 1 (the seven v1 levels per criterion) passes on every seed; level 2 (contract) fails on 3 items. Bank score after the ten-iteration pilot: 222 of 574 items pass on every seed (0.3868); iteration 0 was 208 (0.3624). Hardness: 1.4 items fixed per iteration, 352 remaining, forecast 251 iterations. The record is `validators/judges/journal.jsonl`: iteration 0 and pilot rows 1 to 10, each with the bank summary; `pnpm driftbench validate judges --hardness` prints the measurement and its gate (holds).

## Floor

Floors are per ladder version (section 12.5); `validators/floors.json` is the maintainer's. The judges floor of 7 belongs to version 1. Version 2 starts at the level the pilot reached: 1.

## Open items

Level 2, contract: `contract/probability-above-one`, `contract/probability-below-zero` (outcomeFromProbability reads a probability outside 0 to 1 as a verdict), `contract/probability-crossed-bounds` (bounds with failAt over passAt are accepted). Then level 3, consistency: `judgeRepeated` does not exist (6 items) and chat clients send no temperature (3 items). `pnpm driftbench validate judges --seeds 1..20 --hidden --items` lists the whole bank with a verdict per seed.

## Hypotheses tried

Iterations 1 to 10 each fixed one cause in `packages/judges/src/contract.ts`, each with its test in `packages/judges/test/contract.test.ts`: the first object that meets the contract (5 items: two contract items and three scale items that time a parse after many brace pairs), the outcome without case, a score in quotes, single quotes, a trailing comma, a comment line, typographic quotes, a score that contradicts the outcome, two answers that disagree, a key given twice (1 item each). None was rejected.

## Next actions

1. Make `outcomeFromProbability` read a probability that is not finite or outside 0 to 1 as inconclusive, and refuse bounds whose failAt is not under passAt with a RangeError; run the measurement and record iteration 11.
2. Add `judgeRepeated(client, request, k)` to packages/judges (the spec is in the comment of `families/consistency.ts`), then pin temperature 0 in the three chat clients.
3. Every fix: one cause, its test in packages/judges/test, then `measure.ts --iteration N ...` and `validate judges --journal row.json` (see How to run).

## Pitfalls

* Never edit the bank (`packages/validators/src/ladders/judges/**`): a wrong item goes to the maintainer with the oracle's answer and a counter-example.
* Do not read `packages/validators/test/judges/v2/witness.ts`. It proves every item can pass and holds an implementation of most of the roadmap; copying it would empty the ladder without building anything.
* Scale items run under time budgets on the whole seed set; a laptop under load can push one over. Re-measure before you treat a scale failure as real.
* One capability can flip a family at once (the screen flips injection, precision and attacks together; `agreementInterval` flips 15 calibration items). The pilot forecast comes from contract fixes of one or two items each; expect larger steps later and re-measure the forecast every ten iterations.
* The ladder v1 cassettes are keyed by request hash: a change to the Acme agent or criteria needs `pnpm exec tsx packages/validators/test/judges/record.ts`.

## How to run

```
pnpm driftbench validate judges --seeds 1..3 --hidden            # stops at the first failing level
pnpm driftbench validate judges --seeds 1..20 --hidden --items   # the whole bank, pass or fail per seed
pnpm exec tsx packages/validators/test/judges/v2/measure.ts --iteration N --hypothesis "..." \
  --files a,b --commit <sha> --tests "test name" --out row.json
pnpm driftbench validate judges --journal row.json
pnpm driftbench validate judges --hardness
```

## Fixtures

* The items: `packages/validators/src/ladders/judges/v2/families/*.ts`, one file per family, each with its spec in the head comment.
* The labelled slices and transforms reused from version 1: `packages/validators/src/ladders/judges/pool.ts`, `transforms.ts`, `packages/validators/fixtures/judges/`.
* Live items (20) run only with `DRIFTBENCH_BILLED_APPROVAL` set to the id of an owner-approved sized card.
