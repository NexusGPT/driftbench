# default-on-v7 held-out verify confirmation: result

Preregistered in commit 023af6ab2 before the first call. 536 VerifyBench-Hard items (185 correct responses, 351 incorrect), Claude Haiku 5.5, Messages API, product 6f9cebbc8, run freeze 9fdf45b0. One execution; a host connection loss interrupted 4 items, which reran under the same freeze as the preregistration allows. The pool was used once before to confirm the benchmark-only verify-lead v5; no default-on tuning or diagnosis touched it.

v7: 421/536 correct (78.54%); verdicts 161 pass, 374 fail, 1 inconclusive.

| Comparator | Comparator correct | v7 only / comparator only | Exact p | Holm p | Holm family | Verdict |
|---|---:|---:|---:|---:|---|---|
| promptfoo | 412 | 36 / 27 | 0.314 | 0.314 | peers (5) | TIE |
| DeepEval | 323 | 114 / 16 | 2.07e-19 | 1.04e-18 | peers (5) | WIN |
| Inspect | 410 | 28 / 17 | 0.135 | 0.27 | peers (5) | TIE |
| Langfuse | 406 | 37 / 22 | 0.0674 | 0.202 | peers (5) | TIE |
| LangWatch | 403 | 38 / 20 | 0.0247 | 0.099 | peers (5) | TIE |
| shipped default (run live) | 288 | 143 / 10 | 2.7e-31 | 5.4e-31 | secondary (2) | WIN |
| verify-lead v5 (recorded) | 422 | 20 / 21 | 1 | 1 | secondary (2) | TIE |

Section 4.5 conditions, as preregistered for one benchmark: (1) zero LOSS: holds. (2) primary test against promptfoo in our favour at p < 0.05: does not hold (p 0.314). (3) at least 3 of 5 peers WIN: does not hold (1). (4) every MM-Eval and hard-row cell WIN: not applicable.

Recorded peer decisions are unverified historical (lane report). Run spend: USD 2.01 known plus 0.16 retained for the 4 interrupted calls.
