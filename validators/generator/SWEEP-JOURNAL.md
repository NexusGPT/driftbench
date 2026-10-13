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
