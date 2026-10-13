# Handover: validator system

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
| 1 | 7 |
<!-- level-table:end -->

Baseline on main a303a3f2 merged into codex/system-v3: bank version 5, 2384 items, 2355 passing, 29 failing, score 0.9878355704697986. Only seed 1 is complete. Do not extrapolate to other seeds. Older journals remain in journal-v2.jsonl, journal-v3.jsonl and journal-v4.jsonl.

Latest committed measurement: source e1d6cb6d (iteration 5, unused block cache keys), bank version 5, seed 1 level 7, 2362 of 2384 passing (score 0.9907718120805369). All scale items pass seed 1. The same source completes a five-seed stage, with levels 7,7,7,7,7 and 2359 of 2384 passing every completed seed (score 0.989513422818792). Coverage is 5 of 21 at this source, with no extrapolation. The journal compares seed 1 with the previous seed-1 result; the other four have no same-source before measurement. Older stages at different versions cannot be combined with this result.

Iteration 6, source 5b628263: seed 1 stays level 7, with 2361/2384 passing (score 0.9903523489932886), 1 of 21 at this source. Free-running growth is 28.6 against 25; teacher-forced and replay pass. This result supersedes the seed-1 score above, not its separate five-seed coverage. The growth work remains incomplete.

## Floor

No system floor is set on this branch yet. PR 143 has merged the initial floor into main; merge it at the next measurement boundary. Main c43c8e96 reaches level 7 on visible seeds 1 through 5 and commit-derived hidden seed 293302998: 6 of 21 stopping runs. That minimum justifies the owner-authorized initial system v5 floor of 7 in a separate main change. Further rises require all 21 seeds. Floor evidence is separate from this branch journal.

## Open items

The current seed-1 report has 22 stale item expectations and one free-running scale failure. Across the five-seed stage, free-running growth fails seed 3 at 30.5 and teacher-forced growth fails seed 4 at 38.6, against the unchanged bound of 25. Seed 4 also fails claim/cli/dataset/ref-forms for numeric hash prefix 456042. Replay growth passes all five completed seeds. The committed bank includes the five maintainer estate-item rewrites. The original baseline census is two real and 27 stale failures.

Stale expectations cover the report's two rate intervals, four MDE assertions, extract proposal validation and map counts, select and holdout fixture counts, four mixed-suite golden comparisons and the pilot example totals. The executor does not edit any of them. The bank maintainer re-derives each assertion from current code or docs and retains its strength.

The current golden suite has nine conversations and one price-sheet task. Its documented run requires `--route flow:price-sheet=process:acme-ops`. The stale comparison items omit that route. The holdout secrecy item fails its old sealed-count conjunct, not its leakage assertion: the measured leaked-ID list is empty.

## Hypotheses tried

The function adapter copies every prior message body on each send, and teacher-forced sessions copy their entire canonical prefix on open. Red-first tests reproduce unread message access and teacher-forced growth, including an 80 times measurement and a seed-2 measurement of 58.1 times.

The committed snapshot fix preserves mutable `Message[]` callbacks and `structuredClone`: marked runner-owned prefixes can be borrowed; callbacks receive plain arrays that copy each message on first access. A read-only proxy is an explicit helper, never the callback default. The copy-only five-seed sweep completes 5 of 21 seeds, with levels 2, 2, 7, 2, 2 and 2351 of 2384 items passing every completed seed (score 0.9861577181208053). All three growth paths still fail at least one seed. A later compatibility test run also fails teacher-forced seed 2 at 29.5 times. Do not claim the history work complete before measurement.

Profiling the remaining free-running growth identifies repeated native hash updates over the whole prefix. The cache-key head changes per block, so the incremental digest cannot reuse that head. A new red-first test verifies the unchanged canonical digest but observes 802 native updates for 800 messages. Bulk canonical-text hashing is committed as 0d1dda8f. It passes the exact-digest and native-update tests, but the whole seed-1 report still fails teacher-forced and replay growth. Iteration 3 precompiles only the two anchored non-global ledger contact patterns. Its red-first test observes 4004 constructions for 400 prior contacts, and the fix retains identical contradictions. The whole seed-1 report passes 2361/2384, with teacher-forced growth still 25.7 against 25.

Iteration 4 commits the prefix-text implementation with packages/core/test/canonical-prefix-cost.test.ts and packages/core/test/mutable-list-hash.test.ts. Its red-first tests observe 402 cache lookups and an incorrect digest after a mutable array grows. Eleven hash, cache and growth tests pass after the fix. The full bank still has teacher-forced growth at 45.6 against 25, so the growth work is incomplete.

Iteration 5 commits packages/core/test/runner/uncached-key-cost.test.ts with the conditional cache-key fix as e1d6cb6d. Two uncached-mode tests fail before the fix; all three cache-work cases pass afterward, including unchanged cached/replay key identity. A broader test run has 88 passing cases and a seed-2 growth failure at 25.4. The full five-seed bank accepts the same seed 2 timing, but the seed 3 and seed 4 failures above mean the history growth work remains incomplete.

## Next actions

1. Merge main after PR 128 lands, run node tools/rename-scope.mjs, typecheck and remeasure seed 1. Report any remaining red item. For the remaining shared growing-history cause, the first file is packages/core/src/contracts/history.ts. Keep mutable plain arrays and structuredClone compatibility. The earlier private hybrid-copy and copied-runner timings are withdrawn: CommonJS copies duplicated the ownership marker. Repeat private probes as ESM before judging them.
2. Fix unmatched digit-only hash prefixes in packages/store/src/store.ts. The local, not pushed test packages/store/test/registry-ref.test.ts reproduces prefix 456042 and ambiguity, and checks existing version-number priority. Commit its red-first tests with its fix after measurement.
3. Finish the separate system v5 floor PR, then run the final first five seeds, report N of 21, and run remaining seeds only before 06:00 local. Leave the bank unchanged.


## Pitfalls

* No paid model calls, no git stash, no secrets, no bank edits. Commit trailer: Co-Authored-By: GPT-6.1 Sol (Codex) <noreply@openai.com>. <!-- guard:allow public commit attribution address -->
* Vitest uses `--maxWorkers=2`; after each main merge run `node tools/rename-scope.mjs`, then typecheck and lint before pushing.
* The owner stages sweeps: seed 1 plus four more first; report completed seeds as N of 21. Run remaining seeds only while time remains before 06:00 local. The work ends at 07:00 local or 100 percent.
* Nested stats measurements are cached by stats revision and seed only within one sweep. Dirty stats/bank code measures fresh. Disclose cache use and verify fresh/cached report equality.
* The scale bank times CPU and keeps the minimum of repeated timings. One green micro-run is insufficient when another run fails the bound.
* The owner skips the local estate-floor rerun: 616 seconds against 600 seconds at host load 150 is judged by CI. Do not raise the timeout.
* This branch includes main 14225a2a. The namespace codemod changes zero files; typecheck and lint pass before pushing. New pushes create fresh CI; cancelled runs are not rerun. The public commit-attribution address has a scoped guard:allow marker; keep it when editing this handover.

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

* packages/store/src/store.ts: local, not pushed numeric-ref fallback after a missing version-number lookup. The full seed-1 measurement is in flight; no associated store fix is committed on this branch.
* packages/store/test/registry-ref.test.ts: local, not pushed prefix 456042, full digit-only dataset and prompt hashes, numeric-version priority and ambiguous-prefix cases. Four cases fail before the local fix; all five pass afterward.
* validators/system/research.md: local, not pushed digit-only registry-prefix research entry, naming the code and doc sources, red-first evidence and proposed fallback.

## Pull requests, as of

As of 2026-10-13 04:35 CEST: GitHub reports PR 118 open and draft at 39340a7c, targeting main; its Node 22 growth check fails 27.5 against 25 and Node 24 passes. PR 128 is open at 8250c148, targeting main; PRs 130, 137, 139, 140 and 143 are merged. These are dated GitHub observations, not journal results. Recheck current heads and CI before acting.
