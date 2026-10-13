# Handover: validator system

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
| 1 | 7 |
<!-- level-table:end -->

Baseline on main a303a3f2 merged into codex/system-v3: bank version 5, 2384 items, 2355 passing, 29 failing, score 0.9878355704697986. Only seed 1 is complete. Do not extrapolate to other seeds. Older journals remain in journal-v2.jsonl, journal-v3.jsonl and journal-v4.jsonl.

Latest committed measurement: source 35f5be32 (iteration 3, precompiled ledger patterns), bank version 5, seed 1 level 7, 2361 of 2384 passing (score 0.9903523489932886). Current-code coverage is 1 of 21 seeds. The earlier copy-only stage covers 5 of 21 at a different version and cannot be combined with this result.

## Floor

No system floor is set. The owner authorizes an initial floor from the measured main minimum on completed visible and hidden seeds. A further rise requires all 21 seeds. The floor evidence is separate from this branch journal.

## Open items

The current seed-1 report has one growth failure and 22 stale item expectations. The committed bank includes the five maintainer estate-item rewrites. The original baseline census is two real and 27 stale failures. The latest real failure is `scale/flow-blocks-teacher-forced/growth` (25.7 times), against the unchanged bound of 25. Free-running and replay growth pass this one seed; other seeds can still fail. The free-running growth item passes the baseline but can fail on a new timing.

Stale expectations cover the report's two rate intervals, four MDE assertions, extract proposal validation and map counts, select and holdout fixture counts, four mixed-suite golden comparisons and the pilot example totals. The executor does not edit any of them. The bank maintainer re-derives each assertion from current code or docs and retains its strength.

The current golden suite has nine conversations and one price-sheet task. Its documented run requires `--route flow:price-sheet=process:acme-ops`. The stale comparison items omit that route. The holdout secrecy item fails its old sealed-count conjunct, not its leakage assertion: the measured leaked-ID list is empty.

## Hypotheses tried

The function adapter copies every prior message body on each send, and teacher-forced sessions copy their entire canonical prefix on open. Red-first tests reproduce unread message access and teacher-forced growth, including an 80 times measurement and a seed-2 measurement of 58.1 times.

The committed snapshot fix preserves mutable `Message[]` callbacks and `structuredClone`: marked runner-owned prefixes can be borrowed; callbacks receive plain arrays that copy each message on first access. A read-only proxy is an explicit helper, never the callback default. The copy-only five-seed sweep completes 5 of 21 seeds, with levels 2, 2, 7, 2, 2 and 2351 of 2384 items passing every completed seed (score 0.9861577181208053). All three growth paths still fail at least one seed. A later compatibility test run also fails teacher-forced seed 2 at 29.5 times. Do not claim the history work complete before measurement.

Profiling the remaining free-running growth identifies repeated native hash updates over the whole prefix. The cache-key head changes per block, so the incremental digest cannot reuse that head. A new red-first test verifies the unchanged canonical digest but observes 802 native updates for 800 messages. Bulk canonical-text hashing is committed as 0d1dda8f. It passes the exact-digest and native-update tests, but the whole seed-1 report still fails teacher-forced and replay growth. Iteration 3 precompiles only the two anchored non-global ledger contact patterns. Its red-first test observes 4004 constructions for 400 prior contacts, and the fix retains identical contradictions. The whole seed-1 report passes 2361/2384, with teacher-forced growth still 25.7 against 25.

The committed digest tests are packages/core/test/hash-list.test.ts: exact canonical parity and native update cost. They do not yet cover a mutable array with a changed hash head. The tests and prefix-text candidate for that next cause are local, not pushed, as listed below.

## Next actions

1. Start with packages/core/src/spec/hash.ts. Complete the canonical-prefix-text cause and mutable-array digest repair, measure seed 1, then commit its tests and fix together. Current local work is listed below; none is part of 35f5be32.
2. Fix unmatched digit-only hash prefixes in packages/store/src/store.ts. The local, not pushed test packages/store/test/registry-ref.test.ts reproduces prefix 456042 and ambiguity, and checks existing version-number priority. Measure before committing the tests with the fix.
3. Finish the main floor-test cap and its separately measured system v5 floor. Merge approved maintainer bank changes only at a measurement boundary. Run the final first five seeds, report N of 21, then remaining seeds only before 06:00 local. Leave the bank unchanged.

## Pitfalls

* No paid model calls, no git stash, no secrets, no bank edits. Commit trailer: Co-Authored-By: GPT-6.1 Sol (Codex) <noreply@openai.com>. <!-- guard:allow public commit attribution address -->
* Vitest uses `--maxWorkers=2`; typecheck and lint must pass before each push.
* The owner stages sweeps: seed 1 plus four more first; report completed seeds as N of 21. Run remaining seeds only while time remains before 06:00 local. The work ends at 07:00 local or 100 percent.
* Nested stats measurements are cached by stats revision and seed only within one sweep. Dirty stats/bank code measures fresh. Disclose cache use and verify fresh/cached report equality.
* The scale bank times CPU and keeps the minimum of repeated timings. One green micro-run is insufficient when another run fails the bound.
* The owner skips the local estate-floor rerun: 616 seconds against 600 seconds at host load 150 is judged by CI. Do not raise the timeout.
* This branch includes main 40aab095. New pushes create fresh CI; cancelled runs are not rerun. The public commit-attribution address has a scoped guard:allow marker; keep it when editing this handover.

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


## Local work, not pushed

These changes exist only in the local codex/system-v3 worktree at this handover update. The untracked tests appear only there. A fresh checkout has none of these changes. They are not accepted measurements or committed regression coverage.

* packages/core/src/spec/hash.ts: local, not pushed canonical-prefix-text candidate.
* packages/core/test/canonical-prefix-cost.test.ts: local, not pushed red-first prefix-cache cost test.
* packages/core/test/mutable-list-hash.test.ts: local, not pushed red-first mutable-array digest test. It is not in packages/core/test/hash-list.test.ts.
* packages/store/test/registry-ref.test.ts: local, not pushed prefix 456042, numeric-version priority and ambiguous-prefix cases. No associated store fix is committed on this branch.
* validators/system/research.md: local, not pushed research entry for the prefix-text candidate.

## Pull requests, as of

As of 2026-10-13 02:28 CEST: GitHub reports PR 118 open and draft at 35f5be32, targeting main; PR 128 open at c0b5785d, targeting main; PR 130 merged into main; PR 137 open at 9d18fbec, targeting main. These are dated GitHub observations, not journal results. Recheck their current heads and CI before acting.
