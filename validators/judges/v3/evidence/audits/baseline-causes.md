# Expanded labeller cause review

| cause review | fail | Baseline: 30 failures reviewed; 22 exact matches (0.7333), 3 partial, 5 prerequisite-only; required agreement >=0.8. Final causal population pending. Codex substitutes Sonnet. |

- Reviewer: inherited Codex substitutes prescribed Sonnet.
- Scope: only supplied blind feedback and public contracts; no repository implementation, tests, fixtures, bank, tags, or prior pilots inspected.
- Baseline: 0/334 passing; 30 failing items reviewed (10 base, 20 advanced).
- Diagnosis is frozen before tag exposure. Hash: `8e6f0c02c939ef33e9008982ccff076da27681d1d699a6d0b3ed12936bd54aef`.
- Shared scoring/replay/analysis omissions prevent claims of 30 distinct verified repairs.
- Selection is stratified by visible family/API, not random.

## Frozen baseline diagnoses

### 1. labeller/abstain/erased-value/tier-1

- Proposed fix: Implement observed exact-match counts and null abstention counts. Keep every observation in raw agreement and empirical kappa; coverage uses valid answers divided by all observations. The diagnostic expects two abstentions and coverage 0.6, so filtering nulls is wrong.
- Limit: The all-zero output supports missing scoring/accounting; it does not establish erased-value semantic misclassification.

### 2. labeller/adversarial-label/fake-system/tier-1

- Proposed fix: Replace zero scoring with exact answer-versus-gold counting and empirical marginals. The reported supplied answers should yield 40 correct, agreement 1, kappa 1, and coverage 1. Do not add an instruction-word classifier.
- Limit: Feedback does not show an actual injected instruction changing a prediction; a prompt-security repair is not independently established.

### 3. labeller/agreement/negation/tier-1

- Proposed fix: Compute Cohen kappa as (po-pe)/(1-pe) from retained observations; preserve a negative result. The diagnostic must return -1 while the scoring series returns agreement and kappa 1.
- Limit: Shared zero scoring is evident; a negation-understanding failure is not established.

### 4. labeller/cache-key/context/tier-1

- Proposed fix: Implement replay lookup using a deterministic request key containing label-set hash, exact text, optional context, and labeller ID. Distinct contexts must not hit the same entry; a missing entry must throw.
- Limit: Replay is explicitly unimplemented. Context-key omission is a contract-directed risk, not a demonstrated implemented-code defect.

### 5. labeller/label-set-change/definition/tier-1

- Proposed fix: Implement replay with SHA-256 identity over set name, ordered label names, and their definitions. Definition changes must change identity and prevent reuse of an old recorded answer.
- Limit: Replay is explicitly unimplemented; definition-sensitive hashing is required before the named scenario can be evaluated.

### 6. labeller/length-bias/long-definition/tier-1

- Proposed fix: Implement exact answer scoring so the reported series produces 40 correct and full agreement/coverage. Label definition length must not alter nominal score accounting; do not introduce text-length heuristics.
- Limit: The same zero-scoring signature appears elsewhere; no observed length-dependent prediction error is isolated.

### 7. labeller/near-miss/case/tier-1

- Proposed fix: Compare names exactly without case folding, trimming, or prefix matching. Count nonmatching undeclared strings as invalid, retaining them in the denominator; implement the missing score aggregation.
- Limit: Contract supports exact comparison; feedback alone does not reveal which near-miss prediction, if any, is present.

### 8. labeller/none/above-domain/tier-1

- Proposed fix: Treat literal none as a valid implicit nominal class and count matching none answers as correct. Keep null abstention and undeclared-string invalid outcomes separate, then compute scores from observed counts.
- Limit: No input text is visible, so an above-domain semantic classifier fix is not justified.

### 9. labeller/order-bias/reverse-labels/tier-1

- Proposed fix: Aggregate nominal agreement by exact label identity rather than index or first-listed position. Compute marginals over the same identities so reordering declarations does not change the score of unchanged gold and answers.
- Limit: Current all-zero scores demonstrate a prerequisite failure, not an isolated order-bias mechanism.

### 10. labeller/replay/cloned-object/tier-1

- Proposed fix: Implement an immutable snapshot replay map keyed by serialized request content rather than object identity. Cloned equivalent requests must replay the same answer; validate labeller ID, reject conflicting entries, and throw on misses.
- Limit: Recording explicitly fails because replay is unimplemented; clone stability is a contract-directed implementation requirement.

### 11. labeller/advanced/confusion-orientation

- Proposed fix: Implement confusion with gold labels as rows and prediction descriptors as columns in declared order plus implicit none. Increment cell [gold][prediction], derive TP/FP/FN and score from the same retained observations.
- Limit: The API is unimplemented; the orientation defect is a targeted contract risk rather than an isolated numerical observation.

### 12. labeller/advanced/pabak-skewed-prevalence

- Proposed fix: Implement binary-domain validation followed by PABAK = 2*(exact matches/n)-1. Do not substitute empirical Cohen kappa under skewed class prevalence; reject null, unknown, or multiclass inputs.
- Limit: The advanced API is unimplemented and base scoring also fails; the formula repair is contract-directed.

### 13. labeller/advanced/ci-balanced-delta

- Proposed fix: Implement the stated multinomial cell gradient, V = E[g squared] - E[g] squared, and SE = sqrt(V/n). Return kappa plus/minus the two-sided normal critical value times SE, clipped to [-1,1], using default confidence 0.95.
- Limit: No advanced computed interval is visible; this is an implementation prescription for a missing API.

### 14. labeller/advanced/ci-degenerate-no-false-certainty

- Proposed fix: Handle n<2, pe=1, or V<=1e-15 before interval division. Preserve the base kappa estimate but return degenerate status and null lower, upper, SE, and varianceFactor.
- Limit: The missing API masks whether any particular degeneracy branch is otherwise wrong.

### 15. labeller/advanced/weighted-linear-distance

- Proposed fix: Implement linear ordinal disagreement abs(i-j) using supplied label positions. Derive weighted kappa from observed and independent-marginal expected disagreement; normalize returned observed/expected agreement by K-1.
- Limit: The contract permits direct documented mathematics; no advanced result is available to isolate a narrower bug.

### 16. labeller/advanced/alpha-complete-multiple-raters

- Proposed fix: Implement nominal multi-rater alpha over the raters-by-units matrix, with pairable-unit coincidence counts and chance disagreement from pooled coincidence marginals. Validate rectangular shape and at least two raters; return all required counts.
- Limit: Advanced alpha is absent, rather than a demonstrated error on one specific matrix.

### 17. labeller/advanced/ci-missing-prediction-marginals

- Proposed fix: Retain null and invalid outputs as separate prediction-only categories when constructing the full empirical joint distribution for kappa and its delta gradient. Give both zero gold marginal; never drop these observations or merge them into none.
- Limit: The missing implementation prevents determining whether filtering or category collision is the original finer-grained cause.

### 18. labeller/advanced/coverage-inclusive-and-selective-denominator

- Proposed fix: Implement acceptance as valid class AND confidence>=threshold. Compute coverage accepted/all observations and accepted accuracy correct/accepted, with null accuracy and interval at accepted=0; separately count abstain, invalid, and below-threshold observations.
- Limit: This is the contract-required missing method; no existing selective denominator calculation is observed.

### 19. labeller/advanced/coverage-exact-binomial-boundaries

- Proposed fix: Implement exact Clopper-Pearson bounds for accepted correct/accepted using requested confidence, including zero-success and all-success boundary formulas. Return null bounds with no accepted cases; preserve finite endpoint-near confidence calculations.
- Limit: No computed bounds exist in feedback; the proposal targets the named contract branch.

### 20. labeller/advanced/threshold-max-coverage-and-tie

- Proposed fix: Validate and deduplicate/sort thresholds, calculate coverage points, and retain accepted>0 points satisfying empirical minAccuracy and minCoverage. Choose highest coverage, breaking ties with the lower threshold; return null when none qualify.
- Limit: The selector is unimplemented; no evidence supports changing the contract to optimize accuracy instead.

### 21. labeller/advanced/alpha-singletons-not-marginals

- Proposed fix: Exclude units with fewer than two observed ratings from alpha coincidence counts and their marginals, while counting those units and null ratings in diagnostics. Return insufficient/null metrics if no pairable units remain.
- Limit: This is a prerequisite implementation choice; the absent method has no visible singleton-specific numerical output.

### 22. labeller/advanced/mapping-renamed-vocabularies

- Proposed fix: Implement explicit total gold and answer vocabulary maps into a common target set, including none. Apply the respective map to valid source labels, preserve null/invalid statuses, and score the mapped arrays. Implement replay identity as the separately observed prerequisite.
- Limit: Both replay and advanced analysis are unimplemented; a rename-only mapping defect cannot be isolated yet.

### 23. labeller/advanced/mapping-total-and-unambiguous

- Proposed fix: Before mapping observations, validate exactly one row per source label including none, known source and target labels, no missing rows, and no duplicate source rows even with identical targets. Reject ambiguous mappings rather than choosing one row.
- Limit: The absent API and replay block hide specific validation behavior; these are required checks, not observed branch defects.

### 24. labeller/advanced/mapping-source-validity-before-target

- Proposed fix: Validate each gold label against goldSet before mapping. Classify each answer against answerSet before target lookup; an unknown source string remains invalid even if it names a valid target label. Preserve null as abstain.
- Limit: The API is absent; the feedback does not contain a concrete source/target collision.

### 25. labeller/advanced/sample-plan-delta-margin

- Proposed fix: Compute the same multinomial delta V from the supplied square joint probability matrix, then n=max(2,ceil(z squared*V/margin squared)). Return the assumed kappa, variance, confidence, margin and iid-fixed-joint assumption; reject unsafe calculated sizes.
- Limit: No sample-plan output exists; this is a formula implementation prescription.

### 26. labeller/advanced/sample-plan-reject-unidentified-designs

- Proposed fix: Validate square dimension>=2, finite nonnegative probabilities, sum within 1e-10 of 1 without renormalizing, confidence/margin strictly between 0 and 1. Reject pe=1 and V<=1e-15 as unidentified precision designs.
- Limit: The missing API is the observed blocker; no invalid matrix-specific failure has been isolated.

### 27. labeller/advanced/exact-fixed-margin-perfect

- Proposed fix: Implement exhaustive distinct permutations of the predicted multiset for 1..9 observations with gold fixed. Compute each statistic under fixed marginals and return extreme/permutation count, observed kappa, and exact method metadata.
- Limit: The API is unimplemented; a random approximation or duplicated-permutation bug is not observed.

### 28. labeller/advanced/exact-inclusive-ties-and-alternatives

- Proposed fix: Count inclusive greater/less tails and the absolute-kappa two-sided tail using fixed-margin integer count numerators. Do not double the smaller one-sided probability; include ties exactly and use two-sided by default.
- Limit: This is the required alternative/tie implementation for the missing API, not a measured off-by-one defect.

### 29. labeller/advanced/weighted-explicit-domain

- Proposed fix: Validate at least two unique nonblank ordered labels, then require every gold and answer label to appear in that explicit order. Reject null, unknown labels, and none unless none has an explicit ordinal position.
- Limit: The advanced API is unimplemented; shared nominal none handling cannot be inherited into this stricter domain.

### 30. labeller/advanced/confusion-none-abstain-invalid

- Proposed fix: Append implicit none to declared labels if absent, then add typed abstain and invalid prediction descriptors distinct from strings. Both exceptional outputs add FN to the gold class, never FP to a named class; none remains a normal label.
- Limit: The missing API prevents observing a concrete sentinel collision; typed categories implement the published contract.

## Post-tag comparison

- Exact semantic agreement: 22/30 = 0.7333; below 0.8, so the baseline audit fails.
- Classification: 22 exact, 3 partial, 5 prerequisite-only, 0 unsupported.
- Counting partial matches would give 25/30 = 0.8333. This sensitivity calculation does not override the strict result.
- All 20 advanced proposals match method tags. Base semantic-classification tags often exceed what the failing score feedback establishes.
- Reviewed baseline: 10 proposed repair clusters, not 30 verified distinct causes. Three observed blocker signatures do not prove independent implementation root causes.
- Frozen payload remains unchanged: `8e6f0c02c939ef33e9008982ccff076da27681d1d699a6d0b3ed12936bd54aef`.

| Item | Match | Reason |
|---|---|---|
| labeller/abstain/erased-value/tier-1 | partial | The frozen fix counts null abstentions without agreement, but does not decide to abstain from unavailable evidence. It covers accounting, only part of the classification tag. |
| labeller/adversarial-label/fake-system/tier-1 | prerequisite | Frozen fix restores score aggregation and explicitly declines to infer a prompt-security error. It does not implement the tagged treatment of embedded instructions. |
| labeller/agreement/negation/tier-1 | prerequisite | Frozen fix restores empirical kappa and negative values; the tag concerns applying supplied predicates to evidence. Scoring is necessary but does not implement that classifier. |
| labeller/cache-key/context/tier-1 | exact | The frozen proposed fix implements the same specific method or validation behavior named by the tag. This is semantic agreement, not independent implementation verification. |
| labeller/label-set-change/definition/tier-1 | partial | Frozen fix invalidates stale recordings through definition-sensitive hashing. It does not reclassify evidence under changed predicates. |
| labeller/length-bias/long-definition/tier-1 | prerequisite | Frozen fix makes nominal score accounting independent of definition length. It does not implement evidence classification invariant to irrelevant text length. |
| labeller/near-miss/case/tier-1 | exact | The frozen proposed fix implements the same specific method or validation behavior named by the tag. This is semantic agreement, not independent implementation verification. |
| labeller/none/above-domain/tier-1 | prerequisite | Frozen fix recognizes none as valid during scoring. The tag instead requires deciding that evidence falls outside every supplied predicate. |
| labeller/order-bias/reverse-labels/tier-1 | prerequisite | Frozen fix uses label identities rather than positions in score aggregation. It does not establish position-independent evidence classification. |
| labeller/replay/cloned-object/tier-1 | partial | Frozen immutable content-keyed replay ensures repeated equivalent requests retrieve the same stored answer. It cannot independently ensure that stored answer is correct. |
| labeller/advanced/confusion-orientation | exact | The frozen proposed fix implements the same specific method or validation behavior named by the tag. This is semantic agreement, not independent implementation verification. |
| labeller/advanced/pabak-skewed-prevalence | exact | The frozen proposed fix implements the same specific method or validation behavior named by the tag. This is semantic agreement, not independent implementation verification. |
| labeller/advanced/ci-balanced-delta | exact | The frozen proposed fix implements the same specific method or validation behavior named by the tag. This is semantic agreement, not independent implementation verification. |
| labeller/advanced/ci-degenerate-no-false-certainty | exact | The frozen proposed fix implements the same specific method or validation behavior named by the tag. This is semantic agreement, not independent implementation verification. |
| labeller/advanced/weighted-linear-distance | exact | The frozen proposed fix implements the same specific method or validation behavior named by the tag. This is semantic agreement, not independent implementation verification. |
| labeller/advanced/alpha-complete-multiple-raters | exact | The frozen proposed fix implements the same specific method or validation behavior named by the tag. This is semantic agreement, not independent implementation verification. |
| labeller/advanced/ci-missing-prediction-marginals | exact | The frozen proposed fix implements the same specific method or validation behavior named by the tag. This is semantic agreement, not independent implementation verification. |
| labeller/advanced/coverage-inclusive-and-selective-denominator | exact | The frozen proposed fix implements the same specific method or validation behavior named by the tag. This is semantic agreement, not independent implementation verification. |
| labeller/advanced/coverage-exact-binomial-boundaries | exact | The frozen proposed fix implements the same specific method or validation behavior named by the tag. This is semantic agreement, not independent implementation verification. |
| labeller/advanced/threshold-max-coverage-and-tie | exact | The frozen proposed fix implements the same specific method or validation behavior named by the tag. This is semantic agreement, not independent implementation verification. |
| labeller/advanced/alpha-singletons-not-marginals | exact | The frozen proposed fix implements the same specific method or validation behavior named by the tag. This is semantic agreement, not independent implementation verification. |
| labeller/advanced/mapping-renamed-vocabularies | exact | The frozen proposed fix implements the same specific method or validation behavior named by the tag. This is semantic agreement, not independent implementation verification. |
| labeller/advanced/mapping-total-and-unambiguous | exact | The frozen proposed fix implements the same specific method or validation behavior named by the tag. This is semantic agreement, not independent implementation verification. |
| labeller/advanced/mapping-source-validity-before-target | exact | The frozen proposed fix implements the same specific method or validation behavior named by the tag. This is semantic agreement, not independent implementation verification. |
| labeller/advanced/sample-plan-delta-margin | exact | The frozen proposed fix implements the same specific method or validation behavior named by the tag. This is semantic agreement, not independent implementation verification. |
| labeller/advanced/sample-plan-reject-unidentified-designs | exact | The frozen proposed fix implements the same specific method or validation behavior named by the tag. This is semantic agreement, not independent implementation verification. |
| labeller/advanced/exact-fixed-margin-perfect | exact | The frozen proposed fix implements the same specific method or validation behavior named by the tag. This is semantic agreement, not independent implementation verification. |
| labeller/advanced/exact-inclusive-ties-and-alternatives | exact | The frozen proposed fix implements the same specific method or validation behavior named by the tag. This is semantic agreement, not independent implementation verification. |
| labeller/advanced/weighted-explicit-domain | exact | The frozen proposed fix implements the same specific method or validation behavior named by the tag. This is semantic agreement, not independent implementation verification. |
| labeller/advanced/confusion-none-abstain-invalid | exact | The frozen proposed fix implements the same specific method or validation behavior named by the tag. This is semantic agreement, not independent implementation verification. |

## Final blind population

- Pending feedback from the fresh causal blind pilot.
- Baseline diagnosis is informative only and cannot substitute for the final failing population.
- If final feedback has no failures, remaining causes are 0 and final cause agreement is unmeasured.
- No excluded-pilot code or results inspected.

## Canonical baseline provenance

- Canonical causal baseline: `/tmp/astra-judges-causal-blind/results/round-00.feedback.json`.
- Full parsed JSON equality against the original baseline is independently verified; 0/334 passing, 334 failures.
- Original frozen diagnoses and payload hash remain unchanged.
- Final causal round-10 feedback remains pending.
