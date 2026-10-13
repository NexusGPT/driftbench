## rubricbench (54 tuning items, 46 validation items)

| Row | Tuning half: accuracy [95% interval] | Validation half: accuracy [95% interval] | Balanced accuracy, tuning / validation | S1 calls per 100 | S2 calls per 100 | USD per 100 | Seconds per item |
|---|---|---|---|---:|---:|---:|---:|
| MoJ pw-s1-whole | 83.3 [71, 91] n=54 | 90.2 [78, 96] n=46 | 83 / 90 | 200 | 0 | 0.0000 | 0.91 |
| MoJ pw-s1-rows | 84.3 [72, 92] n=54 | 93.5 [82, 98] n=46 | 84 / 94 | 200 | 0 | 0.0000 | 1.28 |
| MoJ pw-moj-luna | 87.0 [76, 94] n=54 | 93.5 [82, 98] n=46 | 87 / 94 | 300 | 43 | 0.0151 | 4.40 |
| MoJ pw-moj-mix | 87.0 [76, 94] n=54 | 91.3 [80, 97] n=46 | 87 / 91 | 300 | 126 | 0.2656 | 10.26 |
| our judge (recorded) | 83.3 [65, 93] n=27 | 84.1 [64, 94] n=22 | 83 / 85 | 0 | 214 | n/a | n/a |
| our judge with a domain seat (recorded) | 86.4 [71, 94] n=33 | 98.1 [84, 100] n=26 | 86 / 98 | 0 | 100 | n/a | n/a |
| other framework (recorded) | 80.0 [55, 93] n=15 | 80.0 [38, 96] n=5 | 85 / 83 | 0 | 200 | n/a | n/a |
| other framework default grader, gpt-6-luna (fresh) | 82.4 [70, 90] n=54 | 88.0 [76, 95] n=46 | 83 / 88 | 0 | 200 | 0.0437 | 6.25 |
| other framework default grader, gemini-3.8-flash (fresh) | 79.8 [67, 88] n=52 | 77.4 [63, 87] n=42 | 80 / 77 | 0 | 200 | 0.6905 | 13.30 |
| other framework default grader, haiku (fresh) | 73.1 [60, 83] n=54 | 80.4 [67, 89] n=46 | 73 / 80 | 0 | 200 | 0.1305 | 9.00 |
| cheater: longer wins | 35.2 [24, 49] n=54 | 39.1 [26, 54] n=46 | 36 / 39 | 0 | 0 | 0.0000 | 0.00 |
| cheater: first wins | 50.0 [37, 63] n=54 | 50.0 [36, 64] n=46 | 50 / 50 | 0 | 0 | 0.0000 | 0.00 |

## verify (46 tuning items, 49 validation items)

| Row | Tuning half: accuracy [95% interval] | Validation half: accuracy [95% interval] | Balanced accuracy, tuning / validation | S1 calls per 100 | S2 calls per 100 | USD per 100 | Seconds per item |
|---|---|---|---|---:|---:|---:|---:|
| MoJ pw-s1-whole | 78.3 [64, 88] n=46 | 60.2 [46, 73] n=49 | 72 / 44 | 100 | 0 | 0.0000 | 0.65 |
| MoJ pw-s1-rows | 76.1 [62, 86] n=46 | 55.1 [41, 68] n=49 | 70 / 50 | 100 | 0 | 0.0000 | 0.72 |
| MoJ pw-moj-luna | 73.9 [60, 84] n=46 | 73.5 [60, 84] n=49 | 72 / 79 | 300 | 118 | 0.0546 | 12.86 |
| MoJ pw-moj-mix | 67.4 [53, 79] n=46 | 71.4 [58, 82] n=49 | 65 / 77 | 300 | 159 | 0.1659 | 15.65 |
| our judge (recorded) | 69.2 [42, 87] n=13 | 82.4 [59, 94] n=17 | 82 / 68 | 0 | 466 | 0.5564 | n/a |
| other framework (recorded) | 84.6 [58, 96] n=13 | 70.6 [47, 87] n=17 | 91 / 62 | 0 | 97 | 0.0743 | n/a |
| other framework default grader, gpt-6-luna (fresh) | 61.9 [47, 75] n=42 | 77.3 [63, 87] n=44 | 60 / 75 | 0 | 100 | 0.0636 | 8.11 |
| other framework default grader, gemini-3.8-flash (fresh) | 67.4 [53, 79] n=46 | 83.7 [71, 91] n=49 | 61 / 79 | 0 | 100 | 0.7121 | 9.43 |
| other framework default grader, haiku (fresh) | 69.6 [55, 81] n=46 | 69.4 [55, 80] n=49 | 59 / 70 | 0 | 100 | 0.1592 | 11.21 |
| cheater: constant fail | 78.3 [64, 88] n=46 | 85.7 [73, 93] n=49 | 50 / 50 | 0 | 0 | 0.0000 | 0.00 |
| cheater: constant pass | 21.7 [12, 36] n=46 | 14.3 [7, 27] n=49 | 50 / 50 | 0 | 0 | 0.0000 | 0.00 |

## hardrows (42 tuning items, 54 validation items)

| Row | Tuning half: accuracy [95% interval] | Validation half: accuracy [95% interval] | Balanced accuracy, tuning / validation | S1 calls per 100 | S2 calls per 100 | USD per 100 | Seconds per item |
|---|---|---|---|---:|---:|---:|---:|
| MoJ pw-s1-whole | 97.6 [88, 100] n=42 | 94.4 [85, 98] n=54 | 97 / 94 | 100 | 0 | 0.0000 | 0.40 |
| MoJ pw-s1-rows | 97.6 [88, 100] n=42 | 97.2 [89, 99] n=54 | 97 / 97 | 100 | 0 | 0.0000 | 0.43 |
| MoJ pw-moj-luna | 97.6 [88, 100] n=42 | 98.1 [90, 100] n=54 | 97 / 98 | 207 | 15 | 0.0015 | 1.28 |
| MoJ pw-moj-mix | 97.6 [88, 100] n=42 | 98.1 [90, 100] n=54 | 97 / 98 | 207 | 30 | 0.0169 | 1.91 |
| our judge (recorded) | 100.0 [92, 100] n=42 | 100.0 [93, 100] n=54 | 100 / 100 | 0 | 100 | 0.0389 | n/a |
| our shipped judge (recorded) | 97.6 [88, 100] n=42 | 96.3 [87, 99] n=54 | 97 / 97 | 0 | 100 | 0.0343 | n/a |
| other framework (recorded) | 97.6 [88, 100] n=42 | 88.9 [78, 95] n=54 | 97 / 90 | 0 | 100 | 0.0344 | n/a |
| other framework default grader, gpt-6-luna (fresh) | 100.0 [92, 100] n=42 | 100.0 [93, 100] n=54 | 100 / 100 | 0 | 100 | 0.0091 | 2.30 |
| other framework default grader, gemini-3.8-flash (fresh) | 100.0 [92, 100] n=42 | 100.0 [93, 100] n=54 | 100 / 100 | 0 | 100 | 0.1501 | 4.14 |
| other framework default grader, haiku (fresh) | 95.2 [84, 99] n=42 | 92.6 [82, 97] n=54 | 95 / 93 | 0 | 100 | 0.0328 | 4.80 |
| cheater: constant fail | 54.8 [40, 69] n=42 | 46.3 [34, 59] n=54 | 50 / 50 | 0 | 0 | 0.0000 | 0.00 |
| cheater: constant pass | 45.2 [31, 60] n=42 | 53.7 [41, 66] n=54 | 50 / 50 | 0 | 0 | 0.0000 | 0.00 |

## verify-with-reference (40 tuning items, 55 validation items)

| Row | Tuning half: accuracy [95% interval] | Validation half: accuracy [95% interval] | Balanced accuracy, tuning / validation | S1 calls per 100 | S2 calls per 100 | USD per 100 | Seconds per item |
|---|---|---|---|---:|---:|---:|---:|
| MoJ pw-s1-whole | 85.0 [71, 93] n=40 | 96.4 [88, 99] n=55 | 74 / 94 | 100 | 0 | 0.0000 | 0.48 |
| MoJ pw-s1-rows | 72.5 [57, 84] n=40 | 80.0 [68, 88] n=55 | 61 / 88 | 100 | 0 | 0.0000 | 0.49 |
| MoJ pw-moj-luna | 72.5 [57, 84] n=40 | 81.8 [70, 90] n=55 | 61 / 85 | 200 | 11 | 0.0097 | 1.94 |
| MoJ pw-moj-mix | 72.5 [57, 84] n=40 | 81.8 [70, 90] n=55 | 61 / 85 | 200 | 11 | 0.0097 | 1.94 |
| other framework default grader, gpt-6-luna (fresh) | 81.1 [66, 91] n=37 | 77.8 [64, 87] n=45 | 48 / 47 | 0 | 100 | 0.0691 | 7.95 |
| cheater: constant fail | 82.5 [68, 91] n=40 | 81.8 [70, 90] n=55 | 50 / 50 | 0 | 0 | 0.0000 | 0.00 |
| cheater: constant pass | 17.5 [9, 32] n=40 | 18.2 [10, 30] n=55 | 50 / 50 | 0 | 0 | 0.0000 | 0.00 |

