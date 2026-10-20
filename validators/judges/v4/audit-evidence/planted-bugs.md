| planted bugs | pass | All 20 committed bugs and 39 of 42 extras are caught on 5501d11d0 (seeds 1, 2). The 3 still passing are set aside: m1 and m2 (no behaviour change), t06 (contrived guard). No realistic bug is missed. |

Final bank: pw2 at commit 5501d11d0. Base copy: 50 of 50 at seeds 1 and 2. Scorer: pointer-score.mts --blind (score-full.mts prints every miss). Caught = loses at least one item at both seeds. 62 copies re-scored: 20 committed bugs and 42 extras (e 9, s 12, t 6, n 10, m 5). Earlier rounds are kept at audit-out/planted/round1.verdict.md.txt, round2.verdict.md.txt and round3.verdict.md.txt.

Results on this commit
- The 20 committed bugs (b01 to b20): all caught, 42 to 49 of 50 at seed 1.
- 39 of 42 extras caught, 38 to 49 of 50 at seed 1 (lowest e07, 38).
- Earlier misses now caught at both seeds: s03 48, s05 49, s06 43, s07 49, e02 49, n04 49, n06 48, n09 49, m3 48 (choice/vector-refused), m4 49 (yes-no/asked-labels). m5 49.

Misses, classified (3 of 42; none realistic)
- m1, equivalent. stack.ts:136, margin sort comparator returns 1 or -1 on ties. A probe shows the same label and margin as the base for {a,b}, {b,a} and three equal options: no input separates the two builds.
- m2, equivalent. labels.ts:173, an accepted unit without a target carries a key target: undefined. The only reader of the field in the module (dense.ts:123) tests accepted?.target === undefined, and JSON drops the key; only Object.keys differs. No behaviour of the module changes.
- t06, contrived. yesno.ts:76, a guard that makes a set of more than six labels never count as unanswered. No realistic regression has this form. Input that would catch it: yesNoOpinions with 7 asked labels and 6 answered must give no opinion.

Pass rule applied: pass iff all 20 committed bugs and every realistic extra bug is caught. Both hold on 5501d11d0.

### b: the 20 committed bugs
| bug | file:line (in pointer/) | function | change | passing of 50, seed 1 / seed 2 | state | items lost at seed 1 (* = only through its seeded or control part) |
|---|---|---|---|---|---|---|
| b01 | labels.ts:111 | expandUnits | reversed-range refusal dropped (7-5 now gives []) | 48 / 47 | caught | units/expand-invalid, answer/refuses-bad-units |
| b02 | labels.ts:111 | expandUnits | range cap off by one (a span of exactly 10 000 is now refused) | 48 / 49 | caught | units/expand-valid*, units/expand-invalid |
| b03 | labels.ts:148 | checkAnswer | named-twice refusal dropped | 48 / 48 | caught | answer/refuses-named-twice, answer/refusal-keeps-rest |
| b04 | labels.ts:152 | checkAnswer | integer check on the target dropped (1.5 accepted) | 48 / 48 | caught | answer/refuses-bad-target, answer/refusal-keeps-rest* |
| b05 | labels.ts:145 | checkAnswer | an out-of-window refusal now aborts the rest of the answer (continue to break) | 48 / 48 | caught | answer/refuses-outside-window, answer/refusal-keeps-rest |
| b06 | labels.ts:45 | canonical | object keys no longer sorted | 42 / 42 | caught | set-hash/value, set-hash/pairs, set-hash/isolated, recording/labelling-hash, recording/labelling-hash-changes, recording/key-value, recording/key-set-and-model, recording/key-body-and-labeler |
| b07 | labels.ts:94 | setHash | set description missing from the set hash | 47 / 47 | caught | set-hash/value, set-hash/pairs, set-hash/isolated |
| b08 | labels.ts:76 | parseLabelSets | duplicate label name refusal dropped | 49 / 49 | caught | label-file/refuse-duplicates |
| b09 | labels.ts:57 | parseLabelSets | YAML duplicate keys no longer refused | 49 / 49 | caught | label-file/refuse-yaml |
| b10 | cassette.ts:38 | requestKey | readable fields missing from the request key | 47 / 47 | caught | recording/key-value, recording/key-set-and-model, recording/key-body-and-labeler |
| b11 | cassette.ts:58 | readableOf | part hash length 12 changed to 10 | 47 / 47 | caught | recording/key-value, recording/key-set-and-model, recording/key-body-and-labeler |
| b12 | yesno.ts:42 | askedLabels | skipTargetLabels inverted in the target-label refusal | 42 / 42 | caught | yes-no/asked-labels, stack/cascade-sure*, stack/cascade-unsure*, stack/cascade-fallback*, stack/cascade-targets, stack/cascade-bounds*, stack/margin-rule*, stack/margin-no-vector |
| b13 | yesno.ts:82 | yesNoOpinions | threshold comparison at-or-above changed to above | 48 / 47 | caught | yes-no/asked-labels*, yes-no/threshold |
| b14 | yesno.ts:170 | isVector | float epsilon dropped from the tolerance edge | 46 / 46 | caught | choice/vector-tolerance, choice/vector-refused*, choice/choice-ties-missing*, stack/margin* |
| b15 | yesno.ts:190 | choiceOpinions | tie-break lost in a choice answer: the last of equal options wins | 46 / 46 | caught | choice/vector-tolerance, choice/vector-refused, choice/choice-ties-missing, stack/margin* |
| b16 | stack.ts:135 | margin | margin no longer requires none among the options | 48 / 48 | caught | stack/margin, stack/margin-no-vector |
| b17 | stack.ts:119 | single | single labelling drops the target | 49 / 49 | caught | stack/single |
| b18 | stack.ts:150 | stacked | margin cut comparison at-or-above changed to above | 49 / 49 | caught | stack/margin-rule |
| b19 | yesno.ts:84 | yesNoOpinions | a partly answered unit now gets an opinion (guessed) | 49 / 49 | caught | yes-no/unanswered |
| b20 | stack.ts:157 | stacked | cascade fail bound: under changed to at-or-under | 49 / 49 | caught | stack/cascade-sure |

### e: extra probes, round 1
| bug | file:line (in pointer/) | function | change | passing of 50, seed 1 / seed 2 | state | items lost at seed 1 (* = only through its seeded or control part) |
|---|---|---|---|---|---|---|
| e01 | yesno.ts:47 | askedLabels | empty asked-list refusal dropped | 49 / 49 | caught | yes-no/asked-labels |
| e02 | yesno.ts:169 | isVector | upper bound 1 on a probability dropped | 49 / 49 | caught | choice/vector-refused |
| e03 | stack.ts:207 | describeMember | runs missing from the labelling hash | 48 / 48 | caught | recording/labelling-hash, recording/labelling-hash-changes |
| e04 | stack.ts:178 | stacked | fallback flag lost when system 1 gave no opinion | 48 / 48 | caught | stack/cascade-fallback, stack/margin-no-vector |
| e05 | labels.ts:156 | checkAnswer | none-takes-no-target refusal dropped | 47 / 48 | caught | answer/refuses-none-target, answer/refuses-missing-target*, answer/refusal-keeps-rest* |
| e06 | labels.ts:79 | parseLabelSets | condition-needs-target refusal dropped | 49 / 49 | caught | label-file/refuse-conditions |
| e07 | labels.ts:107 | expandUnits | surrounding spaces no longer trimmed in a unit range | 38 / 38 | caught | units/expand-valid, units/expand-invalid*, answer/accepted, answer/refuses-unknown-label*, answer/refuses-bad-units*, answer/refuses-outside-window*, answer/refuses-named-twice*, answer/refuses-bad-target*, answer/refuses-none-target*, answer/refuses-missing-target*, answer/refuses-extra-target*, answer/refusal-keeps-rest* |
| e08 | yesno.ts:82 | yesNoOpinions | tie-break lost in a yes or no answer: the last of equal labels wins | 47 / 47 | caught | yes-no/asked-labels*, yes-no/threshold, yes-no/unanswered |
| e09 | stack.ts:183 | stacked | target labels no longer left to system 2 alone | 48 / 48 | caught | stack/cascade-targets, stack/margin-no-vector |

### s: extra probes, round 1
| bug | file:line (in pointer/) | function | change | passing of 50, seed 1 / seed 2 | state | items lost at seed 1 (* = only through its seeded or control part) |
|---|---|---|---|---|---|---|
| s01 | yesno.ts:85 | yesNoOpinions | opinion keyed by the unit number instead of its place in the file | 47 / 47 | caught | yes-no/asked-labels*, yes-no/threshold, yes-no/unanswered |
| s02 | yesno.ts:200 | choiceOpinions | opinion keyed by the unit number instead of its place in the file | 45 / 45 | caught | choice/vector-tolerance, choice/vector-refused, choice/choice-ties-missing, stack/margin*, gold-set/gold-scan |
| s03 | yesno.ts:196 | choiceOpinions | sum in the no-vector refusal text rounded to 2 decimals | 48 / 48 | caught | choice/vector-tolerance, choice/vector-refused |
| s04 | stack.ts:137 | margin | margin of a lone option: second default 0 changed to 1 | 49 / 49 | caught | stack/margin |
| s05 | stack.ts:154 | stacked | cascade top label: last of equal probabilities wins | 49 / 49 | caught | stack/cascade-sure |
| s06 | stack.ts:190 | stacked | sure decision drops the second labeler's cassette key from its sources | 43 / 43 | caught | stack/cascade-sure, stack/cascade-unsure*, stack/cascade-fallback*, stack/cascade-targets, stack/cascade-bounds, stack/margin-rule, stack/margin-no-vector* |
| s07 | stack.ts:121 | single | single labelling drops the sources | 49 / 49 | caught | stack/single |
| s08 | labels.ts:148 | checkAnswer | units of a later-refused entry are marked covered | 44 / 44 | caught | answer/refuses-named-twice, answer/refuses-bad-target, answer/refuses-none-target, answer/refuses-missing-target, answer/refuses-extra-target, answer/refusal-keeps-rest |
| s09 | labels.ts:68 | parseLabelSets | shape refusal drops the path of the field | 49 / 49 | caught | label-file/refuse-shape |
| s10 | yesno.ts:41 | askedLabels | asked labels come back in reverse order | 49 / 49 | caught | yes-no/asked-labels |
| s11 | stack.ts:113 | single | single labelling hash cut at 15 characters | 49 / 49 | caught | recording/labelling-hash |
| s12 | stack.ts:206 | describeMember | settings missing from the labelling hash | 48 / 48 | caught | recording/labelling-hash, recording/labelling-hash-changes |

### t: extra probes, round 1
| bug | file:line (in pointer/) | function | change | passing of 50, seed 1 / seed 2 | state | items lost at seed 1 (* = only through its seeded or control part) |
|---|---|---|---|---|---|---|
| t01 | labels.ts:111 | expandUnits | range cap loosened by one | 49 / 48 | caught | units/expand-invalid |
| t02 | labels.ts:111 | expandUnits | range cap loosened to 10 500 | 48 / 48 | caught | units/expand-valid*, units/expand-invalid |
| t03 | yesno.ts:164 | VECTOR_TOLERANCE | vector tolerance loosened to 0.0105 | 49 / 49 | caught | choice/vector-tolerance |
| t04 | yesno.ts:164 | VECTOR_TOLERANCE | vector tolerance tightened to 0.0095 | 46 / 46 | caught | choice/vector-tolerance, choice/vector-refused*, choice/choice-ties-missing*, stack/margin* |
| t05 | labels.ts:144 | checkAnswer | some swapped for every: a range partly outside the window is accepted | 48 / 48 | caught | answer/refuses-outside-window, answer/refusal-keeps-rest |
| t06 | yesno.ts:76 | yesNoOpinions | units of a set with more than six labels never count as unanswered | 50 / 50 | MISSED (contrived, set aside) | - |

### n: 10 bugs, round 2
| bug | file:line (in pointer/) | function | change | passing of 50, seed 1 / seed 2 | state | items lost at seed 1 (* = only through its seeded or control part) |
|---|---|---|---|---|---|---|
| n01 | labels.ts:13 | Label schema | a label with an unknown key is accepted | 49 / 49 | caught | label-file/refuse-shape |
| n02 | labels.ts:107 | expandUnits | unit range end anchor dropped (5abc reads as 5) | 47 / 46 | caught | units/expand-valid*, units/expand-invalid, answer/refuses-bad-units* |
| n03 | labels.ts:164 | checkAnswer | takes-no-target refusal dropped for an ordinary label | 48 / 48 | caught | answer/refuses-extra-target, answer/refusal-keeps-rest* |
| n04 | labels.ts:61 | parseLabelSets | YAML error shows all lines, not the first | 49 / 49 | caught | label-file/refuse-yaml |
| n05 | cassette.ts:60 | readableOf | labeler missing from the readable fields | 47 / 47 | caught | recording/key-value, recording/key-set-and-model, recording/key-body-and-labeler |
| n06 | yesno.ts:81 | yesNoOpinions | opinion no longer carries the probabilities | 48 / 48 | caught | yes-no/threshold, yes-no/unanswered |
| n07 | yesno.ts:170 | isVector | vector sum checked on one side only (low sums accepted) | 48 / 48 | caught | choice/vector-tolerance, stack/margin |
| n08 | stack.ts:191 | stacked | sure decision without a second labeler loses its fallback flag | 47 / 47 | caught | stack/cascade-sure, stack/cascade-fallback, stack/margin-no-vector |
| n09 | stack.ts:212 | label | report line names the classes the wrong way round | 49 / 49 | caught | recording/labelling-hash |
| n10 | stack.ts:120 | single | single labelling always says system 1 decided | 49 / 49 | caught | stack/single |

### m: 5 bugs, round 3
| bug | file:line (in pointer/) | function | change | passing of 50, seed 1 / seed 2 | state | items lost at seed 1 (* = only through its seeded or control part) |
|---|---|---|---|---|---|---|
| m1 | stack.ts:136 | margin | margin sort breaks ties the other way (last of equal options leads) | 50 / 50 | MISSED (equivalent, set aside) | - |
| m2 | labels.ts:173 | checkAnswer | an accepted unit without a target carries target undefined | 50 / 50 | MISSED (equivalent, set aside) | - |
| m3 | yesno.ts:196 | choiceOpinions | no-vector refusal drops the window id | 48 / 48 | caught | choice/vector-tolerance, choice/vector-refused |
| m4 | yesno.ts:44 | askedLabels | refusal advice names the wrong class | 49 / 49 | caught | yes-no/asked-labels |
| m5 | labels.ts:77 | parseLabelSets | duplicate label refusal drops the label name | 49 / 49 | caught | label-file/refuse-duplicates |
