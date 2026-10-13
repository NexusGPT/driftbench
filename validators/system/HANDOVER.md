# Handover: validator system

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
| 1 | 10 |
| 2 | 11 |
| 3 | 10 |
| 4 | 10 |
| 5 | 11 |
| 6 | 11 |
| 7 | 10 |
| 8 | 11 |
| 9 | 11 |
| 10 | 10 |
| 11 | 11 |
| 12 | 11 |
| 13 | 11 |
<!-- level-table:end -->

Journal iteration 10 records the owner-stopped partial baseline at source e945dc9a8cd838169332166076538ebfc10c1286. Coverage is 13 of 21 seeds. Partial seed 14 is excluded. Seeds 14 through 20 and the hidden seed are unmeasured at this source. The source includes main 71c26039. This checkpoint claims no component-fix improvement.

| Seed | Passing |
|---|---|
| 1 | 2383/2384 |
| 2 | 2384/2384 |
| 3 | 2383/2384 |
| 4 | 2383/2384 |
| 5 | 2384/2384 |
| 6 | 2384/2384 |
| 7 | 2383/2384 |
| 8 | 2384/2384 |
| 9 | 2384/2384 |
| 10 | 2382/2384 |
| 11 | 2384/2384 |
| 12 | 2384/2384 |
| 13 | 2384/2384 |

The bank has 2384 items. Across all 13 complete seeds, 2382 items pass every seed. Teacher-forced growth fails seeds 1, 3, 7 and 10; free-running growth fails seeds 4 and 10. Every other item passes these complete seeds. The unchanged growth bound is 25.

Evidence: /private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad/codex/system-measurements/pr118-merge-e945dc9a/report.json, individual seed JSON files, source.json, progress.jsonl and stats-cache.jsonl. The sequential sweep uses a single statistics measurement cache and caps nested statistics workers at two. Cached reports retain the hashes of their fresh results. The baseline is stopped, not resumable as a fixed-code result.

## Floor

System bank version 5 has floor 7. This executor does not change the floor. A floor increase requires a separate authorized change with all 21 measured seeds.

## Open items

The current branch has three separately committed component fixes after the partial baseline: suffix-only canonical registration (353ab983), short-circuit ledger evidence (dc65181b), and lazy ledger-history collection (1050ce7c). No full bank result is yet attributed to these changes.

Five cold Node 22.23.3 seed-2 repetitions after all three changes pass: 17.5835, 19.7989, 21.7793, 18.2166 and 13.4983. Reproducing the existing unit-test order, seed 1 before seed 2, passes only two of five: 30.1565, 18.5922, 18.2517, 33.6543 and 26.8932. Earlier broader core-suite runs expose ratios 31.4 and 37.9. These are growth-item measurements, not complete seeds. Growth remains unresolved. The owner has requested an independent design review and stopped new copy experiments until its findings arrive.

Main 086b6003, including PR 180's revert of PR 176, is merged as 7fca5894. The executor neither duplicates nor depends on the seed-7167 calibration change. Main's separate escalation.ts union type error awaits fix/escalation-ledger-union through PR 185. Do not patch that file here. The final sweep starts only after main is green and the five-repeat growth gate holds.

## Hypotheses tried

- Real cost: copying histories of 40, 400 and 4000 messages performs 40, 400 and 4000 template lookups, field definitions and message allocations. CPU noise does not explain those operation counts.
- Timing noise: five fresh pre-fix Node 22 seed-2 ratios are 15.9927, 22.8549, 23.2232, 27.4063 and 17.5487. The spread crosses 25. Five Node 24 ratios are 21.9487, 22.5994, 9.1237, 15.1244 and 9.3676. Node 22 CI at e945dc9a fails the same item at 27.6.
- Canonical registration: the red test sees 402 old/new message visits when a 400-message prefix grows by two. The committed fix visits only the two new messages. Public snapshots, prefix overrides, repeated/backward requests, mutable callbacks and structuredClone stay compatible. This change alone passes only four of five Node 22 repeats.
- Ledger evidence: red tests read 80/800 content fields at history lengths 40/400. Current-contact replies need only the first older alternative, and replies without contact values need no history. Fixed reads are 2/2 and 0/0 respectively. Checked facts and contradiction order are preserved.
- Runner history collection: red tests visit 1600/160000 message slots over 40/400 blocks for a reply needing no ledger history. A restartable iterable reduces both to zero. All 26 ledger and drift checks pass.
- Rejected private experiments: literal message factories, bulk descriptor construction, and deferred nested-message slots do not establish CPU headroom. Deferred slots pass 79 compatibility tests but only two of five Node 22 growth repetitions. A separate shared-accessor candidate passes 437 cases with two skips but still fails growth at 32.0. All rejected source/test edits are removed from the branch. The unchanged callback contract remains a mutable plain array.

Earlier iterations and their source-specific scores remain in journal.jsonl, journal-v2.jsonl, journal-v3.jsonl and journal-v4.jsonl. Their measurements cannot be combined with this partial baseline or the pending final sweep.

## Next actions

1. Wait for the independent design review before another copy experiment. Keep callback mutability unchanged unless the owner authorizes a change. Merge green current main after PR 185 lands. Keep both CHANGELOG sides. Run rename-scope, typecheck, lint and strict executor protection. Do not fix the upstream judge file here.
2. Freeze the source and run one full sequential sweep of seeds 1 through 20 plus its commit-derived hidden seed, with nested statistics workers capped at two. Record all seed levels and pass counts. Do not restart the stopped baseline.
3. Append the measured result to the journal, rewrite this handover, push PR 118, and verify every check is green and GitHub reports MERGEABLE. Log item defects here; never edit the bank or its limits.

## Pitfalls

- Never git stash, never print or commit keys, fictional data only, and no em or en dashes in repo prose.
- Use 2>&1 for command diagnostics and vitest --maxWorkers=2. No simultaneous sweeps.
- The CLI has no --jobs option. The owner confirms sequential execution. The external two-worker-sweep.mts wrapper caps nested workers without editing validator code.
- Only validators/system/HANDOVER.md and appended journal.jsonl rows are authorized here. The CI protected-path list also covers validator source, fixtures, tests, floors, EXECUTOR.md, fault fixtures, statistics references and the validator workflow.
- The journal schema requires measured before levels. Do not invent zeroes for seeds missing from the partial baseline. Report the complete final sweep separately from its comparable before/after seed subset.
- Commit trailer: Co-Authored-By: GPT-6.1 Sol (Codex) <noreply@openai.com>. <!-- guard:allow public commit attribution address -->

## How to run

```sh
pnpm driftbench validate system --help 2>&1
pnpm exec tsx <scratchpad>/system-measurements/two-worker-sweep.mts <new-output-folder> 2>&1
pnpm exec vitest run <tests> --maxWorkers=2 2>&1
node tools/rename-scope.mjs 2>&1
pnpm typecheck 2>&1
pnpm lint 2>&1
pnpm -s driftbench validate protect --branch exec/system-safety-check --base origin/main 2>&1
pnpm driftbench validate system --check-handover 2>&1
```

The wrapper delegates to the unchanged SDK runSeeds full-bank path for each seed, records source identity before/after each seed, and writes individual and aggregate reports. Set DRIFTBENCH_STATS_SWEEP_LOG to the output folder's stats-cache.jsonl to retain cache evidence. The source must stay frozen during the sweep.

## Fixtures

The bank is packages/validators/src/ladders/system/bank. Its manifest is packages/validators/fixtures/system/bank-manifest.json. Only the maintainer changes either. Incoming main changes are retained by merging; the executor adds no edits under protected paths.
