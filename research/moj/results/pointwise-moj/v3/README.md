# Frozen confidence-qualified pointwise router

Final configuration: `configs/pw-router-v3-frozen.json`. Primary residual: 3 of 3.
Practice data only, split moj-split-v2. No sealed file is loaded.

| Validation benchmark | n | Accuracy | Best full-coverage baseline | Balanced | Sensitivity | Specificity | S2 calls/100 | Known S2 USD/100 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| RubricBench | 46 | 91.3 | 93.5 | 91.5 | 87.5 | 95.5 | 45.7 | 0.020494 |
| Hard rows | 54 | 96.3 | 100.0 | 96.0 | 100.0 | 92.0 | 7.4 | 0.000619 |
| Verify | 49 | 69.4 | 85.7 | 70.2 | 71.4 | 69.0 | 295.9 | 0.282956 |
| Verify with reference, diagnostic | 55 | 87.3 | 96.4 | 68.9 | 40.0 | 97.8 | 29.1 | 0.020393 |

## Frozen rule

A point item carrying a supplied reference starts with the whole-reference comparison `pw_whole`.
A point item carrying only a question starts with `pw_ref_luna`: Luna solves without seeing the candidate, then System 1 compares final answers.
Rubric requirements and pairwise rubric questions remain on the inherited rubric route.
The System-1 terrain read stays on every item. Runtime routes never inspect benchmark names, labels or IDs.

The selected reference expert is terminal when its calibrated confidence is at least 0.6.
Below that threshold, its decision continues through the existing Luna escalation and low-confidence panel.
A no-reference item never falls back to a System-1 whole or rows correctness judgment.
Missing required reference evidence stops the run; it cannot silently become a System-1 correctness verdict.

The only selected parameter is the common terminal threshold. The prespecified grid is in the config.
Selection maximizes mean balanced accuracy across the three primary tuning benchmarks, then minimizes System-2 calls.
Expert-confidence maps use grouped five-fold tuning predictions; the final maps fit all primary tuning items.
Inherited v1 content routes and their calibration maps remain frozen. The tuning score is conditional on that previous selection.
The reference-guided diagnostic is excluded from fitting. No validation score selects a threshold or an exception.

## What changed and what failed

`ABLATIONS.md` preserves the original frozen router and both one-change designer ablations.
Unconditional authority reproduces Verify 81.6 and reference-guided Verify 96.4, but hard rows fall to 92.6.
The tuning-qualified gate improves conditional tuning mean balanced accuracy from 78.98 to 80.18 percent.
On validation it restores hard rows to 96.3 but lowers Verify to 69.4 and reference-guided Verify to 87.3.
This final configuration is frozen for the requested report, not promoted as the best judge.

Hard rows remain 3.7 points below the 100 percent baseline, outside the inherited 1.7-point noise floor.
The ceiling baseline uses 100 System-2 calls per 100 items; its recorded judge costs 0.0389 USD per 100.
The new router uses fewer calls but fails the required accuracy tie.
RubricBench trails its best full-coverage baseline; Verify trails constant-fail accuracy 85.7.
Constant-fail has balanced accuracy 50.0, sensitivity 0.0 and specificity 100.0.

The separate 26-item RubricBench domain-seat comparison is met under the owner's ceiling-tie rule:
MoJ 96.2 versus domain-seat 98.1, within the 3.3-point noise proxy, at 23.1 versus 100 System-2 calls per 100.
It does not enter the primary residual. All other partial baselines use matched IDs in `validation.json`.

## Verification and reproduction

From `research/moj`:

```sh
python3 -m moj.pointwise_router report --offline --config configs/pw-router-v3-frozen.json --output v3
PYTHONPATH=. python3 results/pointwise-moj/v3/audit.py
python3 -m unittest discover -s results/pointwise-moj/v3 -p test_threshold.py
```

The audit disables networking, reproduces all 204 validation decisions and verifies all 204 original v1 decisions unchanged.
It rebuilds 238 terminal-expert signals from the original recordings. A gate-bypass mutation fails the targeted test.
All 19 contract tests pass: nine inherited, six terminal-authority, four threshold tests.
Existing inherited tests emit ResourceWarnings about unclosed benchmark files; those files are outside this workstream's ownership.

`SCOREBOARD.md` contains every baseline, coverage, balanced accuracy, sensitivity, specificity and cost.
`validation.json` also contains group-bootstrap intervals from 20,000 draws and each residual comparison.
`validation-errors.json` contains every final error; `tuning-threshold.json` records the complete tuning-only sweep.
Noise floors come from existing `moj/noise.py` repeats. They are conservative proxies, not fresh router-specific noise measurements.
Verify with reference uses different groups and has disclosed ID overlap with vanilla tuning; it remains diagnostic.

Two missing tuning panels were recorded for threshold selection. Validation needed no new model calls.
Reserved-plus-known System-2 spend is 0.764623 USD of 15 USD, including this round's 0.014379 USD increment.
Known cost excludes System-1 pricing. Gemini costs use the harness estimate; the only new Gemini model is gemini-3.5-flash-lite.
The owner requests a freeze and stop after this one threshold fit. No further optimization is performed.
