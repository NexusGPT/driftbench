# Handover: validator system

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
| 1 | 2 |
<!-- level-table:end -->

Baseline on main a303a3f2 merged into codex/system-v3: bank version 5, 2384 items, 2355 passing, 29 failing, score 0.9878355704697986. Only seed 1 is complete. Do not extrapolate to other seeds. Older journals remain in journal-v2.jsonl, journal-v3.jsonl and journal-v4.jsonl.

## Floor

No system floor is set. A numeric floor requires the complete evidence for that ladder version.

## Open items

The baseline has two real growth failures and 27 stale item expectations. The real failures are `scale/flow-blocks-teacher-forced/growth` (30.1 times) and `scale/flow-blocks-replayed/growth` (31.2 times), against the unchanged bound of 25. The free-running growth item passes the baseline but can fail on a new timing.

Stale expectations cover the report's two rate intervals, four MDE assertions, extract proposal validation and map counts, select and holdout fixture counts, four mixed-suite golden comparisons, five estate output assertions and the pilot example totals. The executor does not edit any of them. The bank maintainer re-derives each assertion from current code or docs and retains its strength.

The current golden suite has nine conversations and one price-sheet task. Its documented run requires `--route flow:price-sheet=process:acme-ops`. The stale comparison items omit that route. The holdout secrecy item fails its old sealed-count conjunct, not its leakage assertion: the measured leaked-ID list is empty.

## Hypotheses tried

The function adapter copies every prior message body on each send, and teacher-forced sessions copy their entire canonical prefix on open. Red-first tests reproduce unread message access and teacher-forced growth, including an 80 times measurement and a seed-2 measurement of 58.1 times.

The pending fix preserves mutable `Message[]` callbacks and `structuredClone`: marked runner-owned prefixes can be borrowed; callbacks receive plain arrays that copy each message on first access. A read-only proxy is an explicit helper, never the callback default. The copy-only five-seed sweep completes 5 of 21 seeds, with levels 2, 2, 7, 2, 2 and 2351 of 2384 items passing every completed seed (score 0.9861577181208053). All three growth paths still fail at least one seed. A later compatibility test run also fails teacher-forced seed 2 at 29.5 times. Do not claim the history work complete before measurement.

Profiling the remaining free-running growth identifies repeated native hash updates over the whole prefix. The cache-key head changes per block, so the incremental digest cannot reuse that head. A new red-first test verifies the unchanged canonical digest but observes 802 native updates for 800 messages. The next distinct mechanism is bulk canonical-text hashing for a new head.

## Next actions

1. Check CI for the selection-allocation fix in PR 118, prioritized by the owner because the Node 24 failure blocks PR 74. Its allocation regression is red before and green after; all 36 selection tests pass and ten Node 24 probes have maximum growth 27.94 against 40. The five-seed prefix-copy sweep is journaled as iteration 1, a failed experiment. It loaded selection code before this fix. PR 130 carries the selection-only cherry-pick into main. After PR 131 merges, merge main into both branches and push new heads; never rerun the cancelled jobs.
2. Fix the native hash-update growth with the existing red-first test; preserve exact canonical cache keys. Measure seed 1 and journal it separately.
3. Estate and pilot docs are corrected with red-first tests. Recheck detached-child cleanup after merging main, then fix digit-only hash prefixes: staged seed 4 mistakes hash prefix 456042 for a version. Coordinate all stale expectations with the maintainer.

## Pitfalls

* No paid model calls, no git stash, no secrets, no bank edits. Commit trailer: Co-Authored-By: GPT-6.1 Sol (Codex) <noreply@openai.com>. <!-- guard:allow public commit attribution address -->
* Vitest uses `--maxWorkers=2`; typecheck and lint must pass before each push.
* The owner stages sweeps: seed 1 plus four more first; report completed seeds as N of 21. Run remaining seeds only while time remains before 06:00 local. The work ends at 07:00 local or 100 percent.
* Nested stats measurements are cached by stats revision and seed only within one sweep. Dirty stats/bank code measures fresh. Disclose cache use and verify fresh/cached report equality.
* The scale bank times CPU and keeps the minimum of repeated timings. One green micro-run is insufficient when another run fails the bound.
* The owner skips the local estate-floor rerun: 616 seconds against 600 seconds at host load 150 is judged by CI. Do not raise the timeout.
* PR 74 remains red on the Node 24 golden-cover growth test. PR 118 is this executor's draft into lane/v-system. PR 114 is the separate estate-item maintainer PR, with all checks green at the last check.

## How to run

```
pnpm driftbench validate system --seed 1 --items --json > before.json
pnpm driftbench validate system --seeds 1..5 --items --json > staged.json
pnpm -s exec tsx packages/validators/src/ladders/system/journal-row.ts --before before.json --after staged.json --iteration <n> --hypothesis "<one cause>" --files a,b --commit <sha> --model codex > row.json
pnpm driftbench validate system --journal row.json
pnpm exec vitest run <tests> --maxWorkers=2
pnpm typecheck
pnpm lint
```

The journal-row helper's default command names the full 21-seed sweep. Correct that field to the command actually run before appending a partial-sweep row. Never claim unmeasured seeds.

## Fixtures

The unchanged bank is packages/validators/src/ladders/system/bank. Its manifest is packages/validators/fixtures/system/bank-manifest.json. The maintainer alone changes items and regenerates the manifest. The executor changes component source, tests, docs, research, journal and this handover.
