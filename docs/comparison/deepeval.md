# DeepEval: comparison

DeepEval (confident-ai/deepeval) is a Python library that scores LLM replies with judge-model metrics and a few deterministic checks. This page reads its source at commit 4598fe8. The rows were measured on generated cases with a fixed seed (20261012).

Results come from the comparison table. Limit means a row is not being worked, with its reason stated.

| Capability | Result | Basis | Example | Reproduce |
|---|---|---|---|---|
| Turn relevancy, judged | equal | measured head-to-head | Haiku: 96% (CI 90-98) vs 79% (CI 70-86), p<0.001, so ahead on haiku. Sonnet: 99% (CI 95-100) vs 96% (CI 90-98), p=0.25, so equal on sonnet. Two-part hard set (turn relevancy): 97% vs 51% on haiku, 96% vs 51% on sonnet. | Folder comparisons/deepeval. Command: `.venv-deepeval/bin/python comparisons/deepeval/judge/run.py haiku relevancy cassette`. Not reproducible from main yet: the test is awaiting merge. |
| Turn relevancy, key-term floor | limit | compared against their docs or code. Reason for limit: a design choice. The key-term check is advisory when a judge runs and gates only when none runs (project rule). | No example recorded in the evidence. | packages/checks/test/relevancy.test.ts |
| Knowledge retention, judged | equal | measured head-to-head | Haiku: 94% (CI 88-97) vs 90% (CI 83-94), p=0.34, so equal on haiku. Sonnet: 92% (CI 85-96) vs 83% (CI 74-89), p=0.004, so ahead on sonnet. | Folder comparisons/deepeval. Command: `.venv-deepeval/bin/python comparisons/deepeval/judge/run.py haiku knowledge cassette`. Not reproducible from main yet: the test is awaiting merge. |
| Knowledge retention, ask check | limit | compared against their docs or code. Reason for limit: a design choice. The ask check is advisory when a judge runs and gates a clear re-ask without one (project rule). | No example recorded in the evidence. | packages/checks/test/knowledge_retention.test.ts |
| Conversation completeness, judged | ahead | measured head-to-head | Haiku: 98% vs 81%, p=0.0002. Sonnet: 100% vs 75%, p<0.001. | Folder comparisons/deepeval. Command: `.venv-deepeval/bin/python comparisons/deepeval/judge/run.py haiku completeness cassette`. Not reproducible from main yet: the test is awaiting merge. |
| Role adherence, judged | ahead | measured head-to-head | Haiku: 100% vs 68%, p<0.001. Sonnet: 100% vs 73%, p<0.001. | Folder comparisons/deepeval. Command: `.venv-deepeval/bin/python comparisons/deepeval/judge/run.py haiku role cassette`. Not reproducible from main yet: the test is awaiting merge. |
| Hallucination, judged | ahead | measured head-to-head | Haiku: 100% vs 52%, p<0.001. Sonnet: 100% vs 49%, p<0.001. | Folder comparisons/deepeval. Command: `.venv-deepeval/bin/python comparisons/deepeval/judge/run.py haiku hallucination cassette`. Not reproducible from main yet: the test is awaiting merge. |
| Faithfulness, judged | ahead | measured head-to-head | Haiku: 100% vs 50%, p<0.001. Sonnet: 100% vs 50%, p<0.001. | Folder comparisons/deepeval. Command: `.venv-deepeval/bin/python comparisons/deepeval/judge/run.py haiku hallucination cassette` (the same run covers the faithfulness template). Not reproducible from main yet: the test is awaiting merge. |
| Tool correctness, default | ahead | measured head-to-head | Haiku: 100% vs 55%, p<0.001. Sonnet: 100% vs 55%, p<0.001. | Folder comparisons/deepeval. Commands: `npx tsx comparisons/deepeval/tools/tools_ours.mts` and `.venv-deepeval/bin/python comparisons/deepeval/tools/tools_deepeval.py`. Not reproducible from main yet: the test is awaiting merge. |
| Tool correctness, exact order: accuracy | equal | measured head-to-head | Haiku: 100% vs 100%. Sonnet: 100% vs 100%. Equal on verdicts. | packages/checks/test/tools.test.ts, describe "tools: tool_order modes" (our side). The DeepEval side runs from comparisons/deepeval/tools, which is not on main yet. |
| Tool correctness, exact order: diagnosis | ahead | measured against our earlier version | Ours names the call, its position and the argument that differs. DeepEval gives a score only. The same on haiku and sonnet. | Not reproducible from main yet: the test is awaiting merge. |
| Task completion, judged | ahead | measured head-to-head | Haiku: 95% (CI 89-98) vs 62% (CI 52-71), p<0.001. Sonnet: 100% vs 42% (CI 33-52), p<0.001. | Folder comparisons/deepeval. Command: `.venv-deepeval/bin/python comparisons/deepeval/judge/run.py haiku task cassette`. Not reproducible from main yet: the test is awaiting merge. |
| G-Eval, strict | equal | measured head-to-head | Haiku: 96% vs 97%, p=1.0. Sonnet: 99% (CI 95-100) vs 100% (CI 96-100), p=1.0. G-Eval and DAG are equal and not separable. | Folder comparisons/deepeval. Command (same run as turn relevancy): `.venv-deepeval/bin/python comparisons/deepeval/judge/run.py haiku relevancy cassette`. Not reproducible from main yet: the test is awaiting merge. |
| DAG, one judgement node | equal | measured head-to-head | Haiku: 96% vs 93%, p=0.45. Sonnet: 99% vs 100%, p=1.0. G-Eval and DAG are equal and not separable. | Folder comparisons/deepeval. Command: `.venv-deepeval/bin/python comparisons/deepeval/dag/dag_run.py haiku`. Not reproducible from main yet: the test is awaiting merge. |

## Not compared

- DeepEval's default OpenAI judge model: its prompts ran on the claude command instead.
- DeepEval's thresholds: its own default (0.5) was used, not a tuned value.
- Real customer language: the cases are generated from templates, so they test known shapes only.
- Repeat runs: each item was judged once per model, so the intervals are the only variance shown.
