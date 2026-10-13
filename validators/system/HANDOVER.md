# Handover: validator system

Rewritten by the executor every iteration (docs/validators.md section 10). A stranger continues from this file alone. The level table is written by `driftbench validate system --journal <row.json>` from the last journal row.

## Level per seed

<!-- level-table:start -->
<!-- level-table:end -->

Bank version 5 (2383 items) has no journal row yet: its first full measurement is still to run, so the table is empty. The journals of earlier bank versions are kept as journal-v2.jsonl, journal-v3.jsonl and journal-v4.jsonl.

## Floor

None for system. The validator merges as a regression floor in the plain sense: its failing items name the defects still open, and a fix turns its items green. A numeric floor waits for the first full measurement of bank version 5.

## Open items

A file-by-file measurement on main e6f93d2d, after PRs 51, 53, 59 and 62, checked again every item that had failed (93 items, seeds 1, 2, 3 and 9999). 43 still fail, on every seed, under 29 distinct causes. Each failing item prints "asks: <capability>. found: <what came back>" and names its component; act on that line, the validator code is not needed. Open causes by package:

1. packages/core: 11 (two loader checks on perturbations, the recovery label, nonempty on null mappings, the cache key version label, the one-spec compounding interval, and a per-block cost that grows with the run in the loader, lint and three runner paths).
2. packages/cli: 9 (estate approve on a folder, estate lint and scan output, estate counts and "not built yet" pages that lag the commands, judge names, the floors line, campaign plan on an unknown adapter).
3. packages/store: 4 (bundle record hashes, units by date, a torn read during a replace, listRuns trusting hand-edited columns).
4. packages/adapters: 2 (the final line break of stdout, the session history shared with the Given).
5. packages/sandbox, packages/checks, packages/space: 1 each (a detached child surviving the agent, the plural "orders" word, the extract proposal as a space map).

Items that had never failed were not run again in this measurement; the first full run (Next actions) covers them.

## Hypotheses tried

Ten one-cause fixes were measured against bank version 3 on branch exec/system-pilot-v3 (journal-v3.jsonl rows 1 to 10): units by date, bundle hashes, plan on an unknown adapter, the cache key without the version label, the recovery label per docs/concepts/recovery.md, nonempty on null mappings, the process adapter's final line break and history copy, the plural order word, a store file cut inside its header. Every one held. The fixes live on that branch for their owners.

## Next actions

1. Run the first full measurement of bank version 5 on main: `pnpm driftbench validate system --seeds 1..20 --hidden --items --json > iter0.json`, then build and append its journal row (How to run).
2. Hand each failing item to the lane owning its component; the item's line is the task.
3. When the item set changes, regenerate packages/validators/fixtures/system/bank-manifest.json in a commit of its own.

## Pitfalls

* The hidden seed changes on every run, so a seed-dependent item can fail in one measurement and pass in the next. The pilot met one: the header-cut store item. Compare the failing lists of two runs, not only the counts.
* Run the measurement alone: `--items` runs every level on 21 seeds, about 8 minutes under load. Parallel jobs slow it.
* Under heavy load, packages/cli/test/validate.test.ts can time out at 5 seconds; it passes when run alone.
* Use files of your own, never /tmp/<common name>.
* The scale items time CPU, not wall time; the growth bound is 25 from ten to a hundred times the size.
* The variance family holds three Monte Carlo items; each can fail a correct chain on about 2 seeds in 1000 (packages/validators/fixtures/system/design.json).
* variance/design-effect-calibration plants 20 specs by 4 runs, always balanced, and truncates the correlation at zero itself. So it cannot see an ANOVA that is right on balanced data only, nor a correlation left negative: both give the verdicts of a correct implementation. Unbalanced data and the untruncated value need items of their own.
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
