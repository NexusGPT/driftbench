Head: trained on the span corpus only (9 files, 465 keyed units), no unit of the growth corpus. Key = agreed units, 1256 of 1451.

#### Systems alone, on the key

| System | All estates [Wilson 95%] | Estate A | Estate B | Estate C |
|---|---|---|---|---|
| Jev head Jx, 0% unsure | 86.2 [84.2, 88.0] | 84.9 [81.5, 87.8] | 86.7 [83.1, 89.6] | 87.5 [83.6, 90.6] |
| Haiku run 1 | 96.5 [95.3, 97.4] | 96.7 [94.8, 98.0] | 96.5 [94.3, 97.9] | 96.1 [93.5, 97.7] |
| Haiku run 2 | 97.3 [96.2, 98.1] | 97.8 [96.0, 98.7] | 96.3 [94.0, 97.7] | 97.9 [95.8, 99.0] |
| Haiku run 3 | 90.4 [88.7, 92.0] | 81.1 [77.4, 84.3] | 94.9 [92.3, 96.6] | 98.5 [96.6, 99.4] |
| Haiku majority of 3 | 97.8 [96.8, 98.5] | 97.8 [96.0, 98.7] | 97.7 [95.8, 98.7] | 97.9 [95.8, 99.0] |
| Haiku unanimous only | 98.3 [97.4, 98.9] on 89.7% of units | | | |
| Jev head, 10% lowest-margin units unsure | 90.4 [88.6, 92.0] | | | |

#### The stack at a margin cut: Jev head first, Haiku (3 runs) for units below the cut, unanimous Haiku accepted, otherwise a person

| Margin cut | Share sent to Haiku | Accuracy on accepted, key [Wilson 95%] | Accepted units | To a person % | Accuracy of Jev-accepted units | Estate A / B / C accuracy on accepted |
|---|---|---|---|---|---|---|
| 0 | 0% | 86.2 [84.2, 88.0] | 1256 | 0.0 | 86.2 [84.2, 88.0] | 84.9 [81.5, 87.8] / 86.7 [83.1, 89.6] / 87.5 [83.6, 90.6] |
| 0.3 | 16% | 94.0 [92.5, 95.2] | 1225 | 2.5 | 93.5 [91.9, 94.9] | 92.9 [90.2, 94.9] / 94.8 [92.3, 96.5] / 94.3 [91.3, 96.3] |
| 0.5 | 27% | 96.2 [95.0, 97.1] | 1211 | 3.6 | 96.3 [94.9, 97.3] | 96.5 [94.4, 97.8] / 96.7 [94.5, 98.0] / 95.2 [92.4, 97.0] |
| 0.65 | 36% | 97.5 [96.5, 98.2] | 1199 | 4.5 | 98.1 [96.9, 98.9] | 97.6 [95.7, 98.6] / 97.4 [95.3, 98.5] / 97.6 [95.3, 98.8] |
| 0.76 | 48% | 98.1 [97.2, 98.8] | 1183 | 5.8 | 99.4 [98.4, 99.8] | 97.9 [96.2, 98.9] / 98.1 [96.3, 99.0] / 98.5 [96.5, 99.3] |
| 0.9 | 74% | 98.4 [97.4, 98.9] | 1154 | 8.1 | 100.0 [98.8, 100.0] | 98.1 [96.3, 99.0] / 98.1 [96.2, 99.0] / 99.1 [97.3, 99.7] |
| all to Haiku | 100% | 98.3 [97.4, 98.9] | 1127 | 10.3 | n/a | 98.0 [96.1, 99.0] / 98.0 [96.1, 99.0] / 99.1 [97.3, 99.7] |

#### Cut chosen on estates A and B, applied to estate C

| Target accuracy of Jev-accepted units on A and B | Margin cut | A and B: share kept by Jev | Estate C: share kept by Jev | Estate C: accuracy of Jev-accepted | Estate C: share sent to Haiku | Estate C: accuracy on accepted [Wilson 95%] | Estate C: to a person % |
|---|---|---|---|---|---|---|---|
| 95% | 0.43 | 76% | 81% | 94.1 [90.7, 96.4] | 19% | 95.2 [92.4, 97.0] | 0.6 |
| 97% | 0.50 | 72% | 76% | 93.8 [90.1, 96.1] | 24% | 95.2 [92.4, 97.0] | 0.6 |
| 98% | 0.55 | 69% | 73% | 94.3 [90.6, 96.6] | 27% | 95.8 [93.1, 97.5] | 0.9 |
| 99% | 0.73 | 55% | 58% | 98.5 [95.6, 99.5] | 42% | 98.2 [96.1, 99.2] | 2.4 |

Accept only if the Jev head and a unanimous Haiku give the same label: 99.4 [98.7, 99.7] on 983 of 1256 key units; 21.7% to a person.

All 1451 units at cut 0.65, accepted 1377 (5.1% to a person): accuracy against the author labels 89.3 [87.5, 90.8], against the Opus labels 92.2 [90.7, 93.5]. Sent to Haiku: 580.

Haiku, 3 full runs on all 1451 units: 66 calls, 341184 input and 234637 output tokens, USD 0.151 (0.0104 per 100 units); median 15.2 s per call.
