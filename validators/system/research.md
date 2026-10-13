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

## 2026-10-13: the per-block cost of a growing history (executor, bank version 5)

Question: scale/flow-blocks/growth fails on some seeds and scale/flow-blocks-teacher-forced/growth on every seed. Which part of the work that grows with the history is the runner's own, and which part is the callback contract of the function adapter ("Every argument is a copy", docs/adapters/function.md)?

Sources: the message meter of the bank (packages/validators/src/ladders/system/bank/growth.ts, PR 212, with its evidence tables); PR 118 (the copy-on-write history view, packages/core/src/contracts/history.ts on codex/system-v3); packages/core/src/spec/hash.ts, runner/run.ts, runner/ledger.ts, runner/given.ts; packages/adapters/src/function/index.ts; MDN, Object.freeze (https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/freeze): a write to a frozen object throws a TypeError in strict mode and does nothing otherwise, and a freeze covers the object's own properties only; Immer, performance (https://immerjs.github.io/immer/performance/): a Proxy draft costs two to three times a hand-written update and every value read through a draft becomes a draft.

What was measured, with the meter, on a 400-block flow over a 40-block flow (linear is 10, the bound is 11):

* main a0a3e5d7, mode F: 887389 visits at 400, 93 times. By site: cloneJson 482034 (the adapter's copies), itemText in spec/hash.ts 164670, the user-message filter in runner/run.ts 156187, saidValues in runner/ledger.ts 79840.
* The runner's three sites, fixed (this branch): mode F 87.3 times, mode T 94.1 times. Every remaining visit is cloneJson in the function adapter: the copy of the prefix when a session opens (once per block in mode T) and the copy of the history handed to the agent function on every turn.
* The same branch with the two adapter copies replaced by a new list of the same messages (a local trial, not committed): 790 visits at 40 and 7990 at 400 in both modes, 10.11 times; best CPU growth 19.4 (F) and 16.1 (T).

What others do: a library that shares state with callers either freezes it (a write then throws in strict mode, MDN) or hands out copy-on-write views (Immer). PR 118 took the second way; PR 212 measured it at 62 times on the count, because a view still registers or wraps every message it is read through.

Finding: the runner's own work is linear after this branch. The teacher-forced growth item cannot pass while the function adapter hands the agent a deep copy of the whole history on every turn; that is the documented contract, so the change is the owner's decision. The free-running item (one sample, CPU time only, bound 25) measured 25.6 and 28.1 on main and 21.9 and 23.7 on this branch, on a loaded host, and failed on 4 seeds of 21 in one sweep of main and on 9 in the next: its rule is the one PR 212 replaced for the teacher-forced item, with the false failures that PR measured.

What to try: nothing more in the runner. The two options for the owner are in HANDOVER.md, "The growth item".
