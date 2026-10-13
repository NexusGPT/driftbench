# Calibrated confidence and certified thresholds

This module only reads the three approved practice signal files. It imports no
client or collector and makes no model calls. Python 3 and numpy are sufficient.
The original harness files are unchanged.

## Run and call

From `research/moj`:

```sh
python3 -m unittest discover -s results/confidence -v 2>&1
python3 -m moj.confidence --splits 1000 --output results/confidence/my-run 2>&1
python3 results/confidence/render_report.py results/confidence/my-run 2>&1
```

The output directory must be new. This avoids replacing a previous experiment.
The CLI restricts input to `results/signals/{judgebench,mmeval,writing}.json`.
Unknown provenance or a non-practice split fails closed. It never opens raw
benchmark data, a sealed TEST split, secrets, or another worktree.

Other helpers call this function after loading a saved model:

```python
import json
from moj.confidence import ConfidenceModel, choose_level

report = json.load(open('results/confidence/practice-final/judgebench.json'))
model = ConfidenceModel.from_dict(report['certified_model'])
certificate = report['certificate']
decision = choose_level(item_signals, model,
                        hi=certificate['hi'], lo=certificate['lo'],
                        certificate=certificate)
# decision['level']: 'stop', 'one_more', or 'full'
# decision['confidence']: calibrated probability the S1 verdict matches gold
```

`choose_level` needs only the recorded S1 signal, not gold labels or unrun experts.
Missing probabilities or orders request `full` with confidence `None`.
Order disagreement and an order tie also request `full`.
The returned confidence belongs to the first-pass verdict, not the eventual
middle or full verdict. It is not the certificate's agreement lower bound.
Calling this function chooses work; it does not execute that work.

For an empirical operating point, load `report['model']`, choose one entry from
`report['operating_points']`, and pass its `hi` and `lo` without a certificate.
These points have no statistical guarantee. `balanced.target_feasible` states
whether its requested tuning accuracy and budget were attainable.

## What is frozen

The default full judge is `policy.Combiner`, forced to use
`s1p,s1r,ref,s2v,s2h`. The middle judge uses `s1p,ref`. This is a controlled
confidence experiment, not a replay of the terrain router. The reference is a
mixed judge, not a human oracle. All weights fit on the specified training
portion, independently per benchmark. Ties receive half credit for gold
accuracy and exact-match credit for reference agreement.

Replace the full expert set with `--full-experts s1p,ref,s2v` or pass
`full_experts=(...)` to `ConfidenceModel`. Replace the middle expert with
`--extra`. Missing members are counted and excluded from matched comparisons;
they are never substituted with other experts. If no complete tuning row exists,
the report states that limitation. Coverage denominators are reported explicitly.

The certificate fingerprints the full expert set, fitted full and middle weights,
S1 calibration map, S2 cost weight, and reference implementation version. By
default the version is the SHA-256 of `policy.py`; API users can pass an explicit
`reference_version`. Changing the experts, their underlying prompts/models, the
reference implementation, or the item distribution requires a new fit and
certification. When changing underlying expert identities under the same names,
set a new `reference_version`; names alone cannot detect that change.
Signal-file hashes in the manifest identify the exact measured recordings.

## Probabilities, orders, and calibration

AB and BA both mean P(FIRST wins). The original-A probability is
`p_bar = (p_AB + 1 - p_BA) / 2`. Raw confidence is
`max(p_bar, 1 - p_bar)` and binary label margin is `abs(2*p_bar - 1)`.
Order disagreement compares the signs of `p_AB - 0.5` and `0.5 - p_BA`.
The continuous order gap is `abs(p_AB - (1 - p_BA))`. A probability of exactly
0.5 is recorded as a tie, separately from a strict disagreement.

There are two explicit calibration targets:

- Each expert: monotone PAVA isotonic regression of `pA` against the gold event
  `label == A`. Duplicate probabilities are pooled with their counts before
  fitting. Linear interpolation preserves monotonicity; endpoints are clipped.
  Reports include ten fixed-bin reliability curves, ECE and Brier scores before
  and after fitting. These maps use the tuning half and are scored on validation.
- The routing gate: a separate monotone map from raw S1 confidence to whether its
  original verdict matches gold. This map preserves the original verdict and can
  return confidence below 0.5. It does not flip a poorly calibrated verdict.

The summary's ECE is binary probability ECE for event A, not the routing gate's
correctness confidence. Calibration can worsen on validation, and the report
keeps that result. Recorded S2 vote fractions are calibrated as scores; they are
not represented as token probabilities. The `route` signal has no verdict
probability and is excluded. Cheap controls are included and named as such.

The recordings do not contain first-token top-two probabilities: neither of the
two recording files has a nonempty `choices[].logprobs` entry. The binary Jev
margin is available; the published first-token margin cannot be measured here.
No missing signal is collected by this module.

## Three threshold methods

1. `fixed_0.9`: raw order-averaged confidence at least 0.9 stops. Between 0.7 and
   0.9 adds the configured extra expert. Below 0.7 uses the full judge. The 0.9
   stop boundary follows the supplied JEV research; 0.7 is this experiment's
   disclosed three-level extension. Order conflicts or ties always use full.
2. `cross_validated`: five-fold predictions within tuning choose thresholds from
   a predeclared grid. Each fold fits both combiners and the calibration map
   without its held-out items. Validation never chooses a threshold. The default
   gold-accuracy target is 0.8; `--accuracy-target` and `--cost-budget` change it.
3. `guaranteed`: half of tuning fits a frozen model, and the other half certifies
   thresholds. Validation is untouched until scoring. Exact binomial lower bounds
   certify agreement with the frozen full judge, independently of gold accuracy.

The gate uses only the S1 confidence; the one-extra level is a terminal middle
decision. There is no hidden post-middle threshold or second adaptive choice.
The grid is `(0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1.0, 1.01)`, with `lo <= hi`.
The sentinel 1.01 disables an exit. The selected model is never refitted after
certification. `fit_ids`, `certification_ids`, and `validation_ids` expose the
disjoint sets for an audit.

## What the guarantee means

Defaults: target full-judge agreement X = 0.90 and familywise risk delta = 0.05.
For each of 36 predeclared policies, each of its two enabled early-exit regions
must have an exact one-sided Clopper-Pearson lower bound at least X. The per-bound
risk is `delta / 72`. The union bound permits selecting the cheapest passing
policy after seeing certification results. Empty enabled regions do not pass.
This is a simultaneous lower-bound method, not an implementation of fixed
sequence testing and not an uncorrected threshold search.

Assumptions: independent, identically distributed calibration and future items;
fixed judges, thresholds under consideration, and routing features; no reuse of
certification labels for fitting. Subject to these assumptions, with probability
at least `1 - delta`, both enabled early-exit regions have population agreement
at least X. Full fallback agrees with itself, so the whole cascade inherits X.
This does not guarantee human correctness, distribution-shift robustness, or
that every finite validation sample exceeds X. Correlated practice fixtures can
violate the sampling assumption; random split success is only a sensitivity
check, not a proof of that assumption.

Best-case independent calibration labels needed, with zero disagreements:

| Certificate design | Target full agreement | Risk | Error-free accepted labels per enabled region | Gold accuracy guarantee |
|---|---:|---:|---:|---|
| One region fixed in advance | 90% | 5% | 29 | None |
| Two regions fixed in advance, split risk | 90% | 5% | 36 | None |
| Implemented 36-policy search, two exits each | 90% | 5% | 70 | None |

The formula is `ceil(log(delta / comparisons) / log(X))`. These are optimistic
minima, not adequate sample-size promises: disagreements require more labels.
Two active exits need 70 accepted calibration items each, in disjoint regions.
With the ideal 50/50 practice split and tuning split used here, one active exit
needs at least 280 total practice items; two active exits need at least 560.
Lower acceptance rates require more. In the measured fixed split, certification
has only 21 JudgeBench, 11 MM-Eval, and 11 writing items. No nontrivial early-exit
certificate is possible, even with zero errors. The method therefore returns
full-only, explicitly marked `nontrivial: false`.

The supplied lighter rule, `mean difference - 1.645 * SE >= -0.02`, is an
approximate accuracy-loss screen. It is not used as a finite-sample agreement
guarantee and does not correct an arbitrary search over many thresholds.

## Operating points, costs, and artifacts

- `cheapest`: lowest out-of-fold tuning cost; gold accuracy breaks cost ties.
- `balanced`: cheapest point meeting the requested tuning gold-accuracy target
  and optional cost budget. If none passes, uses the most-accurate point and
  records `target_feasible: false`.
- `most_accurate`: highest out-of-fold tuning gold accuracy, with cost as tie-break.

Names describe tuning selection, not a promise about validation rankings.
Different names may select the same point. That is reported, not hidden.
Default cost units are `S1 calls + 10 * S2 calls`; 10 is a configurable scenario
weight, not a measured price ratio. S1 and S2 call counts remain separate.
Recorded Luna USD is incomplete for reused baselines; Jev prices are absent.
The module never calls the recorded USD field total cascade spend or reports
an unsupported dollar saving. Calls count intended inference, including reused
baseline calls, and deduplicate expert names on each path.

`results/confidence/practice-final/` contains:

- Per-benchmark JSON: every expert's calibration, saved models, certificate,
  all thresholds, selected points, validation per-level shares, gold accuracy
  and full agreement, and random-split summaries.
- Per-benchmark CSV: every one of 1,000 random practice splits for every method,
  including level shares, gold accuracy and full agreement. Each random run
  repeats model fitting, tuning-only cross-validation and independent certification.
- Per-benchmark curve CSV and SVG: cost versus gold accuracy and full agreement
  as thresholds vary. Validation sweeps are descriptive, never selection data.
- `manifest.json` with input hashes and settings; `summary.md` with the selected
  points; `report.md` with calibration, methods, and guarantee outcomes.

The fixed-rule and certified models in random audits use the same fit subset;
cross-validation uses the complete random tuning half and its own frozen
reference. Each agreement number is relative to its run's stated reference,
not an assertion that all fitted references are identical.
The 1,000 splits overlap and are not 1,000 independent replications.
Full-only matches the reference by identity. A 1,000/1,000 target success count
with zero nontrivial certificates demonstrates fallback, not useful savings.

## Evidence and validation

The supplied cascade research, Part 2 and Cards 1, 2 and 5, motivates the
two-order gate, selective certification, and explicit missing token-margin data.
The supplied bias/calibration research, Part 2, motivates separate calibration
and disagreement signals. The methods are associated with these primary papers:

- Jung, Brahman and Choi, [Trust or Escalate](https://arxiv.org/abs/2407.18370).
- Li et al., [JEV-as-a-Judge](https://arxiv.org/abs/2609.26550).
- Ramirez, Birch and Titov, [Uncertainty-Based Two-Tier Selection](https://arxiv.org/abs/2405.02134).

The implementation does not copy published performance numbers into its results.
Tests cover known PAVA solutions and duplicate weights, a synthetic 0.19-to-zero
ECE correction on a separate validation sample, order reversal and ties, missing
signals, exact binomial identities, exhaustive small-binomial coverage, disjoint
cross-fitting, insufficient-label fallback, nontrivial certification with enough
synthetic agreements, reference invalidation, serialization, and TEST rejection.
