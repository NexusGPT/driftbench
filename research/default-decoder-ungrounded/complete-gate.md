# Complete 28-set replay for PR 182

Gate: PASS. All 14 sets on Haiku and all 14 on gpt-6-luna have zero breaks. Gemini is not recorded.

- Recordings: PR 172 commit `d25cc282013bcb170d7bd6e0c4ab0fdc6c4fa85d`; fingerprint `398673b792c1`.
- Re-read on merged main `eb3e7a98` with `rebase-fixture.mts`. New model calls: 0. Cost: USD 0.
- Current means main's strict version 1 decoder, which stays the default. Version 2 is opt-in.
- Main's source-alias grounding (PR 184) moved 43 current rows from unparsed to parsed since PR 172 recorded them. Both decoders read those rows identically. `results.json` lists them under `baselineMovedOnMain`.
- With change measures this PR alone. Alias replay keeps decoder version 1; decoder replay compares versions 1 and 2.
- The complete current gate covers 3,596 rows. The frozen fixture also retains historical sets: 5,469 rows total across 45 recorded or partially recorded sets, all with zero breaks.
- Focused tests: 80 pass in 4 files, including the full frozen replay, variant tests, cassettes and the 1,028-entry legacy/golden test. Prompt and fingerprint unchanged.

### haiku

| Set | Current | With change | Fixes | Breaks |
| --- | ---: | ---: | ---: | ---: |
| fresh-rubric | 188/192 | 188/192 | 0 | 0 |
| fresh-reference | 189/192 | 189/192 | 0 | 0 |
| map-rubric | 156/156 | 156/156 | 0 | 0 |
| map-reference | 173/180 | 173/180 | 0 | 0 |
| hard-rubric | 117/120 | 117/120 | 0 | 0 |
| hard-factuality | 119/120 | 119/120 | 0 | 0 |
| hard-pii | 118/120 | 118/120 | 0 | 0 |
| hard-goal | 106/120 | 106/120 | 0 | 0 |
| heldout-rubric | 71/72 | 71/72 | 0 | 0 |
| heldout-factuality | 71/72 | 71/72 | 0 | 0 |
| heldout-pii | 72/72 | 72/72 | 0 | 0 |
| heldout-goal | 65/72 | 65/72 | 0 | 0 |
| planted-verify | 189/190 | 189/190 | 0 | 0 |
| planted-rubric | 117/120 | 117/120 | 0 | 0 |
| Total | 1751/1798 | 1751/1798 | 0 | 0 |

### gpt-6-luna

| Set | Current | With change | Fixes | Breaks |
| --- | ---: | ---: | ---: | ---: |
| fresh-rubric | 191/192 | 191/192 | 0 | 0 |
| fresh-reference | 140/192 | 140/192 | 0 | 0 |
| map-rubric | 156/156 | 156/156 | 0 | 0 |
| map-reference | 145/180 | 145/180 | 0 | 0 |
| hard-rubric | 120/120 | 120/120 | 0 | 0 |
| hard-factuality | 101/120 | 101/120 | 0 | 0 |
| hard-pii | 114/120 | 114/120 | 0 | 0 |
| hard-goal | 101/120 | 101/120 | 0 | 0 |
| heldout-rubric | 71/72 | 71/72 | 0 | 0 |
| heldout-factuality | 64/72 | 64/72 | 0 | 0 |
| heldout-pii | 68/72 | 68/72 | 0 | 0 |
| heldout-goal | 61/72 | 61/72 | 0 | 0 |
| planted-verify | 187/190 | 187/190 | 0 | 0 |
| planted-rubric | 120/120 | 120/120 | 0 | 0 |
| Total | 1639/1798 | 1639/1798 | 0 | 0 |

### Gemini 3.8 Flash

Dropped by the owner. Not recorded on any of the 14 sets. No Gemini pass is claimed.

| Set | Current | With change | Fixes | Breaks |
| --- | --- | --- | --- | --- |
| fresh-rubric | dropped by the owner | dropped by the owner | n/a | n/a |
| fresh-reference | dropped by the owner | dropped by the owner | n/a | n/a |
| map-rubric | dropped by the owner | dropped by the owner | n/a | n/a |
| map-reference | dropped by the owner | dropped by the owner | n/a | n/a |
| hard-rubric | dropped by the owner | dropped by the owner | n/a | n/a |
| hard-factuality | dropped by the owner | dropped by the owner | n/a | n/a |
| hard-pii | dropped by the owner | dropped by the owner | n/a | n/a |
| hard-goal | dropped by the owner | dropped by the owner | n/a | n/a |
| heldout-rubric | dropped by the owner | dropped by the owner | n/a | n/a |
| heldout-factuality | dropped by the owner | dropped by the owner | n/a | n/a |
| heldout-pii | dropped by the owner | dropped by the owner | n/a | n/a |
| heldout-goal | dropped by the owner | dropped by the owner | n/a | n/a |
| planted-verify | dropped by the owner | dropped by the owner | n/a | n/a |
| planted-rubric | dropped by the owner | dropped by the owner | n/a | n/a |

## Luna fresh-reference

Neither change moves this set: Luna stays at 140/192, while Haiku stays at 189/192. Both variants have 0 fixes, 0 breaks and 0 changed outcomes on this set.

The strict replay contains 40 false failures with already parsed `met: false`. In `fresh-reference-005`, the model treats the monthly modifier in "Its monthly fee is 307 crowns for 171 GB" as missing from the allowance. In `fresh-reference-133`, it treats the shared currency unit in "The superseded figure was 377; the final current fee for Vela-26 is 372 crowns" as missing from 377. Both raw answers contain valid source-addressed quotes, so evidence repair does not alter those semantic verdicts.

