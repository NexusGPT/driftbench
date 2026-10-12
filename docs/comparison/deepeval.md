# DeepEval: comparison

DeepEval (confident-ai/deepeval) is a Python library that scores LLM replies with judge-model metrics. This page reads its source at commit 4598fe8. The rows were measured on generated cases with a fixed seed (20261012).

Results come from the comparison table. Limit means a row is not being worked, with its reason stated.

| Capability | Result | Basis | Example | Reproduce |
|---|---|---|---|---|
| Turn relevancy, judged | ahead | measured head-to-head | Two-part relevancy figures: haiku 97 vs 51, sonnet 96 vs 51, confirmed on a held-out set. | see comparisons/deepeval/README.md: `.venv-deepeval/bin/python comparisons/deepeval/judge/run.py haiku relevancy cassette` |
| Turn relevancy, key-term floor | limit | compared against their docs or code. Limit: DeepEval has no comparator here (judge only), and a project rule decides it: advisory with a judge, gating without one. | No example recorded in the evidence. | packages/checks/test/relevancy.test.ts |
| Knowledge retention, judged | equal | measured head-to-head | No example recorded in the evidence. | see comparisons/deepeval/README.md: `.venv-deepeval/bin/python comparisons/deepeval/judge/run.py haiku knowledge cassette` |
| Knowledge retention, ask check | limit | compared against their docs or code. Limit: DeepEval has no comparator here (judge only), and a project rule decides it: advisory with a judge, gating without one. | No example recorded in the evidence. | packages/checks/test/knowledge_retention.test.ts |
| Conversation completeness | ahead | measured head-to-head | No example recorded in the evidence. | see comparisons/deepeval/README.md: `.venv-deepeval/bin/python comparisons/deepeval/judge/run.py haiku completeness cassette` |
| Role adherence | ahead | measured head-to-head | No example recorded in the evidence. | see comparisons/deepeval/README.md: `.venv-deepeval/bin/python comparisons/deepeval/judge/run.py haiku role cassette` |
| Hallucination | ahead | measured head-to-head | No example recorded in the evidence. | see comparisons/deepeval/README.md: `.venv-deepeval/bin/python comparisons/deepeval/judge/run.py haiku hallucination cassette` |
| Faithfulness | ahead | measured head-to-head | No example recorded in the evidence. | see comparisons/deepeval/README.md: `.venv-deepeval/bin/python comparisons/deepeval/judge/run.py haiku hallucination cassette` (same run as hallucination) |
| Tool correctness, default | ahead | measured head-to-head | No example recorded in the evidence. | see comparisons/deepeval/README.md: `npx tsx comparisons/deepeval/tools/tools_ours.mts` and `.venv-deepeval/bin/python comparisons/deepeval/tools/tools_deepeval.py` |
| Tool correctness, exact order: accuracy | equal | measured head-to-head | No example recorded in the evidence. | see comparisons/deepeval/README.md: `npx tsx comparisons/deepeval/tools/tools_ours.mts` and `.venv-deepeval/bin/python comparisons/deepeval/tools/tools_deepeval.py` |
| Tool correctness, exact order: diagnosis | ahead | compared against their docs or code | Ours names the call, its position and the argument that differs. DeepEval gives a score only. | Not reproducible from the repository: the measurement is a local script outside it. |
| Task completion | ahead | measured head-to-head | No example recorded in the evidence. | see comparisons/deepeval/README.md: `.venv-deepeval/bin/python comparisons/deepeval/judge/run.py haiku task cassette` |
| G-Eval, strict (equal, not separable from DAG) | equal | measured head-to-head | No example recorded in the evidence. | see comparisons/deepeval/README.md: `.venv-deepeval/bin/python comparisons/deepeval/judge/run.py haiku relevancy cassette` (same run as turn relevancy) |
| DAG, one judgement node (equal, not separable from G-Eval) | equal | measured head-to-head | No example recorded in the evidence. | see comparisons/deepeval/README.md: `.venv-deepeval/bin/python comparisons/deepeval/dag/dag_run.py haiku` |

## Not compared

- Real customer language: the sets are generated from templates, so the criteria were tested on known shapes only.
- DeepEval's default OpenAI judge model: its prompts ran on the claude command instead.
- DeepEval's thresholds: its own default of 0.5 was used.
- Repeat runs: each model gave a single sample per row.
