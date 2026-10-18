# Cutter level audit (docs/validators.md 12.7), map validator

Tree: tree-m, branch audit/map-v3. Baseline 188 of 188 on seeds 1,2,3. Method: one edit at a time to cut.ts or ledger.ts, run measure-map.mts on seeds 1,2,3, restore with `git checkout -- <path>`. The bank code was not read. A second, direct probe (own script, 40 small inputs and 12 ledger scenarios) shows which edits change behaviour at all. Tree is clean at the end.

## Check 4: planted bugs (first 20 count; 30 more run as extra evidence)

| # | File | Bug | Score after | Items lost | Behaviour changes on own probe |
|---|---|---|---|---|---|
| B01 | cut | span end off by one (+1) | 94/188 | 94 | yes |
| B02 | cut | BOM offset lost on unit start | 183/188 | 5 | yes |
| B03 | cut | fingerprint keeps white space | 188/188 | 0 | yes (reflowed text gets a new fp) |
| B04 | cut | fingerprint drops NFC | 188/188 | 0 | yes |
| B05 | cut | fingerprint lowercases | 188/188 | 0 | yes |
| B06 | cut | abbreviation merge rule (Dr., e.g.) removed | 185/188 | 3 | yes |
| B07 | cut | lower-case-start merge rule removed | 188/188 | 0 | yes |
| B08 | cut | inline code not masked | 188/188 | 0 | yes ("`Foo. Bar`" splits) |
| B09 | cut | URLs not masked | 188/188 | 0 | yes |
| B10 | cut | table cell span ends at first child | 186/188 | 2 | yes |
| B11 | cut | heading trail pops with > not >= (sibling headings stack) | 188/188 | 0 | yes |
| B12 | cut | list items cut as prose sentences | 178/188 | 10 | yes |
| B13 | cut | block quote paragraphs cut as prose | 188/188 | 0 | yes |
| B14 | cut | front matter value offset ignores opening fence | 188/188 | 0 | yes |
| B15 | cut | code fence opaque span covers the whole fence | 188/188 | 0 | yes |
| B16 | cut | tag-only lines not stripped from paragraph | 188/188 | 0 | yes |
| B17 | ledger | moved unit re-mints its id | 188/188 | 0 | yes |
| B18 | ledger | labels carried when only fp matches (context fp ignored) | 188/188 | 0 | yes |
| B19 | ledger | neighbour lookup by slice (copy per unit) | 188/188 | 0 | no (3,000-unit file ran in under 100 ms) |
| B20 | ledger | text floor removed | 188/188 | 0 | yes |

Result: 5 of 20 lose an item (B01, B02, B06, B10, B12). 15 of 20 keep 188/188, and 14 of those change real behaviour.

Extra 30 (same method), items lost:
- Caught (4 of 30): N01 last sentence of paragraph dropped (108 lost); N10 similarity divides by shorter length (2); N11 follow threshold 0.45 to 0.9 (2); N18 changed unit loses id (2).
- Not caught (26 of 30): B21 deleted entries dropped; B22 short-text uniqueness guard removed; B23 split gives the second piece the old id; B24 occurrence counter not incremented (duplicate ids collide differently); B25 cut digest ignores container; B26 trimSpan stops trimming trailing white space; B27 newline not flattened in mask; B28 digit-dot merge rule removed (no probe change either); B29 mintId ignores path; B30 ambiguous marks only the first hit; N02 heading path keeps `#`; N03 nested list items dropped; N04 comment cut as prose; N05 fp keeps list markers; N06 fp keeps quote markers; N07 BOM not detected; N08 YAML sequence index off by one; N09 ledger prefix from the head; N12 score weights swapped; N13 quadratic duplicate scan in add(); N14 id uses 3 hash bytes instead of 7; N15 id collision guard removed; N16 firstLineEnd boundary; N17 deleted entries sorted first; N19 merge branch off; N20 quadratic scan in follow().
- Overall: 9 of 50 distinct bugs lose an item; 41 of 50 survive at 188/188.

## Check 2: the cheater (shortcut cutters / ledgers that keep 188/188 on real prompts being wrong)

| # | Shortcut | Score after | Items lost | Wrong on a real prompt? | Caught? |
|---|---|---|---|---|---|
| S01 | never split sentences (one unit per paragraph) | 188/188 | 0 | yes: every multi-sentence paragraph becomes one unit, labels cannot point at one rule | NO |
| S02 | one unit per line, no sentence logic | 185/188 | 3 | yes | yes |
| S03 | split at every full stop, no merge rule | 185/188 | 3 | yes (Dr., e.g.) | yes |
| S04 | ignore tables | 155/188 | 33 | yes | yes |
| S05 | fingerprint of the raw text | 188/188 | 0 | yes: a reflow or NFD edit looks like a change | NO |
| S06 | ignore front matter | 188/188 | 0 | yes: descriptions and keys never become units | NO |
| S07 | headings are not units | 188/188 | 0 | yes | NO |
| S08 | no masking (naive split on inline code and URLs) | 188/188 | 0 | yes | NO |
| S09 | ledger forgets the past (ids from fp and occurrence only) | 164/188 | 24 | yes | yes |
| S10 | ledger id by file and position only | 188/188 | 0 | yes: any insert shifts every id | NO |
| S11 | ledger follows exact fingerprints only (no ladder) | 186/188 | 2 | yes | yes |
| S12 | ledger never keeps labels | 188/188 | 0 | yes: every scan re-labels everything | NO |
| S13 | list and quote paragraphs cut as prose sentences | 178/188 | 10 | yes | yes |

Result: 6 of 13 caught, 7 pass undetected (S01, S05, S06, S07, S08, S10, S12). S01 changes the cut of 8 of my 40 probe inputs yet loses no item, so the bank holds no item that needs a paragraph to be split into two sentences.

Note: span, BOM, table, list and abbreviation items exist and catch their bugs. Ledger items exist but only catch a lost id on an edited unit (N18, S09, S11); a moved unit, split, duplicate text, path in the id and label carry are untested.

cheater: fail 7 of 13 shortcuts keep 188/188 while wrong (never splitting sentences, raw-text fingerprint, no front matter, no headings, no masking, positional ids, no label carry)
planted bugs: fail 5 of 20 bugs lost at least one item
