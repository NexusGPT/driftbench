# Handover: validator system

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
| 1 | 13 |
| hidden | 13 |
<!-- level-table:end -->

Ladder version 6, 2026-10-18: the table above is the last builder row, iteration 6, measured on the pilot branch `exec/system-links-pilot` at `a5cfcfcd2`, which carries six product fixes. On main and on this validator branch the product has none of them: the level is 11, with 38 of the 319 new items failing (iteration 0, `daa04791c`, seeds 1 and hidden for levels 1 to 11, seeds 1 to 20 and hidden for levels 12 and 13). The version 5 journal is `journal-v5.jsonl`; `journal.jsonl` starts at version 6.

Measured 2026-10-15: unchanged main `14034c6ca` and product `4170c016e` both reach 11 of 11 on local seed 1. The current bank is Bank version 5 (2385 items), all passing; level 10 has 867 items and level 11 has 76. This supersedes the historical local state in journal rows 0–2. Seeds 2, 3 and the hidden seed still require the current CI result.

## Floor

9, ladder version 5, in `validators/floors.json`. No floor changed. Version 6 has no floor yet: a floor of ladder version 5 is history and `--check-floor` prints it as a note. A version 6 floor is its own commit, with a `--json` run of seed 1 and the hidden seed as evidence (iteration 0 reached 11 on both).

## Open items

- Version 6, the hardness gate (docs/validators.md section 12.4) is not met: the builder pilot topped levels 12 and 13 in 6 iterations (2669 of 2707 to 2707 of 2707). Forecast 0, score after the pilot 1, 0 distinct failing causes. The new levels are too simple by the section 12 rule; extend them (section 12.2) before a floor above 11 is claimed.
- Version 6, the audit (validators/system/audit.md): cheater fail, planted bugs fail (13 of 20), cause review pass (38 of 38, 5 causes), blind pilot 5 iterations at 7.6 items each. Each cheat and each missed bug is owed as a new item before the audit runs again.
- Version 6, after the re-audit: planted bugs pass (20 of 20); the cheater still gained through fixture names and process arguments, closed in `6fb7176cb` (not yet re-audited). Pilot iterations 9 and 10 (journal) measured that bank: `radius localize --help` lacked `--json`, fixed at `ca0b4ea3a`.
- Version 6, after the audit: 94 items (families link-audit and verdict-audit) turn every cheat and missed bug into an item; the bank holds 2801 items. On main they add one more cause (selection in a parent forest follows authored order); the pilot fixed it at `b0a9ab634` (journal rows 7 and 8). The cheater and planted-bug checks have to run again on this bank.
- Version 6, levels 1 to 11 after the pilot: a full seed-1 run at `a5cfcfcd2` passes 2707 of 2707, level 13 (an earlier attempt failed on a full disk and is void).
- Version 6, the six product causes the new items found, each fixed on `exec/system-links-pilot` with a red-first test: mode P run positions in `localizeRuns`; `specIndex` of a block run out of authored order; forest ancestors in `localizeRows`; parent edges in `sectionSelection`; the `radius --mode` default leaking into `radius localize`; `driftbench help <command> <subcommand>`. They are not on main.

- CI before: run 38780677540 on `14034c6ca` reports 9 of 11 and no failure because `--check-floor` sets `maxLevel` to the floor. The log explicitly marks levels 10 and 11 not run for all four seeds. This is a configured cap, not a timeout.
- CI wiring: PR #504, `fix/system-validator-full-ci`, head `93da8da9c`, adds an independent full-system job. It runs seeds 1–3 and the commit-derived hidden seed with `--all-levels`, and requires exit 11. Existing floors and banks remain unchanged. Run 38785996109 is executing the full command.
- Product: PR #506, `feat/system-climb`, is stacked on #504 to receive that CI job. The full local seed-1 run passes after the store fix. Four-seed CI proof is pending; read the latest run, not the earlier queued head.
- PR #428: its actual `not_run`/`blocked` exit 3 rule does not conflict with the inspected budget-stop bank items (`stopped` still exits 1). Its head `654e676aa` has contradictory help tables: `core-exit-codes.md` says 3, `running-outcomes.md` still says 1. Reported to the owner; neither changed here.

## Hypotheses tried

Held: `putRunNow` reparses and validates the campaign, including all N spec references, for each of N stored runs. Detailed instrumentation of the unchanged campaign-growth item counted 8125020 spec entries, 755.807 ms CPU parsing campaign JSON, and 823.087 ms validating campaigns. With the fix these are 5240 entries, 0.680 ms and 5.383 ms. These totals include the validator's extra large-size retry before the fix, so they are diagnostic totals, not a fixed-work speedup ratio.

The fix retains only the last validated campaign's exact serialized row and its realized-text policy. Every write still queries current bytes. Changed rows are revalidated; corrupt/missing rows still fail; another connection's retention-policy change takes effect. Cache memory is bounded to one row and released on close.

The new regression fails before the fix (40 campaign validations for 40 writes) and passes after (one). The 65 selected store tests pass, covering file corruption, retention, bundles, races and ordinary writes. An independent read-only review found no defect in corruption handling, transaction rollback, policy changes or cache bounds.

Timing measurements, seed 1, fresh process per sample, unchanged item and threshold:

| Product | 200-cell best CPU ms | 2000-cell retained CPU ms | Growth | Verdict |
|---|---:|---:|---:|---|
| main 14034c6ca | 45.806 | 1273.469 | 27.8014 | fail |
| main 14034c6ca | 52.051 | 1320.010 | 25.3599 | fail |
| main 14034c6ca | 52.181 | 1291.403 | 24.7485 | pass |
| product fix | 41.406 | 916.735 | 22.1401 | pass |
| product fix | 44.343 | 938.694 | 21.1689 | pass |
| product fix | 43.259 | 895.543 | 20.7019 | pass |

The limit remains 25. The samples retain the bank's own rule: fastest of three medium samples, large-size retry only after exceeding the limit. The baseline varies across the limit on identical code. Report timing-sensitive failures with the samples; never loosen the item. Three additional uninstrumented post-fix runs pass.

## Next actions

1. Version 6: land the six product fixes of `exec/system-links-pilot` through their own reviewed PR, then measure levels 12 and 13 on main. Extend levels 12 and 13 (section 12.2) until a pilot cannot top them; the audit (section 12.7) is owed before merge.
2. Read the latest `system all 11 levels` CI job on #506. Require all four seed columns through level 11; if any item fails, reproduce its exact seed and fix the product.
3. Read #504's full-system result separately. Keep CI wiring and product changes in their separate PRs; retarget #506 to main when #504 merges.
4. After the final push, remove this job's node_modules and sole worktree. Do not remove another job's files or worktrees.

## Pitfalls

- Version 6: section ids written by `radius sections init` slug a heading's hyphens to underscores (`own-0-0` becomes `own_0_0`). A bank item that names a section the registry slugged passes vacuously; `localizeDifference` and the selection items now throw on a section the registry does not hold.
- Version 6: a child of a failing parent is blocked, not passing; a forest reference must leave it out of the rows (found by pilot iteration 3).

- A local seed-1 pass is not four-seed CI proof. The hidden seed changes with the checked-out commit, including GitHub's PR merge commit.
- `--check-floor` intentionally caps measurement at the floor, even with `--all-levels`. The full job uses a plain run and expects exit 11.
- Do not edit source during a system sweep: its CLI subprocesses read the worktree.
- Timing probes must run sequentially; instrumentation totals are not directly comparable when the item takes a different retry path. The table above uses the unchanged timing function, with a wrapper that records its returned CPU samples.
- Full local sweeps print MaxListeners warnings and a fixture's `fatal: not a git repository` diagnostic; inspect the report and exit code. Both measured seed-1 sweeps exit 11 with no failing item.
- Historical bank versions and earlier investigations remain in the append-only journals. They do not describe the current main or its current bank count.

## How to run

```sh
pnpm driftbench validate system --seeds 1..3 --hidden --all-levels --items --json > result.json
pnpm driftbench validate system --journal row.json
pnpm driftbench validate system --check-handover
```

A full pass exits 11, not 0. For one item, filter `systemBank()` by its exact id and call `runItem(item, seed, root, scratch)`. Do not edit the bank to select it.

## Fixtures

- `packages/validators/fixtures/system/bank-manifest.json`: item inventory.
- `packages/validators/fixtures/system/design.json`: Monte Carlo design.
- `packages/validators/src/ladders/system/bank/`: generated items; scale timing in `scale.ts`. Version 6: `links.ts`, `links-world.ts` (the reference Ochiai and the linked suite), `links-chain.ts` (the command-line chain) and `verdicts.ts` (not run and blocked).
- `examples/acme/faults/`: fault family; unchanged.
- `packages/store/test/campaign-write-scaling.test.ts`: product regression and policy/corruption checks.
