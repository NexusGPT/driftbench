### Span designs, Jev only

#### Descent labeller: Jev stacker trained on the other corpus (no Haiku, no label of this corpus); calibration folds: lofo-all

**Test files (6 files, 391 units, 118 rules)**

| Design | Per-unit acc % (all / outside multi-unit rules / inside) | Span exact P / R / F1 % | Exact + kind F1 % | IoU >= 0.5 P / R % | Any-overlap R % | Exact R %: multi-unit / single-unit rules | Spans (multi-unit) |
|---|---|---|---|---|---|---|---|
| s0: per-unit labels only, no grouping | 77.7 / 91.7 / 43.4 | 44.0 / 55.9 / **49.3** | 47.8 | 78.0 / 88.1 | 95.8 | 0.0 / 95.7 | 150 (0) |
| g: top-down, block question (wording 1) (t=0.3) | 76.2 / 79.9 / 67.3 | 51.4 / 64.4 / **57.1** | 54.1 | 78.4 / 94.9 | 98.3 | 49.0 / 75.4 | 148 (49) |
| g: top-down, block question (range wording) (t=0.4) | 75.7 / 81.3 / 61.9 | 51.3 / 66.1 / **57.8** | 54.8 | 76.3 / 93.2 | 97.5 | 38.8 / 85.5 | 152 (37) |
| h: bottom-up, pair question (t=0.8) | 82.4 / 91.0 / 61.1 | 62.5 / 72.0 / **66.9** | 63.0 | 83.8 / 92.4 | 95.8 | 46.9 / 89.9 | 136 (33) |
| g2: top-down then bottom-up merge (t=0.4/0.8) | 78.0 / 80.9 / 70.8 | 59.6 / 73.7 / **65.9** | 62.1 | 80.1 / 96.6 | 97.5 | 59.2 / 84.1 | 146 (52) |
| g-cal: block question + calibrated regression (t=0.4) | 80.6 / 84.2 / 71.7 | 69.0 / 75.4 / **72.1** | 66.4 | 88.4 / 96.6 | 97.5 | 67.3 / 81.2 | 129 (48) |
| h-cal: pair question + calibrated regression (t=0.5) | 84.7 / 90.3 / 70.8 | 80.2 / 82.2 / **81.2** | 74.5 | 91.7 / 95.8 | 95.8 | 77.6 / 85.5 | 121 (46) |
| g2-cal: both, calibrated (t=0.4/0.7) | 80.6 / 84.2 / 71.7 | 69.0 / 75.4 / **72.1** | 66.4 | 88.4 / 96.6 | 97.5 | 67.3 / 81.2 | 129 (48) |

**Dev files (3 files, 175 units, 56 rules)**, where thresholds were chosen

| Design | Per-unit acc % (all / outside multi-unit rules / inside) | Span exact P / R / F1 % | Exact + kind F1 % | IoU >= 0.5 P / R % | Any-overlap R % | Exact R %: multi-unit / single-unit rules | Spans (multi-unit) |
|---|---|---|---|---|---|---|---|
| s0: per-unit labels only, no grouping | 70.9 / 89.1 / 40.0 | 36.3 / 51.8 / **42.6** | 41.2 | 62.5 / 73.2 | 94.6 | 0.0 / 90.6 | 80 (0) |
| g: top-down, block question (wording 1) (t=0.3) | 74.3 / 84.5 / 56.9 | 53.4 / 69.6 / **60.5** | 52.7 | 71.2 / 87.5 | 96.4 | 54.2 / 81.3 | 73 (18) |
| g: top-down, block question (range wording) (t=0.4) | 76.0 / 87.3 / 56.9 | 56.3 / 71.4 / **63.0** | 56.7 | 70.4 / 85.7 | 96.4 | 54.2 / 84.4 | 71 (16) |
| h: bottom-up, pair question (t=0.8) | 76.6 / 86.4 / 60.0 | 45.9 / 60.7 / **52.3** | 49.2 | 73.0 / 85.7 | 94.6 | 25.0 / 87.5 | 74 (18) |
| g2: top-down then bottom-up merge (t=0.4/0.8) | 78.9 / 86.4 / 66.2 | 58.6 / 73.2 / **65.1** | 58.7 | 75.7 / 92.9 | 96.4 | 62.5 / 81.3 | 70 (24) |
| g-cal: block question + calibrated regression (t=0.4) | 79.4 / 86.4 / 67.7 | 66.2 / 80.4 / **72.6** | 62.9 | 75.0 / 91.1 | 96.4 | 83.3 / 78.1 | 68 (24) |
| h-cal: pair question + calibrated regression (t=0.5) | 78.3 / 87.3 / 63.1 | 51.6 / 57.1 / **54.2** | 49.2 | 77.4 / 85.7 | 94.6 | 45.8 / 65.6 | 62 (26) |
| g2-cal: both, calibrated (t=0.4/0.7) | 79.4 / 86.4 / 67.7 | 66.2 / 80.4 / **72.6** | 62.9 | 75.0 / 91.1 | 96.4 | 83.3 / 78.1 | 68 (24) |

**All 9 files (566 units, 174 rules)**, thresholds chosen on the dev files

| Design | Per-unit acc % (all / outside multi-unit rules / inside) | Span exact P / R / F1 % | Exact + kind F1 % | IoU >= 0.5 P / R % | Any-overlap R % | Exact R %: multi-unit / single-unit rules | Spans (multi-unit) |
|---|---|---|---|---|---|---|---|
| s0: per-unit labels only, no grouping | 75.6 / 91.0 / 42.1 | 41.3 / 54.6 / **47.0** | 45.5 | 72.6 / 83.3 | 95.4 | 0.0 / 94.1 | 230 (0) |
| g: top-down, block question (wording 1) (t=0.3) | 75.6 / 81.2 / 63.5 | 52.0 / 66.1 / **58.2** | 53.7 | 76.0 / 92.5 | 97.7 | 50.7 / 77.2 | 221 (67) |
| g: top-down, block question (range wording) (t=0.4) | 75.8 / 83.0 / 60.1 | 52.9 / 67.8 / **59.4** | 55.4 | 74.4 / 90.8 | 97.1 | 43.8 / 85.1 | 223 (53) |
| h: bottom-up, pair question (t=0.8) | 80.6 / 89.7 / 60.7 | 56.7 / 68.4 / **62.0** | 58.3 | 80.0 / 90.2 | 95.4 | 39.7 / 89.1 | 210 (51) |
| g2: top-down then bottom-up merge (t=0.4/0.8) | 78.3 / 82.5 / 69.1 | 59.3 / 73.6 / **65.6** | 61.0 | 78.7 / 95.4 | 97.1 | 60.3 / 83.2 | 216 (76) |
| g-cal: block question + calibrated regression (t=0.4) | 80.2 / 84.8 / 70.2 | 68.0 / 77.0 / **72.2** | 65.2 | 83.8 / 94.8 | 97.1 | 72.6 / 80.2 | 197 (72) |
| h-cal: pair question + calibrated regression (t=0.5) | 82.7 / 89.4 / 68.0 | 70.5 / 74.1 / **72.3** | 66.1 | 86.9 / 92.5 | 95.4 | 67.1 / 79.2 | 183 (72) |
| g2-cal: both, calibrated (t=0.4/0.7) | 80.2 / 84.8 / 70.2 | 68.0 / 77.0 / **72.2** | 65.2 | 83.8 / 94.8 | 97.1 | 72.6 / 80.2 | 197 (72) |

#### Descent labeller: Jev stacker trained on the other corpus; calibration trained on the 3 dev files only; calibration folds: dev-train

**Test files (6 files, 391 units, 118 rules)**

| Design | Per-unit acc % (all / outside multi-unit rules / inside) | Span exact P / R / F1 % | Exact + kind F1 % | IoU >= 0.5 P / R % | Any-overlap R % | Exact R %: multi-unit / single-unit rules | Spans (multi-unit) |
|---|---|---|---|---|---|---|---|
| s0: per-unit labels only, no grouping | 77.7 / 91.7 / 43.4 | 44.0 / 55.9 / **49.3** | 47.8 | 78.0 / 88.1 | 95.8 | 0.0 / 95.7 | 150 (0) |
| g: top-down, block question (wording 1) (t=0.3) | 76.2 / 79.9 / 67.3 | 51.4 / 64.4 / **57.1** | 54.1 | 78.4 / 94.9 | 98.3 | 49.0 / 75.4 | 148 (49) |
| g: top-down, block question (range wording) (t=0.4) | 75.7 / 81.3 / 61.9 | 51.3 / 66.1 / **57.8** | 54.8 | 76.3 / 93.2 | 97.5 | 38.8 / 85.5 | 152 (37) |
| h: bottom-up, pair question (t=0.8) | 82.4 / 91.0 / 61.1 | 62.5 / 72.0 / **66.9** | 63.0 | 83.8 / 92.4 | 95.8 | 46.9 / 89.9 | 136 (33) |
| g2: top-down then bottom-up merge (t=0.4/0.8) | 78.0 / 80.9 / 70.8 | 59.6 / 73.7 / **65.9** | 62.1 | 80.1 / 96.6 | 97.5 | 59.2 / 84.1 | 146 (52) |
| g-cal: block question + calibrated regression (t=0.3) | 76.5 / 77.0 / 75.2 | 70.1 / 75.4 / **72.7** | 66.9 | 85.0 / 94.1 | 97.5 | 75.5 / 75.4 | 127 (61) |
| h-cal: pair question + calibrated regression (t=0.3) | 80.3 / 85.3 / 68.1 | 67.0 / 61.9 / **64.3** | 58.1 | 90.8 / 89.8 | 95.8 | 65.3 / 59.4 | 109 (58) |
| g2-cal: both, calibrated (t=0.3/0.9) | 76.5 / 77.0 / 75.2 | 70.1 / 75.4 / **72.7** | 66.9 | 85.0 / 94.1 | 97.5 | 75.5 / 75.4 | 127 (61) |

**Dev files (3 files, 175 units, 56 rules)**, where thresholds were chosen

| Design | Per-unit acc % (all / outside multi-unit rules / inside) | Span exact P / R / F1 % | Exact + kind F1 % | IoU >= 0.5 P / R % | Any-overlap R % | Exact R %: multi-unit / single-unit rules | Spans (multi-unit) |
|---|---|---|---|---|---|---|---|
| s0: per-unit labels only, no grouping | 70.9 / 89.1 / 40.0 | 36.3 / 51.8 / **42.6** | 41.2 | 62.5 / 73.2 | 94.6 | 0.0 / 90.6 | 80 (0) |
| g: top-down, block question (wording 1) (t=0.3) | 74.3 / 84.5 / 56.9 | 53.4 / 69.6 / **60.5** | 52.7 | 71.2 / 87.5 | 96.4 | 54.2 / 81.3 | 73 (18) |
| g: top-down, block question (range wording) (t=0.4) | 76.0 / 87.3 / 56.9 | 56.3 / 71.4 / **63.0** | 56.7 | 70.4 / 85.7 | 96.4 | 54.2 / 84.4 | 71 (16) |
| h: bottom-up, pair question (t=0.8) | 76.6 / 86.4 / 60.0 | 45.9 / 60.7 / **52.3** | 49.2 | 73.0 / 85.7 | 94.6 | 25.0 / 87.5 | 74 (18) |
| g2: top-down then bottom-up merge (t=0.4/0.8) | 78.9 / 86.4 / 66.2 | 58.6 / 73.2 / **65.1** | 58.7 | 75.7 / 92.9 | 96.4 | 62.5 / 81.3 | 70 (24) |
| g-cal: block question + calibrated regression (t=0.3) | 83.4 / 86.4 / 78.5 | 80.0 / 85.7 / **82.8** | 72.4 | 90.0 / 96.4 | 96.4 | 95.8 / 78.1 | 60 (27) |
| h-cal: pair question + calibrated regression (t=0.3) | 77.1 / 80.9 / 70.8 | 52.7 / 51.8 / **52.3** | 45.0 | 80.0 / 76.8 | 94.6 | 58.3 / 46.9 | 55 (30) |
| g2-cal: both, calibrated (t=0.3/0.9) | 83.4 / 86.4 / 78.5 | 74.1 / 71.4 / **72.7** | 61.8 | 85.2 / 82.1 | 96.4 | 95.8 / 53.1 | 54 (29) |

**All 9 files (566 units, 174 rules)**, thresholds chosen on the dev files

| Design | Per-unit acc % (all / outside multi-unit rules / inside) | Span exact P / R / F1 % | Exact + kind F1 % | IoU >= 0.5 P / R % | Any-overlap R % | Exact R %: multi-unit / single-unit rules | Spans (multi-unit) |
|---|---|---|---|---|---|---|---|
| s0: per-unit labels only, no grouping | 75.6 / 91.0 / 42.1 | 41.3 / 54.6 / **47.0** | 45.5 | 72.6 / 83.3 | 95.4 | 0.0 / 94.1 | 230 (0) |
| g: top-down, block question (wording 1) (t=0.3) | 75.6 / 81.2 / 63.5 | 52.0 / 66.1 / **58.2** | 53.7 | 76.0 / 92.5 | 97.7 | 50.7 / 77.2 | 221 (67) |
| g: top-down, block question (range wording) (t=0.4) | 75.8 / 83.0 / 60.1 | 52.9 / 67.8 / **59.4** | 55.4 | 74.4 / 90.8 | 97.1 | 43.8 / 85.1 | 223 (53) |
| h: bottom-up, pair question (t=0.8) | 80.6 / 89.7 / 60.7 | 56.7 / 68.4 / **62.0** | 58.3 | 80.0 / 90.2 | 95.4 | 39.7 / 89.1 | 210 (51) |
| g2: top-down then bottom-up merge (t=0.4/0.8) | 78.3 / 82.5 / 69.1 | 59.3 / 73.6 / **65.6** | 61.0 | 78.7 / 95.4 | 97.1 | 60.3 / 83.2 | 216 (76) |
| g-cal: block question + calibrated regression (t=0.3) | 78.6 / 79.6 / 76.4 | 73.3 / 78.7 / **75.9** | 68.7 | 86.6 / 94.8 | 97.1 | 82.2 / 76.2 | 187 (88) |
| h-cal: pair question + calibrated regression (t=0.3) | 79.3 / 84.0 / 69.1 | 62.2 / 58.6 / **60.4** | 53.8 | 87.2 / 85.6 | 95.4 | 63.0 / 55.4 | 164 (88) |
| g2-cal: both, calibrated (t=0.3/0.9) | 78.6 / 79.6 / 76.4 | 71.3 / 74.1 / **72.7** | 65.4 | 85.1 / 90.2 | 97.1 | 82.2 / 68.3 | 181 (90) |

### Span designs, Jev with Haiku votes as extra features

#### Descent labeller: Jev + Haiku stacker trained on the other corpus; calibration folds: lofo-all

**Test files (6 files, 391 units, 118 rules)**

| Design | Per-unit acc % (all / outside multi-unit rules / inside) | Span exact P / R / F1 % | Exact + kind F1 % | IoU >= 0.5 P / R % | Any-overlap R % | Exact R %: multi-unit / single-unit rules | Spans (multi-unit) |
|---|---|---|---|---|---|---|---|
| s0: per-unit labels only, no grouping | 80.3 / 93.2 / 48.7 | 41.0 / 57.6 / **47.9** | 45.1 | 74.7 / 90.7 | 98.3 | 0.0 / 98.6 | 166 (0) |
| g: top-down, block question (wording 1) (t=0.3) | 77.0 / 81.3 / 66.4 | 51.6 / 66.9 / **58.3** | 53.1 | 77.1 / 96.6 | 100.0 | 51.0 / 78.3 | 153 (50) |
| g: top-down, block question (range wording) (t=0.4) | 76.5 / 83.1 / 60.2 | 51.9 / 68.6 / **59.1** | 54.0 | 75.6 / 94.9 | 99.2 | 40.8 / 88.4 | 156 (38) |
| h: bottom-up, pair question (t=0.6) | 79.0 / 83.5 / 68.1 | 68.9 / 69.5 / **69.2** | 61.6 | 91.6 / 95.8 | 99.2 | 69.4 / 69.6 | 119 (65) |
| g2: top-down then bottom-up merge (t=0.4/0.8) | 78.5 / 82.4 / 69.0 | 60.8 / 76.3 / **67.7** | 61.7 | 80.4 / 98.3 | 99.2 | 61.2 / 87.0 | 148 (53) |
| g-cal: block question + calibrated regression (t=0.2) | 80.3 / 83.1 / 73.5 | 72.7 / 78.8 / **75.6** | 66.7 | 88.3 / 98.3 | 99.2 | 79.6 / 78.3 | 128 (60) |
| h-cal: pair question + calibrated regression (t=0.4) | 85.7 / 91.4 / 71.7 | 78.9 / 85.6 / **82.1** | 71.5 | 92.2 / 98.3 | 98.3 | 83.7 / 87.0 | 128 (48) |
| g2-cal: both, calibrated (t=0.2/0.4) | 80.6 / 82.7 / 75.2 | 73.4 / 79.7 / **76.4** | 67.5 | 88.3 / 98.3 | 99.2 | 83.7 / 76.8 | 128 (63) |

**Dev files (3 files, 175 units, 56 rules)**, where thresholds were chosen

| Design | Per-unit acc % (all / outside multi-unit rules / inside) | Span exact P / R / F1 % | Exact + kind F1 % | IoU >= 0.5 P / R % | Any-overlap R % | Exact R %: multi-unit / single-unit rules | Spans (multi-unit) |
|---|---|---|---|---|---|---|---|
| s0: per-unit labels only, no grouping | 80.0 / 95.5 / 53.8 | 37.0 / 53.6 / **43.8** | 43.8 | 61.7 / 75.0 | 96.4 | 0.0 / 93.8 | 81 (0) |
| g: top-down, block question (wording 1) (t=0.3) | 81.1 / 90.0 / 66.2 | 57.4 / 69.6 / **62.9** | 58.1 | 75.0 / 87.5 | 96.4 | 54.2 / 81.3 | 68 (18) |
| g: top-down, block question (range wording) (t=0.4) | 81.7 / 92.7 / 63.1 | 59.7 / 71.4 / **65.0** | 58.5 | 73.1 / 85.7 | 96.4 | 54.2 / 84.4 | 67 (16) |
| h: bottom-up, pair question (t=0.6) | 78.9 / 82.7 / 72.3 | 54.2 / 57.1 / **55.7** | 52.2 | 88.1 / 92.9 | 96.4 | 45.8 / 65.6 | 59 (33) |
| g2: top-down then bottom-up merge (t=0.4/0.8) | 85.1 / 91.8 / 73.8 | 63.6 / 75.0 / **68.9** | 62.3 | 80.3 / 92.9 | 96.4 | 66.7 / 81.3 | 66 (24) |
| g-cal: block question + calibrated regression (t=0.2) | 88.0 / 91.8 / 81.5 | 85.7 / 85.7 / **85.7** | 78.6 | 96.4 / 96.4 | 96.4 | 95.8 / 78.1 | 56 (27) |
| h-cal: pair question + calibrated regression (t=0.4) | 88.0 / 94.5 / 76.9 | 87.3 / 85.7 / **86.5** | 79.3 | 96.4 / 96.4 | 96.4 | 83.3 / 87.5 | 55 (25) |
| g2-cal: both, calibrated (t=0.2/0.4) | 88.6 / 91.8 / 83.1 | 89.1 / 87.5 / **88.3** | 81.1 | 96.4 / 96.4 | 96.4 | 100.0 / 78.1 | 55 (28) |

**All 9 files (566 units, 174 rules)**, thresholds chosen on the dev files

| Design | Per-unit acc % (all / outside multi-unit rules / inside) | Span exact P / R / F1 % | Exact + kind F1 % | IoU >= 0.5 P / R % | Any-overlap R % | Exact R %: multi-unit / single-unit rules | Spans (multi-unit) |
|---|---|---|---|---|---|---|---|
| s0: per-unit labels only, no grouping | 80.2 / 93.8 / 50.6 | 39.7 / 56.3 / **46.6** | 44.7 | 70.4 / 85.6 | 97.7 | 0.0 / 97.0 | 247 (0) |
| g: top-down, block question (wording 1) (t=0.3) | 78.3 / 83.8 / 66.3 | 53.4 / 67.8 / **59.7** | 54.7 | 76.5 / 93.7 | 98.9 | 52.1 / 79.2 | 221 (68) |
| g: top-down, block question (range wording) (t=0.4) | 78.1 / 85.8 / 61.2 | 54.3 / 69.5 / **61.0** | 55.4 | 74.9 / 92.0 | 98.3 | 45.2 / 87.1 | 223 (54) |
| h: bottom-up, pair question (t=0.6) | 79.0 / 83.2 / 69.7 | 64.0 / 65.5 / **64.8** | 58.5 | 90.4 / 94.8 | 98.3 | 61.6 / 68.3 | 178 (98) |
| g2: top-down then bottom-up merge (t=0.4/0.8) | 80.6 / 85.1 / 70.8 | 61.7 / 75.9 / **68.0** | 61.9 | 80.4 / 96.6 | 98.3 | 63.0 / 85.1 | 214 (77) |
| g-cal: block question + calibrated regression (t=0.2) | 82.7 / 85.6 / 76.4 | 76.6 / 81.0 / **78.8** | 70.4 | 90.8 / 97.7 | 98.3 | 84.9 / 78.2 | 184 (87) |
| h-cal: pair question + calibrated regression (t=0.4) | 86.4 / 92.3 / 73.6 | 81.4 / 85.6 / **83.5** | 73.9 | 93.4 / 97.7 | 97.7 | 83.6 / 87.1 | 183 (73) |
| g2-cal: both, calibrated (t=0.2/0.4) | 83.0 / 85.3 / 78.1 | 78.1 / 82.2 / **80.1** | 71.7 | 90.7 / 97.7 | 98.3 | 89.0 / 77.2 | 183 (91) |

#### Descent labeller: Jev + Haiku stacker; calibration trained on the 3 dev files only; calibration folds: dev-train

**Test files (6 files, 391 units, 118 rules)**

| Design | Per-unit acc % (all / outside multi-unit rules / inside) | Span exact P / R / F1 % | Exact + kind F1 % | IoU >= 0.5 P / R % | Any-overlap R % | Exact R %: multi-unit / single-unit rules | Spans (multi-unit) |
|---|---|---|---|---|---|---|---|
| s0: per-unit labels only, no grouping | 80.3 / 93.2 / 48.7 | 41.0 / 57.6 / **47.9** | 45.1 | 74.7 / 90.7 | 98.3 | 0.0 / 98.6 | 166 (0) |
| g: top-down, block question (wording 1) (t=0.3) | 77.0 / 81.3 / 66.4 | 51.6 / 66.9 / **58.3** | 53.1 | 77.1 / 96.6 | 100.0 | 51.0 / 78.3 | 153 (50) |
| g: top-down, block question (range wording) (t=0.4) | 76.5 / 83.1 / 60.2 | 51.9 / 68.6 / **59.1** | 54.0 | 75.6 / 94.9 | 99.2 | 40.8 / 88.4 | 156 (38) |
| h: bottom-up, pair question (t=0.6) | 79.0 / 83.5 / 68.1 | 68.9 / 69.5 / **69.2** | 61.6 | 91.6 / 95.8 | 99.2 | 69.4 / 69.6 | 119 (65) |
| g2: top-down then bottom-up merge (t=0.4/0.8) | 78.5 / 82.4 / 69.0 | 60.8 / 76.3 / **67.7** | 61.7 | 80.4 / 98.3 | 99.2 | 61.2 / 87.0 | 148 (53) |
| g-cal: block question + calibrated regression (t=0.3) | 79.5 / 82.0 / 73.5 | 71.3 / 82.2 / **76.4** | 67.7 | 86.0 / 99.2 | 99.2 | 77.6 / 85.5 | 136 (56) |
| h-cal: pair question + calibrated regression (t=0.8) | 85.7 / 92.4 / 69.0 | 73.3 / 83.9 / **78.3** | 68.8 | 91.1 / 98.3 | 98.3 | 71.4 / 92.8 | 135 (38) |
| g2-cal: both, calibrated (t=0.3/0.8) | 79.3 / 81.7 / 73.5 | 70.6 / 81.4 / **75.6** | 66.9 | 86.0 / 99.2 | 99.2 | 77.6 / 84.1 | 136 (57) |

**Dev files (3 files, 175 units, 56 rules)**, where thresholds were chosen

| Design | Per-unit acc % (all / outside multi-unit rules / inside) | Span exact P / R / F1 % | Exact + kind F1 % | IoU >= 0.5 P / R % | Any-overlap R % | Exact R %: multi-unit / single-unit rules | Spans (multi-unit) |
|---|---|---|---|---|---|---|---|
| s0: per-unit labels only, no grouping | 80.0 / 95.5 / 53.8 | 37.0 / 53.6 / **43.8** | 43.8 | 61.7 / 75.0 | 96.4 | 0.0 / 93.8 | 81 (0) |
| g: top-down, block question (wording 1) (t=0.3) | 81.1 / 90.0 / 66.2 | 57.4 / 69.6 / **62.9** | 58.1 | 75.0 / 87.5 | 96.4 | 54.2 / 81.3 | 68 (18) |
| g: top-down, block question (range wording) (t=0.4) | 81.7 / 92.7 / 63.1 | 59.7 / 71.4 / **65.0** | 58.5 | 73.1 / 85.7 | 96.4 | 54.2 / 84.4 | 67 (16) |
| h: bottom-up, pair question (t=0.6) | 78.9 / 82.7 / 72.3 | 54.2 / 57.1 / **55.7** | 52.2 | 88.1 / 92.9 | 96.4 | 45.8 / 65.6 | 59 (33) |
| g2: top-down then bottom-up merge (t=0.4/0.8) | 85.1 / 91.8 / 73.8 | 63.6 / 75.0 / **68.9** | 62.3 | 80.3 / 92.9 | 96.4 | 66.7 / 81.3 | 66 (24) |
| g-cal: block question + calibrated regression (t=0.3) | 88.6 / 92.7 / 81.5 | 87.5 / 87.5 / **87.5** | 80.4 | 96.4 / 96.4 | 96.4 | 95.8 / 81.3 | 56 (26) |
| h-cal: pair question + calibrated regression (t=0.8) | 86.3 / 95.5 / 70.8 | 62.7 / 75.0 / **68.3** | 65.0 | 82.1 / 91.1 | 96.4 | 50.0 / 93.8 | 67 (18) |
| g2-cal: both, calibrated (t=0.3/0.8) | 88.6 / 92.7 / 81.5 | 87.5 / 87.5 / **87.5** | 80.4 | 96.4 / 96.4 | 96.4 | 95.8 / 81.3 | 56 (26) |

**All 9 files (566 units, 174 rules)**, thresholds chosen on the dev files

| Design | Per-unit acc % (all / outside multi-unit rules / inside) | Span exact P / R / F1 % | Exact + kind F1 % | IoU >= 0.5 P / R % | Any-overlap R % | Exact R %: multi-unit / single-unit rules | Spans (multi-unit) |
|---|---|---|---|---|---|---|---|
| s0: per-unit labels only, no grouping | 80.2 / 93.8 / 50.6 | 39.7 / 56.3 / **46.6** | 44.7 | 70.4 / 85.6 | 97.7 | 0.0 / 97.0 | 247 (0) |
| g: top-down, block question (wording 1) (t=0.3) | 78.3 / 83.8 / 66.3 | 53.4 / 67.8 / **59.7** | 54.7 | 76.5 / 93.7 | 98.9 | 52.1 / 79.2 | 221 (68) |
| g: top-down, block question (range wording) (t=0.4) | 78.1 / 85.8 / 61.2 | 54.3 / 69.5 / **61.0** | 55.4 | 74.9 / 92.0 | 98.3 | 45.2 / 87.1 | 223 (54) |
| h: bottom-up, pair question (t=0.6) | 79.0 / 83.2 / 69.7 | 64.0 / 65.5 / **64.8** | 58.5 | 90.4 / 94.8 | 98.3 | 61.6 / 68.3 | 178 (98) |
| g2: top-down then bottom-up merge (t=0.4/0.8) | 80.6 / 85.1 / 70.8 | 61.7 / 75.9 / **68.0** | 61.9 | 80.4 / 96.6 | 98.3 | 63.0 / 85.1 | 214 (77) |
| g-cal: block question + calibrated regression (t=0.3) | 82.3 / 85.1 / 76.4 | 76.0 / 83.9 / **79.8** | 71.6 | 89.1 / 98.3 | 98.3 | 83.6 / 84.2 | 192 (82) |
| h-cal: pair question + calibrated regression (t=0.8) | 85.9 / 93.3 / 69.7 | 69.8 / 81.0 / **75.0** | 67.6 | 88.1 / 96.0 | 97.7 | 64.4 / 93.1 | 202 (56) |
| g2-cal: both, calibrated (t=0.3/0.8) | 82.2 / 84.8 / 76.4 | 75.5 / 83.3 / **79.2** | 71.0 | 89.1 / 98.3 | 98.3 | 83.6 / 83.2 | 192 (83) |

### References

**Test files**

| Design | Per-unit acc % (all / outside multi-unit rules / inside) | Span exact P / R / F1 % | Exact + kind F1 % | IoU >= 0.5 P / R % | Any-overlap R % | Exact R %: multi-unit / single-unit rules | Spans (multi-unit) |
|---|---|---|---|---|---|---|---|
| Structure only, gold unit labels (upper bound of "merge what sits in one paragraph/list/row") | 100.0 / 100.0 / 100.0 | 83.3 / 72.0 / **77.3** | 77.3 | 95.1 / 83.9 | 100.0 | 81.6 / 65.2 | 102 (51) |
| Structure only, Jev stacker labels | 77.7 / 91.7 / 43.4 | 56.3 / 49.2 / **52.5** | 46.2 | 87.4 / 78.8 | 95.8 | 38.8 / 56.5 | 103 (36) |
| Structure only, Haiku majority labels | 83.6 / 87.4 / 74.3 | 71.6 / 66.1 / **68.7** | 59.0 | 87.2 / 80.5 | 96.6 | 77.6 / 58.0 | 109 (57) |
| Haiku run 1 with its own groups | 80.1 / 82.7 / 73.5 | 71.9 / 82.2 / **76.7** | 64.8 | 85.9 / 96.6 | 96.6 | 85.7 / 79.7 | 135 (55) |
| Haiku run 2 with its own groups | 82.9 / 88.1 / 69.9 | 71.9 / 82.2 / **76.7** | 66.4 | 88.9 / 96.6 | 96.6 | 75.5 / 87.0 | 135 (44) |
| Haiku run 3 with its own groups | 85.4 / 88.5 / 77.9 | 76.9 / 84.7 / **80.6** | 71.0 | 89.2 / 96.6 | 96.6 | 87.8 / 82.6 | 130 (53) |
| Haiku consensus: spans 2 of 3 runs produced identically, else the majority unit label | 82.6 / 86.3 / 73.5 | 75.8 / 84.7 / **80.0** | 67.2 | 87.9 / 96.6 | 96.6 | 87.8 / 82.6 | 132 (52) |

**Dev files**

| Design | Per-unit acc % (all / outside multi-unit rules / inside) | Span exact P / R / F1 % | Exact + kind F1 % | IoU >= 0.5 P / R % | Any-overlap R % | Exact R %: multi-unit / single-unit rules | Spans (multi-unit) |
|---|---|---|---|---|---|---|---|
| Structure only, gold unit labels (upper bound of "merge what sits in one paragraph/list/row") | 100.0 / 100.0 / 100.0 | 84.8 / 69.6 / **76.5** | 76.5 | 95.7 / 82.1 | 100.0 | 95.8 / 50.0 | 46 (28) |
| Structure only, Jev stacker labels | 70.9 / 89.1 / 40.0 | 64.7 / 58.9 / **61.7** | 52.3 | 80.4 / 75.0 | 94.6 | 79.2 / 43.8 | 51 (24) |
| Structure only, Haiku majority labels | 89.7 / 91.8 / 86.2 | 72.5 / 66.1 / **69.2** | 63.6 | 86.3 / 82.1 | 100.0 | 95.8 / 43.8 | 51 (30) |
| Haiku run 1 with its own groups | 89.7 / 90.0 / 89.2 | 72.3 / 83.9 / **77.7** | 74.4 | 84.6 / 96.4 | 100.0 | 83.3 / 84.4 | 65 (24) |
| Haiku run 2 with its own groups | 86.3 / 92.7 / 75.4 | 81.7 / 87.5 / **84.5** | 77.6 | 88.3 / 94.6 | 100.0 | 83.3 / 90.6 | 60 (22) |
| Haiku run 3 with its own groups | 89.1 / 91.8 / 84.6 | 76.9 / 89.3 / **82.6** | 79.3 | 87.7 / 100.0 | 100.0 | 83.3 / 93.8 | 65 (23) |
| Haiku consensus: spans 2 of 3 runs produced identically, else the majority unit label | 89.1 / 91.8 / 84.6 | 76.9 / 89.3 / **82.6** | 79.3 | 86.2 / 98.2 | 100.0 | 87.5 / 90.6 | 65 (23) |

**All 9 files**

| Design | Per-unit acc % (all / outside multi-unit rules / inside) | Span exact P / R / F1 % | Exact + kind F1 % | IoU >= 0.5 P / R % | Any-overlap R % | Exact R %: multi-unit / single-unit rules | Spans (multi-unit) |
|---|---|---|---|---|---|---|---|
| Structure only, gold unit labels (upper bound of "merge what sits in one paragraph/list/row") | 100.0 / 100.0 / 100.0 | 83.8 / 71.3 / **77.0** | 77.0 | 95.3 / 83.3 | 100.0 | 86.3 / 60.4 | 148 (79) |
| Structure only, Jev stacker labels | 75.6 / 91.0 / 42.1 | 59.1 / 52.3 / **55.5** | 48.2 | 85.1 / 77.6 | 95.4 | 52.1 / 52.5 | 154 (60) |
| Structure only, Haiku majority labels | 85.5 / 88.7 / 78.7 | 71.9 / 66.1 / **68.9** | 60.5 | 86.9 / 81.0 | 97.7 | 83.6 / 53.5 | 160 (87) |
| Haiku run 1 with its own groups | 83.0 / 84.8 / 79.2 | 72.0 / 82.8 / **77.0** | 67.9 | 85.5 / 96.6 | 97.7 | 84.9 / 81.2 | 200 (79) |
| Haiku run 2 with its own groups | 83.9 / 89.4 / 71.9 | 74.9 / 83.9 / **79.1** | 69.9 | 88.7 / 96.0 | 97.7 | 78.1 / 88.1 | 195 (66) |
| Haiku run 3 with its own groups | 86.6 / 89.4 / 80.3 | 76.9 / 86.2 / **81.3** | 73.7 | 88.7 / 97.7 | 97.7 | 86.3 / 86.1 | 195 (76) |
| Haiku consensus: spans 2 of 3 runs produced identically, else the majority unit label | 84.6 / 87.9 / 77.5 | 76.1 / 86.2 / **80.9** | 71.2 | 87.3 / 97.1 | 97.7 | 87.7 / 85.1 | 197 (75) |

