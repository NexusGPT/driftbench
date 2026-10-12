# DeepEval: comparison

DeepEval (confident-ai/deepeval) is a Python library that scores LLM replies with judge-model metrics. This page reads its source at commit 4598fe8. The rows were measured on generated cases with a fixed seed (20261012).

Results come from the comparison table. Limit means a row is not being worked, with its reason stated.

| Capability | Result | Basis | Example | Reproduce |
|---|---|---|---|---|
| Turn relevancy, judged | ahead | measured head-to-head | Two-part relevancy figures: haiku 97 vs 51, sonnet 96 vs 51, confirmed on a held-out set. | Not reproducible from main yet: the test is awaiting merge. |
| Turn relevancy, key-term floor | limit | compared against their docs or code. Limit: DeepEval has no comparator here (judge only), and a set project rule decides it: advisory with a judge, gating without one. | No example recorded in the evidence. | packages/checks/test/relevancy.test.ts |
| Knowledge retention, judged | equal | measured head-to-head | No example recorded in the evidence. | Not reproducible from main yet: the test is awaiting merge. |
| Knowledge retention, ask check | limit | compared against their docs or code. Limit: DeepEval has no comparator here (judge only), and a set project rule decides it: advisory with a judge, gating without one. | No example recorded in the evidence. | packages/checks/test/knowledge_retention.test.ts |
| Conversation completeness | ahead | measured head-to-head | No example recorded in the evidence. | Not reproducible from main yet: the test is awaiting merge. |
| Role adherence | ahead | measured head-to-head | No example recorded in the evidence. | Not reproducible from main yet: the test is awaiting merge. |
| Hallucination | ahead | measured head-to-head | No example recorded in the evidence. | Not reproducible from main yet: the test is awaiting merge. |
| Faithfulness | ahead | measured head-to-head | No example recorded in the evidence. | Not reproducible from main yet: the test is awaiting merge. |
| Tool correctness, default | ahead | measured head-to-head | No example recorded in the evidence. | Not reproducible from main yet: the test is awaiting merge. |
| Tool correctness, exact order: accuracy | equal | measured head-to-head | No example recorded in the evidence. | Not reproducible from main yet: the test is awaiting merge. |
| Tool correctness, exact order: diagnosis | ahead | compared against their docs or code | Ours names the call, its position and the argument that differs. DeepEval gives a score only. Before and after output is in a local harvest note outside the repository. | Not reproducible from the repository: the measurement is a local script outside it. |
| Task completion | ahead | measured head-to-head | No example recorded in the evidence. | Not reproducible from main yet: the test is awaiting merge. |
| G-Eval, strict (not separable from DAG) | equal | measured head-to-head | No example recorded in the evidence. | Not reproducible from main yet: the test is awaiting merge. |
| DAG, one judgement node (not separable from G-Eval) | equal | measured head-to-head | No example recorded in the evidence. | Not reproducible from main yet: the test is awaiting merge. |

## Not compared

- Real customer language: the sets are generated from templates, so the criteria were tested on known shapes only.
- DeepEval's default OpenAI judge model: its prompts ran on the claude command instead.
- DeepEval's thresholds: its own default of 0.5 was used.
- Repeat runs: each model gave a single sample per row.
