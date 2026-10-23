# Pointer validator: the recorded floor

Floor: 3 (ladder version 2, 14 levels)

## Why

The owner's rule, verbatim: "If you cannot do it, lower the bar per validator". The floor is the level the product reaches on every seed. No item is changed or weakened to reach it.

## Measured

* Run 39902658900 (`validators.yml`, `pointer-measure-full`) on `train/pointer-bar-1` at `6f5bd0b9ae0e77534b0a35be1b2e2e1ee0ce1f34`: seeds 1 to 20 and the hidden seed 869288185, 10 shards. The train is `release/next` d6bb5a5df with PR 1439, PR 1449 and PR 1448.
* Level 3 of 14 on all 21 seeds. The same 11 items of the 787 fail on every seed (776 pass). Only levels 4 and 8 miss their threshold (0.915 and 0.875).
* Level 4, 8 items, 7 causes:
  * `atoms:one-atom-per-unit` (`grouping.range-across-heading`)
  * `atoms:gate-quote-first-to-second` (`grouping.gate-across-sections`)
  * `scan:dirty-window-only` (`labels.carry-forward-dirty-window-only`)
  * `labelset:answer-enum` (`labels.prompt-header-and-enum`)
  * `scan:read-units-marked` (`labels.read-unit-not-labelable`)
  * `labeler:validate-opaque-and-context` (`labels.refuse-label-on-context-unit`, `labels.refuse-label-on-opaque-unit`)
  * `labeler:window-split-at-headings` (`labels.window-split-at-headings`)
* Level 8, 3 items, 2 causes: `perf:replay-index` (`scale.replay-100x`) and `perf:rescan-linear` (`scale.rescan-edit-1pct-10x`, `scale.rescan-edit-1pct-100x`).
* 9 distinct failing causes in all.

## What is not known

The windows, read and anchor-window work targets several of these causes (`labeler:window-split-at-headings`, `scan:dirty-window-only`, `perf:rescan-linear`, `labeler:validate-opaque-and-context`) and lands with the regen PR. That effect is unverified until the bank is measured again with it. The floor rises through `driftbench validate floors --raise` when a later run reaches a higher level on all 21 seeds.
