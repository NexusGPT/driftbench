# Estate level 5: product remeasurement

## Scope and source

This measurement uses product source a91598b5e153dc9c734188abc4027f47073eeae6, the starting head of feat/estate-l5-climb. It tests whether estate-generated specs reject a single broken rule while passing the faithful agent. It introduces no generation, runtime, scanner, validator, fixture or threshold change.

The owner requires fixes to the framework in general, with independent non-bank tests, rather than special cases for bank items. No remaining observation in this measurement justifies a product patch. Existing non-bank generation and ordering regressions remain in place.

## Instruments

The live CLI help exposes --all-levels, but no --level flag. A local driver calls the unchanged BANK_LEVELS and levelMeasure functions for level 5. The driver and captures are preserved outside the disposable worktree under the task's sol-estate-l5b/evidence folder.

At the owner's instruction, the agent-mutant diagnostic applies the follower file from origin/fix/estate-follower-dedup-read at 7a07e19fc0bc997ec9cf97dc29dda4ce6a029d17. That file contains the PR 518 deduplication change and PR 526 initialization change. The overlay is local and is removed before this report is committed. It changes no generated assertion.

The original follower reproduces the known duplicate-read gate/reference failures and the missing offered-tools initialization failure. With the overlay, every agent-mutant class passes on seeds 1 through 8, seed 1009, and hidden seed 837764853 derived from the stamped source. The per-seed raw bank captures distinguish that conditional result from the failing fake-runtime bank.


### Agent-mutant failures in the original follower

| Item | Original-follower defect | Maintainer fix |
|---|---|---|
| mutant.agent.gate | Another identical Read remains before Edit when the targeted gate Read moves after it | PR 518 |
| mutant.agent.gate-fixed-gate | The skill and standing gate each add a Read of the same file | PR 518 |
| mutant.agent.reference-skill | Removing one reference leaves the duplicate Read | PR 518 |
| mutant.agent.reference-standing | Removing the standing reference leaves the skill reference Read | PR 518 |
| mutant.agent.tool-deny-bare | The faithful follower reports no offered-tools list, so the exclusion check is inconclusive | PR 526 |

The detailed original captures name the exact reference path and generated ordered/file-read assertions. A retained duplicate Read really satisfies those assertions; strengthening their counts would overfit the faulty follower. The initialization capture records tools_offered.exclude.WebFetch failing because the adapter reports no offered tools.

### Level-5 scores with the follower overlay

| Seed | Agent classes | Fake-runtime items | Whole level |
|---|---|---|---|
| 1 | 44/44 | 8/30 | 52/74 |
| 2 | 44/44 | 8/30 | 52/74 |
| 3 | 44/44 | 8/30 | 52/74 |
| 837764853 | 44/44 | 8/30 | 52/74 |
| 4 | 44/44 | 8/30 | 52/74 |
| 5 | 44/44 | 8/30 | 52/74 |
| 6 | 44/44 | 8/30 | 52/74 |
| 7 | 44/44 | 8/30 | 52/74 |
| 8 | 44/44 | 8/30 | 52/74 |
| 1009 | 44/44 | 8/30 | 52/74 |

The fake family is seed-independent and executes once per process, as declared by its unchanged seedFree field. No whole-level pass is claimed.

## Remaining fake-runtime conflicts

The unchanged fake family scores 8/30. The earlier product handover reports 9/30: the changed verdict is the optional note-stage deletion. The product correctly avoids requiring an optional stage. The fake emits it after the closing stage, causing the original to fail its closing-stage assertion.

A separate diagnostic supplies the documented state library and fake judge flags at invocation, without altering validator or fake source. It scores 10/30. Its 20 failures comprise:

- Fourteen cases whose selected tests already fail on the original fake.
- Four semantic mutants for which the fixed-phrase stand-in judge supplies no semantic oracle.
- Two declared-tool deletions that inject no observable permission violation under the fake runtime.

All 22 raw fake failures are individually documented in the workstream's RULING-M-kill-fake.md, with atom source lines, original run IDs, check failures and contract references. The declared-tool boundary does not require a call; removing a declaration must not be turned into a fabricated call obligation to produce a kill. The owner rules that optional-stage deletion is equivalent, or the item must target a required stage.

The preserved optional-stage original run 2685b7a6244be284 records plan, do, verify, report, note. Its only failing check is stage.reached: reached note, expected report. The observation and original database are preserved in stage-original-evidence.json and stage-original.db.

These findings do not establish a passing level 5. They identify maintainer-owned positive-control, oracle and invocation defects. No validator or fixture change is included in this branch.

## Targeted regression checks

Six existing generation and adapter test files pass all 79 tests: then, read-attempts, domain-order, focus-distinct, absence, and ordered. The preserved targeted-tests.log records the run.

The reader, lint, plan and generation measurements use the same unchanged product source. This report-only change cannot change their generated specs or runtime checks. Their per-seed captures are preserved with the level-5 evidence; existing failures are not represented as new losses or as passing levels.
