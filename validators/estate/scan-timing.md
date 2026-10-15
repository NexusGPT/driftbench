# Ruling: estate scan budgets measure the scanner

The scan budget starts immediately before the product's `scanEstate` call and ends immediately after it resolves. Fixture creation, directory and file writes, symlink setup, oracle matching, lint and temporary-folder cleanup are outside that interval.

This follows `docs/validators.md` sections 1, 6 and 12.2: the validator plants an input, runs a component, and measures that component. Correct and slow remains a failure. Fixture-writing speed is not scanner speed.

The owner rule applies verbatim:

> make sure all the fixes are fixes that are TO THE FRAMEWORK in general and not just fixes that are overfitting to the problem to make the test pass

## Scope

- `PlantedEstate.scan` reports the product interval as `ScanOutcome.scanMs`.
- The shared `judgeCase` path uses it for every `scan.hostile` and `scan.decoys` item. It does not select an item, filename or seed for special treatment.
- The existing 5000 ms budget, item inputs, correctness oracles and failure handling stay unchanged.
- Estate scale scans already start after planting. Their budgets and implementation stay unchanged.
- No product source under `packages/estate` changes.

## Red-first proof

Commit `70d6eaaad` contains only the regression test, before the timer fix.

The handwritten parcel-audit estate runs through the real fixture writer, scanner and oracle. A controlled clock charges each fixture write 6000 ms and the scanner 700 ms. Both hostile and decoy cases fail with the old timer: 18700 ms is charged to the scanner. A separate case charges lint and cleanup 6000 ms each and the scanner 900 ms; the old timer reports 12900 ms. These are injected test durations, not host benchmarks.

With the corrected boundary, those cases pass. Scanner doubles taking 4999 and 5000 ms pass; one taking 5001 ms fails against the unchanged 5000 ms budget. The actual wide-folder bank item also rejects the 5001 ms scanner double. Wrong output and thrown scanner errors still fail. The clock double avoids sleep-dependent tests on a loaded machine.

Reproduce:

```sh
pnpm exec vitest run --configLoader runner --maxWorkers 1 packages/validators/test/estate/scan-timing.test.ts packages/validators/test/estate/planted-symlinks.test.ts packages/validators/test/estate/bank.test.ts
```

## Other timing boundaries inspected, unchanged

This is a source audit, not a ruling that each broader interval is wrong.

| Ladder | Items | Boundary observed |
|---|---|---|
| Estate | `scale.scan-{250,1000,2500,5000}` | `bank/scale-worker.ts` plants before timing `scanEstate`. The parent watchdog also includes startup and setup, but its larger safety limit is separate from the scored stage budget. |
| System | `scale/<subject>/growth` and `scale/<subject>/x100`, subjects below | `bank/scale.ts` times the entire subject callback, including planting, input construction and result checks. `bank/growth.ts` also wraps the entire callback for history subjects. These use process CPU time, not wall time, on this base. |
| Judges | The `scale/` items listed below | `v2/families/scale.ts` starts before the callback. Transcript, votes, strings, cassette and calibration fixtures built inside it are included. The separate large-player growth ratio times replay after cassette setup. |
| Map | Cases with `budgetMs` | `bank/run.ts` starts after case/source construction and excludes perfect-model time. No fixture-disk-I/O interval like the estate defect is found there. |
| Stats | `scale.*` | `bank/scale.ts` builds data before timing the product callback with CPU time. The outer child watchdog is a distinct whole-item safety bound. |
| Generator | `scale.{10,100}x.time` | `scale-child.ts` starts CPU timing before temporary-directory creation, map rendering and fixture writes. It also includes map loads, both generations and writes, byte comparison, reload and cleanup; follower execution is excluded. A separate parent wall-clock cap covers the whole child. |

System subjects whose growth and largest-size timing include fixture construction:

```text
loader-blocks
lint-blocks
store-runs
scorecard-runs
compounding-runs
transcript-runs
flow-blocks
flow-blocks-teacher-forced
flow-blocks-replayed
reply-characters
tool-calls
campaign-cells
html-report-runs
junit-runs
reliability-runs
compare-runs
spread-runs
tool-accuracy-runs
select-specs
```

Judges items whose scored wall-clock interval includes fixture construction:

```text
scale/prompt-{1000,10000,100000}-entries
scale/key-{1000,10000,100000}-entries
scale/majority-{1000,10000,100000}-votes
scale/parse-after-{100000,1000000,10000000}-characters
scale/parse-many-braces-{100000,1000000,10000000}
scale/escape-{100000,1000000,10000000}-characters-of-tags
scale/screen-{100000,1000000,10000000}-characters
scale/player-1000-entry-cassette
scale/council-1000-requests
scale/calibration-5000-blocks
scale/render-one-megabyte-entry
```
