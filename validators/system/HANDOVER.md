# Handover: validator system

Rewritten by the executor every iteration (docs/validators.md section 10). A stranger continues from this file alone. The level table is written by `driftbench validate system --journal <row.json>` from the last journal row.

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
| 1 | 9 |
| 2 | 9 |
| 3 | 9 |
| 4 | 9 |
| 5 | 9 |
| 6 | 9 |
| 7 | 9 |
| 8 | 9 |
| 9 | 9 |
| 10 | 9 |
| 11 | 9 |
| 12 | 9 |
| 13 | 9 |
| 14 | 9 |
| 15 | 9 |
| 16 | 9 |
| 17 | 9 |
| 18 | 9 |
| 19 | 9 |
| 20 | 9 |
| hidden | 9 |
<!-- level-table:end -->

Bank version 5 (2384 items). Journal: validators/system/journal.jsonl, row 0 (main a0a3e5d7, before any fix) and row 1 (branch exec/system-v3). The journals of earlier bank versions are kept as journal-v2.jsonl, journal-v3.jsonl and journal-v4.jsonl.

## Floor

7 in validators/floors.json (ladder version 5, evidence on seeds 1 to 5 and the hidden seed). The floor is raised only through a maintainer branch (fix/system-floor) with an independent review, never from an executor branch, and never lowered.

## Open items

Measured at b5e67728 (main 6bf47594 plus this branch), seeds 1 to 20 and the hidden seed 52779880: level 9 of 11 on every seed, 2378 of 2384 items pass on every seed. Six items fail, under three causes, none of them the executor's to fix:

1. Level 10, every seed, four items: breaker2/ops/attack-clean-agent-exit-0, attack-rounds-distinct-classes, attack-replay-same-attacks, attack-nearest-pack. One cause, in example data: examples/acme/redteam/d02-goal-shift.yaml gives the approved phrasing d2-cheaper-plan the expectation `must: ["\\$25"]`, which the correct Acme agent fails (the file says so: "NOT SEPARATING (owner review)"). So `driftbench attack` on the real agent reports "Findings: 1 of 10 attacks" and exits 1, where docs/attack.md prints 0 findings. Proof: the same command with a copy of the pack without that line prints "Findings: 0 of 10 attacks". The pack waits for the owner's review; its draft replacement x-d2-cheaper-plan-separating is in the same file. Reported to the lead.
2. Level 11, every seed: scale/flow-blocks-teacher-forced/growth. The owner decision below.
3. Level 11, 1 to 9 seeds per sweep, never the same ones: scale/flow-blocks/growth (and once scale/flow-blocks-replayed/growth). The rule takes one sample of CPU time at 400 blocks over the best of three at 40, about 4 ms, bound 25. On this branch two measures gave 21.9 and 23.7, and a sweep fails it on some seeds under load. PR 212 replaced this rule for the teacher-forced item only and measured its false failures (19 to 33 of 100 on a correct adapter, Node 22). The remaining growth is the same deep copy as in cause 2. The item is the maintainer's to rule on.

### The growth item (an owner decision, not built)

scale/flow-blocks-teacher-forced/growth asks that the work of a turn does not grow with the history: at most 11 times the message visits and 25 times the best CPU time from 40 to 400 blocks. After this branch the runner's own work is linear. What remains is in packages/adapters/src/function/index.ts: the function adapter deep-copies the prefix when a session opens (once per block in mode T) and deep-copies the whole history for the agent function on every turn. docs/adapters/function.md promises exactly that: "Every argument is a copy: the agent cannot change the session or the Given." Measured on this branch: 94.1 times in mode T and 87.3 in mode F, every visit from those two copies.

Option A, a shared history the agent may read and not write. The runner freezes each message once, when it joins the history; the adapter hands the agent a new list of those same messages on every turn.
* Measured (a local trial with the two copies replaced by a new list of the same messages, not committed): 790 visits at 40 blocks and 7990 at 400, 10.11 times in both modes; best CPU growth 19.4 in F and 16.1 in T. The item passes.
* Cost: a breaking change of the function adapter's contract. An agent function that writes to a message it was given (not to the list, which stays its own) gets a TypeError in strict mode, and every ES module is strict. docs/adapters/function.md line 41 and the contract suite change with it. The world and the vars stay copies. Code: two lines in the adapter, a deep freeze of each new message in the runner, the tests of the copy promise rewritten.

Option B, the copy stays and becomes lazy: a copy-on-write view per turn (PR 118, packages/core/src/contracts/history.ts on codex/system-v3).
* Measured by PR 212 on that branch: 62.0 times on the count (bound 11), from messageTemplate and lazyHistoryCopy. The item still fails: a view registers every message it can be read through, on every turn.
* Cost: no contract change, 284 lines of Proxy code in core (history.ts on that branch), every read of a message by an agent going through a Proxy (not measured here; Immer's own page gives two to three times a plain update for its drafts), and the item stays red. Passing with a view would need one view kept per session and extended per turn, which no measurement supports yet.

A third way exists and is the maintainer's, not the executor's: keep the copy contract and rule that the copy the contract demands is outside the item's count. The product then stays quadratic in what it copies, by contract.

## Hypotheses tried

Held (journal.jsonl rows 1 and 2):

* A ref of six or more digits is a hash prefix when no version has that number (packages/store/src/store.ts, carried from PR 118): claim/cli/dataset/ref-forms passes on seeds 4, 6 and 15, where it failed.
* docs/estate.md gives the approved fixture count of 125 (carried from PR 118): breaker/tools/estate-approve-counts-match-docs passes.
* The runner read the whole history on every block in three places: the hash of the prefix under a head that changes (spec/hash.ts), the list of user messages (runner/run.ts) with the ledger scan over it (runner/ledger.ts), and the same list rebuilt from the canonical prefix in mode T. All three now read the new messages only. Of 887389 message visits on a 400-block flow, 400697 were these. Every given hash, cache key, run record and replay is byte for byte what it was (Pitfalls, last entry, says how that was checked).
* A pack with no approved phrasing is refused with exit 2 again (packages/users/src/attack.ts): breaker2/ops/attack-unapproved-needs-drafts passes.

Rejected:

* The runner fixes alone bring scale/flow-blocks-teacher-forced/growth under its bound: no. The count stays at 94.1 times in T and 87.3 in F, all of it the adapter's copies.
* The runner fixes alone make scale/flow-blocks/growth pass on every seed: no. One sweep failed it on 4 seeds and the next on 1; its single sample moves with the host.
* A copy-on-write view of the history in place of the copy (PR 118): measured by PR 212 at 62.0 times on the count, bound 11.

## Next actions

1. Wait for three rulings, then measure again with `--items` on seeds 1 to 20 and the hidden seed: the owner's review of d2-cheaper-plan in the Acme pack (cause 1), the owner's choice on the history contract (the growth item), the maintainer's rule for scale/flow-blocks/growth (cause 3).
2. If the owner takes option A: in packages/adapters/src/function/index.ts hand the agent `[...session.history]` and open the session with `[...given.prefix]`; freeze each message where the runner appends it (packages/core/src/runner/run.ts, the line that builds `history`); rewrite the copy promise of docs/adapters/function.md and its tests. packages/core/test/runner/history-reads.test.ts already holds the runner at a linear count in F and T.
3. The floor can rise from 7 to 9 now: level 9 holds on all 21 seeds in four sweeps (main a0a3e5d7 twice, e04e30f3, b5e67728). It rises on the maintainer branch fix/system-floor, with a `--seeds 1..20 --hidden --json` run of main as evidence and an independent review. Level 10 needs cause 1, level 11 causes 2 and 3.

## Pitfalls

* The hidden seed changes with every commit, so a seed-dependent item can fail in one measurement and pass in the next. Compare the failing lists of two runs, not only the counts.
* Run the measurement alone. `--items` on 21 seeds takes 60 to 100 minutes on a loaded host. Any other CPU work during the sweep makes the scale items of level 11 fail: scale/flow-blocks/growth failed on 4 seeds in a quiet sweep of main and on 9 seeds in a sweep that shared the host with other runs.
* The sweep reads the source tree as it runs (tsx, no build). Do not edit product files in the worktree during a sweep; work in a second worktree and bring the commits over after.
* scale/flow-blocks/growth and the other growth items except the teacher-forced one take one sample at 400 blocks over the best of three at 40, on CPU time, bound 25. The smaller time is about 4 ms, so one millisecond moves the ratio by 5.
* Under heavy load, packages/cli/test/validate.test.ts can time out at 5 seconds; it passes when run alone.
* Use files of your own, never /tmp/<common name>. Never `git stash` in this repository: the stash is shared by every worktree.
* The variance family holds three Monte Carlo items; each can fail a correct chain on about 2 seeds in 1000 (packages/validators/fixtures/system/design.json).
* variance/design-effect-calibration plants 20 specs by 4 runs, always balanced, and truncates the correlation at zero itself. So it cannot see an ANOVA that is right on balanced data only, nor a correlation left negative.
* An item that is wrong is the maintainer's to fix, in a commit of its own on a non-executor branch, never the executor's. Five items that pinned the output of an older Acme example went that way (PRs 262 and 268).
* A change to the hashes of the runner (spec/hash.ts, runner/cache.ts, runner/given.ts) must keep every given hash and cache key byte for byte: run the Acme conversations in T, F and P into a store with the old code and the new, compare the run records without their clock fields and the cache keys, then replay the old store with the new code and count the cache hits.

## How to run

```
pnpm driftbench validate system --seeds 1..20 --hidden --items --json > after.json
pnpm -s exec tsx packages/validators/src/ladders/system/journal-row.ts --before before.json --after after.json --iteration <n> --hypothesis "<one sentence>" --files a,b --commit <sha> --model sonnet > row.json
pnpm driftbench validate system --journal row.json
pnpm driftbench validate system --hardness
```

`--all-levels --json` lists every failing item of every level with the seeds it fails on, in less output than `--items`.

Run one item on chosen seeds while you work: filter `systemBank()` from packages/validators/src/ladders/system/bank/index.ts by id and call `runItem(item, seed, root, scratch)`. The message visits of a flow, by calling function: `countMessageVisits` in packages/validators/src/ladders/system/bank/growth.ts around `runScenario` of bank/world.ts.

The ladder is registered in packages/validators/src/ladders/index.ts (a root file).

## Fixtures

* packages/validators/fixtures/system/bank-manifest.json: every item (id, family, tier, level, source, component, cause); a test compares it with the bank.
* packages/validators/fixtures/system/design.json: the design point of the Monte Carlo items.
* The fault family: examples/acme/faults, read through the gate's importFaultSet; the operator per class is OPERATORS in packages/validators/src/ladders/system/family.ts.
* Everything else is generated from the seed under packages/validators/src/ladders/system/bank/ (claims under bank/claims/).
