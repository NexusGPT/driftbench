# Re-audit of levels 12 and 13 on the grown bank: cheater and planted bugs

Tree: tree-c (branch audit/system-v6-c, head 1e2f321ce). Baseline: 365 of 413 pass (hidden seed 507409500), 48 fail. Same rules as before: product code only, bank never read, every file restored with `git checkout -- packages`; tree-c is clean at the end. Spec and section ids are now drawn from the seed, so id-prefix cheats cannot fire; I re-keyed them on fixture names (`p-bank`, `b0..bN`) and on shapes.

## Check 2: cheater

| # | Cheat (re-keyed) | Score | Items gained |
|---|---|---|---|
| 1 | Fake usage line for `help radius ...` (`main.ts`) | 369 | +4 chain-help/* |
| 2 | Injected-block shift only for the injected block named `p-bank` (`localize.ts`) | 379 | +14: shift/perturbed/* (10), chain-localize/perturbed/* (4) |
| 3 | Parent-chain ancestors when every block id matches `b<digits>` and a block has a parent | 371 | +6 shift/forest-roots/* |
| 4 | Child-authored-first shape selects every later block (`select.ts`) | 371 | +6 select-parent/* |
| 5 | Exit 0 when argv contains `measure` (`radius-localize.ts`) | 363 | 0 gained, -2 (chain-localize/clean/F and T) |
| 6 | Shift applied only when argv contains `measure` | 379 | +14 (same items as cheat 2) |
| 7 | Key verdicts by `blockId` when a block is authored before its parent | 371 | +6 shift/forest-child-first/* |
| N1 | New: same fake usage for `help radius X` and `radius X --help` | 369 | +4 chain-help/*; the 4 audit/help-whole items did not move |
| N2 | New: for child-first specs select only the block named `b1` | 373 | +8: audit/child-first-counter/{root-first,other-root-between,other-child-first}/{id,index} (6) and select-parent/child-first/{id,index} (2) |
| 8 | Stack of 1, 2, 3, 7, N1, N2 | **403** | +38, nothing lost; 10 items stay failing (T/grouped x2, help-whole x4, select-parent grandchild-first and two-children-first x4) |

Result: 9 of 10 cheats gain (only cheat 5 does not); stacked 365 to 403 of 413. The seeded ids did not stop them.

Items that let them through:
- The fixture names stay constant: the injected block is always `p-bank`, blocks are always `b0..bN`. A name test is as good as an id test.
- audit/child-first-counter/* was meant to catch cheat 4, but it is the exact family the name-keyed `b1` cheat (N2) passes, because the counter items always call the block `b1`.
- `argv` containing `measure` still tells the product it is under measurement (cheat 6).
- chain-help/* reads only the first line of the usage.
- audit/help-whole/* blocked N1 because it compares with the real `--help` text option for option; that one holds against the cheat.

## Check 4: planted bugs

Score is items passing of 413 (baseline 365). Lost = items passing at baseline that fail with the bug.

| Bug | Planted bug | Score | Lost | Verdict |
|---|---|---|---|---|
| B01 | localize.ts: hard 0/1 block weight instead of failed/rows over repeats | 355 | 10 | lost |
| B02 | localize.ts: Ochiai denominator without the square root | 243 | 122 | lost |
| B03 | localize.ts: grouped counting drops every child of a failing parent, passing ones too | 316 | 49 | lost |
| B04 | localize.ts: refuted links still charge their section | 355 | 10 | lost |
| B05 | select.ts: closure ignores sections that override a changed one | 357 | 8 | lost |
| B06 | select.ts: stale links no longer select the block | 360 | 5 | lost |
| B07 | select.ts: forward selection starts two blocks after the first selected one | 315 | 50 | lost |
| B08 | links.ts: a numeric block link holds for every block up to its index | 334 | 31 | lost |
| B09 | links.ts: a link to a stale section keeps the declared status | 363 | 2 | lost |
| B10 | sections.ts: the registry check accepts an anchor quote found more than once | 361 | 4 | lost |
| B11 | sections.ts: sections from headings starts at level-1 headings only below the level (off by one) | 210 | 161 | lost |
| B12 | verdicts.ts: a run with a not_run block and a blocked block reads blocked first | 358 | 7 | lost |
| B13 | verdicts.ts: the end-state mismatch no longer fails the run | 364 | 1 | lost |
| B14 | run.ts: a blocked grandchild names its parent as root, not the real root | 349 | 16 | lost |
| B15 | run.ts: a child of a not_run parent runs (only a failed parent blocks) | 347 | 18 | lost |
| B16 | verify-given.ts: value_in_message matches a substring, not whole tokens | 361 | 4 | lost |
| B17 | verify-given.ts: a canonical prefix with an unpaired call is an error, not a warning | 361 | 4 | lost |
| B18 | gate-exit.ts: blocked-only runs exit 1 instead of 3 | 362 | 3 | lost |
| B19 | radius-localize.ts: exit code inverted (0 when nothing failed) | 343 | 22 | lost |
| B20 | identity.ts: provenance stays in the spec hash | 361 | 4 | lost |
| B21 | radius-localize.ts: --counting flat ignored | 361 | 4 | lost (extra) |
| B22 | radius-sections.ts: reanchor exit ignores a reordered section | 363 | 2 | lost (extra) |
| B23 | localize.ts: a block not run counts as a pass row | 353 | 12 | lost (extra) |
| B24 | localize.ts: mode T inherits earlier blocks | 355 | 10 | lost (extra) |
| B25 | run.ts: a later not-run block loses the cause of the first | 365 | 0 | MISS (extra) |
| B26 | verify-given.ts: duplicate tool call ids in one message accepted | 359 | 6 | lost (extra) |
| B27 | links.ts: two registries for one prompt accepted | 361 | 4 | lost (extra) |
| B28 | sections.ts: adjacent sections reported as overlapping | 365 | 0 | MISS (extra) |

B01 to B20: 20 of 20 lost at least one item. Extras B21 to B28: 6 of 8 lost; B25 (the cause text of a later not_run block) and B28 (adjacent sections reported as overlapping) still lose nothing.

cheater: fail 9 of 10 cheats gained (stacked 365 to 403 of 413): fixture-name keys (p-bank, b<digits>, b1) and argv sniffing replace id keys
planted bugs: pass 20 of 20 bugs lost at least one item
