# Cutter level re-audit (301 items), map validator

Tree: tree-m, branch exec/map-cutter-pilot, head a7f1ef2b6, baseline 301 of 301 (seeds 1,2,3). Same method as the first audit: one edit at a time, measure-map.mts, `git checkout -- <path>`, tree clean at the end. Bank code not read. Same 50 bugs and 13 shortcuts as audit 1 (scripts in audit/mm/).

## Check 4: planted bugs (B01 to B20)

| # | Bug | Audit 1 | Now (of 301) | Lost |
|---|---|---|---|---|
| B01 | span end off by one | 94 lost | 190 | 111 |
| B02 | BOM offset lost | 5 | 296 | 5 |
| B03 | fingerprint keeps white space | 0 | 297 | 4 |
| B04 | fingerprint drops NFC | 0 | 301 | 0 |
| B05 | fingerprint lowercases | 0 | 301 | 0 |
| B06 | abbreviation merge rule removed | 3 | 298 | 3 |
| B07 | lower-case-start merge rule removed | 0 | 301 | 0 |
| B08 | inline code not masked | 0 | 289 | 12 |
| B09 | URLs not masked | 0 | 301 | 0 |
| B10 | table cell span ends at first child | 2 | 299 | 2 |
| B11 | sibling headings stack in the trail | 0 | 301 | 0 |
| B12 | list items cut as prose | 10 | 287 | 14 |
| B13 | block quote context dropped | 0 | 298 | 3 |
| B14 | front matter offset ignores the fence | 0 | 292 | 9 |
| B15 | code fence opaque span covers whole fence | 0 | 301 | 0 |
| B16 | tag-only lines kept in a paragraph | 0 | 301 | 0 |
| B17 | moved unit re-mints its id | 0 | 298 | 3 |
| B18 | labels carried when only fp matches | 0 | 301 | 0 |
| B19 | copy per unit in neighbour lookup | 0 | 301 | 0 |
| B20 | text floor removed | 0 | 301 | 0 |

First 20: 10 of 20 lose an item (was 5). Still silent: B04, B05, B07, B09, B11, B15, B16, B18, B19, B20.

Extras (26 that survived audit 1):
- Newly caught (2 of 26): B21 deleted entries dropped (3 lost); B23 split gives the second piece the old id (3 lost).
- Still silent (24 of 26): B22, B24, B25, B26, B27, B28, B29, B30, N02, N03, N04, N05, N06, N07, N08, N09, N12, N13, N14, N15, N16, N17, N19, N20. These include quadratic loops (N13, N20), id collisions (B24, N14, N15), path missing from the id (B29), BOM not detected (N07), YAML sequence index off by one (N08), comment cut as prose (N04), nested list items dropped (N03), and fingerprint keeping list or quote markers (N05, N06).
- The 4 caught in audit 1 (N01, N10, N11, N18) are still caught.
- Note: B28 and B30 changed nothing on my probe in audit 1 either, and may be equivalent mutants. B19 and N13 and N20 are performance only.
- Overall: 16 of 50 bugs lose an item (was 9); 34 of 50 stay at 301/301.

## Check 2: the cheater (13 shortcuts)

| # | Shortcut | Audit 1 | Now (of 301) | Lost | Caught |
|---|---|---|---|---|---|
| S01 | never split sentences | 0 | 283 | 18 | yes (was no) |
| S02 | one unit per line | 3 | 280 | 21 | yes |
| S03 | split at every full stop | 3 | 298 | 3 | yes |
| S04 | ignore tables | 33 | 268 | 33 | yes |
| S05 | fingerprint of the raw text | 0 | 297 | 4 | yes (was no) |
| S06 | ignore front matter | 0 | 292 | 9 | yes (was no) |
| S07 | headings are not units | 0 | 293 | 8 | yes (was no) |
| S08 | no masking | 0 | 283 | 18 | yes (was no) |
| S09 | ledger forgets the past | 24 | 265 | 36 | yes |
| S10 | ledger id by file and position only | 0 | 301 | 0 | NO |
| S11 | ledger follows exact fingerprints only | 2 | 293 | 8 | yes |
| S12 | ledger never keeps labels | 0 | 298 | 3 | yes (was no) |
| S13 | list and quote paragraphs cut as prose | 10 | 284 | 17 | yes |

Result: 12 of 13 caught (was 6). One shortcut passes: a ledger that mints each id from the file and the unit's position. It is wrong on a real prompt because an insert shifts every later id, and the label of each shifted unit is lost.

Remaining weak spots: ledger id minting (path in the id, collision guard, hash width, position-only ids), the text floor and context-fingerprint label rule, and every perf-only bug.

cheater: fail 1 of 13 shortcuts keeps 301/301 while wrong (ledger ids from file and position only)
planted bugs: fail 10 of 20 bugs lost at least one item
