# Final remaining-cause review

- Scope: final round 10 only; separate from the baseline diagnostic.
- Reviewer: inherited Codex substitutes for prescribed Sonnet. Sonnet independence is not claimed.
- Population: all 7 remaining failures reviewed; feedback reports 327 passing items in a bank of 334.
- Both public contracts make `none` implicitly valid. The earlier conflict claim was withdrawn.

## Pre-tag diagnoses

Every failure exposes `advanced=labeller analysis not implemented`. This establishes one shared failure signature. It does not expose seven distinct algorithmic defects.

The two repair groups below follow public API boundaries. They are actionable inferred repair boundaries, not two proven implementation root causes.

### labeller/advanced/exact-fixed-margin-perfect

- Evidence: `raw=1; kappa=1; correct=64/64; abstentions=0; invalid=0; coverage=1; advanced=labeller analysis not implemented`
- Diagnosis: The advanced call reports that analysis is not implemented; the feedback does not expose a numerical result or a more specific failing branch.
- Repair group: `exact-enumeration`.
- Concrete fix: Implement exactLabellerKappaTest: enumerate distinct permutations of the predicted multiset with fixed marginals; compute kappa and extreme/permutations under the default absolute-kappa two-sided tail.
- Limit: The item name and public contract identify the required behavior; they do not prove a specific algorithmic defect behind the unimplemented response.

### labeller/advanced/sample-plan-delta-margin

- Evidence: `raw=1; kappa=1; correct=64/64; abstentions=0; invalid=0; coverage=1; advanced=labeller analysis not implemented`
- Diagnosis: The advanced call reports that analysis is not implemented; the feedback does not expose a numerical result or a more specific failing branch.
- Repair group: `sample-planner`.
- Concrete fix: Implement planLabellerKappaSample: derive po, pe, cell gradients and multinomial delta variance V from the supplied joint matrix, then return max(2, ceil(z*z*V/(margin*margin))) with the declared precision metadata.
- Limit: The item name and public contract identify the required behavior; they do not prove a specific algorithmic defect behind the unimplemented response.

### labeller/advanced/sample-plan-reject-unidentified-designs

- Evidence: `raw=1; kappa=1; correct=64/64; abstentions=0; invalid=0; coverage=1; advanced=labeller analysis not implemented`
- Diagnosis: The advanced call reports that analysis is not implemented; the feedback does not expose a numerical result or a more specific failing branch.
- Repair group: `sample-planner`.
- Concrete fix: Implement planner validation before calculation: require a square finite nonnegative matrix of at least two categories, total probability within 1e-10 of one without renormalizing, valid margin/confidence, pe != 1, V > 1e-15, and a safe finite sample size.
- Limit: The item name and public contract identify the required behavior; they do not prove a specific algorithmic defect behind the unimplemented response.

### labeller/advanced/exact-degenerate-and-size-bound

- Evidence: `raw=1; kappa=1; correct=72/72; abstentions=0; invalid=0; coverage=1; advanced=labeller analysis not implemented`
- Diagnosis: The advanced call reports that analysis is not implemented; the feedback does not expose a numerical result or a more specific failing branch.
- Repair group: `exact-enumeration`.
- Concrete fix: Implement exact-test domain checks for 1..9 observations, a named size-limit error beyond nine, and finite degenerate handling that returns pValue=1 for all-equal or all-abstain predictions.
- Limit: The item name and public contract identify the required behavior; they do not prove a specific algorithmic defect behind the unimplemented response.

### labeller/advanced/exact-inclusive-ties-and-alternatives

- Evidence: `raw=1; kappa=1; correct=72/72; abstentions=0; invalid=0; coverage=1; advanced=labeller analysis not implemented`
- Diagnosis: The advanced call reports that analysis is not implemented; the feedback does not expose a numerical result or a more specific failing branch.
- Repair group: `exact-enumeration`.
- Concrete fix: Implement greater, less and two-sided tails using inclusive integer-count comparisons under fixed marginals; compare absolute kappa for two-sided tails and include ties.
- Limit: The item name and public contract identify the required behavior; they do not prove a specific algorithmic defect behind the unimplemented response.

### labeller/advanced/exact-missing-and-invalid-multisets

- Evidence: `raw=0.9863013698630136; kappa=0.9836065573770492; correct=72/73; abstentions=1; invalid=0; coverage=0.9863013698630136; advanced=labeller analysis not implemented`
- Diagnosis: The advanced call reports that analysis is not implemented; the feedback does not expose a numerical result or a more specific failing branch.
- Repair group: `exact-enumeration`.
- Concrete fix: Implement exact-test encoding that retains null and invalid predictions as distinct noncolliding prediction-only categories, then enumerate their multiset together with valid labels without dropping observations.
- Limit: The item name and public contract identify the required behavior; they do not prove a specific algorithmic defect behind the unimplemented response.

### labeller/advanced/sample-plan-prevalence-and-confidence

- Evidence: `raw=1; kappa=1; correct=72/72; abstentions=0; invalid=0; coverage=1; advanced=labeller analysis not implemented`
- Diagnosis: The advanced call reports that analysis is not implemented; the feedback does not expose a numerical result or a more specific failing branch.
- Repair group: `sample-planner`.
- Concrete fix: Implement sample planning from the actual joint distribution and requested confidence: recompute prevalence-sensitive delta variance and a finite normal critical value for representable confidence values, rather than using a fixed variance or critical value.
- Limit: The item name and public contract identify the required behavior; they do not prove a specific algorithmic defect behind the unimplemented response.

## Cause grouping

| Proposed repair boundary | Items | Evidence limit |
|---|---:|---|
| Exact fixed-margin permutation test | 4 | Missing capability inferred; individual branch defects unobserved |
| Delta-method sample planner | 3 | Missing capability inferred; individual branch defects unobserved |

- Observed shared failure signatures: 1. Proposed capability repair groups: 2.
- Distinct implementation root-cause count is undetermined. Neither 7 items nor 2 API boundaries proves that many causes.

## Gate and tag comparison

| Canonical row | Result | Note |
|---|---|---|
| cause review | fail | All 7 failures reviewed. Exact 7; partial 0; prerequisite 0; unsupported 0. Repair-tag agreement 1.0. Two inferred repair groups versus seven author tags. Population below 30; 100 distinct actual causes unestablished. |

The section 12 requirement is conjunctive: 30 failing items, agreement at least 0.8, and 100 distinct remaining causes. This final population cannot satisfy it. A separate baseline review does not enlarge this final population.

At freeze, tag comparison was pending. The completed comparison follows below. Prerequisite-only matches receive no agreement credit.

## Frozen evidence

- Frozen diagnosis payload SHA-256: `112b30ba42375999004881f7332f49163913d6175c44771edb0247fee76b96c2`.
- The JSON `frozen_pre_tag` object is hashed as UTF-8 JSON with sorted keys, compact separators, and unescaped Unicode.
- No forbidden implementation, bank/source/tests, builder tags, prior reports, or handover documents were read.
- Post-tag comparison will be appended separately and will not revise the frozen diagnosis payload.

## Post-tag comparison

| Item | Match | Reason |
|---|---|---|
| `exact-fixed-margin-perfect` | exact | The frozen fix explicitly enumerates distinct predicted-multiset permutations under fixed marginals, matching the entire author tag. |
| `sample-plan-delta-margin` | exact | The frozen fix derives kappa delta variance from the specified joint distribution and computes the requested precision sample size. |
| `sample-plan-reject-unidentified-designs` | exact | The frozen fix explicitly rejects invalid matrix inputs, degenerate pe/V, invalid options and unsafe sample sizes. |
| `exact-degenerate-and-size-bound` | exact | The frozen fix names the enumeration bound, named over-limit error and constant/all-abstain pValue=1 convention. |
| `exact-inclusive-ties-and-alternatives` | exact | The frozen fix explicitly includes ties under the requested greater/less/absolute-two-sided tail, using integer comparisons. |
| `exact-missing-and-invalid-multisets` | exact | The frozen fix explicitly retains null and invalid as distinct prediction-only categories throughout multiset enumeration. |
| `sample-plan-prevalence-and-confidence` | exact | The frozen fix explicitly uses prevalence-sensitive variance from the actual joint and the requested confidence critical value. |

- Exact: 7. Partial: 0. Prerequisite: 0. Unsupported: 0.
- Strict concrete-fix agreement: 7/7 = 1.0. Only exact matches receive credit.
- Distinct author tag strings: 7. Reviewer repair groups: 2, both inferred.
- The frozen payload hash remains `112b30ba42375999004881f7332f49163913d6175c44771edb0247fee76b96c2`.

Each frozen fix matches the author’s behavioral repair prescription. The generic diagnosis alone would only identify an unavailable prerequisite; that diagnosis is not counted as a detailed causal match. The specific fixes provide the repair-tag matches.

The item names and public contract already disclose the target behaviors. Therefore, this agreement does not demonstrate seven independently identified causal defects. The shared unimplemented response cannot distinguish one common stub, two missing API implementations, or more internal defects. No candidate code was inspected.

The final cause-review row remains **fail**. The population contains fewer than 30 failing items, and the evidence does not establish 100 distinct actual remaining causes. A separate baseline diagnostic must be reported separately; it cannot change this final-population result.
