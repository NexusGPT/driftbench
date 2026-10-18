# Cause review, system validator, levels 12 and 13 (links, not run and blocked)

Scope: all 38 failing items of `audit/failing-blind.json` (the doc asks for 30; with 38, all are reviewed).
Read for the fixes: `docs/concepts/blast-radius.md`, `docs/concepts/given-when-then.md`, `docs/reference/cli.md`,
`docs/validators.md` 12.7, and the product code under `packages/core/src/{radius,runner,spec}` and `packages/cli/src`.
Not read: `packages/validators/src/ladders/system/`, `packages/validators/fixtures/system/`, `validators/system/`, HANDOVER.md, journal files.

## Independence note (read this first)

- To look for extra detail on the truncated failure strings I opened `audit/raw.json`. That file carries the builder's
  `cause` field. I printed the entries of two ids before I saw it: `links/select-parent/child-first/id` and
  `links/chain-localize/x1-local/T/grouped`. I saw their cause text and stopped reading that file.
- I wrote the fixes for those two groups (Fix 3, 6 items, and Fix 4, 2 items) from the code and docs. Each has an independent
- Fixes 1, 2 and 5 were derived from code and docs; Fix 5 and the mode default of Fix 4 were reproduced by running the CLI. Fixes 1 to 3 were not executed, they are read from the code.
  line of evidence below, but treat the 8 items of Fix 3 and Fix 4 as exposed when you read the agreement number.
- `audit/builder-causes.json` does not exist (checked at the start and again after writing this report). The agreement
  step cannot run. See "Agreement" below.

## The fixes I would make, grouped

### Fix 1. `localizeRuns` maps a run block to its spec block by position, not by spec index (20 items)

- File: `packages/core/src/radius/localize.ts`, function `localizeRuns` (the loop over `run.blocks`).
- Behaviour now: it keys a verdict by `blockName(spec, block.index)`. `block.index` is the position of the block in the
  run. Two things move that position away from the authored index:
  - perturbed mode inserts an injected block before authored block k, so every later block sits one position later;
  - a parent-linked spec runs in dependency order (`parentOrder`), so a child authored first runs after its parent.
- Change: take the authored index from the run, as `specBlocks(run, spec)` in `runner/compounding.ts` does (`specIndex`
  when set, else count the non-injected blocks), and key the verdict by that index. A block with no spec index
  (a driver-injected one) is not a row. A replacement perturbation stands for its block (`specBlocks` already says so),
  so the current `block.injected === true` skip should defer to `specBlocks`.
- Items (all fail because the reported failing root or top section is the neighbour block):
  - `links/shift/perturbed/*` (10): roots `#b3` for authored block 2, `#b4` for authored block 3. The offset equals the number of injected blocks before the block.
  - `links/chain-localize/perturbed/*` (4): top section `own_2_3` instead of `own_2_2`, same shift.
  - `links/shift/forest-child-first/*` (6): roots `#b0` instead of `#b1`. The parent b1 runs first (position 0) and its failure is filed under b0.

### Fix 2. `localizeRows` takes ancestors from the authored order even when the spec declares parent links (6 items)

- File: `packages/core/src/radius/localize.ts`, function `localizeRows`, the `chain` helper.
- Behaviour now: the ancestors of a block in modes F and P are every earlier block of the spec (`own`), plus the
  cross-spec parent. A failure with a failing "earlier" block is dropped as inherited.
- Change: when any block of the spec has `parent`, the ancestors of a block are only its `parent` chain (resolved by
  block id, as `parentOrder` does). Roots have none, so two failing roots both count. Specs with no `parent` keep the
  authored-order rule.
- Doc basis: given-when-then.md "Parent blocks": "its blocks form a forest in every mode: each root starts at the spec
  defaults, and a child inherits only its ancestors"; blast-radius.md: "Explicit forest roots remain independent".
- Items: `links/shift/forest-roots/*` (6): failure weight 1, expected 2. The second root's failure is dropped as
  inherited from the first root.

### Fix 3. `sectionSelection` forward closure ignores block-level `parent` edges (6 items)

- File: `packages/core/src/radius/select.ts`, function `sectionSelection`, the forward-closure loop.
- Behaviour now: a block is forward-selected only when it comes after the first selected block in authored order, or
  when its whole spec starts from a selected block of another spec (`parentOf`, the spec-level edge). The block-level
  `parent` field is never read, so a child authored before its selected parent stays `out`.
- Change: in a spec with block `parent` links, select every descendant (through `block.parent`, by id) of a selected
  block, whatever the authored order. In such a spec the "after the first selected block" rule is replaced by this
  descendant rule, because roots are independent. `parentOrder`/`radius.ts` (line 328 onward) already does this for the
  plain radius.
- Doc basis: blast-radius.md "Parent blocks": "A change that reaches a parent also reaches every descendant, in F, T
  and P, regardless of authored order."
- Items: `links/select-parent/{child-first,grandchild-first,two-children-first}/{id,index}` (6). The `id` and `index`
  variants differ only in how the link names the block; link resolution already works for both, so one change fixes
  all six.

### Fix 4. `radius localize` reads `--mode` from the parent `radius` command, so the campaign's own mode is never used (2 items)

- File: `packages/cli/src/commands/radius-localize.ts` (`registerRadiusLocalize`, `localizeCommand`).
- Behaviour now: the action calls `command.optsWithGlobals()`. The parent `radius` declares `--mode` with default `F`,
  so `options.mode` is `"F"` even when the user gave none. The branch "default: the only mode of the campaign" never
  runs. On a mode T campaign every run is skipped ("mode T, not F"), the failure weight is 0, and the command exits 1.
  The failing output prints `"mode": "F"` for a T item, which shows it.
- Change: read `mode` (and `sections`) from the subcommand's own options and fall back to the campaign's single mode
  when the subcommand did not receive `--mode` (for example `command.opts().mode`, or check
  `getOptionValueSource('mode')` is not `default`).
- Doc basis: the command's own option text, "default the only mode of the campaign", and the cli.md exit contract
  ("exits 0 with a ranking").
- Items: `links/chain-localize/x1-local/T/grouped`, `links/chain-localize/x5-tool/T/grouped` (2).

### Fix 5. `driftbench help <command> <subcommand>` drops the subcommand (4 items)

- File: `packages/cli/src/help-topics.ts` (`runHelpTopics`, the `if (argv.length > 2) return undefined;` line) with
  `packages/cli/src/main.ts`, or main.ts alone.
- Behaviour now: `help radius localize` falls through to commander, whose `help [command]` takes the first operand and
  prints the usage of `radius`. I ran it: output starts `Usage: driftbench radius [options] [command] <paths...>`.
  `radius localize --help` already prints `Usage: driftbench radius localize ...`.
- Change: when `help` is followed by two or more command words that name nested commands, print the usage of the
  deepest one (equal to running `<words> --help`), for `radius localize`, `radius sections init|check|reanchor`
  and any other nested command (`campaign run` has the same defect: it prints the `campaign` usage).
- Doc basis: cli.md "Global options": "`driftbench help <command>` does the same" as `--help`.
- Items: `links/chain-help/{localize,sections-init,sections-check,sections-reanchor}/topic` (4).

## Item table

| # | Item id | Fix |
|---|---|---|
| 0-9 | links/shift/perturbed/{x1-local,x2-contradiction,x3-flow,x4-format,x5-tool,d2-goal-shift,d4-loose-confirmation,d6-instruction-in-data,d8-tool-failure,d9-out-of-scope} | 1 |
| 10,12,14,16,18,20 | links/shift/forest-roots/{x1-local,x4-format,x5-tool,d4-loose-confirmation,d6-instruction-in-data,d9-out-of-scope} | 2 |
| 11,13,15,17,19,21 | links/shift/forest-child-first/{same six} | 1 |
| 22-27 | links/select-parent/{child-first,grandchild-first,two-children-first}/{id,index} | 3 |
| 28-29 | links/chain-localize/{x1-local,x5-tool}/T/grouped | 4 |
| 30-33 | links/chain-localize/perturbed/{x1-local,x5-tool,d4-loose-confirmation,d9-out-of-scope} | 1 |
| 34-37 | links/chain-help/{localize,sections-init,sections-check,sections-reanchor}/topic | 5 |

Counts: Fix 1 = 20, Fix 2 = 6, Fix 3 = 6, Fix 4 = 2, Fix 5 = 4. Total 38.

Distinct causes I found: 5.

## Items I think are wrong (oracle against the docs)

None of the 38 contradicts the docs. Three soft points, none a defect in the item:

- Fix 2 items (`forest-roots`): blast-radius.md "Localisation over sections" says a failure is dropped when "an earlier
  block of the same conversation (or a parent block) failed". Read alone, two forest roots are "the same conversation",
  so the sentence can be read to drop the second root. given-when-then.md "Parent blocks" decides it ("a child inherits
  only its ancestors"; roots start at the spec defaults). The item follows given-when-then.md. The localisation
  paragraph should say "an ancestor block".
- Fix 3 items: blast-radius.md line 377 lists the selection rule as "every later block of the same conversation, and
  the blocks of a spec that starts from a selected parent block". It does not mention block-level `parent`. The item
  follows the "Parent blocks" section at the end of the page. The selection list should name block parents.
- Fix 5 items: cli.md says `help <command>` equals `--help`; it does not say nested commands. The item reads the
  sentence as covering a command written as two or three words. This is the natural reading, and `campaign run` shows
  the same defect.

## Agreement

`audit/builder-causes.json` now exists (38 ids). I read it only after the fixes above were written. Comparison, by item:

| My fix | Items | Builder cause | Same change? |
|---|---|---|---|
| 1 | 10 shift/perturbed + 4 chain-localize/perturbed (14) | localizeRuns maps a mode P block to its authored index, not its run position after the injected block | yes |
| 1 | 6 shift/forest-child-first | localizeRuns maps a block run out of authored order by its specIndex, not its run position | yes |
| 2 | 6 shift/forest-roots | localizeRows reads ancestors in a parent forest from its parent edges | yes |
| 3 | 6 select-parent (exposed) | sectionSelection follows block-level parent edges to every descendant | yes |
| 4 | 2 chain-localize/T/grouped (exposed) | radius localize reads the campaign's single mode, not the F default of radius --mode | yes |
| 5 | 4 chain-help | driftbench help <command> prints the usage of a subcommand of radius | yes |

- Agreement counted, all 38 items: 38/38 = 1.00.
- Agreement with the 8 exposed items (select-parent, chain-localize T) left out: 30/30 = 1.00.
- One difference of grouping, not of change: the builder tags Fix 1 as two causes (mode P shift, child-first specIndex). Both are one edit in
  `localizeRuns`: key a block by its authored index (`specIndex` / `specBlocks`) and not by its run position. I count them as one cause.
  If you count the builder's tags as written, the builder has 6 distinct causes and I have 5; the 20 items still agree on the change.
- Distinct causes I found: 5.

cause review: pass 38/38, 5 distinct causes reviewed
