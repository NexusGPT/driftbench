# Handover: validator judges

Rewritten by the executor every iteration (docs/validators.md section 10). A stranger continues from this file alone. The level table is written by `driftbench validate judges --journal <row.json>` from the last journal row.

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
<!-- level-table:end -->

No executor iteration has run yet, so the table is empty. The V3 lane's own run (`pnpm driftbench validate judges --seeds 1..20 --hidden`, with the good cassette) reached level 7 of 7 on seeds 1 to 20 and on the hidden seed.

## Floor

See `validators/floors.json`; `pnpm driftbench validate floors` prints it. The judges validator has no floor yet.

## Open items

None on the good cassette: levels 1 to 7 pass on seeds 1 to 20 and the hidden seed. The cassettes are scripted (no model), so the ladder measures the judge path (cassette replay, the answer contract, the council and its cascade) and the labelled set, not a real judge. The next real item comes from a cassette recorded from a live judge on the same requests (a billed mode the owner approves).

## Hypotheses tried

None yet. Each entry: the hypothesis, the evidence, and why it was rejected.

## Next actions

1. Record a live judge on every request of `requestsToRecord` (in `packages/validators/test/judges/record.ts`) with `recordingClient`, in the billed mode the owner approves, and run `judgesLadder({ cassette })` on it: its first failing level is the first open item.
2. Run `pnpm driftbench validate judges --seeds 1..20 --hidden` and record the level per seed with `--journal`.
3. Raise the floor to 2 with `pnpm driftbench validate floors --raise judges 2 --evidence <run.json>` once a `--json` run on seeds 1 to 20 and the hidden seed reaches level 2 on every seed; levels 1 and 2 are the ones the brief requires on current code.

## Pitfalls

* The cassettes are keyed by a hash of what the judge reads. A change to the Acme agent, its criteria files, the fault family, the phrase bank or a transform changes the keys: every level then fails with "no recording" items. Re-record with `pnpm exec tsx packages/validators/test/judges/record.ts`; the cassette test fails until you do.
* Levels 2 to 7 score the hidden split only. The split is stratified by criterion and label, so each criterion keeps both labels; the item count per criterion is small (4 to 11 per label in the pool), so one wrong answer moves a criterion's accuracy by a lot.
* Level 2 holds the kappa point estimate to 0.8 and prints its bootstrap interval; it does not hold the lower bound.
* Level 5 counts every injected hidden item; a planted instruction only matters on a fail item, so a judge that obeys it fails about half the edits.

## How to run

```
pnpm driftbench validate judges --seeds 1..20 --hidden
pnpm driftbench validate judges --seed 1 --json
pnpm driftbench validate judges --brief
pnpm exec tsx packages/validators/test/judges/record.ts
```

## Fixtures

* The labelled set: `packages/validators/src/ladders/judges/pool.ts` drives the Acme sales assistant (`examples/acme/src`) through the fault family (`examples/acme/faults`) and slices the conversations; the criteria and their fixture pairs are `examples/acme/criteria/*.yaml`.
* The phrase bank and the swap lists: `packages/validators/fixtures/judges/phrases.yaml`.
* The cassettes: `packages/validators/fixtures/judges/{good,brittle,injectable,flaky,council}.cassette.json`, written by `packages/validators/test/judges/record.ts` from the scripted reading in `packages/validators/test/judges/scripted.ts`.
* The fixed table from a failure to its component: `JUDGE_COMPONENTS` in `packages/validators/src/ladders/judges/index.ts`.
