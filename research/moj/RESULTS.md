# MoJ pilot results (practice splits only, split moj-split-v2)

Mixture of Judges (MoJ): a System-1 first pass on every item, then a full judge mixing System-1 and System-2
models on the items the first pass leaves unsure. System 1 = Jev (`jev-1.13.0`, gateway route). System 2 =
`gpt-6-luna`, medium effort, no temperature. Every number below replays from `recordings/` at zero cost
(`python3 -m moj.score configs/<variant>.json`). No sealed test item was read.

## Best arm: `r6-ref-first`

Stage 1: System-1 pairwise in both orders (2 calls). Router: one System-1 call reads the terrain. On reasoning
terrain the reference check joins (System 2 solves once without the candidates, System 1 compares each reply
with the reference). On subjective-writing terrain the item stays with System 1. Elsewhere, a combined
confidence under 0.8 adds the System-2 single verdict. Weights: no-intercept logistic, cross-fitted on the
tuning half, pooled over benchmarks (no benchmark label).

| Benchmark (pairs) | MoJ r6 [95%] | S1 / S2 calls per pair | Our ledger (recorded) | promptfoo select-best (gpt-6-luna) | Longer wins | System 1 alone |
|---|---|---|---|---|---|---|
| JudgeBench (250) | **91.6** [88, 94] | 5.0 / 1.49 | 95.6 [88, 98] on 68; MoJ there 94.1 | 90.4 [86, 93] at 2.00 S2 | 47.2 | 77.2 |
| MM-Eval (300) | **95.7** [93, 97] | 4.3 / 0.95 | 55.0 [34, 74] on 20; MoJ there 82.5 | 92.8 [89, 95] at 2.00 S2 | 37.0 | 91.7 |
| Writing (300) | **64.8** [59, 70] | 3.5 / 0.43 | 57.0 [43, 70] on 50; MoJ there 64.0 | 54.8 [49, 60] at 2.00 S2 | **68.7** | 64.9 |

- Paired difference against promptfoo (same pairs): JudgeBench +1.2 [-1.6, +4.0], MM-Eval +2.8 [+0.5, +5.2],
  writing +10.0 [+4.3, +16.0] points. Against the length rule on writing: -3.8 [-10.0, +2.2].
- Cost per 100 pairs, System 2 only: JudgeBench 0.040 USD, MM-Eval 0.013, writing 0.009 (promptfoo on the
  same pairs: 0.053, 0.026, 0.068 by reader 3's measure). Jev has no published price: 3.5 to 5.0 calls per pair,
  median 0.32 to 0.42 s per call. Price unknown.
- Latency per pair (sum of call times, no parallelism): 11.4 s, 4.8 s, 3.8 s.
- Validation half only: JudgeBench 93.1, MM-Eval 95.8, writing 64.2.

## Arms compared (pooled practice, tuning / validation half)

| Arm | Gate | Pooled tune / valid | S1, S2 calls per pair | JB / MM / WP (all pairs) |
|---|---|---|---|---|
| r0-s1p-only | none: System 1 alone | 78.1 / 77.8 | 2.0, 0 | 77.2 / 91.7 / 64.8 |
| lit-jev-cascade | margin, raw probability, 0.9, System 2 replaces (arXiv 2609.26550 rule) | 78.4 / 79.6 | 2.0, 1.60 | 90.4 / 92.8 / 55.4 |
| r1-margin | margin only, fitted combination at 0.8 | 80.3 / 81.9 | 2.0, 1.04 | 90.8 / 93.8 / 60.0 |
| r2-hold-writing | + writing terrain stays with System 1 | 82.1 / 83.8 | 2.0, 0.61 | 90.8 / 94.3 / 64.8 |
| r3-ref | reference check at the middle level | 82.5 / 83.0 | 3.6, 0.34 | 89.6 / 95.0 / 64.8 |
| r5-ref-panel | ref + System-2 verdict both at the low level | 82.5 / 84.3 | 3.1, 1.67 | 91.6 / 95.0 / 64.8 |
| **r6-ref-first** | **ref joins stage 1 on reasoning terrain** | **82.5 / 84.9** | **4.2, 0.93** | **91.6 / 95.7 / 64.8** |
| r6 at hi 0.7 (cheapest point) | same, boundary 0.7 | 82.8 / 84.3 | 4.2, 0.80 | 91.6 / 95.3 / 64.8 |
| r6 at hi 0.9 (most System 2) | same, boundary 0.9 | 82.5 / 84.9 | 4.2, 1.22 | 91.6 / 95.7 / 64.8 |
| r7-rows | + System-1 pointwise rows in stage 1 | 82.4 / 83.8 | 6.2, 0.97 | worse on writing |
| r8-high-effort | high-effort System 2 on the low level | 83.2 / 84.3 | 4.2, 1.07 | 92.0 / 95.7 / 64.8 |
| r9-reasoning-mix | reasoning terrain always to the mixed judge | 82.5 / 84.9 | 4.2, 1.73 | same as r6, 1.9 times its System 2 |
| v0-ledger-10/20/30 | escalate least confident share to the recorded ledger | ledger recordings cover 138 of 850 pairs: not scorable at scale |

## Confidence levels, calibration, routing (r6)

| Benchmark | High: share at accuracy | Held (writing terrain) | Low: share at accuracy | ECE | Route right when some expert is right | Rough ground (all designs wrong) |
|---|---|---|---|---|---|---|
| JudgeBench | 76 % at 95 | 0 | 24 % at 82 | 0.050 | 94 % | 6, recovered 0 |
| MM-Eval | 78 % at 98 | 7 % at 72 | 15 % at 92 | 0.079 | 96 % | 3, recovered 0 |
| Writing | 35 % at 73 | 56 % at 62 | 9 % at 48 | 0.087 | 75 % | 42, recovered 0 |

Writing calibration curve (confidence bin: n, mean confidence, accuracy): 0.5-0.6: 58, 0.55, 0.57 ·
0.6-0.7: 63, 0.65, 0.64 · 0.7-0.8: 66, 0.75, 0.61 · 0.8-0.9: 99, 0.85, 0.73 · 0.9-1.0: 11, 0.91, 0.73.

## Ablation (r6, points of accuracy the component earns, tune / valid)

| Component | Earns | System-2 calls it costs per pair |
|---|---|---|
| reference check on reasoning terrain | +0.4 / +1.0 | 0.31 |
| System-2 verdict at the low level | -0.2 / +2.1 | 0.31 |
| writing hold (r1 to r2) | +1.8 / +1.9 | saves 0.43 |
| System-1 pointwise rows (r6 to r7) | -0.1 / -1.1 | 0: cut |
| counterfactual, adversarial, debate, System-2 rows as single experts | below System-1 pairwise or System-2 verdict on every terrain (terrain table): not routed | |

## The two numbers driven to zero (noise floor from recorded repeats: JudgeBench 1.7, MM-Eval and writing 6.7 points)

| Arm | R1 cells not ahead of the best baseline by more than the floor | R2 cells costlier than an unbeaten cheaper baseline |
|---|---|---|
| r0-s1p-only | 3 of 3 | 0 |
| r1-margin | 3 | 1 |
| r6-ref-first | 3 | 1 (writing: the length rule costs nothing) |
| r8-high-effort | 2 | 1 |

R1 has not moved below 2. Two rounds without gain on writing: the step back for that cell is in the design file.
