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

0 (validators/floors.json).

## Open items

The items of the first failing level, by id, each with the component it points at.

## Hypotheses tried

The constant empty implementation originally earned 51/471 seed-1 items. Positive checks now reject all of them; targeted mutation tests exercise those checks. This is bank repair evidence, not an executor pilot.

## Next actions

1. Integrate the real components (PR 692 and PR 706) and map the variables adapter.
2. Rerun the full baseline and complete ten real executor iterations.
3. Complete the four independent gates in `audit.md`; all remain pending.

## Pitfalls

The default adapter supplies no operations. A 0/471 baseline is expected and proves no real component capability. Candidate cause labels do not prove independent fixes; see `audit.md`.

## How to run

```
pnpm driftbench validate variables --seeds 1..20 --hidden
pnpm driftbench validate variables --brief
```

## Fixtures

Where the validator reads its planted truth: name the files.

## Fresh baseline and reproduction

The measured journal row at `ba1e62133c1d6dd18410c114380c2ee3e5d2f1bc` (source SHA-256 `a7cc7b4e5169285746fb098ea773c27ce48857cea7a41107c50d3f4564e7f88e`) records 0/471 for each seed 1–20 and the canonical hidden seed using the actual default adapter. Run `pnpm exec tsx validators/variables/baseline.ts` to repeat with the current commit’s canonical hidden seed. The in-process runner uses the actual adapter module in any child process too.
