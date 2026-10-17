| Pair | Units | Same label | Agreement % | Cohen kappa | Instruction vs not, agree % | Exact-span F1 (first as gold) | IoU>=0.5 recall % |
|---|---|---|---|---|---|---|---|
| A vs C | 566 | 465 | 82.2 | 0.774 | 91.7 | 78.2 | 97.1 |
| A vs B | 566 | 453 | 80.0 | 0.748 | 90.8 | 76.1 | 97.7 |
| B vs C | 566 | 501 | 88.5 | 0.857 | 94.9 | 82.1 | 94.0 |
| frozen gold3 vs C | 566 | 495 | 87.5 | 0.843 | 91.5 | 79.1 | 97.7 |
| frozen gold3 vs A | 566 | 521 | 92.0 | 0.898 | 98.4 | 93.4 | 99.4 |

Rules: A 173 (multi-unit 69), B 200 (79), C 190 (86), frozen gold 174 (73).

| Answer key | Units | Dev (3 files) | Test (6 files) | Outside multi-unit rules | Inside multi-unit rules |
|---|---|---|---|---|---|
| A = C (answer key without Haiku) | 465 | 148 | 317 | 335 | 130 |
| A = B = C | 429 | 144 | 285 | 311 | 118 |
| frozen gold3 = C | 495 | 158 | 337 | 339 | 156 |
| all units | 566 | 175 | 391 | 388 | 178 |

Rules that A and C produce identically (same units, same kind): 123 of A's 173 and C's 190; multi-unit 46.

A (rows) against C (columns):

| A \ C | rule | prohibition | gate | example | description | none |
|---|---|---|---|---|---|---|
| rule | 115 | 25 | 21 | 2 | 1 | 0 |
| prohibition | 1 | 65 | 4 | 0 | 1 | 0 |
| gate | 0 | 2 | 36 | 0 | 1 | 0 |
| example | 0 | 0 | 0 | 17 | 0 | 0 |
| description | 28 | 9 | 5 | 0 | 128 | 0 |
| none | 0 | 0 | 0 | 0 | 1 | 104 |
