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
