# Handover: validator pointer

Rewritten by the executor every iteration (docs/validators.md section 10). A stranger continues from this file alone. The level table is written by `driftbench validate pointer --journal <row.json>` from the last journal row.

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
| 1 | 0 |
<!-- level-table:end -->

## Floor

0 (validators/floors.json).

## Open items

The items of the first failing level, by id, each with the component it points at.

## Hypotheses tried

None yet. Each entry: the hypothesis, the evidence, and why it was rejected.

## Next actions

1. Run `pnpm driftbench validate pointer --seeds 1..20 --hidden` and record the level per seed.
2. Take the first failing level and write one sentence: the component, the cause, the item that proves it.
3. Fix one cause with a test that reproduces the item first.

## Pitfalls

None recorded yet.

## How to run

```
pnpm driftbench validate pointer --seeds 1..20 --hidden
pnpm driftbench validate pointer --brief
```

## Fixtures

Where the validator reads its planted truth: name the files.
