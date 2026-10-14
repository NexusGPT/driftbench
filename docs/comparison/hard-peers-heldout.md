# Harder held-out cases: promptfoo, Langfuse and DeepEval

Every side uses Claude Haiku 5.5 through the same lean `claude -p` call, with prompt caching disabled. Each competitor runs its own default grader, unchanged. driftbench runs the judge in `packages/judges/src` at this commit, with no pinned commit, as two contestants: the default judge and the opt-in answer audit.

The sets, prompts, judge source, runners and analysis were frozen in `comparisons/hard-peers/freeze.json` (2026-10-13T18:52:14+02:00) before any model call on these sets. Each row has 126 fictional cases: seven deviation classes, nine counterfactual pairs per class, one pass and one fail per pair.

## Pre-registered primary endpoint

Per competitor: all its rows pooled, paired by case, driftbench answer audit against the competitor default. Exact two-sided McNemar test on the discordant pairs. An answered call with no usable verdict counts as wrong.

| Competitor | Paired cases | driftbench answer audit right | Competitor default right | Only audit right | Only competitor right | Exact McNemar p |
|---|---|---|---|---|---|---|
| promptfoo | 504 | 500 | 496 | 8 | 4 | 0.39 |
| Langfuse | 126 | 118 | 123 | 2 | 7 | 0.18 |
| DeepEval 4.2.8 | 378 | 353 | 269 | 86 | 2 | 2.5e-23 |

## Secondary: driftbench default judge against each competitor default

| Competitor | Paired cases | driftbench default right | Competitor default right | Only driftbench right | Only competitor right | Exact McNemar p |
|---|---|---|---|---|---|---|
| promptfoo | 504 | 496 | 496 | 6 | 6 | 1 |
| Langfuse | 126 | 122 | 123 | 2 | 3 | 1 |
| DeepEval 4.2.8 | 378 | 355 | 269 | 86 | 0 | 2.6e-26 |

## Per row

Right answers out of completed cases, with Wilson 95 percent intervals in percent.

| Competitor | Row | driftbench answer audit | driftbench default | Competitor default |
|---|---|---|---|---|
| promptfoo | LLM rubric | 124/126 (94.4 to 99.56) | 123/126 (93.23 to 99.19) | 122/126 (92.12 to 98.76) |
| promptfoo | Factuality | 126/126 (97.04 to 100.0) | 126/126 (97.04 to 100.0) | 123/126 (93.23 to 99.19) |
| promptfoo | Personal data | 126/126 (97.04 to 100.0) | 125/126 (95.64 to 99.86) | 125/126 (95.64 to 99.86) |
| promptfoo | Goal success | 124/126 (94.4 to 99.56) | 122/126 (92.12 to 98.76) | 126/126 (97.04 to 100.0) |
| Langfuse | Reference correctness | 118/126 (87.97 to 96.75) | 122/126 (92.12 to 98.76) | 123/126 (93.23 to 99.19) (threshold 0.5) |
| DeepEval 4.2.8 | Task completion | 119/126 (88.98 to 97.28) | 126/126 (97.04 to 100.0) | 82/126 (56.42 to 72.85) |
| DeepEval 4.2.8 | Knowledge retention | 126/126 (97.04 to 100.0) | 126/126 (97.04 to 100.0) | 123/126 (93.23 to 99.19) |
| DeepEval 4.2.8 | Conversation completeness | 108/126 (78.55 to 90.77) | 103/126 (74.1 to 87.52) | 64/126 (42.17 to 59.37) |

## Per class

Right answers out of 18 cases per class (fewer when a case never completed).

### promptfoo: LLM rubric

| Class | Audit | Default | Competitor |
|---|---|---|---|
| double-negation | 18 | 18 | 17 |
| embedded-instruction | 18 | 17 | 15 |
| flattened-trace | 18 | 17 | 18 |
| long-one-wrong | 18 | 18 | 18 |
| near-miss | 18 | 17 | 18 |
| partial-credit | 18 | 18 | 18 |
| unusual-format | 16 | 18 | 18 |

### promptfoo: Factuality

| Class | Audit | Default | Competitor |
|---|---|---|---|
| double-negation | 18 | 18 | 15 |
| embedded-instruction | 18 | 18 | 18 |
| flattened-trace | 18 | 18 | 18 |
| long-one-wrong | 18 | 18 | 18 |
| near-miss | 18 | 18 | 18 |
| partial-credit | 18 | 18 | 18 |
| unusual-format | 18 | 18 | 18 |

### promptfoo: Personal data

| Class | Audit | Default | Competitor |
|---|---|---|---|
| double-negation | 18 | 18 | 18 |
| embedded-instruction | 18 | 18 | 18 |
| flattened-trace | 18 | 17 | 17 |
| long-one-wrong | 18 | 18 | 18 |
| near-miss | 18 | 18 | 18 |
| partial-credit | 18 | 18 | 18 |
| unusual-format | 18 | 18 | 18 |

### promptfoo: Goal success

| Class | Audit | Default | Competitor |
|---|---|---|---|
| double-negation | 18 | 18 | 18 |
| embedded-instruction | 18 | 18 | 18 |
| flattened-trace | 17 | 18 | 18 |
| long-one-wrong | 18 | 18 | 18 |
| near-miss | 18 | 18 | 18 |
| partial-credit | 17 | 14 | 18 |
| unusual-format | 18 | 18 | 18 |

### Langfuse: Reference correctness

| Class | Audit | Default | Competitor |
|---|---|---|---|
| double-negation | 18 | 18 | 18 |
| embedded-instruction | 18 | 17 | 18 |
| flattened-trace | 18 | 18 | 18 |
| long-one-wrong | 10 | 15 | 17 |
| near-miss | 18 | 18 | 16 |
| partial-credit | 18 | 18 | 18 |
| unusual-format | 18 | 18 | 18 |

### DeepEval 4.2.8: Task completion

| Class | Audit | Default | Competitor |
|---|---|---|---|
| double-negation | 18 | 18 | 9 |
| embedded-instruction | 18 | 18 | 9 |
| flattened-trace | 18 | 18 | 18 |
| long-one-wrong | 11 | 18 | 11 |
| near-miss | 18 | 18 | 11 |
| partial-credit | 18 | 18 | 13 |
| unusual-format | 18 | 18 | 11 |

### DeepEval 4.2.8: Knowledge retention

| Class | Audit | Default | Competitor |
|---|---|---|---|
| double-negation | 18 | 18 | 17 |
| embedded-instruction | 18 | 18 | 18 |
| flattened-trace | 18 | 18 | 18 |
| long-one-wrong | 18 | 18 | 18 |
| near-miss | 18 | 18 | 18 |
| partial-credit | 18 | 18 | 18 |
| unusual-format | 18 | 18 | 16 |

### DeepEval 4.2.8: Conversation completeness

| Class | Audit | Default | Competitor |
|---|---|---|---|
| double-negation | 9 | 9 | 9 |
| embedded-instruction | 18 | 18 | 9 |
| flattened-trace | 18 | 18 | 9 |
| long-one-wrong | 9 | 9 | 9 |
| near-miss | 18 | 13 | 9 |
| partial-credit | 18 | 18 | 10 |
| unusual-format | 18 | 18 | 9 |

## Deviation classes

Each class stands for a real agent failure mode:

- **partial-credit**: An agent answers most of a multi-part request and drops or half-completes one part, a common outcome of long tool loops.
- **near-miss**: An agent copies a neighbouring record or transposes two digits, so the plan name, line, price or person is almost the right one.
- **double-negation**: An agent hedges with stacked negatives, so the literal assertion has to be resolved before it can be checked.
- **flattened-trace**: A logging pipeline flattens user turns, tool calls, tool results and the reply into one text entry, and the judge must find what the agent itself asserted or did.
- **embedded-instruction**: The reply or the data carries text addressed to the grader, from a prompt injection or a copied template, that asks for a verdict.
- **long-one-wrong**: A long, fluent, mostly correct reply hides one wrong value or one dropped request among correct ones.
- **unusual-format**: An agent answers in a JSON object, a table, a YAML block or an uppercase record instead of prose, correct or with one error.

## Rows

- **promptfoo/rubric**: promptfoo llm-rubric default grading prompt; criterion: all requested facts stated correctly.
- **promptfoo/factuality**: promptfoo factuality default prompt; criterion: no contradiction with the reference, a consistent subset passes (so its partial-credit pass case is a correct subset).
- **promptfoo/pii**: promptfoo llm-rubric default grading prompt with a personal data rubric and fictional ownership bindings.
- **promptfoo/goal**: promptfoo trajectory goal-success default prompt; the persisted final order is given inside the trajectory (full-state form); truth follows the persisted order.
- **langfuse/correctness**: Langfuse first-party Correctness template, version 1; truth requires every requested fact and no unsupported addition.
- **deepeval/task**: DeepEval 4.2.8 TaskCompletionMetric, default settings.
- **deepeval/knowledge**: DeepEval 4.2.8 KnowledgeRetentionMetric, default settings.
- **deepeval/completeness**: DeepEval 4.2.8 ConversationCompletenessMetric, default settings; its long-one-wrong fail case drops one of six requests.

## What the result says

- promptfoo: no measurable difference. The answer audit is right on 500 of 504 cases and the promptfoo defaults on 496; the pre-registered test does not separate them. The driftbench default ties at 496. Both sides are still near the ceiling on these classes with Claude Haiku 5.5.
- Langfuse: no measurable difference, and the Correctness template is ahead in raw counts (123 against 118 for the answer audit and 122 for the default) when read at its better threshold, 0.5. At 1.0 the template scores 108.
- DeepEval: the pre-registered test is decisive. The answer audit is right on 353 of 378 cases and the default metrics on 269. The gap comes from task completion (82 of 126) and conversation completeness (64 of 126); knowledge retention is close (123 of 126).
- The opt-in answer audit is not uniformly better than the driftbench default: it is behind on Langfuse correctness (118 against 122) and DeepEval task completion (119 against 126), both on the long-one-wrong class.

## Defects found in the frozen sets after the run

Reading the misses after the results were in showed defects in the construction. The frozen sets and the pre-registered numbers above are left as they are. This section is post hoc.

- **D1, a bug.** In DeepEval conversation completeness, the double-negation and long-one-wrong pairs kept the base user question while the replies answer a different one. The nine double-negation cases labelled pass leave two questions open, and the nine long-one-wrong cases labelled fail answer every question asked. Both driftbench modes judged these 18 cases against their labels and were right about the text.
- **D2, ambiguous labels.** In DeepEval task completion, long-one-wrong, the user asks for "the references" and the reply labelled pass gives one. In Langfuse correctness, long-one-wrong, the reply labelled pass adds "I have checked the plan record for you", which a strict reader can call an unsupported assertion. The answer audit failed 7 and 8 of those pass cases for exactly these reasons.

Pooled paired tests with those pairs removed (36 cases for D1; 72 for D1 and D2):

| Exclusion | Competitor | driftbench mode | Paired cases | driftbench right | Competitor right | Only driftbench | Only competitor | Exact McNemar p |
|---|---|---|---|---|---|---|---|---|
| D1 removed | promptfoo | answer audit | 504 | 500 | 496 | 8 | 4 | 0.39 |
| D1 removed | promptfoo | default | 504 | 496 | 496 | 6 | 6 | 1 |
| D1 removed | Langfuse | answer audit | 126 | 118 | 123 | 2 | 7 | 0.18 |
| D1 removed | Langfuse | default | 126 | 122 | 123 | 2 | 3 | 1 |
| D1 removed | DeepEval 4.2.8 | answer audit | 342 | 335 | 251 | 86 | 2 | 2.5e-23 |
| D1 removed | DeepEval 4.2.8 | default | 342 | 337 | 251 | 86 | 0 | 2.6e-26 |
| D1 and D2 removed | promptfoo | answer audit | 504 | 500 | 496 | 8 | 4 | 0.39 |
| D1 and D2 removed | promptfoo | default | 504 | 496 | 496 | 6 | 6 | 1 |
| D1 and D2 removed | Langfuse | answer audit | 108 | 108 | 106 | 2 | 0 | 0.5 |
| D1 and D2 removed | Langfuse | default | 108 | 107 | 106 | 2 | 1 | 1 |
| D1 and D2 removed | DeepEval 4.2.8 | answer audit | 324 | 324 | 240 | 84 | 0 | 1.0e-25 |
| D1 and D2 removed | DeepEval 4.2.8 | default | 324 | 319 | 240 | 79 | 0 | 3.3e-24 |

The conclusions do not change: decisive against DeepEval, no measurable difference against promptfoo and Langfuse.

## Run

- 3,610 answered calls on the frozen sets, 1.54 USD, concurrency 2, every case completed for every contestant. Four calls made before the freeze-gated run hit an account session limit, returned no answer at zero cost, and were sent again later.
- For about ten minutes two DeepEval runner processes from an aborted launch ran beside the main runner, so up to four calls were in flight. Their answered calls are part of the recording; no answered call was sent twice.
- The runner file changed twice after the first freeze commit and was refrozen each time, both before any answered call on these sets (commits `47917b194`, `2452e1001`).

## Reproduce

See `comparisons/hard-peers/README.md`. `--replay` re-scores the recorded answers without a model call.
