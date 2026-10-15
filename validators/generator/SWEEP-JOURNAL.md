# Generator sweep journal

Full bank measurements are appended to `journal.jsonl`. This journal records partial measurements and their limits while a sweep runs.

## 2026-10-13T06:32:25+02:00: deadline checkpoint

- Options A and B and the separate compose repair are pushed to PR 113. Code source: `8359f453`; latest fixture alignment: `1b06db25`.
- The full sweep started at 06:13 local time with seeds 1 to 20 plus hidden and two seed workers. At this checkpoint, 0 seed result files are complete. Global Acme and scale results are still pending. Evidence: `.exec/after-ab.log` and `.exec/after-ab.json.seed-*.json`.
- A separate seed-1 ladder run stops at its first failing level. Its result is pending in `.exec/level-ab.json`.
- The latest completed bank measurement remains journal row 17 at 2026-10-13T01:29:28Z: seed 1, level 5, 1551 of 2033 items, source `4d94b132`. This is the pre-change baseline, not a measurement of options A and B.
- Final typecheck and lint pass. The full repository test run is still running. Acme extraction, generation and budget rechecks pass all 30 tests after fixture alignment. The run reports a system-floor assertion failure and a CLI action test failure; their final failure details are pending. These are not reported as passing.
- The six formerly unchecked fault classes are killed in the graph-suite integration test. The compose regression fails before the repair and passes after. The repair makes the bank stricter and changes no item's expected answer.

The next entry records completed seed results or the final bank result. No unmeasured item is counted as passing.

## 2026-10-13T06:34:53+02:00: fresh seed-1 level

- Source code: `8359f453`, unchanged by the later documentation and Acme fixture-alignment commits. Command: `pnpm driftbench validate generator --seed 1 --json`. Exit code 5 is the measured ladder level.
- Seed 1 reaches level 5 of 22. Levels 1 through 5 pass all their items. Level 6 passes 19 of 22 items.
- The stop-at-first-failure run measures 148 items, of which 145 pass. This is a partial measurement, not the score of the full 2033-item bank. Levels 7 through 22 remain unmeasured by this command.
- The first failures are `gate.shortcut.passed-by-first-tool` (8 boundary blocks), `gate.contrast.then-ignores-edit` (30 blocks), and `gate.accepted.boundary` (54 of 72 boundary blocks accepted). No bank expected answer or threshold is changed.
- Machine-readable evidence: [options-ab-seed-1-level.json](evidence/options-ab-seed-1-level.json). The full seeds 1 to 20 plus hidden sweep remains active.

## 2026-10-13T06:37:53+02:00: CLI rechecks

- The two CLI generation expectations are aligned with the regenerated Acme refusal reason and 252 complete specs. All 7 CLI generation tests pass.
- The isolated CI action test passes its parity and bad-input branches in 74.647 seconds, with no CI code changes. The earlier full-run failure took 139.742 seconds against an explicit 120-second test timeout; its final error detail is not yet available, so timeout is a hypothesis.
- The system committed-floor assertion remains unresolved. A read-only diagnosis is running; no system validator expected answer, source, or floor is changed.
- Full repository tests and the 21-seed sweep remain active. Fresh seed-1 level: 5, with the partial measurement limits recorded above.

## 2026-10-13T06:41:34+02:00: system-floor recheck

- The exact committed-floor run is repeated on source `cf271ae8`, seed 1, through floor 7. All 1297 items pass and the run reaches level 7. [Measured level counts](evidence/options-ab-system-floor.json) preserve the source and timestamps; full item details remain in `.exec/system-floor-ab.json`.
- No deterministic regression is reproduced. The original full-suite failure cause remains unconfirmed until its final error details are available. No system validator source or floor is changed.
- Every failure reported so far by the still-running full test suite has a passing focused recheck. The full suite and the 21-seed bank sweep are still running.

## 2026-10-13T06:44:24+02:00: completed seed workers and gate fixture recheck

- Seed 2: level 5, 1791 of 2009 seed-dependent items pass. The 24 global Acme and scale items are pending, so this is not a full-bank score. Source: `8359f453`; evidence: `.exec/after-ab.json.seed-2.json`.
- The regenerated D4 loose-confirmation probe is `gen-deviation-005`; the CLI gate test now references that probe. Its acceptance, fault-kill and control assertions remain unchanged. All 10 gate and pilot rechecks pass.

## 2026-10-13T06:48:13+02:00: seed 1 finishes and full test results

- Seed 1: level 5, 1788 of 2009 seed-dependent items pass. Seed 2: level 5, 1791 of 2009 pass. The same 24 global items remain pending. These counts do not claim full-bank scores.
- The full repository run finishes with 424 passing files and 6 failing files; 5018 tests pass, 7 fail and 43 skip. The CI suite cleanup hook also times out. Three failures are stale fixture expectations now fixed; three are explicit test timeouts; the system-floor assertion reports level 2 rather than floor 7.
- All seven failed tests have passing focused rechecks, including the exact system-floor run through level 7. The original system item failure is not captured by the test assertion, so its cause remains unconfirmed. All six affected suites are rerunning together with one worker, a 30-second default test timeout and a 60-second cleanup timeout. Explicit per-test timeouts and bank budgets remain unchanged.

## 2026-10-13T04:55:24+00:00: owner pause

- The owner says: "alright man, let's pause it all for now." The sweep parent and its two active children receive SIGTERM and are verified stopped. No other process is stopped, and no automatic finalizer is armed.
- Seeds 1, 2, 3 and 4 all reach level 5. Their passing seed-dependent item counts are 1788, 1791, 1773 and 1789 of 2009. Seeds 5 through 20 plus hidden and 24 global items remain pending. [Partial evidence](evidence/options-ab-partial-sweep.json) contains every measured level and failure.
- The six affected test suites finish before the pause: all 6 pass, with 105 tests passing and 4 skipped. This recheck uses one worker, a 30-second default test timeout and a 60-second cleanup timeout; explicit test timeouts and bank budgets are unchanged. The initial full-run failure record remains preserved above.
- A read-only adapter audit finds a remaining option-A edge case: Claude Code replay assigns step-feed rows before the first user turn to block 0, falsely satisfying `stage_reported: true`. The repair is not started. No further adapter or runner gap is found in the audited surfaces.
- On resume, fix that boundary with a regression while preserving old spec behavior, then finish the sweep and append native journal row 18. The stopped parent kept global scale results only in memory, so those must be recomputed.

## 2026-10-13T07:00:04+00:00: resume and replay boundary repair

- The owner resumes work from `a0fedc3b` and authorizes merging PR 155 (cap) and PR 158 (speed) into this branch after the replay repair. Their workers are paused.
- The replay regression first reproduces the false pass in all three modes, then passes after pre-turn stage reports gain carried provenance. Legacy omitted/false flags remain unchanged. The targeted run passes 130 tests in 12 files.
- The combined cap evidence and full 21-seed sweep require fresh measurements. Pre-pause seed files retain their old source stamp and are not reused as new evidence.

## 2026-10-13T07:20:27+00:00: integrated source checkpoint

- Cap PR 155 and speed PR 158 are merged at `6236f772` and `8d44e8f5`. The owner authorizes both merges; neither other branch nor worktree is edited.
- Replay stage provenance and its cache version are repaired in separate commits. The new cache regression fails before the version bump, then the 27-test recheck passes.
- All 104 focused integration tests pass. Lint passes; the rename-scope script changes no files. Typecheck, fresh cap evidence and paired speed measurements are running. Full repository tests and the new 21-seed sweep remain pending.
- Measurement source: `1084a1e5`. The cap evidence script now compares written YAML hashes and protected probes against the uncapped suite. Historical cap counts remain bounded to their earlier source.

## 2026-10-13T07:33:26+00:00: focused local verification only

- The owner directs local work to run only focused tests, with full suites delegated to CI because host load exceeds 200. The local full run exits 143 after SIGTERM; every recorded process from that run is verified stopped. Its log has no completed suite result, so it supplies no pass or fail count. No other job is stopped.
- The focused integration result remains 104 passing tests. Repository typecheck and lint pass. Both measurement scripts also pass a separate TypeScript check after a type-only cap-options correction.
- The selected 100x cap will be timed in five full-window runs. Report the median process user-plus-system CPU time as contended, with no causal speed-gain claim. Pre-change single runs remain diagnostic output-preservation evidence.

## 2026-10-13T07:57:17+00:00: recovery after plugin interruption

- The recorded benchmark parent and child are absent after the plugin crash. Only the 1x and 10x after measurements complete; the 100x comparison, cap-limit probe and cap assays produce no completed result. No sweep was started. No interrupted result counts as evidence.
- Replay recheck on `a7fb2452`: 22 tests pass across the current-block stage and replay cache regression files. The repair is already committed in `9abeb25c` and `42fb7c3b`; no duplicate fix is applied.
- The owner directs PR 174 to merge only after green CI, then requests the full 21-seed sweep with two workers and load logging. The owner assigns protected changes to an independent maintainer on `fix/generator-validator-contracts`; import from main only after that PR merges. No protection exception or branch rename is used.


## 2026-10-15: maintainer semantic invariance pairing (PR 510)

- Base: `779d61573f6e92d995241be6aad515bdc28f3b9e`, the existing PR head. The auditor shows that renaming a block hides a wrong expectation while a separate clean pair still satisfies pair existence.
- Ruling: Given and ordered When define the comparison; Then is the value tested. Approved phrase intents, stage transitions and slot bindings supply meaning. Persona introductions normalize; unknown wording stays literal. Neither block ids nor expected stages can separate a pair. Actual initial/per-turn facts and language remain fixed.
- Red first: 39 cases fail on the base, including the auditor's same-turn/wrong-Then reproducer on all three paths and both axes. Green: 111 tests pass across five files. All 24 hand-built planted true pairs across fresh seeds 1009, 2027, 4093 and 8191 pass the real reference and reject the wrong Then despite opaque ids and a separate clean pair. Another 24 planted mutations of real generated walks on those seeds also fail, while the original walks pass the reference.
- Generation-only measurement: all six invariance items pass on visible seeds 1–20 and base-derived hidden seed 7802775. Arbitrarily renaming every block leaves every verdict unchanged. The six formerly failing items are three different-request pairs, each scored on both axes: seed 3 input-value vs behaviour; seeds 5/18 input-value vs returned-value. The actual requests and complete final-block Thens are in the evidence and PR body.
- The seed-18 gen-cover-096/gen-phrase-012 false pair remains excluded. Controls preserve transition order, bound values, burst boundaries, world/prefix facts and literal unknown requests; a changed expected stage never creates a new pair.
- Scope: no product changes, items removed, thresholds lowered, fault agents changed or fixture pins changed. No ladder level is inferred and the historical executor journal/level table stays unchanged. Evidence: [invariance-semantic-turns.json](evidence/invariance-semantic-turns.json).
- Product obligation: for the same facts and ordered requests, generate identical machine expectations across persona/channel variants, regardless of block labels.
