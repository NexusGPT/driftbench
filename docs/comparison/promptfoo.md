# promptfoo: comparison

promptfoo is an LLM evaluation framework. It runs assertions on model replies and tool calls, red-team probes, and a simulated user for conversations. This page compares our checks with its source at commit 8014282. Some rows are measured on the same inputs, or on generated cases with a fixed seed.

Results come from the comparison table. Limit means a row is not being worked, with its reason stated.

| Capability | Result | Basis | Example | Reproduce |
|---|---|---|---|---|
| Word count (min and max) | ahead | compared against their docs or code | The reply "one" and "two", on separate lines, counts as 2 words. | Not reproducible from main yet: the test is awaiting merge. |
| Character bounds | ahead | compared against their docs or code | "é😀" passes a character minimum and maximum of 2. Counting UTF-16 units gives 3 and fails. | Not reproducible from main yet: the test is awaiting merge. |
| Valid JSON, JSON schema, contains-json | ahead | measured head-to-head | 'Here you go: {"price": 35}' fails their is-json check and passes our embedded mode. Our default strict mode fails it, because the whole reply must be JSON. | Not reproducible from main yet: the test is awaiting merge. |
| JSON paths | ahead | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Tool-call F1 | ahead | compared against their docs or code | Expected catalog.search with plan mobile, called with plan home. Their set check passes it. Ours fails it. | Not reproducible from main yet: the test is awaiting merge. |
| Refusal | ahead | compared against their docs or code | "Je ne peux pas vous aider." is a refusal for us. For them it is one only when the provider flags it. | Not reproducible from main yet: the test is awaiting merge. |
| XML, HTML and SQL validity | ahead | measured head-to-head | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Regex | equal | measured head-to-head | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Contains, contains-all, contains-any | ahead | measured head-to-head | No example recorded in the evidence. | Not reproducible from the repository yet. |
| icontains, icontains-all, icontains-any | ahead | measured head-to-head | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Equals | equal | measured head-to-head | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Starts-with | ahead | measured head-to-head | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Levenshtein, similar (cosine, dot, euclidean) | ahead | measured head-to-head | No example recorded in the evidence. | Not reproducible from the repository yet. |
| ROUGE, BLEU, METEOR, GLEU, n-grams | in progress | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Perplexity | limit | compared against their docs or code. Reason: needs token log probabilities, which our adapter contract does not carry. | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Cost and latency | ahead | measured head-to-head | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Trace span count, duration, error spans | limit | compared against their docs or code. Reason: theirs use OpenTelemetry spans, and our adapters report calls, not spans. | No example recorded in the evidence. | Not reproducible from the repository yet. |
| LLM rubric, model-graded closed QA, G-Eval, agent rubric | ahead | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Factuality, model-graded factuality | equal | measured head-to-head | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Answer relevance, conversation relevance | limit | compared against their docs or code. Reason: promptfoo generates three questions with a text provider before embedding them, so our local route still needs a text model. | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Context faithfulness, recall, relevance (RAG) | limit | compared against their docs or code. Reason: our Max has no retrieval step. | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Finish reason | equal | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Classifier, moderation, pi and webhook checks | limit | compared against their docs or code. Reason: theirs call external services, and our checks are local. | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Custom code checks (JavaScript and Python assertions) | ahead | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Skill used | ahead | measured against our earlier version | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Function-call and tools-call validity | ahead | measured head-to-head | A valid call against its tool's JSON Schema fails promptfoo's check when the provider has no validator. Our schema check passes it. | Not reproducible from main yet: the test is awaiting merge. |
| Trajectory: tool used | ahead | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Trajectory: tool sequence | ahead | compared against their docs or code | Promptfoo's exact-mode reason lists the expected and actual tool names, with no call position. Ours names the first difference by call position. | Not reproducible from main yet: the test is awaiting merge. |
| Trajectory: tool arguments | ahead | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Trajectory: step count | ahead | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Trajectory: goal success | ahead | compared against their docs or code | The reply says the mobile M order is on its way, while the end state holds the mobile S plan. Our end-state check fails it. A judge that reads the reply alone can pass it. | Not reproducible from main yet: the test is awaiting merge. |
| Red-team plugins | behind | compared against their docs or code | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Red-team strategies (encodings, multilingual, multi-turn) | equal | compared against their docs or code | A base64 encoding of an attack, and a French instruction placed in the world notes. Neither changed the findings. | Not reproducible from the repository yet. |
| Simulated user: persona, turn limit, stop token | ahead | compared against their docs or code | The persona's fact reaches the agent only after the agent asks for it. The run fails if the model gives a fact the agent did not ask for. | pnpm -s vitest run packages/users/test/simulated.test.ts -t "gives a fact only after" |
| Simulated user: initial messages | limit | compared against their docs or code. Reason: not measured on a run. | No example recorded in the evidence. | Not reproducible from the repository yet. |
| Simulated user: stateful (send only the latest message) | limit | compared against their docs or code. Reason: adapters send the full history by design. | No example recorded in the evidence. | Not reproducible from the repository yet. |

## Not compared

- ROUGE, BLEU, METEOR, GLEU and n-grams: not compared on this page. The LangWatch comparison builds them.
- Perplexity: needs token log probabilities, which our adapter contract does not carry.
- Trace span count, duration and error spans: theirs use OpenTelemetry spans.
- Context faithfulness, recall and relevance (RAG): our Max has no retrieval step.
- Classifier, moderation, pi and webhook checks: theirs call external services, and ours are not built.
- Red-team reply patterns on injected blocks, and the goal-shift case: promptfoo was not run against them. Its red-team grades each plugin, not each injected block.
- Prompt-extraction half of the personal data check: not measured, and we have no check for it.
