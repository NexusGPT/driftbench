# Handover: validator system

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
| 1 | 7 |
<!-- level-table:end -->

Baseline on main a303a3f2 merged into codex/system-v3: bank version 5, 2384 items, 2355 passing, 29 failing, score 0.9878355704697986. Only seed 1 is complete. Do not extrapolate to other seeds. Older journals remain in journal-v2.jsonl, journal-v3.jsonl and journal-v4.jsonl.

Latest full measurement: source b83ea14d plus precompiled ledger patterns, bank version 5, seed 1 level 7, 2361 of 2384 passing (score 0.9903523489932886). Current-code coverage is 1 of 21 seeds. The earlier copy-only stage covers 5 of 21 at a different version and cannot be combined with this result.

## Floor

No system floor is set. A numeric floor requires the complete evidence for that ladder version.

## Open items

The current seed-1 report has one growth failure and 22 stale item expectations. Main includes the five estate-item rewrites from PR 114. The original baseline census is two real and 27 stale failures. The latest real failure is `scale/flow-blocks-teacher-forced/growth` (25.7 times), against the unchanged bound of 25. Free-running and replay growth pass this one seed; other seeds can still fail. The free-running growth item passes the baseline but can fail on a new timing.

Stale expectations cover the report's two rate intervals, four MDE assertions, extract proposal validation and map counts, select and holdout fixture counts, four mixed-suite golden comparisons, five estate output assertions and the pilot example totals. The executor does not edit any of them. The bank maintainer re-derives each assertion from current code or docs and retains its strength.

The current golden suite has nine conversations and one price-sheet task. Its documented run requires `--route flow:price-sheet=process:acme-ops`. The stale comparison items omit that route. The holdout secrecy item fails its old sealed-count conjunct, not its leakage assertion: the measured leaked-ID list is empty.

## Hypotheses tried

The function adapter copies every prior message body on each send, and teacher-forced sessions copy their entire canonical prefix on open. Red-first tests reproduce unread message access and teacher-forced growth, including an 80 times measurement and a seed-2 measurement of 58.1 times.

The committed snapshot fix preserves mutable `Message[]` callbacks and `structuredClone`: marked runner-owned prefixes can be borrowed; callbacks receive plain arrays that copy each message on first access. A read-only proxy is an explicit helper, never the callback default. The copy-only five-seed sweep completes 5 of 21 seeds, with levels 2, 2, 7, 2, 2 and 2351 of 2384 items passing every completed seed (score 0.9861577181208053). All three growth paths still fail at least one seed. A later compatibility test run also fails teacher-forced seed 2 at 29.5 times. Do not claim the history work complete before measurement.

Profiling the remaining free-running growth identifies repeated native hash updates over the whole prefix. The cache-key head changes per block, so the incremental digest cannot reuse that head. A new red-first test verifies the unchanged canonical digest but observes 802 native updates for 800 messages. Bulk canonical-text hashing is committed as 0d1dda8f. It passes the exact-digest and native-update tests, but the whole seed-1 report still fails teacher-forced and replay growth. Iteration 3 precompiles only the two anchored non-global ledger contact patterns. Its red-first test observes 4004 constructions for 400 prior contacts, and the fix retains identical contradictions. The whole seed-1 report passes 2361/2384, with teacher-forced growth still 25.7 against 25.

A new regression test exposes a bulk-hash compatibility defect: a new hash head on the same mutable array reuses old canonical text after the array grows. Keep PR 118 draft until this digest regression is repaired and exact digest tests pass.

## Next actions

1. Time the exact system-floor test on main and this branch without changing its 600-second limit. Isolate repeated nested stats cost and ship the cache to main separately if it is the lever. Repair the new mutable-array hash regression before PR 118 leaves draft.
2. Fix unmatched digit-only hash prefixes in the store. The regression suite has two red cases and one passing version-number-priority case. Staged seed 4 demonstrates prefix 456042. Preserve ambiguity errors and existing numeric-version priority.
3. PR 118 now targets main and stays draft until its current-head CI passes; then remove draft status for the auto-merger. PR 130 is merged into main as ab0de699 and carries only the selection fix. PR 128 targets main for the remaining 22 stale items. Merge its approved bank changes at a measurement boundary; the executor never edits them. Run the final first five seeds, report N of 21, then remaining seeds only before 06:00 local.

## Pitfalls

* No paid model calls, no git stash, no secrets, no bank edits. Commit trailer: Co-Authored-By: GPT-6.1 Sol (Codex) <noreply@openai.com>. <!-- guard:allow public commit attribution address -->
* Vitest uses `--maxWorkers=2`; typecheck and lint must pass before each push.
* The owner stages sweeps: seed 1 plus four more first; report completed seeds as N of 21. Run remaining seeds only while time remains before 06:00 local. The work ends at 07:00 local or 100 percent.
* Nested stats measurements are cached by stats revision and seed only within one sweep. Dirty stats/bank code measures fresh. Disclose cache use and verify fresh/cached report equality.
* The scale bank times CPU and keeps the minimum of repeated timings. One green micro-run is insufficient when another run fails the bound.
* The owner skips the local estate-floor rerun: 616 seconds against 600 seconds at host load 150 is judged by CI. Do not raise the timeout.
* PR 74 and PR 114 are merged. Both executor branches include main 40aab095 after PR 131. New pushes create fresh CI; cancelled runs are not rerun. The public commit-attribution address has a scoped guard:allow marker; keep it when editing this handover.

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
