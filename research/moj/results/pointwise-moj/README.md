# Pointwise router handoff

Status: frozen before validation. No validation label selects a policy.

## Frozen routing

- Every item gets a System-1 terrain read and row judgment.
- Supplied references take priority. Unreferenced reasoning can use the recorded Luna solution and System-1 comparison.
- Isotonic confidence fits tuning groups only. Confidence below 0.8 adds Luna; below 0.7 adds the cross-family panel.
- Evidence cases flagged for reasoning, safety or long context take the Luna guard even at high System-1 confidence.
- The runtime selects by payload shape: rubric pair, supplied evidence or unreferenced answer. It never routes on benchmark names.

## Selection and stopping

| Content | Frozen round |
|---|---|
| pair | pw-router-r2-panel |
| evidence | pw-router-r3-reasoning |
| unreferenced | pw-router-r2-panel |

RubricBench stops after two applicable hypotheses without a tuning gain. The panel does not improve its 83.4 percent out-of-fold balanced accuracy; typed comparison lowers it to 82.6 percent.
Verify stops after two applicable panel hypotheses without a tuning gain. Reference-first scores 60.6 percent out-of-fold balanced accuracy, unweighted panel 53.3, learned mixture 43.3. The frozen requested panel architecture therefore has no tuning evidence of improvement on Verify.
Hardrows improves from 95.7 to 100 percent tuning balanced accuracy with the evidence reasoning guard, using 16.7 System-2 calls per 100 items.

A reference-only change on rubric pairs and a pair-only change on point answers are marked not applicable; they do not count as experiments on untreated items.

## Reproduction

```sh
cd research/moj
python3 -m moj.pointwise_router replay --offline
python3 -m moj.pointwise_router report --offline
PYTHONPATH=. python3 results/pointwise-moj/test_router.py
```

`replay` reconstructs each collected System-1 and panel signal from recorded calls, including exhausted unanswered System-1 requests. `report` reproduces the frozen validation decisions and baseline comparisons.

## Evidence limits

- Baseline decisions and old expert signals are reused without requesting their answers again.
- Main residual uses full-coverage baselines. Partial baselines get matched-ID comparisons; the domain-seat subset targets a ceiling tie at fewer System-2 calls.
- Noise floors are the conservative maximum existing recorded ranges from moj/noise.py: RubricBench 3.3 points, Verify 3.3, hardrows 1.7. No claim of fresh router-specific repeat noise is made.
- Verify with reference has different groups and a different validation population. It is a separate diagnostic, never one of the three primary cells. Some labels overlap vanilla tuning; its count is in validation.json.
- USD figures are known System-2 estimates. System-1 price is unspecified. Gemini uses the inherited conservative rate estimate; Haiku uses reported CLI cost.
- The System-2 spend ledger reserves before submission and retains reservations for unanswered attempts. One interrupted unanswered tuning call keeps its reservation; returned answers are reused.

## Next work

The owner asks this pass to stop after frozen validation. A designer supplies the next changes to System-1 framing, terrain calibration, tie bands and safety routing.
System-1 has no budget ceiling for useful recorded practice experiments. The unchanged client still caps concurrency at three and backs off on HTTP 403/429. System-2 stays within the 15 USD cap.
