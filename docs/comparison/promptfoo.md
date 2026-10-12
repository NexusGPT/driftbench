# promptfoo: comparison

promptfoo is an open-source tool for testing LLM prompts, agents and red-team attacks. This page reads its source at commit 8014282 (read 2026-10-12). Some rows are measured on the same inputs as promptfoo, and the rows come from the comparison table's Rows section, with its Measured update section taking precedence for rows 7 to 12, 16, 19, 35 and 36.

Results come from the comparison table. Limit means a row is not being worked, with its reason stated.

| Capability | Result | Basis | Example | Reproduce |
|---|---|---|---|---|
| Word count | ahead | compared against their docs or code | Both count "Thanks, your order is in." as 5 words. Ours also sets a minimum and a maximum. | Not reproducible from main yet: the test is awaiting merge. |
| Character bounds | ahead | compared against their docs or code | Ours counts code points: "é😀" passes a minimum and maximum of 2 characters. Counting UTF-16 units gives 3 and fails. | Not reproducible from main yet: the test is awaiting merge. |
| Valid JSON, JSON schema, contains-json | ahead | measured head-to-head | "Here you go: {"price": 35}" is valid for promptfoo. Our strict default fails it, and our embedded mode passes it. | Not reproducible from the repository: the measurement is a local script outside it. |
| JSON paths | ahead | compared against their docs or code | No example recorded in the evidence. | Not reproducible from main yet: the test is awaiting merge. |
| Tool-call F1 | ahead | compared against their docs or code | Expected catalog.search with plan mobile, called with plan home. promptfoo's set check passes it. Ours fails it. | Not reproducible from main yet: the test is awaiting merge. |
| Refusal | ahead | compared against their docs or code | "Je ne peux pas vous aider." is a refusal for us. For promptfoo it is one only if the provider says so. | Not reproducible from main yet: the test is awaiting merge. |
| XML, HTML and SQL validity (contains-html, is-html, contains-sql, is-sql, contains-xml, is-xml) | equal | measured head-to-head | No example recorded in the evidence. | Not reproducible from main yet: the test is awaiting merge. |
| regex | equal | measured head-to-head | No example recorded in the evidence. | Not reproducible from main yet: the test is awaiting merge. |
| contains, contains-all, contains-any | equal | measured head-to-head | No example recorded in the evidence. | Not reproducible from main yet: the test is awaiting merge. |
| icontains, icontains-all, icontains-any | equal | measured head-to-head | No example recorded in the evidence. | Not reproducible from main yet: the test is awaiting merge. |
| equals | ahead | measured head-to-head | Ahead on loose truth (120 vs 54 of 120). Behind on identical text (54 vs 120). | Not reproducible from main yet: the test is awaiting merge. |
| starts-with | ahead | measured head-to-head | No example recorded in the evidence. | Not reproducible from main yet: the test is awaiting merge. |
| Levenshtein, similar (cosine, dot, euclidean) | equal | compared against their docs or code | No example recorded in the evidence. | pnpm -s vitest run packages/checks/test/similarity.test.ts |
| ROUGE, BLEU, METEOR, GLEU, n-grams | in progress | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Perplexity | limit | compared against their docs or code. Reason: needs token log probabilities, which our adapter contract does not carry. | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Cost and latency | equal | measured head-to-head | No example recorded in the evidence. | Not reproducible from main yet: the test is awaiting merge. |
| Trace span count, duration, error spans | limit | compared against their docs or code. Reason: our adapters record calls, not spans. | No example recorded in the evidence. | Not reproducible from the repository yet. |
| LLM rubric, model-graded closed QA, G-Eval, agent rubric | ahead | compared against their docs or code | No example recorded in the evidence. | pnpm -s vitest run packages/judges/test/calibration.test.ts |
| Factuality, model-graded factuality | equal | measured head-to-head | No example recorded in the evidence. | Not reproducible from main yet: the test is awaiting merge. |
| Answer relevance, conversation relevance | limit | compared against their docs or code. Reason: promptfoo first generates three questions with a text model, and our local route still needs one. | No example recorded in the evidence. | pnpm -s vitest run packages/checks/test/relevancy.test.ts |
| Context faithfulness, recall, relevance (RAG) | limit | compared against their docs or code. Reason: Max has no retrieval step. | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Finish reason | equal | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Classifier, moderation, safety checks, pi, webhook | limit | compared against their docs or code. Reason: out of scope, since their checks call external services and ours run locally. | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Custom code checks (JavaScript and Python assertions) | equal | compared against their docs or code | No example recorded in the evidence. | pnpm -s vitest run packages/checks/test/custom.test.ts |
| Skill used | ahead | measured against our earlier version | No example recorded in the evidence. | Not reproducible from the repository: the measurement is a local script outside it. |
| Function-call and tools-call validity | ahead | measured head-to-head | No example recorded in the evidence. Caveat: a provider with a validator was not run. | Not reproducible from main yet: the test is awaiting merge. |
| Trajectory: tool used | ahead | measured head-to-head | No example recorded in the evidence. | Not reproducible from the repository: the measurement is a local script outside it. |
| Trajectory: tool sequence | ahead | measured head-to-head | No example recorded in the evidence. | Not reproducible from main yet: the test is awaiting merge. |
| Trajectory: tool arguments | ahead | compared against their docs or code | No example recorded in the evidence. | pnpm -s vitest run packages/checks/test/tools.test.ts |
| Trajectory: step count | ahead | measured head-to-head | No example recorded in the evidence. | Not reproducible from the repository: the measurement is a local script outside it. |
| Trajectory: goal success | ahead | measured head-to-head | No example recorded in the evidence. Caveat: a judge that reads the trace was not run. | Not reproducible from main yet: the test is awaiting merge. |
| Red-team plugins (69 plugins, src/redteam/plugins) | behind | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Red-team strategies (encodings, multilingual, crescendo, GOAT, hydra) | equal | measured against our earlier version | Drafts: a base64 encoding and a French instruction in the world notes for D6, a French billing request for D9, and a goal shift with no keyword for D2. | Not reproducible from the repository yet. |
| Simulated user: persona, turn limit, stop token | ahead | compared against their docs or code | A persona fact reaches the agent only after the agent asks for it. promptfoo sends simulated messages to its hosted models unless remote generation is turned off. Ours makes no network call. The stop token works the same way on both sides. | pnpm -s vitest run packages/users/test/simulated.test.ts -t "gives a fact only after" |
| Simulated user: initial messages (fixed mid-state start) | limit | compared against their docs or code. Reason: not measured on a run. The starting history is served by the block prefix and tested in the runner tests. | No example recorded in the evidence. | pnpm -s vitest run packages/core/test/runner/run.test.ts |
| Simulated user: stateful (send only the latest message) | limit | compared against their docs or code. Reason: adapters send the full history by design. | No example recorded in the evidence. | Not reproducible from the repository yet. |

## Not compared

- Classifier, moderation, safety checks, pi and webhook: out of scope, since their checks call external services.
- RAG faithfulness, recall and relevance: Max has no retrieval step.
- ROUGE, BLEU, METEOR, GLEU and n-grams: a separate effort builds these.
- Perplexity: needs token log probabilities, which our adapter contract does not carry.
- Trace span count, duration and error spans: our adapters record calls, not spans.
- Red-team plugins: drafts only, not wired.
- Multi-turn red-team attacks: the simulator exists, not measured here.
- Goal success with a judge that reads the trace: not run.
- Function-call validity with a provider that has a validator: not run.
- Simulated user initial messages: not measured on a run.
- Simulated user stateful mode: adapters send the full history by design.
- Factuality: 100 of 100 on both sides, but the cases are too easy to separate, so no advantage is claimed.
- Custom code checks at 100 cases: not measured.
