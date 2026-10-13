# Today's judge on the existing held-out sets

The README hard-case charts were measured with judge source pinned at older commits (promptfoo `c07c705cb`, Langfuse `8195902dd`, DeepEval prompts rendered before the latest judge changes). This page scores the judge in `packages/judges/src` at this branch, with no pinned commit, on the same held-out items. Each request is wired as the earlier harness wired it; only the judge source is today's. The competitor answers are the ones recorded then, unchanged.

Same model on every side: Claude Haiku 5.5 through `claude -p`, prompt caching disabled for the new calls. These items were not frozen for this test, so the paired p values are descriptive.

| Competitor | Row | Cases | Earlier pinned judge | Competitor default | Today default | Today answer audit (opt-in) | Audit vs competitor: only audit right / only competitor right, exact McNemar p |
|---|---|---|---|---|---|---|---|
| promptfoo | rubric | 72 | 71 | 69 | 68 | 72 | 3 / 0, p 0.25 |
| promptfoo | factuality | 72 | 70 | 70 | 71 | 72 | 2 / 0, p 0.5 |
| promptfoo | pii | 72 | 72 | 71 | 72 | 71 | 1 / 1, p 1 |
| promptfoo | goal | 72 | 72 | 71 | 64 | 69 | 1 / 3, p 0.62 |
| Langfuse | correctness | 120 | 116 | 115 | 115 | 118 | 5 / 2, p 0.45 |
| DeepEval 4.2.8 | turn relevancy | 72 | 65 | 36 | 69 | 72 | 36 / 0, p 2.9e-11 |
| DeepEval 4.2.8 | G-Eval strict | 72 | 65 | 70 | 69 | 72 | 2 / 0, p 0.5 |
| DeepEval 4.2.8 | DAG | 72 | 65 | 65 | 69 | 72 | 7 / 0, p 0.016 |
| DeepEval 4.2.8 | role adherence | 72 | 72 | 63 | 72 | 72 | 9 / 0, p 0.0039 |
| DeepEval 4.2.8 | conversation completeness | 72 | 70 | 46 | 72 | 72 | 26 / 0, p 3e-08 |
| DeepEval 4.2.8 | task completion | 72 | 72 | 44 | 72 | 72 | 28 / 0, p 7.5e-09 |
| DeepEval 4.2.8 | hallucination | 72 | 71 | 36 | 72 | 72 | 36 / 0, p 2.9e-11 |
| DeepEval 4.2.8 | faithfulness | 72 | 71 | 36 | 72 | 72 | 36 / 0, p 2.9e-11 |
| DeepEval 4.2.8 | knowledge retention | 72 | 68 | 69 | 72 | 72 | 3 / 0, p 0.25 |

## Notes

- Today's default is below the earlier pinned judge on promptfoo goal success (64 against 72, 4 inconclusive) and LLM rubric (68 against 71, 4 inconclusive). The answer audit recovers the rubric row (72) and part of goal success (69).
- Langfuse: the competitor is read at its better threshold, 0.5 (115); at the pre-registered 1.0 it scores 83.
- DeepEval task completion: this page pairs with the conversation-evidence recording (`baseline-heldout.json`), where the default metric scores 44 of 72. The README bar (72 against 72) comes from the tool-receipt variant (`baseline-task-receipts-heldout.json`), where both sides score 72.
- DeepEval G-Eval strict and DAG share the relevancy items; hallucination and faithfulness share the grounding items. Our judge is asked once per item, so it has one count per set.
- Cost of the rerun: 0.82 USD for 1,577 answered calls (both driftbench modes).

Reproduce: `pnpm exec tsx comparisons/hard-peers/run.mts <competitor> <row>:default,<row>:audit --old --replay`, then `python3 comparisons/hard-peers/score_old.py`.
