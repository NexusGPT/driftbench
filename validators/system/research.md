# Research: validator system

Append only, one entry per research pass (docs/validators.md section 10.6): the question, the sources read (URL or path), what others do, what to try, and why.

## 2026-10-11: the design point of the planted effect (lane V2, before the first executor)

Question: which pairs per campaign, true rate, drop and margin make levels 6 and 7 pass on a correct chain on almost every seed, at a run cost a CI job can carry?

Sources: docs/concepts/statistics.md (the parity verdict: the upper bound of the paired interval below the margin); packages/stats/src/paired.ts (`nonInferiority`, the paired Newcombe interval); packages/stats/src/intervals.ts (`wilson`, `bootstrapCI`); packages/stats/src/variance.ts (`varianceComponents`, `icc`).

What was measured, with the statistics functions alone (no runner):

* Exact Wilson coverage over n of 40 to 80 and rates of 0.80 to 0.93: the highest are 0.9780 at n 50 and a rate of 0.93, and at n 44 and 0.92. At 0.97799 the chance that fewer than 93 of 100 campaigns hold the truth is 0.0017.
* The parity verdict at 50 pairs, a rate of 0.9 and a margin of 0.1, over 200 seeds of 100 campaigns: with no run noise (a threshold agent) no false alarm and at most 1 missed drop of 20 points in 100; with 2 percent noise 8 seeds false-alarm more than 5 times; with 5 percent noise 186 seeds do.
* The mean ANOVA design effect over 100 clustered campaigns (20 specs, 4 runs, rate 0.8, rho 0.25): the 99 percent bootstrap interval held the true 1.75 on 199 of 200 seeds, and the 99.9 percent interval the ladder uses held it on 200 of 200.

What to try next if level 6 or 7 flakes: more pairs per campaign (the cost grows linearly), or a rate with a higher exact Wilson coverage at the chosen n; never a lower bar.

## 2026-10-12: the hardness pilot (lane V2)

Question: does the system bank meet the gate of section 12.4 (forecast at least 100, score at most 0.4 after a ten-iteration pilot)?

Sources: docs/validators.md section 12; the parity matrix (research/parity/MATRIX.md, rows 16 to 18, 25, 26); validators/system/journal.jsonl rows 0 to 10.

Finding: no. Iteration 0 passed 519 of 665 (0.780); after ten one-cause fixes, 572 (0.860); 5.3 items fixed per iteration; forecast 17.6. The chain built in phases 1 to 3 (runner, checks, store, cache, recovery, drift classes) passes nearly every item the bank asks of it, including 179 generated fault-reach and class items and 82 precision items; what fails is phase 4 (report, compare, ci) and three scale items. Reaching a score of 0.4 would need about 800 more failing items, which the system's documented contract does not supply; padding them would break section 12.1.

What to try: items with independent causes (one fix, one item): the documented verdict ids of every check (docs/reference/checks.md), every assertion kind in every position, the artifact checks per file kind through a campaign, and a breaker lane that has not read the runner (section 12.2, item 5).

## 2026-10-12: the hardness pilot on bank version 3 (lane V2)

Question: with families of independent causes (executable docs claims, CLI exit codes and flags, check by adapter by mode, store concurrency and corruption, twelve scale subjects, report numbers recomputed by brute force), does the bank meet section 12.4 (forecast at least 100, score at most 0.4, at least 100 distinct failing causes)?

Sources: docs/validators.md section 12; docs/concepts/*.md, docs/reference/*.md, docs/cli.md (the claims); validators/system/journal.jsonl rows 0 to 10.

Finding: no. Iteration 0 passed 1244 of 1280 (0.9719) with 25 distinct failing causes. After ten one-cause fixes, 1265 (0.9883) with 15 causes; 2.1 items fixed per iteration (2.0 without the glob item correction; the two report corrections only undid what the label fix broke), forecast 7.1. Of 717 docs-claim items, 14 failed at iteration 0: the chain mostly does what its pages say. The failures are real defects: three loader checks, a torn store read, a status filter, digit-only hash prefixes, a detached child surviving the timeout, a compounding interval, a pass^k interval, a quadratic per-block cost in five places.

What to try: the forecast is bounded by the number of real defects, not by the bank size. More causes need a breaker lane that has not read the runner (section 12.2, item 5), and the hidden seed rotation, which found the header-cut defect on its own.

## 2026-10-12: unchanged level, remaining growing-history work

Question: why does teacher-forced growth pass after avoiding eager prefix copies, while free-running and replay growth can still exceed the bound of 25?

Sources: packages/core/src/spec/hash.ts (`sha256WithList`, `sha256OfJsonWithList`); packages/core/src/runner/cache.ts (`blockCacheKey`); packages/core/test/hash-list.test.ts (exact canonical digest parity); docs/adapters/index.md (history ownership and mutable callback compatibility).

What was measured: the targeted seed-1 run passes teacher-forced growth, but free-running growth is 29.4 times and replay growth 31.2 times. A CPU profile of free-running work attributes 421 milliseconds of sampled wall time to native hash update calls and 162 to the lazy history copy. These are profile samples, not the bank's CPU measurements. The deterministic red-first hash test observes 802 native updates for an 800-message prefix, while confirming the digest matches the plain canonical JSON.

What the existing implementation does: it retains a digest state only for an identical head. A block key changes its head with the Given hash and position, so the old messages each go through another native update. The canonical text cache already permits reading the immutable bodies once.

What to try: for a new head, feed the cached canonical list text into the hash in bulk; retain the incremental update for a head that can extend its previous prefix. This is a different mechanism from lazy message copies. The existing exact-digest tests remain mandatory, so cache keys and replay semantics stay unchanged.

## 2026-10-13: PR 74 Node 24 selection growth

Question: why can the unchanged 500-to-5000 sparse-pool check exceed its CPU growth limit of 40?

Sources: packages/generate/src/select/cover.ts; packages/generate/test/select/cover-scale.test.ts; docs/reference/cli.md (select required-cell and sealed-spec semantics); PR 74 Node 24 CI failure, ratio 53.454619124797404.

Finding: the no-evidence path creates an empty fault Set for every spec, membership creates a separate deduplication Set for every cell, and gain recomputation and heap swaps create temporary arrays and callbacks. A local CPU profile includes 574 milliseconds of garbage-collection samples across 100 large selections; that profile is corroboration, not the bank's CPU timing. Deterministic red-first tests observe empty Set allocations growing from 30 to 210 on 20 and 200 specs, and populated Set allocations growing from 22 to 202.

Fix: omit absent evidence, deduplicate memberships by the last index already held, visit coverage without flattened temporary arrays, reuse gain vectors, and swap heap entries directly. The greedy heap, ranked tiers and pool-order tie break stay the same. All 36 selection tests pass, including the unchanged growth limit and exact full-scan reference comparisons with duplicate and out-of-pool inputs. Ten Node 24 CPU probes in one fresh process of the same 500-to-5000 shape measure a maximum ratio of 27.94. CI remains the acceptance check for PR 74.


## 2026-10-13: candidate ledger allocation mechanism

Question: which remaining growing-history cost can be removed without changing mutable callback semantics or canonical cache keys?

Sources: packages/core/src/runner/ledger.ts (`kindOf`, `sameValue`, `saidValues`); packages/core/test/runner/drift.test.ts (phone, email, dates and replacement semantics); docs/concepts/drift.md (The ledger check); system-measurements/history-runtime.cpuprofile (private measurement artifact).

Finding: the profile still includes lazy-array construction, but preserving plain mutable arrays and structuredClone requires their earlier slots. Ledger comparison also constructs anchored email and phone RegExp objects repeatedly for old facts. An isolated copy of the exact ledger module with only the two anchored patterns precompiled produces identical checked facts and contradictions. Across five 400-block growing-contact probes, the original module uses 176.926 to 193.233 CPU milliseconds and the candidate 57.377 to 80.618. These are subsystem probes, not bank scores.

What to try after the hash iteration is measured: a red-first allocation test on the real ledger function, precompile only the non-global anchored patterns, retain all existing phone/email semantics, then measure the same bank growth items. This is a distinct allocation mechanism; it is not implemented in component source yet.


## 2026-10-13: canonical text prefix reuse

Question: why does bulk hashing still traverse old item texts on a new list, and how can it preserve mutable-array digest behavior?

Sources: packages/core/src/spec/hash.ts (canonicalList, sha256WithList); packages/core/test/hash-list.test.ts (plain canonical digest oracle); packages/core/test/mutable-list-hash.test.ts; docs/adapters/index.md (mutable Message arrays).

Finding: an extended immutable prefix repeats every old WeakMap lookup before joining the same old texts. The red-first test observes 402 lookups after extending a 400-object prefix by one item. A second red-first test confirms the new-head bulk path incorrectly reuses the array-identity text after a mutable array grows. The plain canonical SHA-256 oracle disagrees.

Mechanism: keep the last canonical prefix text with a copied list of item references, verify that prefix before appending new texts, and bypass the immutable-array identity cache for mutable digest callers. Seven exact-digest and prefix tests pass after the change. The whole seed-1 measurement is the acceptance evidence for the growth item, not the subsystem test.


## 2026-10-13: avoid unused cache keys

Question: which prefix work has no consumer in an uncached live run?

Sources: packages/core/src/runner/run.ts (execute, liveChannel, remember); packages/core/src/runner/cache.ts (blockCacheKey); docs/running.md (optional cache and replay).

Finding: liveChannel only passes the key to remember, which returns immediately without run.cache. execute still hashes it on every block. The key is not emitted in a block result. Empty string retains the end-state marker because the check is lastKey !== undefined.

Mechanism: compute the block key only with a cache. Two red uncached tests see three calls each, then pass after the fix. A third case confirms cached live and replay keys stay identical. Full seed 1 moves from 2361 to 2362/2384, with all scale items passing. The five-seed stage completes 5 of 21 with 2359/2384 passing every completed seed; free-running seed 3 and teacher-forced seed 4 still exceed 25. The numeric registry prefix also fails seed 4. No bank or limit changes.

Private follow-up probes: descending and sparse array construction have mixed results. The hybrid adapter and copied-runner timings are withdrawn after instrumentation finds zero borrowed prefixes: the private CommonJS modules duplicate the ESM ownership marker. Corrected ESM probes borrow all 924 opened prefixes. The ledger reordering preserves exact verdict projections but still has teacher-forced failures; it is not implemented. The remaining shared lazy-array allocation cost needs a different mechanism.


## 2026-10-13: message-field snapshot representation

Question: can ordinary callback arrays avoid indexed accessor dictionaries while retaining mutable writes, unread fields and structuredClone?

Sources: packages/core/src/contracts/history.ts (lazyHistoryCopy and immutableHistorySource); packages/adapters/src/function/index.ts (callback and exposed-session boundary); docs/adapters/index.md (snapshot ownership and compatibility); packages/core/test/history-fields.test.ts.

Finding: a 400-message snapshot creates 400 indexed array accessors. Reading a message role also reads its content getter. Both deterministic tests fail before the representation change. Private copied adapters must be ESM: CommonJS reloads the marker module and forces prefix cloning, invalidating those earlier performance comparisons. Instrumented corrected ESM probes borrow all opened prefixes.

Mechanism committed as 5b628263: retain data slots holding private message objects, capture primitive fields, and share per-field getters for nested JSON and accessors. Cache field templates only for explicitly immutable sources. Proxy and non-plain messages keep the prior indexed fallback. Compatibility checks pass, including structuredClone, frozen/sealed objects, unread proxies and sparse inputs. The 15 targeted growth checks pass 13 cases; seed 3 free-running is 25.5 and teacher-forced is 31.5 against 25. Those probes are not complete bank seeds and do not prove growth is fixed. The full seed-1 bank measurement stays level 7, with 2361/2384 passing and free-running growth 28.6 against 25. Teacher-forced and replay pass. Coverage is 1 of 21.


## 2026-10-13: digit-only registry hash prefixes

Question: why does dataset ref 456042 fail on seed 4 while six hexadecimal characters are documented as valid?

Sources: packages/store/src/store.ts getVersion; packages/store/src/errors.ts StoreError; docs/datasets.md The registry; packages/cli/src/commands/registry.ts resolve.

Finding: the digit-only branch returns immediately after a missing version-number lookup. It never reaches the hexadecimal prefix lookup shared by datasets and prompts. Four red-first cases reproduce a missing numeric prefix, its ambiguity and full digit-only hashes for both registry kinds. The existing version-number priority case stays green.

Mechanism committed as 796124a5: preserve existing version-number priority and short or overlong missing-number behavior; let unmatched six-to-64 digit refs continue to the existing hash-prefix lookup. Ambiguity retains INVALID_RECORD and the existing diagnostic. No bank edit.

Whole seed 1 stays level 7 and 2361/2384, 1 of 21 at this source. Free-running growth remains 25.3 against 25. The unchanged seed-4 dataset/ref-forms item passes its targeted check, which does not count as a complete seed. All 16 targeted registry cases pass.


## 2026-10-13: repeated immutable template registration

Question: does marking each resolved prefix rewrite metadata that earlier immutable messages already own?

Sources: packages/core/src/contracts/history.ts immutableHistorySource and messageTemplate; packages/core/src/runner/given.ts resolveGiven; docs/adapters/index.md explicit immutable ownership; system-measurements/iter6-current-history.cpuprofile.

Finding: the current post-main seed-1 bank has teacher-forced growth 31.4 and replay growth 30.3 against 25; free-running passes. Two red-first registration tests observe 400 repeated template writes for an identical 400-message prefix and a rewrite of the old message when one new message is appended. The marker writes a template even when messageTemplate returns an already-known immutable template.

Mechanism committed as f4f70544: skip template registration for messages already present in the immutable-template WeakMap. This leaves the array marker, new-message registration and snapshot semantics unchanged. Three registration cases pass after the one-line fix, including replacement and same-array append; all 49 selected history, adapter and growth checks pass, with two existing skips. Whole-bank growth remains unaccepted until measured.

The whole seed-1 measurement remains level 7 and 2360/2384, 1 of 21. Teacher-forced growth is 26.8 and replay growth 25.5 against 25; free-running passes. No growth item is cleared by this iteration.
