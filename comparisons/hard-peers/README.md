# Harder held-out cases against promptfoo, Langfuse and DeepEval

The earlier hard sets put both sides near the ceiling, so they could not show a margin. This folder holds harder held-out sets and one runner for all three competitors. It scores the judge this checkout ships, loaded from `packages/judges/src`, with no pinned commit.

## Contestants

- **theirs**: each competitor's own default grader, unchanged. promptfoo's default llm-rubric, factuality and trajectory goal-success templates, rendered by the earlier harness's renderer. The Langfuse first-party Correctness template, version 1. DeepEval 4.2.8 metric classes with the earlier harness's model adapter.
- **default**: the driftbench judge a caller gets with no option set.
- **audit**: the opt-in driftbench answer audit (`assessment: { kind: 'answer-audit' }`).

All three use Claude Haiku 5.5, through the same lean `claude -p` call (the flags of `packages/judges/src/clients/claude-cli.ts`), with prompt caching disabled.

## Sets

`generate.py` builds eight rows of 126 fictional cases each: seven deviation classes, nine counterfactual pairs per class, one pass and one fail per pair. Labels come from the construction. `freeze.json` lists one sentence per class naming the agent failure it stands for, the row notes, the pre-registered endpoints and the hash of every set, prompt, judge source file and runner file. Both runners refuse to call a model when any of those files changed.

| Competitor | Rows |
|---|---|
| promptfoo | rubric, factuality, personal data, goal success |
| Langfuse | reference correctness |
| DeepEval | task completion, knowledge retention, conversation completeness |

## Reproduce

Run from the repository root:

```sh
python3 comparisons/hard-peers/generate.py
python3 comparisons/hard-peers/render_peers.py
python3 -m unittest discover -s comparisons/hard-peers -p test_hard_peers.py
pnpm exec tsx comparisons/hard-peers/run.mts promptfoo rubric:audit,rubric:default,rubric:theirs --replay
python3 comparisons/hard-peers/score.py
```

`--replay` reads only recorded answers under `calls/` and sends nothing. Without it, a run sends only the calls that have no recorded answer, at concurrency 2, after ten healthy network probes 30 seconds apart. Three consecutive calls without output pause the run for ten minutes and repeat the probe gate. The whole comparison shares one 25 USD cap. DeepEval runs with `deepeval==4.2.8` installed: `python comparisons/hard-peers/deepeval_run.py <row>`.

`calls/old-langwatch.jsonl` is above the leak guard's scan limit, so the repository holds it as two line-aligned parts in `calls/old-langwatch.jsonl.parts/`. Run `python3 comparisons/hard-peers/parts.py join` once to write the original file (it checks the size and sha256 in `parts-manifest.json`); the joined file is git-ignored.
