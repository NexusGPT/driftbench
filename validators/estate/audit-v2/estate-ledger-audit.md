# Estate level 8 (the ledger): audit of checks 4 and 2

Tree: audit/tree-e, branch audit/estate-v2. Tool: measure-estate-ledger.mts, seeds 1,2,3. Baseline 62 of 62 (re-measured at the start and at the end; tree clean, no stash). Each bug was planted alone, measured, then restored with `git checkout -- <file>`. The bank sources were not read. The mutation lists are in `e-work/muts.json` and `e-work/muts2.json`, the runner in `e-work/run.py`.

## Check 4: planted bugs

The 20 bugs of the verdict are B01 to B20. B21 to B24 are four more in the same areas. The first B09 I planted (moved checked before changed) is an equivalent mutant: a unit cannot change text and file at once, because the scored pass is same-file only. I replaced it.

| # | area | bug planted | loses an item | items lost | first failing items |
|---|---|---|---|---|---|
| B01 | ledger following | text floor removed: a rewritten unit is carried by context alone | no | 0 |  |
| B02 | ledger following | follow threshold too strict: edited units become new+deleted | yes | 4 | ledger-diff.class.new, ledger-diff.class.split, ledger-diff.class.merged (+1 more) |
| B03 | ledger following | labels carry for a changed unit (fp check dropped) | yes | 1 | ledger-scan.edit.one-window |
| B04 | ledger following | labels carry when only the context changed | no | 0 |  |
| B05 | ledger following | short repeated text moved across files by text | no | 0 |  |
| B06 | ledger following | split/ambiguous: every piece keeps the old id (first-wins check on item only) | yes | 1 | ledger-diff.class.split |
| B07 | ledger following | deleted events never counted | no | 0 |  |
| B08 | ledger following | deleted entries dropped from the ledger | yes | 1 | ledger-scan.delete.entry-deleted |
| B09 | edit classes | a neighbour-only edit is classed changed (replaces the equivalent first B09) | yes | 7 | ledger-diff.class.moved, ledger-diff.class.new, ledger-diff.class.heading-renamed (+4 more) |
| B10 | edit classes | context class never produced | yes | 1 | ledger-diff.class.heading-renamed |
| B11 | rerun rule | new unit reruns its own (nonexistent) links instead of its section | yes | 4 | ledger-diff.rerun.new, ledger-diff.rerun.split, ledger-diff.manifest.new-file (+1 more) |
| B12 | rerun rule | deleted unit reruns nothing | yes | 2 | ledger-diff.rerun.deleted, ledger-diff.rerun.merged |
| B13 | rerun rule | no whole-file fallback for a new unit without a heading match | no | 0 |  |
| B14 | manifest | manifest ignores atoms: every unit is a unit change | yes | 1 | ledger-diff.manifest.changed-atom |
| B15 | manifest | atomsByUnit ignores the units of conditions | no | 0 |  |
| B16 | windows | windows end at every heading, not only top-level | no | 0 |  |
| B17 | windows | window holds size+1 units | no | 0 |  |
| B18 | cassette replay | replay mode calls the labeler on a miss | no | 0 |  |
| B19 | cassette replay | request key ignores the readable fields (run, cut digest) | no | 0 |  |
| B20 | label-to-atom mapping | gate quote starts at the labelled unit, not the earlier of the two | no | 0 |  |
| B21 | atom fields | atom drops the class `by` that decided the label | yes | 1 | ledger-scan.class-field |
| B22 | cutter | fingerprint is case-insensitive | no | 0 |  |
| B23 | cutter | a sentence starting lower case is no longer merged | yes | 2 | ledger-diff.class.new, ledger-diff.class.split |
| B24 | cutter | BOM offset dropped from unit spans | no | 0 |  |

B01 to B20: 9 of 20 lose an item. B01 to B24: 11 of 24.

Survivors, read as gaps (each one changes behaviour; I confirmed B01, B04, B05, B07, B16, B17, B22, B24 with a direct before/after probe of the product function, the rest by reading the code):

- B01: a wholly rewritten unit with unchanged neighbours is followed as `changed` instead of `new`+`deleted` (no item rewrites a unit to unrelated text)
- B04: labels carry onto a unit whose neighbours changed (the ctxFp rule is not checked on the scan)
- B05: a short text that repeats is moved across files by its text (no item with a repeated short sentence)
- B07: `events.deleted` is never counted (the scan report count is not asserted)
- B13: a new unit under a heading no old unit shares gets no whole-file fallback (the doc says "else every unit of the file")
- B15: `atomsByUnit` ignores `fields.condition`, so an edit of a condition unit reruns nothing
- B16: windows end at every heading, not only top-level ones (no item with a nested heading)
- B17: a window holds size+1 units (no item at the cap)
- B18: replay mode calls the labeler on a cassette miss (no replay item with a miss and a callable labeler)
- B19: the request key ignores run, cut digest, model, set hash (a stale answer would hit)
- B20: a gate quote starts at the labelled unit even when the target comes earlier in the file
- B22: the fingerprint ignores case, so MUST to must is "unchanged" (the doc says case is kept for force)
- B24: unit offsets lose the byte-order mark, so every quote and line span shifts by one

### More bugs (not in the verdict)

| # | area | bug planted | loses an item | items lost |
|---|---|---|---|---|
| X01 | ledger following | joinMargin removed: splits/merges accepted easily | no | 0 |
| X02 | ledger following | scored pass crosses files | no | 0 |
| X03 | ledger following | score weights: text 0.2 instead of 0.6 | no | 0 |
| X04 | ledger following | no collision loop on minted ids | no | 0 |
| X05 | ledger following | estate key not in the id | no | 0 |
| X06 | ledger following | deleted entries followed again | no | 0 |
| X07 | ledger following | ctxFp ignores the heading path | no | 0 |
| X08 | ledger following | merge across files allowed | no | 0 |
| X09 | rerun rule | context edits rerun | yes | 7 |
| X10 | rerun rule | moved reported nowhere | yes | 1 |
| X11 | rerun rule | new unit in unknown file does not rerun the suite | yes | 1 |
| X12 | rerun rule | section match by full path, not prefix | no | 0 |
| X13 | manifest | whole-suite change not global | yes | 1 |
| X14 | manifest | atomsByUnit keeps only the last atom per unit | no | 0 |
| X15 | windows | opaque units shown to the labeler | no | 0 |
| X16 | windows | halving uses floor | no | 0 |
| X18 | cassette replay | too_large refusal not recorded | no | 0 |
| X19 | cassette replay | miss diagnosis picks nearest across files | no | 0 |
| X20 | label-to-atom mapping | conditions joined in reverse file order | no | 0 |
| X21 | label-to-atom mapping | polarity dropped | yes | 1 |
| X22 | label-to-atom mapping | kind check removed | no | 0 |
| X23 | atom fields | atom field unit id wrong | yes | 2 |
| X24 | cutter | table pipes kept in the fingerprint | no | 0 |
| X25 | cutter | numbered-decimal merge removed | no | 0 |
| X26 | cutter | list item cut as sentence container | no | 0 |
| X27 | cutter | fence opaque covers whole block | no | 0 |

X17 was a no-op edit and was dropped. X24 (table pipes in the fingerprint) and X25 (a digit-after-stop merge) change nothing my probe could observe, so I count them as likely equivalent. Of the other 24 more bugs, 18 survive, 6 are caught. X04 (no id-collision loop) was confirmed: it re-mints the id of a deleted unit when the same text returns, giving two ledger entries one id.

## Check 2: the cheater

Each shortcut is a lazy implementation that could still score 62 of 62 on a thin bank. The score is the tool's; "caught" means at least one item fails.

| # | shortcut | caught | items lost | first failing items |
|---|---|---|---|---|
| C1 | always classify an edit as changed (moved and context collapse into changed) | yes | 7 | ledger-diff.class.moved, ledger-diff.class.new, ledger-diff.class.heading-renamed (+4 more) |
| C2 | re-mint ids on every scan (previous ledger never followed) | yes | 34 | ledger-scan.recall.rule, ledger-scan.recall.prohibition, ledger-scan.recall.gate (+31 more) |
| C3 | ids kept only for unchanged anchors (no moved/changed/split/merged following) | yes | 11 | ledger-scan.edit.same-unit, ledger-diff.class.changed, ledger-diff.class.moved (+8 more) |
| C4 | ignore the section rule for new units (a new unit reruns nothing) | yes | 4 | ledger-diff.rerun.new, ledger-diff.rerun.split, ledger-diff.manifest.new-file (+1 more) |
| C5 | a new unit reruns every unit of the old estate | yes | 3 | ledger-diff.rerun.new, ledger-diff.rerun.split, ledger-diff.rerun.deleted |
| C6 | a changed or deleted unit reruns every unit | yes | 6 | ledger-diff.rerun.changed, ledger-diff.rerun.deleted, ledger-diff.rerun.new (+3 more) |
| C7 | manifest always the whole suite | yes | 3 | ledger-diff.manifest.changed-atom, ledger-diff.manifest.unchanged-empty, ledger-diff.manifest.unit-without-atom |
| C8 | never carry labels: every unit relabelled from the cassette each scan | yes | 22 | ledger-scan.recall.rule, ledger-scan.recall.prohibition, ledger-scan.recall.gate (+19 more) |
| C10 | anchor by position instead of LCS (an insert shifts every id) | yes | 27 | ledger-scan.recall.rule, ledger-scan.recall.prohibition, ledger-scan.recall.gate (+24 more) |
| C11 | an edited unit that kept its id is never changed | yes | 9 | ledger-diff.class.changed, ledger-diff.class.split, ledger-diff.class.merged (+6 more) |
| C12 | a paragraph is one unit (no sentence cut) | yes | 6 | ledger-scan.recall.rule, ledger-scan.recall.prohibition, ledger-scan.recall.register (+3 more) |
| C13 | one window per top-level heading, size cap ignored | no | 0 |  |
| C14 | one unit per window | yes | 1 | ledger-scan.edit.one-window |
| C15 | cassette key is only file, window id and set | no | 0 |  |
| C16 | a unit moved to another file is never followed | yes | 1 | ledger-diff.class.moved |
| C17 | conditions never attached (no situation) | no | 0 |  |
| C18 | every unit relabelled every scan (carry ignored) | yes | 22 | ledger-scan.recall.rule, ledger-scan.recall.prohibition, ledger-scan.recall.gate (+19 more) |

C9 was a no-op edit and was dropped. Your four examples: always classify as changed (C1) caught; re-mint ids every scan (C2) caught; ignore the section rule for new units (C4) caught; a rerun set of every unit (C5, C6, C7) caught.

Not caught:
- C13: the window cap is ignored, one window per top-level heading. The cassette and the edit item still pass because no item has a section larger than the cap.
- C15: the cassette key is only file, window id and set. A changed model, set hash, cut digest or run would hit a stale answer, and no item changes one of them under replay.
- C17: a condition label never attaches to its target, so no atom gets a `situation`. No item builds a condition label.

cheater: fail 3 of 17 shortcuts pass all 62 items (window cap ignored, weak cassette key, conditions never attached)
planted bugs: fail 9 of 20 bugs lost at least one item
