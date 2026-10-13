# JudgeBench: architecture-level ideas, one prototype, dev results (opus-jb lane)

Snapshot 2026-10-13 04:55 Brussels. Branch research/opus-jb, worktree .worktrees/opus-jb, code in research/opus-jb/.
Model: Claude Haiku through `claude -p`, same as every contestant. DEV split only (121 pairs). Test never read or run.

## Verdict

- Best prototype: evidence-gated two-option arbitration on top of frozen reference3.
- Full dev: **112/121 official (92.6)** and **109/111 audited (98.2)**, against reference3 111/121 and 108/111.
- One fix (3c6f3a85), zero breaks, stable across two independent samples. Gain is +1, below the +3 bar. **No test proposal.**
- Cost: 0.9239 USD per 100 pairs with retrieval (reference3 0.7720 plus 0.1519); 0.8456 USD per 100 pairs for the retrieval-free duel.
- The retrieval was NOT the cause of the fix: the no-retrieval control fixes the same item. Retrieval adds precision (a validated quote) but no new correct verdicts on dev.
- Main finding: dev has almost no honest headroom left. Of reference3's 10 official misses, 7 are audit-excluded (same final answer, malformed option, defensible alternative). Only 3 are retained misses. A +3 official win on dev therefore needs to fix every retained miss or win label-ambiguous items, which is noise. 95 percent on JudgeBench needs test-scale gains on the knowledge slice, which dev cannot measure at this size.

## 1. Dev miss classes (reference3, read from codex-jb recordings, read only)

| Item | Group | Class | Note |
|---|---|---|---|
| c20860f9 | mmlu | knowledge, judge's own solve wrong (psychology) | label J; Haiku solves C, then F |
| dcfbadd5 | mmlu | knowledge, judge's own solve wrong (philosophy, Nussbaum) | label J (Aristotelian); Haiku says H |
| 3c6f3a85 | mmlu | knowledge, judge's own solve wrong (economics, asset demand for money) | label D; Haiku solves B |
| 8b33bb85 | mmlu | audit-excluded: both finals wrong-or-defensible, one breaks the five-letter format | format class |
| 0a347026, 9536d58f, cc8d0d03 | mmlu | audit-excluded: defensible alternatives | label noise class |
| c67cf264 | mmlu | audit-excluded: option names the wrong person | malformed input |
| 82a6f9e6, a243b087 | livebench | audit-excluded: identical final answers | tie class, unwinnable honestly |

All 3 retained misses are one class: **closed-book knowledge error where every Haiku solve agrees with itself**. More solves, votes, backward checks and code (tonight's cascades) cannot fix it, because the error is correlated across all samples. Only new information or a different question framing can.

## 2. Ranked ideas (web research, 2025 to 2026)

| Rank | Idea | Tried tonight before? | Why it fits | Sources |
|---|---|---|---|---|
| 1 | Evidence-grounded arbitration: retrieve encyclopedia text for the contested claim, decide with a code-validated quote, override only under a strict gate | No | Only lever that adds knowledge the judge lacks; OpenRM and SAFE show tool evidence helps knowledge-intensive judging | [OpenRM / OpenReward, arXiv 2510.24636](https://arxiv.org/abs/2510.24636v1); [SAFE, arXiv 2403.18802](https://arxiv.org/pdf/2403.18802); [REPLUG Wikipedia retrieval on MMLU, arXiv 2301.12652](https://arxiv.org/pdf/2301.12652); [Agent-as-a-Judge, arXiv 2601.05111](https://arxiv.org/pdf/2601.05111) |
| 2 | Contested-option duel: shrink a 10-option MCQ to the two options the replies chose, judge in both option orders, override on agreement | No | Removes distractor load; JudgeBench knowledge items come from MMLU-Pro whose LLM-made distractors create defensible traps | [JudgeBench, arXiv 2410.12784](https://arxiv.org/pdf/2410.12784); [MMLU-Pro, arXiv 2406.01574](https://arxiv.org/pdf/2406.01574); [IRT audit of benchmark items, arXiv 2605.30504](https://arxiv.org/pdf/2605.30504) |
| 3 | Agentic search judge (search inside reasoning, multi-hop) | No | Stronger than one-shot retrieval on knowledge tasks, but leakage risk: open web search can find the MMLU-Pro answer key | [Search-o1, arXiv 2501.05366](https://arxiv.org/pdf/2501.05366); [WebThinker, arXiv 2504.21776](https://arxiv.org/html/2504.21776v2) |
| 4 | Tool-integrated judge with code for math and coding | Yes (cascades) | Already measured: did not beat reference3 | [TIR-Judge, arXiv 2510.23038](https://arxiv.org/abs/2510.23038v1) |
| 5 | Confidence-gated escalation | Yes (cascades) | Already measured: +1 at best | [Trust or Escalate, arXiv 2407.18370](https://arxiv.org/pdf/2407.18370) |
| 6 | Debate between two Haiku advocates | No | Same-family debate shows little gain; low priority | [Khan et al., arXiv 2402.06782](https://arxiv.org/pdf/2402.06782); [weak-judge debate null result write-up](https://www.greaterwrong.com/posts/kQCLPighFvb4ChHtu/inference-time-generative-debates-on-coding-and-reasoning) |

Context: no public JudgeBench result near 95 was found; [BenchLM's JudgeBench table](https://benchlm.ai/benchmarks/judgebench) lists o3-mini high at 80.9 on the paper split. ChatEval multi-agent judging is reported at 34.0 ([liner review of JudgeBench](https://liner.com/review/judgebench-a-benchmark-for-evaluating-llmbased-judges)).

## 3. Prototype design (idea 1 with idea 2 as its control)

Route (label blind): the question has lettered options and the two replies' final five-letter strings name different letters. Dev: 57 of 121 pairs. Everything else keeps reference3 unchanged.

1. Query call (Haiku, no tools): the stem plus the two contested options; returns 3 short Wikipedia queries naming the concept to look up. No option letters.
2. Retrieval (code, free): Wikipedia search API, top 3 titles per query, plain-text extracts of up to 9 pages, paragraphs ranked by word overlap with stem and the two options, about 9,000 characters, about 13 passages per item. Throttled to one request per 1.5 s, cached on disk.
3. Verdict calls (Haiku, no tools), one per option order: passages plus full question; decide between the two contested options; JSON with `evidence_quote`, `winner`, `confidence`.
4. Code checks the quote is a verbatim substring of the retrieved text.
5. Gate G1, pre-registered before the full run: both orders name the same winner, at least one validated quote, both confidences at least 70. Then the evidence winner replaces reference3's two games; otherwise reference3 stands.
6. Control: identical verdict prompt with no passages (`NO_EVIDENCE=1`), the pure two-option duel. A second fresh sample (`SAMPLE=2`) measures stability.

Why it is honest: no label, group, length, position or item id enters a prompt or gate. Wikipedia does not host MMLU-Pro answer keys; open web search was rejected for that leakage risk.

## 4. Full-dev results

| Variant | Official | Audited (111 retained) | Overrides | Fixes | Breaks | USD per 100 pairs |
|---|---|---|---|---|---|---|
| reference3 (frozen baseline) | 111/121 (91.7) | 108/111 (97.3) | 0 | | | 0.7720 |
| **reference3 + evidence, gate G1 (pre-registered)** | **112/121 (92.6)** | **109/111 (98.2)** | 19 | 3c6f3a85 | none | 0.9239 |
| reference3 + evidence, gate G0 (no quote needed) | 111/121 (91.7) | 108/111 (97.3) | 32 | 3c6f3a85 | 81ec57f2 | 0.9239 |
| reference3 + evidence, any order agreement | 110/121 (90.9) | 107/111 (96.4) | 51 | 3c6f3a85 | 81ec57f2, 2daba22f | 0.9239 |
| reference3 + duel, no retrieval, G0, sample 1 | 112/121 (92.6) | 109/111 (98.2) | 32 | 3c6f3a85 | none | 0.8456 |
| reference3 + duel, no retrieval, any agreement, sample 1 | 113/121 (93.4) | 110/111 (99.1) | 48 | c20860f9, 3c6f3a85 | none | 0.8456 |
| reference3 + duel, no retrieval, G0, sample 2 | 112/121 (92.6) | 109/111 (98.2) | 31 | 3c6f3a85 | none | 0.8424 |
| reference3 + duel, no retrieval, any agreement, sample 2 | 112/121 (92.6) | 108/111 (97.3) | 50 | c67cf264, 3c6f3a85 | 5e29323a | 0.8424 |
| reference3 + duel, 4 of 4 agreement across both samples | 112/121 (92.6) | 109/111 (98.2) | 43 | 3c6f3a85 | none | 0.9160 |

Reading the table:
- The only stable gain is 3c6f3a85, fixed by every variant, with or without retrieval.
- The 113/121 row is sampling noise: its second fix (c20860f9) does not reproduce in sample 2. It was not a pre-registered gate.
- On the 57 routed pairs, reference3 is right on 49. The evidence verdict alone is right on 43 (6 split), the duel alone on 43 and 45. Neither is better than reference3 as a standalone judge; both are useful only as a high-precision override.
- The validated quote is what keeps G1 clean: G0 overrides 81ec57f2 (Shannon capacity) wrongly from passages that did not support it; G1 refuses it.
- G1 precision on dev: 19 overrides, 19 correct. Measured on dev only; the gate was set before the run, but 19 is a small sample.

## 5. Spend (all logged in spend-ledger.md)

| Run | Calls | Measured USD |
|---|---|---|
| Pilot, 4 pairs | 12 | 0.0110 |
| Evidence, full dev (pilot replayed) | 159 | 0.1718 |
| Duel control, sample 1 | 114 | 0.0890 |
| Duel control, sample 2 | 114 | 0.0852 |
| Total | 399 | 0.3570 of the 3 USD cap |

## 6. What to do next (proposal, not a test run)

- Not eligible for a fresh-test confirmation: +1 is below the +3 bar.
- If the lead still wants knowledge-slice gains, the measurement must move: dev holds only 3 retained knowledge misses, so any variant is decided by 1 item. A fresh, never-seen knowledge sample (other JudgeBench response splits, for example the Claude split, which is not our 350-pair GPT-4o file) would give a real denominator without touching our test split.
- Cheapest keepable piece: the G1 gate as a cascade rung for contested multiple-choice pairs. Cost +0.15 USD per 100 pairs, 0 dev breaks.
- Do not pursue: open web search (answer-key leakage), "any agreement" gates (noise), the evidence verdict as a standalone judge (worse than reference3).
- The 95 target equals the honest dev ceiling, so it leaves no margin. Dev ceiling for an honest judge is about 115/121 (95.0) official: the 3 retained misses plus the format item 8b33bb85 on top of reference3.

## 7. Files

- research/opus-jb/evidence_judge.py: router, retrieval, prompts, recordings (replay with `REPLAY_ONLY=1`).
- research/opus-jb/score_evidence.py: official, audited, fixes, breaks, cost per 100.
- research/opus-jb/results/*.jsonl and *.log: per-item outputs for every run above.
- research/opus-jb/recordings/haiku-evidence.jsonl: every model call with its price. The Wikipedia cache is not committed (12 MB; refetchable).
