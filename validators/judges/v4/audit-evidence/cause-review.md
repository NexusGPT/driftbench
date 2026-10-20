| cause review | pass | 30 of 30 items agree (1.00; 0.90 if scored strictly); I find 33 distinct causes in the 43 failing items, the author's text has 27 distinct strings |

# Cause review, final bank (50 items; 43 fail on the emptied module)

Files: audit-out/causes/failing.json (blind list), mine.md (my 30 changes, written before step 3), failing-with-cause.json (author causes, read after).

## Method
- Blind failing list taken from the emptied module (7 of 50 pass, 43 fail). The details only say "not implemented: <function>", so I took the function from the detail and the behaviour from the item id and the doc comments of the emptied copy.
- 30 items chosen by family, proportional to family size, spread over tiers: units 2/2, set-hash 2/3, answer 7/10, label-file 5/6, yes-no 2/3, choice 2/3, stack 6/9, recording 3/5, gold-set 1/2.
- I did not open pointer.ts or the shipped module before mine.md was complete.

## Agreement (pair agrees = same function and same behaviour)
| # | item | agree | note |
|---|---|---|---|
| 1 | units/expand-valid | yes | expandUnits reads a number or range |
| 2 | units/expand-invalid | yes | refuses anything else |
| 3 | set-hash/value | yes | same function, hash of sorted-key JSON; I missed "first 16 hex characters" (not in the doc comments) |
| 4 | set-hash/isolated | yes | |
| 5 | answer/accepted | yes | |
| 6 | answer/refuses-unknown-label | yes | author adds "with the set named" in the message |
| 7 | answer/refuses-bad-units | yes | |
| 8 | answer/refuses-outside-window | yes | |
| 9 | answer/refuses-named-twice | yes | author adds "keeps the first answer" |
| 10 | answer/refuses-none-target | yes | author's cause covers required, none, extra, outside window; mine is the none case |
| 11 | answer/refusal-keeps-rest | yes | author adds "covers none of its units" |
| 12 | label-file/read-valid | yes | |
| 13 | label-file/refuse-names | yes | |
| 14 | label-file/refuse-duplicates | yes | |
| 15 | label-file/refuse-conditions | yes | author files conditions under shape validation; same function, same refusal |
| 16 | label-file/refuse-yaml | yes | |
| 17 | yes-no/asked-labels | yes | skip target labels, refuse otherwise |
| 18 | yes-no/unanswered | yes | |
| 19 | choice/vector-tolerance | yes | isVector, 0.01 |
| 20 | choice/choice-ties-missing | yes | |
| 21 | stack/margin | yes | author adds: no margin when `none` is absent |
| 22 | stack/cascade-sure | yes | |
| 23 | stack/cascade-fallback | yes | |
| 24 | stack/cascade-bounds | yes | author states the generic cascade rule; I named the edge rule of the same bounds |
| 25 | stack/margin-no-vector | yes | |
| 26 | stack/single | yes | author adds "no opinion is no decision" |
| 27 | recording/labelling-hash | yes | same function, hash of canonical members and rule; I missed "16 hex characters" |
| 28 | recording/key-value | yes | author names readableOf and requestKey; I named readableOf |
| 29 | recording/key-body-and-labeler | yes | |
| 30 | gold-set/gold-set | yes | stacked cascade rule |

Agreement = 30 / 30 = 1.00 (threshold 0.8): pass.
Strict reading: three pairs are weaker (3 and 27, where my change would give a hash of the wrong length because the 16-character cut is in no doc comment; 28, where the author also names requestKey). Scored as disagreements: 27 / 30 = 0.90, still a pass.

## Distinct causes
- My count: 33 distinct causes among the 43 failing items. Criterion: a distinct rule that a mutant could drop alone. I would merge 10 of the 43: set-hash 2 (value, pairs, isolated are one), answer 1 (none-target and extra-target are one), label-file 2 (read-valid, names, shape are one schema check), choice 1 (tolerance and refused are one isVector rule), stack 1 (cascade-sure and cascade-unsure), recording 1 (the two labelling-hash items), gold-set 2 (both fail only because stacked is empty; no rule of their own).
- The author writes one cause per item (43), but the text repeats: 27 distinct strings among the 43. Where the author's string repeats it matches my merges (set-hash 3, label-file names/conditions/shape, stack cascade, choice vector, recording hash and key groups, gold-set).
- Finer split I would keep that the author's repeated strings hide: the three label-file shape items (names, conditions, shape) and the three readableOf items check different field groups, so a mutant could drop one without the others.

## Caveats
- Nothing in the failing details separates rules inside one function (every detail is "not implemented"). A reader of the blind list learns the function from the detail and the rule only from the id; for the ids above this was enough.
- requestKey and canonical have no item that names them in the detail text; they are reached through readableOf-based keys and setHash.
- gold-set items give no rule of their own in the id; the author's cause (the cascade rule) is the only reading I can derive.
