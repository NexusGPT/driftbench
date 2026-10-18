# Audit of levels 12 and 13: cheater (check 2) and planted bugs (check 4)

Tree: tree-a (branch audit/system-v6-a), seeds 1..3 plus hidden seed 844070894. Baseline: 281 of 319 pass, 38 fail. Every change was made on product code only and restored with `git checkout -- <path>`; the tree is clean at the end. I never read the bank, fixtures or journals. One runtime probe: I logged the shape (index, injected, blockId) of the stored runs that `localizeRuns` receives, to see what the items feed it. That is a form of "reading the plant".

## Check 2: cheater

| # | Cheat | What changed | Score before, after | Items that moved |
|---|---|---|---|---|
| 1 | Return what the check looks for (help) | `main.ts`: for `help radius <anything>` print `Usage: driftbench radius ... [options]` and exit 0 | 281, 285 | +4: links/chain-help/{localize,sections-init,sections-check,sections-reanchor}/topic |
| 2 | Special-case spec ids | `localize.ts`: when `run.specId` starts with `shift-perturbed`, subtract the injected blocks seen so far from the block index | 281, 291 | +10: all links/shift/perturbed/* |
| 3 | Special-case spec ids | `localize.ts`: when spec id starts with `shift-forest`, ancestors are the real `parent` chain only | 281, 287 | +6: links/shift/forest-roots/{x1,x4,x5,d4,d6,d9} |
| 4 | Short-circuit on fixture shape | `select.ts`: if a block names a parent authored after it, mark every unselected block of the spec `forward` | 281, 287 | +6: links/select-parent/{child-first,grandchild-first,two-children-first}/{id,index} |
| 5 | Environment sniffing (exit code) | `radius-localize.ts`: exit 0 when `process.argv` contains `measure` | 281, 279 | none gained; -2 (links/chain-localize/clean/{F,T}). The two T/grouped items need a score, not an exit code. |
| 6 | Environment sniffing (argv) | `localize.ts`: apply the injected-block shift only when `process.argv` contains `measure` | 281, 295 | +14: links/shift/perturbed/* (10) and links/chain-localize/perturbed/{x1,x5,d4,d9} (4) |
| 7 | Special-case spec ids (block id) | `localize.ts`: for spec ids starting `shift-forest-child-first`, key verdicts by `block.blockId`, not by run position | 281, 287 | +6: links/shift/forest-child-first/{x1,x4,x5,d4,d6,d9} |
| 8 | All of 1, 2 (as 6), 3, 4, 7 together | the edits above, stacked | 281, 317 | +36, nothing lost. Only 2 items remain failing: links/chain-localize/x1-local/T/grouped and x5-tool/T/grouped |

Result: 7 of 8 cheats raise the score; stacked they reach 317 of 319. The hidden seed did not stop them.

Items that let them through:
- links/chain-help/* : the check reads only the start of the output (`Usage: driftbench radius localize`), not that it is the real usage of the command.
- links/shift/* and links/chain-localize/perturbed/* : spec ids carry stable prefixes (`shift-perturbed-...`, `shift-forest-...`, `shift-forest-child-first-...`) on every seed, including the hidden one, so an id prefix test fires on all of them. There is no twin item with a renamed id and the same shape that would punish a special case.
- links/select-parent/* : every item of the shape "child authored first" expects the whole rest of the spec selected; no item has a child-first spec where an unrelated block must stay out.
- Items run under the measurement process, so sniffing `process.argv` (cheat 6) switches the correct behaviour on only there.

## Check 4: planted bugs

Score is items passing of 319 (baseline 281). "Lost" = items that passed at baseline and fail with the bug. B01 to B20 are the 20 counted bugs; B21 to B28 are extras I ran afterwards.

| Bug | Component | Planted bug | Score | Lost | Verdict |
|---|---|---|---|---|---|
| B01 | localize.ts | block weight is 0/1 instead of failed rows over rows | 281 | 0 | MISS |
| B02 | localize.ts | Ochiai denominator without the square root | 209 | 72 | lost |
| B03 | localize.ts | grouped counting drops every child of a failing parent, passing ones too | 241 | 40 | lost |
| B04 | localize.ts | refuted links still charge their section | 281 | 0 | MISS |
| B05 | select.ts | closure ignores sections that override a changed one | 273 | 8 | lost |
| B06 | select.ts | stale links no longer select the block | 276 | 5 | lost |
| B07 | select.ts | forward selection starts two blocks after the first selected one | 232 | 49 | lost |
| B08 | links.ts | numeric block link holds for every block up to its index | 250 | 31 | lost |
| B09 | links.ts | link to a stale section keeps its declared status | 279 | 2 | lost |
| B10 | sections.ts | registry check accepts an anchor quote found more than once | 281 | 0 | MISS |
| B11 | sections.ts | heading level off by one (`<` for `<=`) | 142 | 145 | lost |
| B12 | verdicts.ts | run with not_run and blocked blocks reads blocked first | 274 | 7 | lost |
| B13 | verdicts.ts | end-state mismatch no longer fails the run | 280 | 1 | lost |
| B14 | run.ts | blocked grandchild names its parent as root | 265 | 16 | lost |
| B15 | run.ts | child of a not_run parent runs (only a failed parent blocks) | 263 | 18 | lost |
| B16 | verify-given.ts | value_in_message matches a substring, not whole tokens | 281 | 0 | MISS |
| B17 | verify-given.ts | unpaired call in a canonical prefix is an error, not a warning | 281 | 0 | MISS |
| B18 | gate-exit.ts | blocked-only runs exit 1 instead of 3 | 281 | 0 | MISS |
| B19 | radius-localize.ts | exit code inverted | 267 | 14 | lost |
| B20 | identity.ts | provenance stays in the spec hash | 281 | 0 | MISS |
| B21 | radius-localize.ts | `--counting flat` ignored | 281 | 0 | MISS (extra) |
| B22 | radius-sections.ts | reanchor exit ignores a reordered section | 279 | 2 | lost (extra) |
| B23 | localize.ts | a not_run block counts as a pass row | 281 | 0 | MISS (extra) |
| B24 | localize.ts | mode T inherits earlier blocks | 281 | 0 | MISS (extra) |
| B25 | run.ts | later not_run blocks lose the cause text of the first | 281 | 0 | MISS (extra) |
| B26 | verify-given.ts | duplicate tool call ids in one message accepted | 275 | 6 | lost (extra) |
| B27 | links.ts | two registries for one prompt accepted | 281 | 0 | MISS (extra) |
| B28 | sections.ts | adjacent sections reported as overlapping | 281 | 0 | MISS (extra) |

Counted bugs B01 to B20: 13 lost an item, 7 missed (B01, B04, B10, B16, B17, B18, B20). Over all 28: 15 lost, 13 missed.

Holes the misses show, by component:
- localize.ts: no item with repeats (soft weights), no refuted link, no not_run block inside a localized run, no mode T item where an earlier block would be inherited (B01, B04, B23, B24).
- sections.ts: `radius sections check` has no item with an anchor quote found twice, and none with touching spans (B10, B28).
- verify-given.ts: only the repeated-id rule is exercised; token-boundary matching and the canonical-prefix warning are not (B16, B17).
- gate-exit.ts: no item reaches the blocked-only exit 3 (B18). Also no item for `--counting flat` on the CLI (B21).
- identity.ts: no item where provenance differs and the hash must not (B20).
- links.ts: no item for two registries on one prompt (B27). run.ts: the not_run cause text is not read (B25).

cheater: fail 7 of 8 cheats gained (stacked 281 to 317 of 319): spec-id prefixes, argv sniffing, child-first shape and a fake help usage all pass
planted bugs: fail 13 of 20 bugs lost at least one item
