# DeepEval: comparison

DeepEval (confident-ai/deepeval) is a Python library that scores LLM replies with judge-model metrics and a few deterministic checks. This page reads its source at commit 4598fe8. The rows were measured on generated cases with a fixed seed (20261012).

Results come from the comparison table. Limit means a row is not being worked, with its reason stated.

| Capability | Result | Basis | Example | Reproduce |
|---|---|---|---|---|
| Turn relevancy, judged | ahead | measured head-to-head | Haiku: 96% (CI 90-98) vs 79% (CI 70-86), p<0.001. Sonnet: 99% (CI 95-100) vs 96% (CI 90-98), p=0.25, so equal on sonnet. Two-part relevancy figures: haiku 97 vs 51, sonnet 96 vs 51. Our criterion: examples/criteria/relevancy.yaml:4. Their code: turn_relevancy/turn_relevancy.py:56, :308. | Not reproducible from main yet: the test is awaiting merge. |
| Turn relevancy, key-term floor | limit | compared against their docs or code. Limit: DeepEval has no comparator here (judge only). The rule is advisory with a judge and gating without one. | No comparator. Our check: packages/checks/src/checks/relevancy.ts:42,46,49. | Not reproducible from main yet: the test is awaiting merge. |
| Knowledge retention, judged | equal | measured head-to-head | Haiku: 94% (CI 88-97) vs 90% (CI 83-94), p=0.34. Sonnet: 92% (CI 85-96) vs 83% (CI 74-89), p=0.004, so ahead on sonnet. Our criterion: examples/criteria/knowledge_retention.yaml. Their code: knowledge_retention/knowledge_retention.py:356-358. | Not reproducible from main yet: the test is awaiting merge. |
| Knowledge retention, ask check | limit | compared against their docs or code. Limit: DeepEval has no comparator here (judge only). The rule is advisory with a judge and gating without one. | No comparator. Our check: packages/checks/src/checks/knowledge_retention.ts:43,58. | Not reproducible from main yet: the test is awaiting merge. |
| Conversation completeness | ahead | measured head-to-head | Haiku: 98% vs 81%, p=0.0002. Sonnet: 100% vs 75%, p<0.001. Our criterion: examples/criteria/conversation_completeness.yaml. Their code: conversation_completeness/conversation_completeness.py:336. | Not reproducible from main yet: the test is awaiting merge. |
| Role adherence | ahead | measured head-to-head | Haiku: 100% vs 68%, p<0.001. Sonnet: 100% vs 73%, p<0.001. Our criterion: examples/criteria/role.yaml:4. Their code: role_adherence/role_adherence.py:332. | Not reproducible from main yet: the test is awaiting merge. |
| Hallucination | ahead | measured head-to-head | Haiku: 100% vs 52%, p<0.001. Sonnet: 100% vs 49%, p<0.001. Our criterion: examples/acme/criteria/no_invented_data.yaml. Their code: hallucination/hallucination.py:283. | Not reproducible from main yet: the test is awaiting merge. |
| Faithfulness | ahead | measured head-to-head | Haiku: 100% vs 50%, p<0.001. Sonnet: 100% vs 50%, p<0.001. Our criterion: examples/acme/criteria/no_invented_data.yaml. Their code: faithfulness/faithfulness.py:408. | Not reproducible from main yet: the test is awaiting merge. |
| Tool correctness, default | ahead | measured head-to-head | Haiku: 100% vs 55%, p<0.001. Sonnet: 100% vs 55%, p<0.001. Our code: packages/checks/src/checks/tools.ts and forbidden.ts. Their code: tool_correctness/tool_correctness.py:474. | Not reproducible from main yet: the test is awaiting merge. |
| Tool correctness, exact order: accuracy | equal | measured head-to-head | Haiku: 100% vs 100%. Sonnet: 100% vs 100%. Equal on verdicts. Our code: packages/checks/src/checks/tools.ts (tool_order exact, argument check). Their code: tool_correctness/tool_correctness.py:474-504. | Not reproducible from main yet: the test is awaiting merge. |
| Tool correctness, exact order: diagnosis | ahead | measured against our earlier version | Ours names the call, its position and the argument that differs. DeepEval gives a score only (tool_correctness/tool_correctness.py:474). The same on haiku and sonnet. | Not reproducible from the repository: the measurement is a local script outside it. |
| Task completion | ahead | measured head-to-head | Haiku: 95% (CI 89-98) vs 62% (CI 52-71), p<0.001. Sonnet: 100% vs 42% (CI 33-52), p<0.001. Our criterion: examples/criteria/task_completion.yaml. Their code: task_completion/task_completion.py:309. | Not reproducible from main yet: the test is awaiting merge. |
| G-Eval, strict | equal | measured head-to-head | Haiku: 96% vs 97%, p=1.0. Sonnet: 99% (CI 95-100) vs 100% (CI 96-100), p=1.0. G-Eval and DAG are equal and not separable on this set. Our criterion: examples/criteria/relevancy.yaml:4. Their code: g_eval/g_eval.py:90. | Not reproducible from main yet: the test is awaiting merge. |
| DAG, one judgement node | equal | measured head-to-head | Haiku: 96% vs 93%, p=0.45. Sonnet: 99% vs 100%, p=1.0. G-Eval and DAG are equal and not separable on this set. Our criterion: examples/criteria/relevancy.yaml:4. Their code: dag/ (leaf score 0-10). | Not reproducible from main yet: the test is awaiting merge. |

## Not compared

- DeepEval's default OpenAI judge model: its prompts ran on the claude command instead.
- DeepEval's thresholds: its own default (0.5) was used, not a tuned value.
- Real customer language: the cases are generated from templates, so they test known shapes only.
- Repeat runs: each item was judged once per model, so the intervals are the only variance shown.
