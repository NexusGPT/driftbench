# Handover: judges v3 labeller pilot

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
| 1 | 3 |
| 2 | 3 |
| 3 | 3 |
| 4 | 3 |
| 5 | 3 |
| 6 | 3 |
| 7 | 3 |
| 8 | 3 |
| 9 | 3 |
| 10 | 3 |
| 11 | 3 |
| 12 | 3 |
| 13 | 3 |
| 14 | 3 |
| 15 | 3 |
| 16 | 3 |
| 17 | 3 |
| 18 | 3 |
| 19 | 3 |
| 20 | 3 |
| hidden | 3 |
<!-- level-table:end -->

This table records the isolated builder candidate after ten repairs, not the
finished production scorer. The blind candidate independently reaches the same
327/334, score 0.979041916168, level 3. Both use checkpoint
`6579b72536697bc99bccb5c138d007d4e3a4a44d`, hidden seed `703475557`.

## Floor

Version 2 stays the default with floor 20. No version 3 floor is raised by this
PR. The provisional delivery bar and unmet original gate are in [GATE.md](GATE.md).

## Open items

Seven items remain in both isolated pilot candidates:

- `labeller/advanced/sample-plan-delta-margin`
- `labeller/advanced/sample-plan-reject-unidentified-designs`
- `labeller/advanced/exact-fixed-margin-perfect`
- `labeller/advanced/sample-plan-prevalence-and-confidence`
- `labeller/advanced/exact-inclusive-ties-and-alternatives`
- `labeller/advanced/exact-missing-and-invalid-multisets`
- `labeller/advanced/exact-degenerate-and-size-bound`

The sample planner and exact permutation test remain stubs in those candidates.
The separate production implementation supplies them. Author tags count seven;
the final reviewer groups them into two inferred capabilities, without claiming
a verified implementation root-cause count.

## Hypotheses tried

Builder repairs: nominal scoring; immutable replay plus required identity;
confusion; PABAK; delta kappa CI; coverage; threshold selection; total vocabulary
mapping; weighted kappa; nominal alpha. Each has a red/green regression and
immutable measured snapshot. Blind order differs; both final scores agree.
[Round notes and reports](evidence/README.md) preserve the actual sequences.
No deliberately failing code or unchanged padding rounds enter this pilot.

## Next actions

1. Review the normal PR against its stated provisional delivery bar and failed
   original hardness/audit conditions.
2. To continue the experiment, restore a preserved candidate in a separate
   workspace and implement one remaining capability per measured round.
3. Extend the bank only for additional documented product capabilities; preserve
   version 2's default, items and floor.

## Pitfalls

The score is passing items divided by 334, not level divided by five. A shared
foundation clears many cases. Do not count seven remaining tags as seven proven
repairs. Do not use the production scorer as an untouched pilot baseline.
The alpha `pairable` field counts retained ratings, not units; the clarification
is recorded in both executors' round-ten notes. Audits disclose model substitution
and protocol limitations. The original hardness command is expected to fail.

## How to run

For the finished implementation:

```sh
pnpm driftbench validate judges --ladder-version 3 --seeds 1..20 --hidden --items --json
pnpm driftbench validate judges --ladder-version 3 --hardness --json
pnpm driftbench validate judges --ladder-version 3 --check-handover
```

The ordinary validator exits with its reached level. Hardness exits 1; handover
consistency should exit 0. To reproduce a pilot measurement, check out its
recorded bank revision, restore an evidence snapshot as `candidate.ts`, and use
[PILOT.md](PILOT.md) with a new output directory. Prefix heavy commands with the
shared slot runner in the owner's environment; Vitest uses `--maxWorkers=2`.

## Fixtures

Base: `packages/validators/src/ladders/judges/v3/{bank,fixtures}.ts`.
Advanced: `packages/validators/src/ladders/judges/v3/advanced-bank.ts`.
Combined bank: `judgesV3Bank()` in that directory's `index.ts`.
[Public methods](ADVANCED.md), [inventory](README.md), [audit](audit.md), and
[immutable pilot evidence](evidence/README.md) are version-specific.
