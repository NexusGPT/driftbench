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

---

# Pairwise rounds 7 to 10 and the sealed confirmation (2026-10-13)

Practice numbers below use the enlarged sets and split `moj-split-v2` (pooled tuning / validation half, calls per pair).
Noise floors: JudgeBench 1.7, MM-Eval 1.8 (measured here: two fresh promptfoo repeats on 30 pairs, flip share 0.10),
writing 6.7 points.

## Practice: rounds, one change each

| Round | Change (against r6 unless said) | Pooled tune / valid | S1, S2 calls | JudgeBench | MM-Eval | Writing | Kept |
|---|---|---|---|---|---|---|---|
| r6-ref-first | reference first on reasoning terrain, hold on writing, System-2 verdict under 0.8 | 82.5 / 84.9 | 4.2, 0.93 | 90.3 / 93.1 | 95.5 / 95.8 | 65.3 / 64.2 | secondary |
| r7a-panel | Gemini flash-lite verdict in the low-level mix | 82.1 / 84.6 | 4.2, 1.20 | 89.6 / 93.1 | 94.9 / 95.1 | 65.3 / 64.2 | no |
| r7b-ref-rc | reference-consistency rule in the reference check | 82.3 / 84.3 | 4.2, 0.93 | 90.3 / 92.2 | 94.9 / 95.8 | 65.3 / 63.4 | no |
| r7c-chk-writing | checklist joined on writing terrain | 81.8 / 85.1 | 5.0, 1.30 | 90.3 / 93.1 | 95.5 / 95.5 | 63.3 / 65.4 | no |
| r7e-chk-low | checklist at the low level | 82.5 / 84.1 | 4.5, 1.08 | 90.3 / 91.4 | 95.5 / 95.1 | 65.3 / 64.2 | no |
| r7d-guarantee | boundary 0.6, picked by the lower-bound rule on the tuning half | 82.8 / 83.8 | 4.2, 0.71 | 90.3 / 92.2 | 95.5 / 94.4 | 65.8 / 63.4 | cheaper point, within 2 points as the rule promises |
| v2a-terminal | reference terminal at margin 0.3 | 82.2 / 84.6 | 4.2, 0.91 | 89.6 / 92.7 | 95.2 / 95.5 | 65.3 / 64.2 | no |
| v2s-safety | safety-facts expert on safety terrain | 82.8 / 84.9 | 4.4, 0.93 | 90.3 / 93.1 | 96.2 / 95.8 | 65.3 / 64.2 | no (0 on validation) |
| v2c-lenfull | completeness question as stage 1 on writing terrain | 82.4 / 86.3 | 4.2, 0.93 | 90.3 / 93.1 | 94.9 / 96.2 | 65.5 / 68.3 | no (+4.1 validation under the 6.7 floor, +0.2 tuning) |
| v2e-refpair | pairwise-with-reference decision at the low level | 81.9 / 84.3 | 4.4, 1.00 | 89.6 / 91.4 | 94.2 / 95.8 | 65.3 / 64.2 | no |
| r8-strong-ref | high-effort reference + second-family reference + agreement rule, fallback to refpair and System 2 | 82.1 / 84.3 | 5.3, 2.31 | 90.3 / 91.4 | 94.2 / 95.8 | 65.3 / 64.2 | refuted: JudgeBench validation under the 94.0 bar |
| r8b-ref-hi | high-effort reference alone | 82.3 / 84.3 | 4.0, 0.84 | 90.3 / 90.5 | 94.9 / 96.5 | 65.3 / 64.2 | no |
| **r9-two-step** | **two System-1 steps: answer or abstain (commit 0.8), then the router for abstained pairs only** | **82.3 / 84.3** | **3.1, 0.42** | **90.3 / 92.2** | **94.9 / 95.1** | **65.3 / 64.2** | **frozen primary** |
| r9b-two-step-max | same at commit 0.95 | 82.5 / 84.6 | 4.0, 0.80 | 90.3 / 92.2 | 95.5 / 95.8 | 65.3 / 64.2 | no (more System 2, same score) |
| r10a-writing-length | r9 + computed length feature on writing terrain, weights fitted on that terrain | 82.0 / 85.8 | 3.1, 0.42 | 90.3 / 92.2 | 94.9 / 95.5 | 64.4 / 68.3 | no (tuning falls, validation under the bar) |
| r10b-writing-creative | r9 + length + six creative-rubric System-1 rows | 81.2 / 86.6 | 3.4, 0.42 | same | same | 62.1 / 70.7 | no |
| r10c-writing-all | r9 + length, structure, specificity, creative rubric, completeness | 79.2 / 86.8 | 3.9, 0.42 | same | same | 57.1 / 71.5 | no |

Round 8 detail. On reasoning terrain the high-effort reference scores 81.0 / 86.9 on JudgeBench against 83.6 / 88.7 for
the medium one; the Gemini flash-lite reference 65.3 / 70.7. The three references agree on 41 of 134 and 38 of 111
reasoning pairs only. Where they agree the reference check is 86.6 / 92.1.

Round 9 detail (r9 on all practice pairs). Step 1 commits 36 percent of JudgeBench pairs at 96 percent right, 67 percent
of MM-Eval at 99, 39 percent of writing at 72. Abstained pairs: reference first 135 JudgeBench pairs at 90 (25 more go
on to System 2, at 80); on MM-Eval 51 at 92; writing terrain stays with System 1 (162 writing pairs at 60).
Thresholds were fitted on the tuning half: the cheapest setting within 0.5 point of the best cross-fitted accuracy.

## Writing: why the length rule is the ceiling here

- Longer wins scores 68.7 on practice (67.8 tuning, 69.9 validation). The dataset paper says pairs are length-matched;
  in our practice pairs 126 of 300 have a length ratio of 1.7 or more, and the longer reply holds the label on 76 to 84
  percent of those.
- On the 94 pairs where the shorter reply holds the label, every System-1 design is under chance: pairwise 38,
  completeness 34, creative rubric rows 32 to 49, checklist 44. The System-2 verdict is at 52. No signal we have
  finds the "shorter is better" cases, so no combination can add them to the length rule's hits.
- Best cross-validated combination on the tuning half: System-1 pairwise plus length, 68.9 (length alone 67.8);
  with more features the cross-validated score falls (59.3 to 65.5) while validation rises (71.5 to 75.6): variance,
  not signal. Nothing clears 68.7 plus the 6.7 floor.
- The paper reports 53.9 percent for zero-shot model judges, no gain from reasoning models, and accepts a pair on 2 of 3
  annotators; it gives no agreement statistic to bound the label noise.
- Stated plainly: on this label MoJ beats promptfoo (+10.0 practice) and the ledger, and does not beat counting
  characters. The set measures a length-correlated preference more than judging.

## JudgeBench against the ledger's 95.6

The 95.6 is on the 68 core pairs the ledger harness recorded; r9 scores 92.6 on those pairs and promptfoo 95.0 on the
50 it recorded. Four rounds aimed at the gap (high-effort System 2, panel member, stronger reference, reference
fallback): none gained on both halves. 12 of the 21 r6 errors have a wrong System-2 reference, and the high-effort
reference is not more often right. No route found on gpt-6-luna.

## Residual on practice

| Config | Cells not ahead of the best baseline beyond the floor (of 3) | Cells costlier than an unbeaten cheaper baseline |
|---|---|---|
| r6-ref-first | 2 (JudgeBench against the ledger on 68 pairs; writing against longer wins) | 1 (writing: longer wins costs nothing) |
| r9-two-step | 2 (same two; MM-Eval +2.2 [-0.2, +4.5] against promptfoo, floor 1.8) | 1 |

## Sealed confirmation (run once)

Sequence, stated plainly. The sealed ids were drawn and digested before any call. The System-1, reference and
promptfoo signals on the sealed pairs were collected under the first freeze (r6, commit 60da2848) and were not
scored. Rounds 8 to 10 then ran on practice data only. The primary was frozen as `r9-two-step` (commit 9be7b751,
`sealed/freeze.json`) before any sealed score existed; r9 uses the same experts and the same weights, fitted on all
850 practice pairs. `moj/policy.py` and `moj/experts.py` gained round-10 code after the freeze; a replay with the frozen
files gives identical r9 and r6 decisions on all 850 practice pairs (0 differences). r6 is reported as a secondary,
outside the Holm family. Sealed pairs: JudgeBench 100, MM-Eval 294 (6 of 300 ids dropped for sharing a prompt with
practice), writing 300. Four pairs got no System-1 answer (gateway 403): they count as losses for MoJ.
All contestants: gpt-6-luna, medium effort. Our judge: the pair ledger of PR 168 with each harness's own settings
(MM-Eval with the harm pre-call and the compute check).

| Benchmark | MoJ r9 [95%] | promptfoo [95%] | Our ledger [95%] | Longer wins | r6 (secondary) |
|---|---|---|---|---|---|
| JudgeBench, strict both-order rule (100) | 85.0 [77, 91] | 84.0 [76, 90] | 85.0 [77, 91] | 43.0 | 90.0 |
| JudgeBench, half credit | 85.0 | 88.5 | 88.0 | | 90.0 |
| MM-Eval (294) | 94.9 [92, 97] | 94.7 [92, 97] | 93.4 [90, 96] | 42.0 | 96.6 |
| Writing (300) | 65.2 [60, 70] | 57.0 [51, 62] | 61.7 [56, 67] | **69.7** [64, 75] | 64.5 |

| Per 100 pairs | MoJ r9: S1 calls, S2 calls, S2 USD | promptfoo: S2 calls, USD | Ledger: S2 calls, USD | r6: S1, S2 calls |
|---|---|---|---|---|
| JudgeBench | 347, 57, 0.018 | 200, 0.065 | 213, 0.180 | 500, 146 |
| MM-Eval | 246, 21, 0.003 | 200, 0.025 | 246, 0.083 | 449, 91 |
| Writing | 261, 10, 0.003 | 200, 0.075 | 227, 0.157 | 340, 34 |

| Comparison (paired, by prompt group, Holm over 6) | Difference | 95% interval | Holm p | Verdict |
|---|---|---|---|---|
| JudgeBench, MoJ minus promptfoo (strict) | +1.0 | [-7.0, +9.0] | 1.00 | tie |
| JudgeBench, MoJ minus ledger (strict) | 0.0 | [-7.0, +7.0] | 1.00 | tie |
| MM-Eval, MoJ minus promptfoo | +0.2 | [-2.0, +2.2] | 1.00 | tie |
| MM-Eval, MoJ minus ledger | +1.5 | [-1.2, +4.3] | 1.00 | tie |
| Writing, MoJ minus promptfoo | +8.2 | [+2.3, +13.9] | 0.047 | win |
| Writing, MoJ minus ledger | +3.5 | [-2.6, +9.4] | 1.00 | tie |

Reading by the pre-registered rule. MoJ ties promptfoo and the ledger on JudgeBench and MM-Eval at 11 to 29 percent of
promptfoo's System-2 calls and 12 to 28 percent of its System-2 cost. On writing it wins against promptfoo and ties
the ledger, but stays under longer wins (65.2 against 69.7): the report does not count that cell as a judging win.
MoJ is not shown better in accuracy on any objective cell; it is shown equal within the intervals, at a fraction of the
System-2 spend. Jev calls: 2.5 to 3.5 per pair, price unknown. Latency per pair (sum of call times): 8.1 s, 3.1 s, 3.4 s.
Step 1 committed 51 percent of JudgeBench pairs (86 percent right), 82 percent of MM-Eval (98), 44 percent of writing (81).
On JudgeBench the sealed set shows a 5-point gap between r9 and r6 (85.0 against 90.0, 100 pairs); practice showed 0.4.
The sealed set is used once: a later configuration needs a fresh draw.
