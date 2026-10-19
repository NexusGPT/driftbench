# Audit of the links2 lane of the blocks bank (docs/validators.md section 12.7)

Scope: the 99 items whose ids start with `links2/` (families `links2-localize` and `links2-schema`), added to the blocks bank of PR 563 (base `6e219f4c9`). Four audit helpers ran on 2026-10-18 on Sonnet at medium effort. None read `packages/validators/src/ladders/blocks-links2/`, `blocks/contracts.ts` or a handover. Their reports are in this folder. The verdict lines below are quoted from those reports. The builder wrote only the free text after the table.

This file is not `validators/blocks/audit.md`, which belongs to the bank owner. The owner folds these lines into it when the lane merges.

| Check | Verdict | Note |
|---|---|---|
| blind pilot | pass | "8 fixed in round 1, 1 round, residual 0" ([blind.md](blind.md)). The blind fix is `link.status !== 'stale'` in `localizeRows`, the same as the builder's pilot. |
| cause review | pass | "agreement 8/8 = 1.0, 1 distinct cause" ([bugs-2.md](bugs-2.md), from the blind causes in [blind.md](blind.md)). |
| cheater | fail | Round 2 at `60e212216`: "11 cheats reach 0 failing on both seed sets (A,B,C,G,H,I,L,Q,R,S,U), F and J lower it partly, M2 lowers it on 1,2,3 only; the validator does not catch argv, cwd, env, uptime, stack or id-shape sniffing" ([cheater-2.md](cheater-2.md), diffs in [cheats-round2](cheats-round2/)). |
| planted bugs | fail | Round 2 at `ee626798f`: "14 of 20 new non-equivalent bugs pass all 91 items (N2 N3 N4 N5 N7 N8 N10 N11 N13 N14 N15 N16 N17 N19)" ([bugs-2.md](bugs-2.md)). |

Round 1 at `41955e719` (44 items): cheater fail, with K1 to K6 and K8 taking the 8 failures to 0. Planted bugs fail: 29 of 44 bugs failed no item ([cheater-and-bugs.md](cheater-and-bugs.md), diffs in [cheats-round1](cheats-round1/)).

## What changed after each round

- After cheater round 1 (`60e212216`):
  - Every prompt, spec, block and section name is drawn from the seed, with no fixed prefix.
  - Every check runs with argv `node app`, an empty execArgv and the home folder as the working folder.
- After cheater round 2 (`2393e4a67`):
  - Names take every character an id may hold and a seeded length of 3 to 20.
  - The spec and block counts of each world are drawn from the seed.
  - This answers cheats F, G, J, Q and R by design. No helper re-ran the cheats on this head.
- After planted bugs round 1 (`ee626798f`), 47 items were added:
  - chain rows in modes T and F;
  - links by block index;
  - links to another prompt;
  - duplicate links;
  - every listed value accepted;
  - refused link shapes.
- After planted bugs round 2 (`9770e2284`), the 91 items became 99:
  - the comparison checks every section's linked count and its rank range, and a NaN score never matches;
  - chains run in mode P too;
  - link statuses are drawn among `declared`, `attributed` and `verified`;
  - a spec that gains its first links keeps its hash.

## Builder re-measure at `9770e2284` (not a verdict)

Every round 1 and round 2 bug was planted into the pilot fix and scored on seeds 1, 2 and 3 against the 99 items. The script is `bugs-all.py`; it is not in this folder.

- Round 1: 30 of 43 bugs fail at least one item. Bug C14 no longer matches the code. The 13 misses:
  - B4 (refuted links) and B11 (sort order): the bank's `links/localize/*` items fail both.
  - B12 and C17: a stale registry section kept in a row, and the dedupe of a block's sections. No output of `localizeRuns` can differ.
  - B16, B17, B18, B19 and B28: skipped runs (another mode, another spec hash), injected blocks, not-run blocks, block indexes past the spec.
  - B24, B25 and B26: `sectionLinkStatus`, `checkSpecLinks` and the registry duplicate check.
  - C5 and C15: provenance in the hash, and a spec with one bad link.
- Round 2: 11 of 20 fail at least one item. The 9 misses:
  - N3: tie order.
  - N5: roots.
  - N8: `suiteRuns`.
  - N10: ancestors across a parent edge.
  - N13: `sectionLinkStatus`.
  - N14: the stale-link warning.
  - N15: kind checks in `checkSpecLinks`.
  - N17: an empty prompt id.
  - N19: the perturbation in the suite group key.

## Owed before section 12.7 holds for this lane

1. Run every item in a child process with a user's argv, environment and working folder, and with no validator frame on the call stack. An in-process check cannot hide the process it runs in: call stack, environment, uptime and module paths stay readable. This applies to every in-process family of the bank, so it is a change to the validator frame.
2. Add items for the localize behaviours that `localizeRuns` implements but `docs/reference/block-contracts.md` and `docs/concepts/blast-radius.md` do not state. Each item needs that doc sentence written first:
   - skipped runs and their reasons;
   - injected and not-run blocks;
   - `suiteRuns`, roots and tie order;
   - parent-edge ancestors;
   - `sectionLinkStatus`, `checkSpecLinks` and the registry checks.
3. Run a third cheater round and a third planted-bug round with seats that did not build the lane.
