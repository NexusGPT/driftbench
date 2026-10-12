# promptfoo: comparison

promptfoo is a tool for testing LLM applications with assertions, judged criteria, red-team attacks and simulated users. This comparison uses the source at revision 8014282, read directly.

Results come from the comparison table. Limit means a row is not being worked, with its reason stated.

| Capability | Result | Basis | Example | Reproduce |
|---|---|---|---|---|
| Word count | ahead | compared against their docs or code | Both count "Thanks, your order is in." as 5 words. Ours also takes a min and a max bound on the count. | Not reproducible from main yet: the test is awaiting merge. |
| Character bounds | ahead | compared against their docs or code | Ours counts code points: "é😀" passes chars min 2, max 2. Counting UTF-16 units would give 3 and fail. Their assertion list has no character bound. | Not reproducible from main yet: the test is awaiting merge. |
| Valid JSON, JSON schema, contains-json | ahead | measured head-to-head | On 15 shared cases, ours passes every case theirs passes, and three more. Array in prose: their contains-json fails, ours embedded mode passes. | Not reproducible from main yet: the test is awaiting merge. |
| JSON paths | ahead | compared against their docs or code | Their checks have no path assertions. Ours takes the spec's own assertions on paths. | Not reproducible from main yet: the test is awaiting merge. |
| Tool-call F1 | ahead | compared against their docs or code | Expected catalog.search with plan mobile, called with plan home. Their set check passes it. Ours fails it. | Not reproducible from main yet: the test is awaiting merge. |
| Refusal | ahead | compared against their docs or code | "Je ne peux pas vous aider." is a refusal for us, in seven languages. Theirs reads a flag from the provider, so the reply text alone does not count. | Not reproducible from main yet: the test is awaiting merge. |
| XML, HTML and SQL validity (contains-html, is-html, contains-sql, is-sql, contains-xml, is-xml) | in progress | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| regex | equal | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| contains, contains-all, contains-any | equal | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| icontains, icontains-all, icontains-any | equal | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| equals | in progress | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| starts-with | equal | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Levenshtein, similar (cosine, dot, euclidean) | equal | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| ROUGE, BLEU, METEOR, GLEU, n-grams | limit | compared against their docs or code. Reason: skipped here, another comparison builds these metrics. | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Perplexity | limit | compared against their docs or code. Reason: needs token log probabilities, which our adapter contract does not carry. | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Cost and latency | equal | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Trace span count, duration, error spans | limit | compared against their docs or code. Reason: their checks use OpenTelemetry spans, and our adapters report calls, not spans. | No example recorded in the evidence. | Not reproducible from the repository yet. |
| LLM rubric, model-graded closed QA, G-Eval, agent rubric | ahead | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Factuality, model-graded factuality | in progress | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Answer relevance, conversation relevance | equal | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Context faithfulness, recall, relevance (RAG) | limit | compared against their docs or code. Reason: our Max has no retrieval step. | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Finish reason | equal | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Classifier, moderation, safety layers, pi, webhook | limit | compared against their docs or code. Reason: their checks call external services; ours are local by design. | No example recorded in the evidence. | Not reproducible from the repository yet. |
| JavaScript, Python, Ruby assertions | equal | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Skill used | equal | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Function-call and tools-call validity | equal | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Trajectory: tool used | equal | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Trajectory: tool sequence | equal | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Trajectory: tool arguments | ahead | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Trajectory: step count | equal | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Trajectory: goal success | equal | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Red-team plugins (69 plugins, src/redteam/plugins) | behind | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Red-team strategies (encodings, multilingual, crescendo, GOAT, hydra) | equal | measured against our earlier version | Across seven sales faults, seeds 0 to 2, 10 rounds: the findings per fault are the same before and after the drafted phrasings. | Not reproducible from the repository yet. |
| Simulated user: persona, turn limit, stop token | ahead | compared against their docs or code | A persona fact reaches the agent only after the agent asks for it. Their docs describe no rule that holds a fact back. Their simulated user calls hosted models by default. Ours makes no network call, and the model is injected. | pnpm -s vitest run packages/users/test/simulated.test.ts -t "gives a fact only after"; grep -n "fetch(" packages/users/src/simulated.ts (no matches) |
| Simulated user: initial messages (fixed mid-state start) | in progress | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Simulated user: stateful (send only the latest message) | in progress | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |

## Not compared

- ROUGE, BLEU, METEOR, GLEU and n-gram metrics: skipped here, built in a separate comparison.
- Perplexity, trace span checks and RAG checks: not applicable to our adapter contract or to Max.
- Classifier, moderation, safety, pi and webhook checks: their checks call external services; ours are local by design.
- Not measured head to head: equals, XML, HTML and SQL validity, the factuality judge, and both simulated user rows for initial messages and stateful mode.
