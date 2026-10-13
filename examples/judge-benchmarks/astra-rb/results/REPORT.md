# RubricBench validated machine checks

Measured 2026-10-13T04:36:46.612Z. Full DEV score on 357 pairs; partial code-execution coverage is disclosed below.

Combined: 296/357 (82.91%), versus the frozen 294/357 (82.35%). Change: +0.56 percentage points.
Feature gate: FAIL. TEST gate: FAIL. No TEST call has occurred in this experiment.

## Full-dev measurements

| Procedure | Correct / 357 | Accuracy | Change, points | Fixes | Breaks | Extra checks / 100 | Total / 100 | Exact paired p |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Frozen baseline | 294 | 82.35% | 0 | 0 | 0 | $0 | $0.167171 | 1 |
| execution | 294 | 82.35% | +0.00 | 0 | 0 | $0.182035 | $0.349205 | 1 |
| constraints | 296 | 82.91% | +0.56 | 2 | 0 | $0.062493 | $0.229664 | 0.5 |
| combined | 296 | 82.91% | +0.56 | 2 | 0 | $0.227167 | $0.394338 | 0.5 |

| Procedure | Code/MBPP correct / 83 | Code fixes | Code breaks | Machine-decided pairs | Correct among decided | Baseline correct on same pairs |
|---|---:|---:|---:|---:|---:|---:|
| execution | 69 | 0 | 0 | 0 | 0 | 0 |
| constraints | 69 | 0 | 0 | 13 | 13 | 11 |
| combined | 69 | 0 | 0 | 13 | 13 | 11 |

The exact paired test is the two-sided binomial McNemar test on discordant pairs. Each pair counts once. Correlated canonical presentations are not independent samples.

## Scope, validity and coverage

- All 357 original dev pairs are scored. All 55 council-owned ties retain their original decisions and incur no new calls.
- Code/MBPP contains 83 pairs. Its 15 ties are excluded, leaving 68 eligible pairs, all sent through instruction-only generation.
- There are 240 routed plans and 240 terminal evidence records. Unrouted pairs retain the frozen baseline.
- Execution contracts: 37; both candidates observed: 15; at least one observed: 18; candidate-case observations: 574.
- Input validation rejects 6 generated cases before candidate execution. Reference/example conflicts and invalid contracts abstain.
- C2 generation sees the instruction only. Contract validation sees the question, rubric, generated inputs and reference, with no candidates or labels.
- Each adapter sees one exact candidate, validated input previews and output types, without expected values or frozen verdicts. A separate binding audit precedes sandbox execution.
- Both candidates receive identical validated inputs. Original fenced source is read from files. Allowed changes are entry points, imports, fixture binding and output serialization.
- Execution uses this worktree's packages/sandbox localProvider plus macOS sandbox-exec. Network access and outside writes are denied. Runs have CPU, output and wall-clock limits.
- An oracle-matched disagreement is final for its machine block. Both passing, both failing, absent or incomparable observations retain the frozen judge. A known fail cannot win through an unknown counterpart.
- C1 programs use instruction and rubric constraints. Positive/negative fixtures and independent audits validate them. Three demonstrated parser defects are rejected through fictional adversarial fixtures before labels are inspected.
- Blind source review rejects the apparent NumPy separation: its oracle requires a 2D output and a stacking axis that the instruction does not specify. The raw runs remain visible, but they cannot override the baseline.
- Blind source review also rejects a browser separation caused by linkedom lacking standard HTMLFormElement.elements. A sandboxed fictional jsdom control confirms the environment gap.
- Infrastructure repairs occur before labels are inspected: explicit inputs, output shape, shared test-module helpers, dependencies, TypeScript API compatibility and direct offline C# compilation. Existing valid observations are retained without reference to labels.

## Cost accounting

Reported research cost: $1.480200 across 747 recorded Haiku calls. The owner raises the task cap from $6 to $12 and concurrency from two to six.
Per-procedure cost uses the union of recording keys needed by that procedure: generator, contract audit, adapters, binding audits and their repairs. Earlier discarded generation experiments are research cost, not deployment cost. Reused adapter attempts remain charged.
Total per 100 adds the complete frozen judge cost, even for machine-decided pairs. No hypothetical skipped-judge savings are claimed.
The copied CLI harness reports successful response costs. A provider refusal interrupted one batch; failed or unreturned calls lack provider cost receipts. Exact invoice cost is therefore unavailable. Reported costs are observed lower bounds, not a claimed invoice total.

## Release decision

Feature bar: at least four fixes among the 14 frozen code/MBPP misses, zero code breaks, and extra machine-check cost below $0.07 per 100.
TEST bar: at least three overall dev points. A feature-only pass does not authorize TEST. A qualifying design must be committed before the single disjoint, stratified TEST confirmation and cannot be tuned afterward.
Combined fixes: rubric_eval_320, rubric_eval_1061. Combined breaks: none.
Code fixes: none. Code breaks: none.

## Per-domain combined results

| Domain | Correct / n | Frozen correct | Accuracy | Wilson 95% interval |
|---|---:|---:|---:|---:|
| Factuality | 9/10 | 9 | 90.00% | 59.58% to 98.21% |
| Focus | 6/6 | 6 | 100.00% | 60.97% to 100.00% |
| Math | 1/2 | 1 | 50.00% | 9.45% to 90.55% |
| Precise IF | 5/9 | 5 | 55.56% | 26.67% to 81.12% |
| Safety | 12/12 | 12 | 100.00% | 75.75% to 100.00% |
| code | 67/78 | 67 | 85.90% | 76.49% to 91.94% |
| general | 24/28 | 24 | 85.71% | 68.51% to 94.30% |
| gpqa | 1/1 | 1 | 100.00% | 20.65% to 100.00% |
| harmlessness | 11/13 | 11 | 84.62% | 57.77% to 95.67% |
| helpful | 5/5 | 5 | 100.00% | 56.55% to 100.00% |
| human-preference | 57/83 | 57 | 68.67% | 58.06% to 77.64% |
| ifeval | 31/33 | 29 | 93.94% | 80.39% to 98.32% |
| math | 23/24 | 23 | 95.83% | 79.76% to 99.26% |
| mbpp | 2/5 | 2 | 40.00% | 11.76% to 76.93% |
| mmlu-pro | 1/1 | 1 | 100.00% | 20.65% to 100.00% |
| stem | 41/47 | 41 | 87.23% | 74.83% to 94.02% |

## Frozen code/MBPP misses

| Pair | Final decision | Label | Machine decision | Execution status |
|---|---|---|---|---|
| rubric_eval_2 | A | B | fallback | council_owned_tie |
| rubric_eval_94 | B | A | fallback | b: executed; a: executed |
| rubric_eval_193 | B | A | fallback | a: executed; b: executed |
| rubric_eval_234 | tie | A | fallback | council_owned_tie |
| rubric_eval_596 | A | B | fallback | evaluated |
| rubric_eval_644 | tie | A | fallback | council_owned_tie |
| rubric_eval_656 | B | A | fallback | council_owned_tie |
| rubric_eval_746 | B | A | fallback | council_owned_tie |
| rubric_eval_790 | A | B | fallback | council_owned_tie |
| rubric_eval_803 | B | A | fallback | a: unsupported_candidate; b: unsupported_candidate |
| rubric_eval_1009 | B | A | fallback | no_machine_contract |
| rubric_eval_1051 | tie | A | fallback | council_owned_tie |
| rubric_eval_1086 | A | B | fallback | no_machine_contract |
| rubric_eval_1099 | B | A | fallback | a: unsupported_candidate; b: unsupported_candidate |

## Every code/MBPP pair

| Pair | Status | A observations | B observations |
|---|---|---:|---:|
| rubric_eval_2 | council_owned_tie | none | none |
| rubric_eval_4 | execution contract | executed: 15 pass, 4 fail, 0 unknown | no_executable_snippet: 0 pass, 0 fail, 0 unknown |
| rubric_eval_43 | council_owned_tie | none | none |
| rubric_eval_45 | no executable contract | none | none |
| rubric_eval_49 | execution contract | executed: 15 pass, 0 fail, 0 unknown | executed: 15 pass, 0 fail, 0 unknown |
| rubric_eval_52 | invalid_contract_or_reference | none | none |
| rubric_eval_94 | browser_emulator_api_gap | executed: 0 pass, 15 fail, 0 unknown | executed: 15 pass, 0 fail, 0 unknown |
| rubric_eval_105 | no executable contract | none | none |
| rubric_eval_153 | no executable contract | none | none |
| rubric_eval_165 | no executable contract | none | none |
| rubric_eval_178 | execution contract | executed: 18 pass, 0 fail, 0 unknown | executed: 18 pass, 0 fail, 0 unknown |
| rubric_eval_181 | council_owned_tie | none | none |
| rubric_eval_185 | no executable contract | none | none |
| rubric_eval_193 | execution contract | executed: 13 pass, 0 fail, 0 unknown | executed: 13 pass, 0 fail, 0 unknown |
| rubric_eval_199 | council_owned_tie | none | none |
| rubric_eval_214 | execution contract | executed: 0 pass, 21 fail, 0 unknown | executed: 0 pass, 21 fail, 0 unknown |
| rubric_eval_221 | execution contract | executed: 0 pass, 23 fail, 0 unknown | executed: 0 pass, 23 fail, 0 unknown |
| rubric_eval_234 | council_owned_tie | none | none |
| rubric_eval_258 | execution contract | executed: 24 pass, 0 fail, 0 unknown | unsupported_candidate: 0 pass, 0 fail, 0 unknown |
| rubric_eval_280 | execution contract | unsupported_candidate: 0 pass, 0 fail, 0 unknown | unsupported_candidate: 0 pass, 0 fail, 0 unknown |
| rubric_eval_310 | no executable contract | none | none |
| rubric_eval_315 | invalid_contract_or_reference | none | none |
| rubric_eval_327 | no executable contract | none | none |
| rubric_eval_329 | council_owned_tie | none | none |
| rubric_eval_354 | no executable contract | none | none |
| rubric_eval_375 | no executable contract | none | none |
| rubric_eval_387 | no executable contract | none | none |
| rubric_eval_415 | no executable contract | none | none |
| rubric_eval_424 | council_owned_tie | none | none |
| rubric_eval_433 | execution contract | unsupported_candidate: 0 pass, 0 fail, 0 unknown | unsupported_candidate: 0 pass, 0 fail, 0 unknown |
| rubric_eval_446 | no executable contract | none | none |
| rubric_eval_468 | no executable contract | none | none |
| rubric_eval_491 | no executable contract | none | none |
| rubric_eval_503 | execution contract | unsupported_candidate: 0 pass, 0 fail, 0 unknown | unsupported_candidate: 0 pass, 0 fail, 0 unknown |
| rubric_eval_506 | execution contract | executed: 24 pass, 0 fail, 0 unknown | executed: 24 pass, 0 fail, 0 unknown |
| rubric_eval_557 | no executable contract | none | none |
| rubric_eval_569 | execution contract | executed: 13 pass, 1 fail, 0 unknown | executed: 13 pass, 1 fail, 0 unknown |
| rubric_eval_596 | invalid_contract_or_reference | none | none |
| rubric_eval_629 | execution contract | executed: 0 pass, 1 fail, 0 unknown | unsupported_candidate: 0 pass, 0 fail, 0 unknown |
| rubric_eval_634 | execution contract | invalid_adapter: 0 pass, 0 fail, 0 unknown | invalid_adapter: 0 pass, 0 fail, 0 unknown |
| rubric_eval_637 | invalid_contract_or_reference | none | none |
| rubric_eval_643 | council_owned_tie | none | none |
| rubric_eval_644 | council_owned_tie | none | none |
| rubric_eval_645 | oracle_shape_underspecified | executed: 0 pass, 8 fail, 0 unknown | executed: 8 pass, 0 fail, 0 unknown |
| rubric_eval_656 | council_owned_tie | none | none |
| rubric_eval_694 | no executable contract | none | none |
| rubric_eval_703 | no executable contract | none | none |
| rubric_eval_711 | council_owned_tie | none | none |
| rubric_eval_720 | invalid_contract_or_reference | none | none |
| rubric_eval_730 | execution contract | unsupported_candidate: 0 pass, 0 fail, 0 unknown | unsupported_candidate: 0 pass, 0 fail, 0 unknown |
| rubric_eval_733 | no executable contract | none | none |
| rubric_eval_746 | council_owned_tie | none | none |
| rubric_eval_761 | execution contract | executed: 0 pass, 20 fail, 0 unknown | executed: 0 pass, 20 fail, 0 unknown |
| rubric_eval_790 | council_owned_tie | none | none |
| rubric_eval_801 | no executable contract | none | none |
| rubric_eval_802 | invalid_contract_or_reference | none | none |
| rubric_eval_803 | execution contract | unsupported_candidate: 0 pass, 0 fail, 0 unknown | unsupported_candidate: 0 pass, 0 fail, 0 unknown |
| rubric_eval_836 | invalid_contract_or_reference | none | none |
| rubric_eval_843 | invalid_contract_or_reference | none | none |
| rubric_eval_850 | no executable contract | none | none |
| rubric_eval_874 | no executable contract | none | none |
| rubric_eval_911 | council_owned_tie | none | none |
| rubric_eval_924 | no executable contract | none | none |
| rubric_eval_926 | no executable contract | none | none |
| rubric_eval_934 | execution contract | executed: 24 pass, 0 fail, 0 unknown | executed: 24 pass, 0 fail, 0 unknown |
| rubric_eval_936 | no executable contract | none | none |
| rubric_eval_938 | no executable contract | none | none |
| rubric_eval_941 | no executable contract | none | none |
| rubric_eval_974 | invalid_contract_or_reference | none | none |
| rubric_eval_991 | no executable contract | none | none |
| rubric_eval_1009 | no executable contract | none | none |
| rubric_eval_1011 | execution contract | executed: 0 pass, 18 fail, 0 unknown | executed: 0 pass, 18 fail, 0 unknown |
| rubric_eval_1012 | no executable contract | none | none |
| rubric_eval_1024 | invalid_contract_or_reference | none | none |
| rubric_eval_1048 | no executable contract | none | none |
| rubric_eval_1051 | council_owned_tie | none | none |
| rubric_eval_1072 | execution contract | executed: 17 pass, 0 fail, 0 unknown | executed: 17 pass, 0 fail, 0 unknown |
| rubric_eval_1082 | execution contract | no_executable_snippet: 0 pass, 0 fail, 0 unknown | no_executable_snippet: 0 pass, 0 fail, 0 unknown |
| rubric_eval_1084 | execution contract | no_executable_snippet: 0 pass, 0 fail, 0 unknown | unsupported_candidate: 0 pass, 0 fail, 0 unknown |
| rubric_eval_1086 | no executable contract | none | none |
| rubric_eval_1099 | execution contract | unsupported_candidate: 0 pass, 0 fail, 0 unknown | unsupported_candidate: 0 pass, 0 fail, 0 unknown |
| rubric_eval_1131 | execution contract | executed: 0 pass, 17 fail, 0 unknown | executed: 5 pass, 12 fail, 0 unknown |
| rubric_eval_1139 | execution contract | executed: 0 pass, 18 fail, 0 unknown | executed: 15 pass, 3 fail, 0 unknown |

## Reproduction and provenance

Frozen baseline commit: `76f4f6a6a3acaf105a9f1e0849becf9cf9a3efc5`. Research branch: `research/astra-rb-exec`, created from `origin/main` at `5a90bfb6`.
Decision SHA-256: `335e1798180866cf8b28a6734f8ca9fd0665a56bda596e35ba11f70ce8a4aaf1`.
Source, model recordings, input hashes, generated programs, source-binding audits, execution observations and per-pair scores live in `examples/judge-benchmarks/astra-rb/`.
The raw public dataset stays in ignored cache. No TEST item is sent to a model, and none of tonight's 434 sampled TEST pairs is reused.
Validation: eight deterministic unit tests pass, covering fail-final behavior, unknowns, asymmetric oracles, conflicts, both-side execution, structured equality and the exact paired test. TypeScript compilation passes.
Commit and remote verification are appended after the final artifact is written.
