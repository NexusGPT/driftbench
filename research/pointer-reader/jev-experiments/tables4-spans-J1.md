#### Test files

| Design | Spans | Exact P / R / F1 % | Exact + kind F1 % | IoU >= 0.5 R % | Any-overlap R % | Multi-unit rules found exactly % | Agreed rules found exactly (A = C) | Predicted spans equal to a span of A or of C, % [Wilson 95%] |
|---|---|---|---|---|---|---|---|---|
| Jev head, per-unit labels only (no grouping) | 190 | 34.2 / 55.1 / **42.2** | 40.3 | 88.1 | 95.8 | 0.0 | 51 of 82 | 40.5 [33.8, 47.6] |
| Jev head + calibrated pair head (pair answers: 1 pass; tau 0.4 chosen on dev) | 124 | 66.9 / 70.3 / **68.6** | 60.3 | 93.2 | 95.8 | 69.4 | 66 of 82 | 78.2 [70.2, 84.6] |
| Jev head + calibrated pair head (pair answers: 3 passes; tau 0.4 chosen on dev) | 123 | 65.9 / 68.6 / **67.2** | 58.9 | 93.2 | 95.8 | 65.3 | 64 of 82 | 77.2 [69.1, 83.8] |
| Haiku run 1 with its own groups | 135 | 71.9 / 82.2 / **76.7** | 64.8 | 96.6 | 96.6 | 85.7 | 72 of 82 | 83.0 [75.7, 88.4] |
| Haiku run 2 with its own groups | 135 | 71.9 / 82.2 / **76.7** | 66.4 | 96.6 | 96.6 | 75.5 | 76 of 82 | 85.2 [78.2, 90.2] |
| Haiku run 3 with its own groups | 130 | 76.9 / 84.7 / **80.6** | 71.0 | 96.6 | 96.6 | 87.8 | 73 of 82 | 84.6 [77.4, 89.8] |
| Haiku consensus (spans produced identically by 2 of 3 runs) | 132 | 75.8 / 84.7 / **80.0** | 67.2 | 96.6 | 96.6 | 87.8 | 73 of 82 | 84.1 [76.9, 89.4] |
| Both agree: Jev head + pair head spans that Haiku consensus also produces | 87 | 86.2 / 63.6 / **73.2** | 63.4 | 69.5 | 69.5 | 59.2 | 59 of 82 | 95.4 [88.8, 98.2] |

#### Dev files

| Design | Spans | Exact P / R / F1 % | Exact + kind F1 % | IoU >= 0.5 R % | Any-overlap R % | Multi-unit rules found exactly % | Agreed rules found exactly (A = C) | Predicted spans equal to a span of A or of C, % [Wilson 95%] |
|---|---|---|---|---|---|---|---|---|
| Jev head, per-unit labels only (no grouping) | 85 | 34.1 / 51.8 / **41.1** | 38.3 | 73.2 | 94.6 | 0.0 | 24 of 41 | 36.5 [27.0, 47.1] |
| Jev head + calibrated pair head (pair answers: 1 pass; tau 0.4 chosen on dev) | 58 | 55.2 / 57.1 / **56.1** | 56.1 | 80.4 | 94.6 | 45.8 | 26 of 41 | 62.1 [49.2, 73.4] |
| Jev head + calibrated pair head (pair answers: 3 passes; tau 0.4 chosen on dev) | 59 | 54.2 / 57.1 / **55.7** | 55.7 | 80.4 | 94.6 | 45.8 | 26 of 41 | 61.0 [48.3, 72.4] |
| Haiku run 1 with its own groups | 65 | 72.3 / 83.9 / **77.7** | 74.4 | 96.4 | 100.0 | 83.3 | 37 of 41 | 83.1 [72.2, 90.3] |
| Haiku run 2 with its own groups | 60 | 81.7 / 87.5 / **84.5** | 77.6 | 94.6 | 100.0 | 83.3 | 38 of 41 | 86.7 [75.8, 93.1] |
| Haiku run 3 with its own groups | 65 | 76.9 / 89.3 / **82.6** | 79.3 | 100.0 | 100.0 | 83.3 | 40 of 41 | 89.2 [79.4, 94.7] |
| Haiku consensus (spans produced identically by 2 of 3 runs) | 65 | 76.9 / 89.3 / **82.6** | 79.3 | 98.2 | 100.0 | 87.5 | 40 of 41 | 86.2 [75.7, 92.5] |
| Both agree: Jev head + pair head spans that Haiku consensus also produces | 34 | 88.2 / 53.6 / **66.7** | 66.7 | 58.9 | 58.9 | 41.7 | 26 of 41 | 94.1 [80.9, 98.4] |

#### All 9 files

| Design | Spans | Exact P / R / F1 % | Exact + kind F1 % | IoU >= 0.5 R % | Any-overlap R % | Multi-unit rules found exactly % | Agreed rules found exactly (A = C) | Predicted spans equal to a span of A or of C, % [Wilson 95%] |
|---|---|---|---|---|---|---|---|---|
| Jev head, per-unit labels only (no grouping) | 275 | 34.2 / 54.0 / **41.9** | 39.6 | 83.3 | 95.4 | 0.0 | 75 of 123 | 39.3 [33.7, 45.2] |
| Jev head + calibrated pair head (pair answers: 1 pass; tau 0.4 chosen on dev) | 182 | 63.2 / 66.1 / **64.6** | 59.0 | 89.1 | 95.4 | 61.6 | 92 of 123 | 73.1 [66.2, 79.0] |
| Jev head + calibrated pair head (pair answers: 3 passes; tau 0.4 chosen on dev) | 182 | 62.1 / 64.9 / **63.5** | 57.9 | 89.1 | 95.4 | 58.9 | 90 of 123 | 72.0 [65.1, 78.0] |
| Haiku run 1 with its own groups | 200 | 72.0 / 82.8 / **77.0** | 67.9 | 96.6 | 97.7 | 84.9 | 109 of 123 | 83.0 [77.2, 87.6] |
| Haiku run 2 with its own groups | 195 | 74.9 / 83.9 / **79.1** | 69.9 | 96.0 | 97.7 | 78.1 | 114 of 123 | 85.6 [80.0, 89.9] |
| Haiku run 3 with its own groups | 195 | 76.9 / 86.2 / **81.3** | 73.7 | 97.7 | 97.7 | 86.3 | 113 of 123 | 86.2 [80.6, 90.3] |
| Haiku consensus (spans produced identically by 2 of 3 runs) | 197 | 76.1 / 86.2 / **80.9** | 71.2 | 97.1 | 97.7 | 87.7 | 113 of 123 | 84.8 [79.1, 89.1] |
| Both agree: Jev head + pair head spans that Haiku consensus also produces | 121 | 86.8 / 60.3 / **71.2** | 64.4 | 66.1 | 66.1 | 53.4 | 85 of 123 | 95.0 [89.6, 97.7] |

Agreed pairs (A and C agree on linked or not): 525 of 557; linked in A 101, in C 121; agreed rules 123 (multi-unit 46).