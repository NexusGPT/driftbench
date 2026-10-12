# DeepEval: comparison

DeepEval (confident-ai/deepeval) is a Python library that scores LLM replies with judge-model metrics. This page reads its source at commit 4598fe8. The rows were measured on generated cases with a fixed seed (20261012).

Results come from the comparison table. Limit means a row is not being worked, with its reason stated.

| Capability | Result | Basis | Example | Reproduce |
|---|---|---|---|---|
| Turn relevancy, judged | ahead | measured head-to-head | Two-part relevancy figures: haiku 97 vs 51, sonnet 96 vs 51, confirmed on a held-out set. | comparisons/deepeval/README.md. Not reproducible from main yet: the test is awaiting merge. |
| Turn relevancy, key-term floor | limit | compared against their docs or code. Limit: DeepEval has no comparator here (judge only), and the project rule is advisory with a judge and gating without one. | No example recorded in the evidence. | Not reproducible from main yet: the test is awaiting merge. |
| Knowledge retention, judged | equal | measured head-to-head | No example recorded in the evidence. | Not reproducible from main yet: the test is awaiting merge. |
| Knowledge retention, ask check | limit | compared against their docs or code. Limit: DeepEval has no comparator here (judge only), and the project rule is advisory with a judge and gating without one. | No example recorded in the evidence. | Not reproducible from main yet: the test is awaiting merge. |
| Conversation completeness | ahead | measured head-to-head | No example recorded in the evidence. | Not reproducible from main yet: the test is awaiting merge. |
| Role adherence | ahead | measured head-to-head | No example recorded in the evidence. | Not reproducible from main yet: the test is awaiting merge. |
| Hallucination | ahead | measured head-to-head | No example recorded in the evidence. | Not reproducible from main yet: the test is awaiting merge. |
| Faithfulness | ahead | measured head-to-head | No example recorded in the evidence. | Not reproducible from main yet: the test is awaiting merge. |
| Tool correctness, default | ahead | measured head-to-head | No example recorded in the evidence. | Not reproducible from main yet: the test is awaiting merge. |
| Tool correctness, exact order: accuracy | equal | measured head-to-head | Equal on verdicts: 100% vs 100% on both models. | Not reproducible from main yet: the test is awaiting merge. |
| Tool correctness, exact order: diagnosis | ahead | compared against their docs or code | Ours names the call, its position and the argument that differs. DeepEval gives a score only. | Not reproducible from the repository: the measurement is a local script outside it. |
| Task completion | ahead | measured head-to-head | No example recorded in the evidence. | Not reproducible from main yet: the test is awaiting merge. |
| G-Eval, strict | equal | measured head-to-head | G-Eval and DAG are equal and not separable on this set. | Not reproducible from main yet: the test is awaiting merge. |
| DAG, one judgement node | equal | measured head-to-head | G-Eval and DAG are equal and not separable on this set. Both are at ceiling on sonnet, so the set shows no headroom. | Not reproducible from main yet: the test is awaiting merge. |

## Not compared

- Real customer language: the sets are generated from templates, so the criteria were tested on known shapes only.
- DeepEval's default OpenAI judge model: its prompts ran on the claude command instead.
- Repeat runs: each model gave a single sample per row.
