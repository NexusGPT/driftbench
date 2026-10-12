# promptfoo: comparison

promptfoo is an open-source framework for testing LLM applications, with assertions, red-team plugins and simulated users. This page is based on its source at commit 8014282. Some rows are measured on the same inputs, and the rest are compared by reading its code or docs.

Results come from the comparison table. Limit means a row is not being worked, with its reason stated.

| Capability | Result | Basis | Example | Reproduce |
|---|---|---|---|---|
| Word count | ahead | compared against their docs or code | Both count "Thanks, your order is in." as 5 words, and "one" and "two" on separate lines count 2 words. | Not reproducible from main yet: the test is awaiting merge. |
| Character bounds | ahead | compared against their docs or code | "é😀" passes a character minimum and maximum of 2. Counting UTF-16 units gives 3 and fails. | Not reproducible from main yet: the test is awaiting merge. |
| Valid JSON, JSON schema, contains-json | ahead | measured head-to-head | "Here you go: {"price": 35}" passes their contains-json check and fails our strict check. Our embedded mode passes it. | Not reproducible from the repository: the measurement is a local script outside it. |
| JSON paths | ahead | compared against their docs or code | No example recorded in the evidence. | Not reproducible from main yet: the test is awaiting merge. |
| Tool-call F1 | ahead | compared against their docs or code | Expected catalog.search with plan mobile, called with plan home. Their set check passes it. Ours fails it. | Not reproducible from main yet: the test is awaiting merge. |
| Refusal | ahead | compared against their docs or code | "Je ne peux pas vous aider." is a refusal for us. For them it is one only if the provider says so. | Not reproducible from main yet: the test is awaiting merge. |
| XML, HTML and SQL validity (contains-html, is-html, contains-sql, is-sql, contains-xml, is-xml) | in progress | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Regex | equal | measured head-to-head | 120 of 120 cases right for both, case-sensitive by default. | Not reproducible from the repository: the measurement is a local script outside it. |
| Contains, contains-all, contains-any | equal | measured head-to-head | 120 of 120 cases right for both. | Not reproducible from the repository: the measurement is a local script outside it. |
| icontains, icontains-all, icontains-any | equal | measured head-to-head | 120 of 120 cases right for both. | Not reproducible from the repository: the measurement is a local script outside it. |
| equals | in progress | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| starts-with | equal | measured head-to-head | No example recorded in the evidence. | Not reproducible from the repository: the measurement is a local script outside it. |
| Levenshtein, similar (cosine, dot, euclidean) | ahead | measured head-to-head | On a fictional held-out set, ours is right 67 of 100 and promptfoo 50 of 100. The set is built so character distance cannot separate a case change from a price change. | Not reproducible from the repository: the measurement is a local script outside it. |
| ROUGE, BLEU, METEOR, GLEU, n-grams | limit | compared against their docs or code. Reason: skipped, a separate workstream builds these. | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Perplexity | limit | compared against their docs or code. Reason: needs token log probabilities, which our adapter contract does not carry. | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Cost and latency | equal | measured head-to-head | 120 of 120 cases right for both. | Not reproducible from the repository: the measurement is a local script outside it. |
| Trace span count, duration, error spans | limit | compared against their docs or code. Reason: theirs use OpenTelemetry spans, and our adapters record calls, not spans. | No example recorded in the evidence. | Not reproducible from the repository yet. |
| LLM rubric, model-graded closed QA, G-Eval, agent rubric | ahead | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Factuality, model-graded factuality | equal | measured head-to-head | 100 of 100 right for both. The cases are too easy to separate the two. | Not reproducible from the repository yet. |
| Answer relevance, conversation relevance | limit | compared against their docs or code. Reason: promptfoo generates three questions with a text provider before embedding them, and our local route still needs a text model. | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Context faithfulness, recall, relevance (RAG) | limit | compared against their docs or code. Reason: Max has no retrieval step. | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Finish reason | equal | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Classifier, moderation, safety checks, prompt injection, webhook | limit | compared against their docs or code. Reason: not built. Theirs call external services, and our checks are local. | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Custom code checks (JavaScript and Python assertions) | ahead | compared against their docs or code | A user check that never finishes is cut at 50 ms and fails. Stated limit: a synchronous infinite loop is not interrupted, it runs in the same process. | Not reproducible from the repository: the measurement is a local script outside it. |
| Skill used | ahead | measured against our earlier version | Before the fix, our count was right on 65 of 100 traces with failed loads. Now it is 100 of 100. | Not reproducible from the repository: the measurement is a local script outside it. |
| Function-call and tools-call validity | ahead | measured head-to-head | With a provider that has no validator, promptfoo's is-valid-function-call fails every call: 50 of 100 right. | Not reproducible from main yet: the test is awaiting merge. |
| Trajectory: tool used | ahead | measured head-to-head | Verdicts match. Ours names the closest observed call in 100 of 100 traces. Promptfoo names none, in 0 of 100. | Not reproducible from the repository: the measurement is a local script outside it. |
| Trajectory: tool sequence | ahead | measured head-to-head | Verdicts match. Ours names the first wrong call and its position in 100 of 100 traces. Promptfoo's exact-mode reason gives the names but no position, in 0 of 100. | Not reproducible from main yet: the test is awaiting merge. |
| Trajectory: tool arguments | ahead | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Trajectory: step count | ahead | measured head-to-head | Verdicts match. Ours lists each step with the count and the limit, in 100 of 100 traces. Promptfoo prints "Matched N trajectory step(s)" from the count alone. | Not reproducible from the repository: the measurement is a local script outside it. |
| Trajectory: goal success | ahead | compared against their docs or code | Two judges that read only the reply were each right 63 of 100 times. Our end-state check was right 100 of 100. | Not reproducible from main yet: the test is awaiting merge. |
| Red-team plugins (69 plugins) | equal | measured head-to-head | Personal data: ours 200 of 200, promptfoo 199 of 200. | Not reproducible from the repository: the measurement is a local script outside it. |
| Red-team strategies (encodings, multilingual, crescendo, GOAT, hydra) | equal | compared against their docs or code | A rot13 attack is refused with or without the decode wrapper, 3 of 3 each. A neutral rot13 question gets a normal reply, 3 of 3. | Not reproducible from the repository yet. |
| Simulated user: persona, turn limit, stop token | ahead | compared against their docs or code | A persona fact reaches the agent only after the agent asks for it. No hosted model is called by default. | pnpm -s vitest run packages/users/test/simulated.test.ts |
| Simulated user: initial messages | limit | compared against their docs or code. Reason: not measured on a run. The block's given prefix serves it, and a test covers it. | No example recorded in the evidence. | pnpm -s vitest run packages/core/test/runner/run.test.ts |
| Simulated user: stateful (send only the latest message) | limit | compared against their docs or code. Reason: adapters send the full history by design. | No example recorded in the evidence. | Not reproducible from the repository yet. |

## Not compared

- ROUGE, BLEU, METEOR, GLEU and n-grams: skipped, a separate workstream builds them.
- Perplexity: needs token log probabilities, which our adapter contract does not carry.
- Trace span checks: theirs use OpenTelemetry spans, and our adapters record calls.
- RAG faithfulness, recall and relevance: Max has no retrieval step.
- Classifier, moderation, safety checks, prompt injection and webhook: not built.
- Answer relevance: not measured, and promptfoo's route needs a text model.
- equals: not measured against theirs.
- XML, HTML and SQL validity: head-to-head not run.
- Red-team prompt extraction: not measured.
- Red-team grading per injected block: not compared, promptfoo grades per plugin.
- Stateful simulated user: adapters send the full history by design.
