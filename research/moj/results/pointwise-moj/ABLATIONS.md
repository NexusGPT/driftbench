# Tuning ablations

Every value is from grouped out-of-fold tuning predictions. Validation is reserved for the frozen configuration.

| Round | Hypothesis | RubricBench balanced | Hardrows balanced | Verify balanced |
|---|---|---:|---:|---:|
| pw-router-r0-confidence | Calibrated confidence below 0.8 selects the recorded Luna grader. | 83.4 | 95.7 | 55.6 |
| pw-router-r1-reference | Reference-first comparison improves balanced accuracy over the confidence cascade. | 83.4 (not applicable) | 95.7 | 60.6 |
| pw-router-r2-panel | A cross-family panel below calibrated confidence 0.7 improves balanced accuracy. | 83.4 | 95.7 (not applicable) | 53.3 |
| pw-router-r3-reasoning | Arithmetic and long-context evidence cases need Luna even when System 1 is confident. | 83.4 (not applicable) | 100.0 | 53.3 (not applicable) |
| pw-router-r4-typed | Naming rubric-comparison terrain and cancelling pair order improves rubric judging. | 82.6 | 100.0 (not applicable) | 53.3 (not applicable) |
| pw-router-r5-blend | Equal blending of typed comparison and rubric rows is more reliable than either view alone. | stopped | 100.0 (not applicable) | 53.3 (not applicable) |
| pw-router-r6-weighted | A tuning-fitted mixture of stage-one, Luna and panel votes improves the unweighted panel. | stopped | 100.0 (not applicable) | 43.3 |
