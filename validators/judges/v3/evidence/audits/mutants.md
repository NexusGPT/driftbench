# Independent advanced labeller mutation audit

| Check | Verdict | Note |
|---|---|---|
| planted bugs | pass | 26/26 satisfy edge and bank kill requirements; 26/26 lose bank items; original baseline 334/334, unchanged bound-copy baseline 334/334 items pass at seed 71. |

Measured: 2026-10-18T00:50:49.382Z.

One semantic source defect per isolated module. Delegated alpha defects mutate a copied real stats helper bound into the copied advanced module. Production and bank files remain untouched. Each unchanged-copy edge witness passes before mutation. Edge kills alone do not count as bank kills.

| Source | SHA-256 |
|---|---|
| /private/var/folders/r2/k83h9fg92j7f6pfxshk0nn280000gn/T/astra-judges/packages/judges/src/labeller-analysis.ts | c0aa40de69cad90632b118401f50e4de54f5f70ed6330a033dabe4091f07236a |
| /private/var/folders/r2/k83h9fg92j7f6pfxshk0nn280000gn/T/astra-judges/packages/stats/src/agreement.ts | f0ea2c19f087f5563fd34f035ce1e5134bf1ef444a5eb4785d102a92b03fb85a |
| /private/var/folders/r2/k83h9fg92j7f6pfxshk0nn280000gn/T/astra-judges/packages/validators/src/ladders/judges/v3/advanced-bank.ts | 4d5b340f1e545d01115c2d16e22f25a79b1cea622f26819e0e6138aa0e58d6ff |
| /private/var/folders/r2/k83h9fg92j7f6pfxshk0nn280000gn/T/astra-judges/packages/validators/src/ladders/judges/v3/bank.ts | c7c5320be0208888e3ecb9744566316803014cf66efcf764bbdaf0bd5f48f482 |
| /private/var/folders/r2/k83h9fg92j7f6pfxshk0nn280000gn/T/astra-judges/packages/validators/src/ladders/judges/v3/fixtures.ts | d3b68e6065ba68cba6ecb220f0d8e7c7057b3fc2c19ca5a58cfc1d3b630eb143 |
| /private/var/folders/r2/k83h9fg92j7f6pfxshk0nn280000gn/T/astra-judges/packages/judges/src/labeller.ts | ea066b27138882d7ecc0457bdddff1808bd0b2faa734d95a5bf3a09be8386d78 |
| /private/var/folders/r2/k83h9fg92j7f6pfxshk0nn280000gn/T/astra-judges/packages/validators/test/judges/v3/advanced-mutants.test.ts | bd98c1da321f64485c228b4a2f1067f101383acb4cc417805432eaa7445c0a9e |

| Mutation | Capability | Edge killed | Calls through affected bound export | Bank items lost | First lost item |
|---|---|---|---:|---:|---|
| CI gradient omits row-marginal coupling | CI | true | 8 | 3 | labeller/advanced/ci-unequal-marginals-confidence |
| CI standard-error variance divided by n squared | CI | true | 8 | 3 | labeller/advanced/ci-balanced-delta |
| CI joint counts normalized by n squared | CI | true | 7 | 4 | labeller/advanced/ci-balanced-delta |
| PABAK returns raw agreement without binary adjustment | PABAK | true | 5 | 2 | labeller/advanced/pabak-skewed-prevalence |
| PABAK accepts missing observations in binary domain | PABAK | true | 3 | 1 | labeller/advanced/pabak-domain-and-abstention |
| weighted kappa swaps linear and quadratic distances | weighted | true | 10 | 4 | labeller/advanced/weighted-linear-distance |
| weighted kappa sorts the explicit ordinal positions | weighted | true | 10 | 2 | labeller/advanced/weighted-nonlexical-order |
| weighted agreement omits maximum-distance normalization | weighted | true | 10 | 4 | labeller/advanced/weighted-linear-distance |
| alpha discards every partly missing unit | alpha | true | 6 | 2 | labeller/advanced/alpha-variable-observed-raters |
| alpha treats singleton self-pairs as coincidences | alpha | true | 6 | 1 | labeller/advanced/alpha-singletons-not-marginals |
| alpha loses finite-population expected-disagreement correction | alpha | true | 4 | 4 | labeller/advanced/alpha-complete-multiple-raters |
| rare-class precision uses gold support denominator | confusion | true | 4 | 1 | labeller/advanced/confusion-rare-label-denominators |
| rare-class recall uses predicted-count denominator | confusion | true | 4 | 1 | labeller/advanced/confusion-rare-label-denominators |
| coverage threshold excludes equality | coverage | true | 10 | 1 | labeller/advanced/coverage-inclusive-and-selective-denominator |
| accepted accuracy divides by all observations | coverage | true | 10 | 3 | labeller/advanced/coverage-inclusive-and-selective-denominator |
| coverage denominator drops missing and invalid predictions | coverage | true | 10 | 2 | labeller/advanced/coverage-inclusive-and-selective-denominator |
| selector maximizes threshold instead of eligible coverage | coverage | true | 2 | 1 | labeller/advanced/threshold-max-coverage-and-tie |
| mapping ignores explicit answer rename | mapping | true | 8 | 3 | labeller/advanced/mapping-renamed-vocabularies |
| mapping rejects split children sharing a target parent | mapping | true | 8 | 1 | labeller/advanced/mapping-split-children-common-parent |
| mapping accepts unknown source answer as target label | mapping | true | 7 | 1 | labeller/advanced/mapping-source-validity-before-target |
| sample precision rounds required size down | sample | true | 6 | 3 | labeller/advanced/sample-plan-delta-margin |
| sample precision ignores requested confidence | sample | true | 7 | 1 | labeller/advanced/sample-plan-prevalence-and-confidence |
| sample precision assumes uniform chance prevalence | sample | true | 7 | 4 | labeller/advanced/ci-balanced-delta |
| exact greater-tail test excludes tied permutations | exact | true | 8 | 3 | labeller/advanced/exact-fixed-margin-perfect |
| exact two-sided tail becomes one-sided | exact | true | 9 | 3 | labeller/advanced/exact-fixed-margin-perfect |
| exact permutation discards null predictions | exact | true | 10 | 2 | labeller/advanced/exact-missing-and-invalid-multisets |

- CI gradient omits row-marginal coupling: raw=1; kappa=1; correct=64/64; abstentions=0; invalid=0; coverage=1; advanced=delta standard error: got 0.07957333931329287, expected 0.08050028953498042
- CI standard-error variance divided by n squared: raw=1; kappa=1; correct=56/56; abstentions=0; invalid=0; coverage=1; advanced=delta standard error: got 0.007999999999999998, expected 0.08000000000230044
- CI joint counts normalized by n squared: raw=1; kappa=1; correct=56/56; abstentions=0; invalid=0; coverage=1; advanced=delta standard error: got 0.008820777576538144, expected 0.08000000000230044
- PABAK returns raw agreement without binary adjustment: raw=1; kappa=1; correct=48/48; abstentions=0; invalid=0; coverage=1; advanced=PABAK: got 0.8, expected 0.6
- PABAK accepts missing observations in binary domain: raw=0.9824561403508771; kappa=0.9767441860465116; correct=56/57; abstentions=1; invalid=0; coverage=0.9824561403508771; advanced=binary abstention: invalid input was accepted
- weighted kappa swaps linear and quadratic distances: raw=1; kappa=1; correct=56/56; abstentions=0; invalid=0; coverage=1; advanced=weighted kappa: got 0.2500000000000001, expected 0.16666666666666663
- weighted kappa sorts the explicit ordinal positions: raw=1; kappa=1; correct=64/64; abstentions=0; invalid=0; coverage=1; advanced=weighted kappa: got 0.16666666666666674, expected 0
- weighted agreement omits maximum-distance normalization: raw=1; kappa=1; correct=56/56; abstentions=0; invalid=0; coverage=1; advanced=weighted observed: got 0.19999999999999996, expected 0.6
- alpha discards every partly missing unit: raw=0.9863013698630136; kappa=0.9836065573770492; correct=72/73; abstentions=1; invalid=0; coverage=0.9863013698630136; advanced=krippendorffAlpha: matrix has no unit with two values
- alpha treats singleton self-pairs as coincidences: raw=0.9863013698630136; kappa=0.9836065573770492; correct=72/73; abstentions=1; invalid=0; coverage=0.9863013698630136; advanced=alpha alpha: got 0.09090909090909094, expected -0.3333333333333335
- alpha loses finite-population expected-disagreement correction: raw=1; kappa=1; correct=64/64; abstentions=0; invalid=0; coverage=1; advanced=alpha alpha: got 0.4893617021276596, expected 0.5319148936170213
- rare-class precision uses gold support denominator: raw=1; kappa=1; correct=64/64; abstentions=0; invalid=0; coverage=1; advanced=rare precision: got 1, expected 0.1
- rare-class recall uses predicted-count denominator: raw=1; kappa=1; correct=64/64; abstentions=0; invalid=0; coverage=1; advanced=rare recall: got 0.1, expected 1
- coverage threshold excludes equality: raw=0.9824561403508771; kappa=0.9767441860465116; correct=56/57; abstentions=1; invalid=0; coverage=0.9824561403508771; advanced=selection counts: got [6,1,1,1,1,3], expected [6,3,3,1,1,1]
- accepted accuracy divides by all observations: raw=0.9824561403508771; kappa=0.9767441860465116; correct=56/57; abstentions=1; invalid=0; coverage=0.9824561403508771; advanced=accepted-only accuracy: got 0.5, expected 1
- coverage denominator drops missing and invalid predictions: raw=0.9824561403508771; kappa=0.9767441860465116; correct=56/57; abstentions=1; invalid=0; coverage=0.9824561403508771; advanced=coverage retains rejected units: got 0.75, expected 0.5
- selector maximizes threshold instead of eligible coverage: raw=0.9846153846153847; kappa=0.9808089754945379; correct=64/65; abstentions=1; invalid=0; coverage=0.9846153846153847; advanced=coverage tie selection: got 0.8, expected 0.7
- mapping ignores explicit answer rename: raw=1; kappa=1; correct=56/56; abstentions=0; invalid=0; coverage=1; advanced=renamed labels: got [1,3,0,2], expected [3,3,0,0]
- mapping rejects split children sharing a target parent: raw=1; kappa=1; correct=64/64; abstentions=0; invalid=0; coverage=1; advanced=mapping contains an unknown or duplicate source/target
- mapping accepts unknown source answer as target label: raw=1; kappa=1; correct=72/72; abstentions=0; invalid=0; coverage=1; advanced=target-name shortcut remains invalid: got [2,0,1,3], expected [1,1,1,3]
- sample precision rounds required size down: raw=1; kappa=1; correct=64/64; abstentions=0; invalid=0; coverage=1; advanced=planned sample size: got 245, expected 246
- sample precision ignores requested confidence: raw=1; kappa=1; correct=72/72; abstentions=0; invalid=0; coverage=1; advanced=prevalence-specific size: got 576, expected 406
- sample precision assumes uniform chance prevalence: raw=1; kappa=1; correct=56/56; abstentions=0; invalid=0; coverage=1; advanced=delta standard error: got 0.05, expected 0.08000000000230044
- exact greater-tail test excludes tied permutations: raw=1; kappa=1; correct=64/64; abstentions=0; invalid=0; coverage=1; advanced=exact probability: got 0, expected 0.16666666666666666
- exact two-sided tail becomes one-sided: raw=1; kappa=1; correct=64/64; abstentions=0; invalid=0; coverage=1; advanced=default absolute two-sided probability: got 0.16666666666666666, expected 0.3333333333333333
- exact permutation discards null predictions: raw=0.9863013698630136; kappa=0.9836065573770492; correct=72/73; abstentions=1; invalid=0; coverage=0.9863013698630136; advanced=exact kappa: got 0, expected -0.2857142857142857

Command: `pnpm exec vitest run packages/validators/test/judges/v3/scoring-mutants.test.ts packages/validators/test/judges/v3/advanced-mutants.test.ts --maxWorkers=2 --reporter=verbose`.

Scope: the actual combined bank at seed 71 and the explicit independent edge witnesses. This does not establish other seeds, live-model quality, or the remaining hardness-audit sections.

## Observed final execution

- Shared-wrapper command above exited 0: 2 test files passed, 46 tests passed, Vitest duration 22.72s.
- Advanced suite: 26/26 source mutants pass both kill requirements across all 9 capabilities; original baseline and unchanged bound-copy baseline both pass 334/334 items.
- Existing base suite: 20/20 unchanged source mutants pass against its 300-item labeller bank, in the same execution on the expanded-source checkpoint.
- Existing base test SHA-256: `e02128be07bf4c3e8137c3b4fa1ea4a780c94e123c41ba9d5b07faf62565a2b9`.
- Every source hash above matches the file read after the final execution. No production, bank, or old-test files were edited by this auditor.

## Audit-harness corrections before this result

- Initial advanced attempt had 26 inactive mutants because a context-free TypeScript scanner mishandled template literals. It established no advanced mutation kills. Parser-derived token matching now requires exactly one source site per edit.
- The next execution activated all 26 mutants and lost bank items for every mutant, but an ordinal-order edge witness was insensitive. Strict result: 25/26; combined tests: 45/46, exit 1, 15.93s.
- Added an asymmetric independent ordinal witness without changing any mutant or bank case: declared order gives kappa 4/7; lexical order gives kappa 1/4. Rational distance enumeration independently confirms both values.
- Final execution above supersedes those failed audit attempts. No bank survivor was observed in either activated execution; this statement covers only the measured seed and mutations.

- Final read-only Biome check: exit 0; checked 1 file, no fixes applied. Command: shared wrapper with `pnpm exec biome check packages/validators/test/judges/v3/advanced-mutants.test.ts`.
