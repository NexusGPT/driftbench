# DeepEval comparison

Measures driftbench's judged criteria and checks against DeepEval's metrics, on the same generated cases. Competitor: confident-ai/deepeval, Apache-2.0. Pinned package: `deepeval==4.2.8`.

Every number in a comparison entry comes from a file in this folder. Run every script from the repository root unless a row says otherwise. Model answers are recorded in `cassettes/`, so a rerun that replays them costs nothing.

## Setup

1. Dependencies: `pnpm install`.
2. A Python venv with the competitor: `python3 -m venv .venv-deepeval && .venv-deepeval/bin/pip install deepeval==4.2.8`.
3. The `claude` command on the path, signed in. Only needed to record new answers; replays need no command.

## Layout

| Folder | Holds |
|---|---|
| `datasets/` | the generated cases with their labels (seed 20261012; `knowledge2.json` seed 20261013, labels corrected by `judge/relabel_knowledge2.py`) |
| `gen/` | the generator |
| `judge/` | the renderer of our prompts, the runner with the cassette, the tally, the sonnet merge, and the label correction |
| `dag/` | DeepEval's DAG metric, with the claude command as its model |
| `tools/` | our tool checks and DeepEval's tool-correctness metric |
| `cassettes/` | recorded answers, keyed by a hash of model, system prompt and user prompt |
| `results/` | the outputs the tables quote |

## Rows and commands

Prompts are rendered from the shipped criteria, then the runner calls them. `SPEND_CAP_USD` stops a run before it passes the cap.

| Row | Set | Our side | Their side | Command |
|---|---|---|---|---|
| turn relevancy | relevancy | `examples/criteria/relevancy.yaml` | turn_relevancy template | `.venv-deepeval/bin/python comparisons/deepeval/judge/run.py haiku relevancy cassette` |
| G-Eval strict | relevancy | same | g_eval strict template | same run as above |
| DAG | relevancy | none | DAG, one node | `.venv-deepeval/bin/python comparisons/deepeval/dag/dag_run.py haiku` |
| role adherence | role | `examples/criteria/role.yaml` | role_adherence template | `... judge/run.py haiku role cassette` |
| conversation completeness | completeness | `examples/criteria/conversation_completeness.yaml` | intentions then verdicts | `... judge/run.py haiku completeness cassette` |
| task completion | task | `examples/criteria/task_completion.yaml` | goal extraction then verdict | `... judge/run.py haiku task cassette` |
| hallucination, faithfulness | hallucination | `examples/acme/criteria/no_invented_data.yaml` | hallucination and faithfulness templates | `... judge/run.py haiku hallucination cassette` |
| knowledge retention | knowledge | `examples/criteria/knowledge_retention.yaml` | knowledge_retention verdict | `... judge/run.py haiku knowledge cassette` |
| knowledge retention, hard | knowledge2 | same | same | `... judge/run.py haiku knowledge2 cassette` |
| tool calls | tools | `packages/checks` tools and forbidden | ToolCorrectnessMetric | `npx tsx comparisons/deepeval/tools/tools_ours.mts` and `.venv-deepeval/bin/python comparisons/deepeval/tools/tools_deepeval.py` |

Render our prompts first, once per change to a criterion: `npx tsx comparisons/deepeval/judge/render.mts`.

Run the rows for sonnet with `sonnet` in place of `haiku`. Replays are free; only new prompts cost. The cassette replays every row listed above for haiku. For sonnet, only `knowledge2` and both DAG runs are replayable, see the caveats.

## Tally

```
.venv-deepeval/bin/python comparisons/deepeval/judge/tally.py haiku comparisons/deepeval/results/haiku-cassette.json
python3 comparisons/deepeval/judge/merge_sonnet.py
.venv-deepeval/bin/python comparisons/deepeval/judge/tally.py sonnet comparisons/deepeval/results/sonnet-merged.json
```

The tally prints accuracy with 95% Wilson intervals, the cases each side alone gets right, and a paired exact McNemar p-value. An inconclusive or unparsed verdict counts as wrong. The tally reads `results/dag-MODEL.json` and the tool results.

## Labels

The labels are fixed by construction in `gen/gen.py`. Run `python3 comparisons/deepeval/gen/gen.py` and then `python3 comparisons/deepeval/judge/relabel_knowledge2.py`. The second step is required, because the generator writes the original `knowledge2` labels.

The `knowledge2` labels were corrected after the first run showed misses on both sides. I read the missed items first, and then wrote the rule in `judge/relabel_knowledge2.py` from the question wording alone. The rule is a fixed reading of the text, but the decision to relabel came after seeing the misses, so treat the corrected `knowledge2` numbers as post hoc. The rule: a reply is a re-ask when it names another email, asks for the full name, or asks a question about an email, inbox or mailbox. A question about a postal address is not a re-ask. The rule changed 16 labels: 8 full-name questions to forget, and 8 postal-address questions to keep. The original labels are in `datasets/knowledge2-original.json`.

Results on `knowledge2`, from the replayed answers (`results/haiku-cassette.json`, `results/sonnet-merged.json`):

| model | original labels, first recording | corrected labels, replay | reading |
|---|---|---|---|
| haiku | 90 vs 85, p=0.38 | 92 vs 87, p=0.38 | equal |
| sonnet | 88 vs 86, p=0.81 | 96 vs 87, p=0.049 | borderline; post hoc labels |

## Caveats

- Recording and replay: the first haiku recording called identical prompts more than once, and the judge answered some of them differently. The cassette keeps one answer per prompt, so the first run's rows and the replay differ on 39 of 700 rows. `results/haiku-first-recording.json` keeps the first run for reference. `results/haiku-cassette.json` is the replay output, and the haiku tally quotes that file. Replays are deterministic.

- Sonnet, six original sets: their answers were recorded before the cassette existed, in `results/sonnet-stored-100.json`. They cannot be replayed. The merged input labels each row's source. The haiku cassette covers every set.
- Template version: the haiku cassette was recorded with the installed `deepeval==4.2.8` templates. The first round used the git clone at commit 4598fe8, whose templates differ in wording. Numbers from the two rounds are not the same measurement, and results from the first round are not in this folder.
- The sets are generated from templates, so they test the criteria on known shapes, not on real customer language.
- Each item is judged once per model. Intervals are the only variance reported.
- Sample sizes are 100 per row, so a difference under about 10 points is inside the noise.
