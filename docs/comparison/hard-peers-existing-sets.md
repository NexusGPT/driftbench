# Today's judge on the existing held-out sets

The README hard-case charts and the LangWatch page were measured with judge source pinned at older commits (promptfoo `c07c705cb`, Langfuse and LangWatch PR 115 `8195902dd`, DeepEval prompts rendered before the latest judge changes). This page scores the judge in `packages/judges/src` at this branch, with no pinned commit, on the same held-out items. Each request is wired as the earlier harness wired it; only the judge source is today's. The competitor answers are the ones recorded then, unchanged. No reported number here passes through `comparisons/promptfoo/hard/decoder-parity.mts` (pinned at `c07c705cb`): promptfoo answers are decoded by `comparisons/promptfoo/hard/run.py`, and driftbench answers by today's `parseJudgeText`.

Same model on every side: Claude Haiku 5.5 through `claude -p`, prompt caching disabled for the new calls. These items were not frozen for this test, so the paired p values are descriptive.

| Competitor | Row | Units | Earlier pinned judge | Competitor default | Today default | Today answer audit (opt-in) | Audit vs competitor: only audit / only competitor, exact McNemar p | Default vs competitor: only default / only competitor, p |
|---|---|---|---|---|---|---|---|---|
| promptfoo | rubric | 72 | 71 | 69 | 68 | 72 | 3 / 0, p 0.25 | 2 / 3, p 1 |
| promptfoo | factuality | 72 | 70 | 70 | 71 | 72 | 2 / 0, p 0.5 | 2 / 1, p 1 |
| promptfoo | pii | 72 | 72 | 71 | 72 | 71 | 1 / 1, p 1 | 1 / 0, p 1 |
| promptfoo | goal | 72 | 72 | 71 | 64 | 69 | 1 / 3, p 0.62 | 0 / 7, p 0.016 |
| Langfuse | correctness | 120 | 116 | 115 | 115 | 118 | 5 / 2, p 0.45 | 5 / 5, p 1 |
| DeepEval 4.2.8 | turn relevancy | 72 | 65 | 36 | 69 | 72 | 36 / 0, p 2.9e-11 | 33 / 0, p 2.3e-10 |
| DeepEval 4.2.8 | G-Eval strict | 72 | 65 | 70 | 69 | 72 | 2 / 0, p 0.5 | 2 / 3, p 1 |
| DeepEval 4.2.8 | DAG | 72 | 65 | 65 | 69 | 72 | 7 / 0, p 0.016 | 5 / 1, p 0.22 |
| DeepEval 4.2.8 | role adherence | 72 | 72 | 63 | 72 | 72 | 9 / 0, p 0.0039 | 9 / 0, p 0.0039 |
| DeepEval 4.2.8 | conversation completeness | 72 | 70 | 46 | 72 | 72 | 26 / 0, p 3.0e-08 | 26 / 0, p 3.0e-08 |
| DeepEval 4.2.8 | task completion | 72 | 72 | 44 | 72 | 72 | 28 / 0, p 7.5e-09 | 28 / 0, p 7.5e-09 |
| DeepEval 4.2.8 | hallucination | 72 | 71 | 36 | 72 | 72 | 36 / 0, p 2.9e-11 | 36 / 0, p 2.9e-11 |
| DeepEval 4.2.8 | faithfulness | 72 | 71 | 36 | 72 | 72 | 36 / 0, p 2.9e-11 | 36 / 0, p 2.9e-11 |
| DeepEval 4.2.8 | knowledge retention | 72 | 68 | 69 | 72 | 72 | 3 / 0, p 0.25 | 3 / 0, p 0.25 |
| DeepEval 4.2.8 | task completion (tool receipts, the README bar) | 72 | 72 | 72 | 72 | 72 | 0 / 0, p 1 | 0 / 0, p 1 |
| LangWatch | criterion labels, short cohort | 240 | 238 | 240 | 240 | 227 | 0 / 13, p 2.4e-04 | 0 / 0, p 1 |
| LangWatch | criterion labels, long cohort | 240 | 205 | 230 | 233 | 186 | 2 / 46, p 8.4e-12 | 5 / 2, p 0.45 |

## Notes

- Today's default is below the earlier pinned judge on promptfoo goal success (64 against 72, 4 inconclusive) and LLM rubric (68 against 71, 4 inconclusive). The answer audit recovers the rubric row (72) and part of goal success (69).
- Langfuse: the competitor is read at its better threshold, 0.5 (115); at the pre-registered 1.0 it scores 83.
- DeepEval task completion has two recordings. The README bar (72 against 72) is the tool-receipt run (`baseline-task-receipts-heldout.json`, the row marked "tool receipts, the README bar"). The conversation-evidence run (`baseline-heldout.json`) has DeepEval at 44 of 72. Both are shown.
- DeepEval G-Eval strict and DAG share the relevancy items; hallucination and faithfulness share the grounding items. Our judge is asked once per item, so it has one count per set.
- LangWatch: one unit per declared criterion, 120 cases with two criteria each per cohort. Labels are pass, fail or inconclusive. "Earlier pinned judge" is the PR 115 default at `8195902dd`, the driftbench row the LangWatch page reports; the competitor is LangWatch's native Scenario judge as recorded then. The earlier harness decoded our default with the old binary `parseAnswerText`; today's rerun uses the shipped `parseJudgeText`.
- On the LangWatch cohorts the answer audit is well below the default (227 and 186 of 240): it marks "inconclusive" criteria as failed (13 short, 27 long) and fails or withholds 27 long-cohort passes. The answer audit has no way to return "the deciding evidence is absent" except an unknown check, and these criteria ask for that verdict.
- Cost of the rerun: 1.91 USD for 2,652 answered calls (both driftbench modes).

Reproduce: `pnpm exec tsx comparisons/hard-peers/run.mts <competitor> <row>:default,<row>:audit --old --replay`, then `python3 comparisons/hard-peers/score_old.py`.
