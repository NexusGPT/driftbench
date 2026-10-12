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

The level is 0 on every seed: level 1 (records) still holds failing items. Bank version 3, 1280 items. After pilot iteration 10 (branch exec/system-pilot-v3), 1265 pass on every seed and 15 fail, with 15 distinct causes. On lane/v-system, which does not carry the pilot fixes, 1244 pass (iteration 0).

## Floor

None yet for system; `pnpm driftbench validate floors` prints the floors. The level is 0 until the records level is clean, so no floor above 0 holds.

## Open items

Each failing item prints "asks: <capability>. found: <what came back>" and names its component. Act on that line; the validator code is not needed. One cause per item, one fix per iteration:

1. packages/core/src/spec/semantics.ts: the loader reports COUNT_RANGE_INVALID on a count range under expect.subagents, as it does for the other counts (claim/spec/issue/count-range-subagents).
2. packages/core/src/spec/semantics.ts: a perturbation inserted before block k runs before block k sets its given.ledger, so its knowledge_retention fact is checked against the ledgers of the blocks before k only; an unknown fact gives RETENTION_FACT_UNKNOWN (claim/spec/issue/retention-perturbation-before-block-given).
3. packages/core/src/spec/semantics.ts: a world-only perturbation (no user turn) needs a block at inject_at to carry it; inject_at equal to the block count is a load error (claim/concepts/perturbation/world-only-needs-block).
4. packages/store/src/store.ts: getRun reads the run row and its block rows inside one read transaction, so a reader racing a replace never mixes two versions (claim/adapters/store-torn-read-during-replace).
5. packages/store/src/store.ts: listRuns filtered by status checks the status of the record it read, so a hand-edited status column never returns a run of another status (claim/adapters/store-hand-edit-status-column).
6. packages/store/src/registry.ts: a dataset ref name@<hex prefix> resolves when the prefix has only digits (fails on 3 of 21 seeds, the ones whose hash starts with six digits) (claim/cli/dataset/ref-forms).
7. packages/sandbox/src/run.ts: at the timeout the sandbox also kills a child the agent started in its own process group (claim/adapters/process/timeout-kills-detached-child).
8. packages/core/src/runner/compounding.ts: the overall compounding index clusters by spec, so a campaign of one spec gets no interval, whatever its targets (claim/report/compounding-one-spec).
9. packages/report/src/reliability.ts: every pass^k and pass@k interval contains its own point value; today pass^3 of 0 (c 2 of n 3) prints an interval starting at 0.009 (claim/report/line-pass-k-inside).
10. packages/space/src/load.ts: the space map loader accepts the proposal `extract` writes (its evidence and produced_by keys, its version) as a map, as cli.md says (claim/cli/extract/proposal-is-space-map). If the owner prefers, change the cli.md sentence instead; generating.md routes the space commands through `extract map`.
11. to 15. The per-block cost grows with the run size (time from ten to a hundred times the size grows more than 25 times):
    * packages/core/src/spec/load.ts (scale/loader-blocks/growth, 52 times),
    * packages/core/src/spec/lint.ts (scale/lint-blocks/growth, 61 times),
    * packages/core/src/runner/run.ts (scale/flow-blocks/growth, 43 times),
    * packages/core/src/runner/given.ts (scale/flow-blocks-teacher-forced/growth, 47 times),
    * packages/core/src/runner/cache.ts (scale/flow-blocks-replayed/growth, 39 times).
    The runner hashes the whole history on every block for the cache key and the Given; the loader and lint walk every earlier block per block. Make each per-block step independent of the run length.

## Hypotheses tried

Pilot v3 (journal rows 1 to 10, branch exec/system-pilot-v3), one cause each, every one held:

1. The store keeps a cost unit put later only when it is measured later (store/units-latest).
2. A campaign bundle records the hash of every record and refuses one edited after the export (store/bundle-tampered).
3. campaign plan exits 2 on a target with no adapter (cli/plan/unknown-adapter).
4. The cache key leaves out the spec version label (replay/key/version-label, claim/concepts/modes/cache-version-label).
5. The recovery label follows docs/concepts/recovery.md: immediate when turnsToRecover is at most within_blocks (11 items).
6. nonempty treats a mapping whose keys all hold null as empty (claim/checks/assert/nonempty-null-mapping).
7. The process adapter strips only the final line break of stdout.
8. The process adapter deep-copies the prefix into the session history.
9. classifyTool reads "orders", plural, as the order word.
10. openStore refuses a non-empty file shorter than the 100-byte SQLite header with OPEN_FAILED.

Three items were wrong and were corrected in the bank, each in a commit of its own: the glob `?` item (seed 10 named a two-character file), and two report recovery items that computed the old label rule.

## Next actions

1. Fix open item 1 (COUNT_RANGE_INVALID on expect.subagents) in packages/core/src/spec/semantics.ts and measure.
2. Fix open item 4 (one read transaction in getRun) in packages/store/src/store.ts and measure.
3. Fix open item 9 (pass^k interval holds its point) in packages/report/src/reliability.ts and measure.

## Pitfalls

* The hidden seed changes on every run, so a seed-dependent item can fail in one measurement and pass in the next. The pilot met one: the header-cut store item. Compare the failing lists of two runs, not only the counts.
* Run the measurement alone: `--items` runs every level on 21 seeds, about 8 minutes under load. Parallel jobs slow it.
* Under heavy load, packages/cli/test/validate.test.ts can time out at 5 seconds; it passes when run alone.
* Use files of your own, never /tmp/<common name>.
* The scale items time CPU, not wall time; the growth bound is 25 from ten to a hundred times the size.
* The variance family holds three Monte Carlo items; each can fail a correct chain on about 2 seeds in 1000 (packages/validators/fixtures/system/design.json).
* An item that is wrong is the maintainer's to fix, in a commit of its own on a non-executor branch, never the executor's.
* docs/concepts/*.md is the contract the bank follows; docs/running.md and cli.md lag in places (cli.md still says report, compare and ci are not built).

## How to run

```
pnpm driftbench validate system --seeds 1..20 --hidden --items --json > after.json
pnpm -s exec tsx packages/validators/src/ladders/system/journal-row.ts --before before.json --after after.json --iteration <n> --hypothesis "<one sentence>" --files a,b --commit <sha> --model sonnet > row.json
pnpm driftbench validate system --journal row.json
pnpm driftbench validate system --hardness
```

Run one item family on one seed while you work: filter `systemBank()` from packages/validators/src/ladders/system/bank/index.ts by id prefix and call `runItem(item, seed, root, scratch)`.

The ladder is registered in packages/validators/src/ladders/index.ts (a root file).

## Fixtures

* packages/validators/fixtures/system/bank-manifest.json: every item (id, family, tier, level, source, component, cause); a test compares it with the bank.
* packages/validators/fixtures/system/design.json: the design point of the Monte Carlo items.
* The fault family: examples/acme/faults, read through the gate's importFaultSet; the operator per class is OPERATORS in packages/validators/src/ladders/system/family.ts.
* Everything else is generated from the seed under packages/validators/src/ladders/system/bank/ (claims under bank/claims/).
