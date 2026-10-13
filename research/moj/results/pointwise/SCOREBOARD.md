## rubricbench (54 tuning items, 46 validation items)

| Row | Tuning half: accuracy [95% interval] | Validation half: accuracy [95% interval] | Balanced accuracy, tuning / validation | S1 calls per 100 | S2 calls per 100 | USD per 100 | Seconds per item |
|---|---|---|---|---:|---:|---:|---:|
| MoJ pw-s1-whole | 82.4 [70, 90] n=54 | 91.3 [80, 97] n=46 | 82 / 91 | 200 | 0 | 0.0000 | 0.88 |
| MoJ pw-s1-rows | 88.0 [77, 94] n=54 | 89.1 [77, 95] n=46 | 87 / 89 | 200 | 0 | 0.0000 | 1.43 |
| MoJ pw-moj-luna | 88.9 [78, 95] n=54 | 89.1 [77, 95] n=46 | 89 / 89 | 300 | 26 | 0.0065 | 3.29 |
| MoJ pw-moj-mix | 83.3 [71, 91] n=54 | 84.8 [72, 92] n=46 | 84 / 85 | 300 | 487 | 0.7304 | 25.97 |
| our judge (recorded) | 94.4 [79, 99] n=27 | 70.5 [50, 85] n=22 | 95 / 71 | 0 | 214 | n/a | n/a |
| our judge with a domain seat (recorded) | 87.5 [72, 95] n=32 | 96.3 [82, 99] n=27 | 88 / 96 | 0 | 100 | n/a | n/a |
| other framework (recorded) | 80.0 [49, 94] n=10 | 80.0 [49, 94] n=10 | 86 / 83 | 0 | 200 | n/a | n/a |
| other framework default grader, gpt-6-luna (fresh) | 86.1 [74, 93] n=54 | 83.7 [71, 92] n=46 | 86 / 84 | 0 | 200 | 0.0382 | 5.91 |
| other framework default grader, gemini-3.8-flash (fresh) | 80.4 [68, 89] n=51 | 76.7 [62, 87] n=43 | 81 / 77 | 0 | 200 | 0.7096 | 14.10 |
| other framework default grader, haiku (fresh) | 76.9 [64, 86] n=54 | 76.1 [62, 86] n=46 | 77 / 75 | 0 | 200 | 0.1121 | 8.74 |
| cheater: longer wins | 35.2 [24, 49] n=54 | 39.1 [26, 54] n=46 | 36 / 38 | 0 | 0 | 0.0000 | 0.00 |
| cheater: first wins | 50.0 [37, 63] n=54 | 50.0 [36, 64] n=46 | 50 / 50 | 0 | 0 | 0.0000 | 0.00 |

## verify (53 tuning items, 42 validation items)

| Row | Tuning half: accuracy [95% interval] | Validation half: accuracy [95% interval] | Balanced accuracy, tuning / validation | S1 calls per 100 | S2 calls per 100 | USD per 100 | Seconds per item |
|---|---|---|---|---:|---:|---:|---:|
| MoJ pw-s1-whole | 79.2 [67, 88] n=53 | 72.6 [58, 84] n=42 | 61 / 45 | 100 | 0 | 0.0000 | 0.72 |
| MoJ pw-s1-rows | 35.8 [24, 49] n=53 | 28.6 [17, 44] n=42 | 53 / 22 | 100 | 0 | 0.0000 | 1.06 |
| MoJ pw-moj-luna | 73.6 [60, 84] n=53 | 71.4 [56, 83] n=42 | 62 / 68 | 300 | 102 | 0.0523 | 13.06 |
| MoJ pw-moj-mix | 75.5 [62, 85] n=53 | 71.4 [56, 83] n=42 | 72 / 63 | 300 | 388 | 1.1512 | 43.06 |
| our judge (recorded) | 77.8 [55, 91] n=18 | 75.0 [47, 91] n=12 | 77 / 75 | 0 | 468 | 0.5625 | n/a |
| other framework (recorded) | 77.8 [55, 91] n=18 | 75.0 [47, 91] n=12 | 77 / 75 | 0 | 99 | 0.0740 | n/a |
| other framework default grader, gpt-6-luna (fresh) | 73.5 [60, 84] n=49 | 64.9 [49, 78] n=37 | 71 / 62 | 0 | 100 | 0.0797 | 8.58 |
| other framework default grader, gemini-3.8-flash (fresh) | 79.2 [67, 88] n=53 | 71.4 [56, 83] n=42 | 74 / 63 | 0 | 100 | 0.8313 | 10.28 |
| other framework default grader, haiku (fresh) | 75.5 [62, 85] n=53 | 61.9 [47, 75] n=42 | 72 / 53 | 0 | 100 | 0.1985 | 12.34 |
| cheater: constant fail | 83.0 [71, 91] n=53 | 81.0 [67, 90] n=42 | 50 / 50 | 0 | 0 | 0.0000 | 0.00 |
| cheater: constant pass | 17.0 [9, 29] n=53 | 19.0 [10, 33] n=42 | 50 / 50 | 0 | 0 | 0.0000 | 0.00 |

## hardrows (55 tuning items, 41 validation items)

| Row | Tuning half: accuracy [95% interval] | Validation half: accuracy [95% interval] | Balanced accuracy, tuning / validation | S1 calls per 100 | S2 calls per 100 | USD per 100 | Seconds per item |
|---|---|---|---|---:|---:|---:|---:|
| MoJ pw-s1-whole | 96.4 [88, 99] n=55 | 95.1 [84, 99] n=41 | 97 / 95 | 100 | 0 | 0.0000 | 0.33 |
| MoJ pw-s1-rows | 98.2 [90, 100] n=55 | 96.3 [86, 99] n=41 | 98 / 97 | 100 | 0 | 0.0000 | 0.38 |
| MoJ pw-moj-luna | 98.2 [90, 100] n=55 | 97.6 [87, 100] n=41 | 98 / 98 | 207 | 15 | 0.0012 | 1.14 |
| MoJ pw-moj-mix | 100.0 [93, 100] n=55 | 100.0 [91, 100] n=41 | 100 / 100 | 220 | 78 | 0.0606 | 3.99 |
| our judge (recorded) | 100.0 [93, 100] n=55 | 100.0 [91, 100] n=41 | 100 / 100 | 0 | 100 | 0.0386 | n/a |
| our shipped judge (recorded) | 96.4 [88, 99] n=55 | 97.6 [87, 100] n=41 | 96 / 98 | 0 | 100 | 0.0352 | n/a |
| other framework (recorded) | 92.7 [83, 97] n=55 | 92.7 [81, 97] n=41 | 92 / 93 | 0 | 100 | 0.0339 | n/a |
| other framework default grader, gpt-6-luna (fresh) | 100.0 [93, 100] n=55 | 100.0 [91, 100] n=41 | 100 / 100 | 0 | 100 | 0.0087 | 2.14 |
| other framework default grader, gemini-3.8-flash (fresh) | 100.0 [93, 100] n=55 | 100.0 [91, 100] n=41 | 100 / 100 | 0 | 100 | 0.1565 | 4.33 |
| other framework default grader, haiku (fresh) | 94.5 [85, 98] n=55 | 92.7 [81, 97] n=41 | 94 / 93 | 0 | 100 | 0.0337 | 4.91 |
| cheater: constant fail | 52.7 [40, 65] n=55 | 46.3 [32, 61] n=41 | 50 / 50 | 0 | 0 | 0.0000 | 0.00 |
| cheater: constant pass | 47.3 [35, 60] n=55 | 53.7 [39, 68] n=41 | 50 / 50 | 0 | 0 | 0.0000 | 0.00 |

## verify-with-reference (45 tuning items, 50 validation items)

| Row | Tuning half: accuracy [95% interval] | Validation half: accuracy [95% interval] | Balanced accuracy, tuning / validation | S1 calls per 100 | S2 calls per 100 | USD per 100 | Seconds per item |
|---|---|---|---|---:|---:|---:|---:|
| MoJ pw-s1-whole | 91.1 [79, 96] n=45 | 92.0 [81, 97] n=50 | 83 / 88 | 100 | 0 | 0.0000 | 0.48 |
| MoJ pw-s1-rows | 73.3 [59, 84] n=45 | 80.0 [67, 89] n=50 | 67 / 84 | 100 | 0 | 0.0000 | 0.50 |
| MoJ pw-moj-luna | 73.3 [59, 84] n=45 | 82.0 [69, 90] n=50 | 67 / 81 | 200 | 14 | 0.0112 | 2.15 |
| MoJ pw-moj-mix | 77.8 [64, 87] n=45 | 82.0 [69, 90] n=50 | 46 / 74 | 200 | 44 | 0.0296 | 4.23 |
| other framework default grader, gpt-6-luna (fresh) | 80.5 [66, 90] n=41 | 78.0 [63, 88] n=41 | 49 / 47 | 0 | 100 | 0.0659 | 7.82 |
| cheater: constant fail | 84.4 [71, 92] n=45 | 80.0 [67, 89] n=50 | 50 / 50 | 0 | 0 | 0.0000 | 0.00 |
| cheater: constant pass | 15.6 [8, 29] n=45 | 20.0 [11, 33] n=50 | 50 / 50 | 0 | 0 | 0.0000 | 0.00 |

