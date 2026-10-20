# H7 fresh sample, ledger (unit) selection: the same marks, the same 274

Lane: pointer-chain. Branch: feature/pointer-chain-ledger-marks, stacked on PR 983. The commit that adds this file is the pre-registration. Nothing below was run before it.

## Why

PR 983 measured the section selection on the fresh sample with the frozen rerun marks: 0 misses of 274, Wilson upper bound 1.38%, ratio 0.574. The README story of an edited rule runs on the ledger (PR 830), where a `unit` change selects blocks through `estate_unit` links. The marks are one feature on two paths, so the ledger path reads them too and must meet the same bar.

## Fixed before the run

* Marks: frozen as at `81fb93054`: `packages/core/test/fixtures/sections/h7-rerun-marks.json`, unchanged. No rule changes: the procedures, their thresholds and the list stay as they are.
* Code change: `unitSelection` reads `metadata.rerun` the way `sectionSelection` does. A marked block is selected on any `unit` change that names a unit (reason `rerun:<reason>`); a global change or one that names no unit already selects every block. Nothing else changes.
* Population: the same 274 fresh mutants of PR 983 (the 26 left out stay out). No new model call and no new spend: the flips (E) are the recorded ones in `h7-selection-fresh.json`, and the flaky blocks (`af1`, `d1`) are excluded as registered.
* Selection under measurement: each mutant's text is cut and followed on the ledger from the original prompt, the change manifest is read by the ledger (`ledgerChanges`, `rerunOf`, `ledgerChangeManifest`), a block links to every ledger unit of the sections it declared, of every global section and of the sections that name a tool its checks expect (the links of PR 960 on the units of those sections), advisory units are not added, and the marks apply.
* Miss: a mutant whose E holds a block that the selection does not hold. Result: k misses of 274, the Wilson 95% upper bound, and the mean selection ratio beside 0.574 of the section path. At or below 5%: the bar is met on the ledger path. Above 5%: it is not met and is reported as it is. No second run and no change after the run. If a model call turns out to be needed, the run stops.
