# Harder held-out cases: LangWatch

Added after the promptfoo, Langfuse and DeepEval run, by a freeze amendment in `comparisons/hard-peers/freeze.json` (2026-10-13T23:04:06+02:00), committed before any LangWatch call. Same model on every side: Claude Haiku 5.5 through the same lean `claude -p` call, prompt caching disabled.

- **Rows.** Three fresh conversation rows of 126 cases (seed 20261014, generate_langwatch.py): task completion, knowledge retention, conversation completeness, in the same seven classes. The two construction defects found after the first run are corrected in these rows; knowledge retention uses the frozen builder unchanged.
- **Competitor.** LangWatch's default judge: the vendored Scenario verdict prompt, per-criterion rules and structured-output schema, rendered by the earlier harness's own functions with its trusted role-separated transcript. Its one declared criterion is the rubric sentence of the shipped criterion driftbench is asked. Structured answers get two turns, then six once, as the earlier harness did.
- **Disclosure.** The class design and the two defect corrections were informed by the first run. No driftbench or LangWatch answer on these rows existed when this was written.

## Pre-registered primary endpoint

Pooled over the three rows, paired by case, driftbench answer audit against the LangWatch default judge. Exact two-sided McNemar test. An answered call with no usable verdict counts as wrong.

| Contestant | Paired cases | driftbench right | LangWatch right | Only driftbench | Only LangWatch | Exact McNemar p |
|---|---|---|---|---|---|---|
| driftbench answer audit (primary) | 378 | 378 | 358 | 20 | 0 | 1.9e-06 |
| driftbench default (secondary) | 378 | 374 | 358 | 20 | 4 | 0.0015 |

## Per row

| Row | driftbench answer audit | driftbench default | LangWatch default |
|---|---|---|---|
| Task completion | 126/126 (97.04 to 100.0) | 125/126 (95.64 to 99.86) | 106/126 (76.75 to 89.48) |
| Knowledge retention | 126/126 (97.04 to 100.0) | 126/126 (97.04 to 100.0) | 126/126 (97.04 to 100.0) |
| Conversation completeness | 126/126 (97.04 to 100.0) | 123/126 (93.23 to 99.19) | 126/126 (97.04 to 100.0) |

## Per class

### Task completion

| Class | Audit | Default | LangWatch |
|---|---|---|---|
| double-negation | 18 | 18 | 17 |
| embedded-instruction | 18 | 18 | 9 |
| flattened-trace | 18 | 18 | 18 |
| long-one-wrong | 18 | 18 | 10 |
| near-miss | 18 | 17 | 17 |
| partial-credit | 18 | 18 | 17 |
| unusual-format | 18 | 18 | 18 |

### Knowledge retention

| Class | Audit | Default | LangWatch |
|---|---|---|---|
| double-negation | 18 | 18 | 18 |
| embedded-instruction | 18 | 18 | 18 |
| flattened-trace | 18 | 18 | 18 |
| long-one-wrong | 18 | 18 | 18 |
| near-miss | 18 | 18 | 18 |
| partial-credit | 18 | 18 | 18 |
| unusual-format | 18 | 18 | 18 |

### Conversation completeness

| Class | Audit | Default | LangWatch |
|---|---|---|---|
| double-negation | 18 | 18 | 18 |
| embedded-instruction | 18 | 18 | 18 |
| flattened-trace | 18 | 18 | 18 |
| long-one-wrong | 18 | 18 | 18 |
| near-miss | 18 | 15 | 18 |
| partial-credit | 18 | 18 | 18 |
| unusual-format | 18 | 18 | 18 |

## What the result says

- The pre-registered test is significant: the answer audit is right on every case and LangWatch on 358 of 378. All 20 LangWatch misses are on task completion, and all are "inconclusive" answers on cases labelled pass. They fall in five classes: an instruction to the grader inside the reply (9 misses, 9 of 18 right), a long reply hiding one wrong value (8 misses, 10 of 18 right), and one miss each in double-negation, near-miss and partial-credit (17 of 18 right each). Two classes account for 17 of the 20.
- Knowledge retention and conversation completeness tie at or near the ceiling.
- Cost: 0.66 USD for 1,135 answered calls; every case completed.

Reproduce: `python3 comparisons/hard-peers/generate_langwatch.py`, `pnpm exec tsx comparisons/hard-peers/render_langwatch.mts`, `pnpm exec tsx comparisons/hard-peers/run.mts langwatch task:theirs,task:default,task:audit --replay`, then `python3 comparisons/hard-peers/score_langwatch.py`.
