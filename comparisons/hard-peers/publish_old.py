"""Write docs/comparison/hard-peers-existing-sets.md and docs/comparison/hard-peers-langwatch.md. Formatting only."""
import glob
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
N = {'promptfoo': 'promptfoo', 'langfuse': 'Langfuse', 'deepeval': 'DeepEval 4.2.8', 'langwatch': 'LangWatch'}


def p_text(p):
    return f'{p:.2g}' if p >= 0.001 else f'{p:.1e}'


def cost(pattern):
    return sum(json.loads(line)['costUsd'] for f in glob.glob(str(HERE / 'calls' / pattern)) for line in open(f))


def calls(pattern):
    return sum(1 for f in glob.glob(str(HERE / 'calls' / pattern)) for _ in open(f))


def existing():
    t = json.loads((HERE / 'old-report.json').read_text())
    L = ["# Today's judge on the existing held-out sets", '',
         'The README hard-case charts and the LangWatch page were measured with judge source pinned at older commits '
         '(promptfoo `c07c705cb`, Langfuse and LangWatch PR 115 `8195902dd`, DeepEval prompts rendered before the latest '
         'judge changes). This page scores the judge in `packages/judges/src` at this branch, with no pinned commit, on the '
         "same held-out items. Each request is wired as the earlier harness wired it; only the judge source is today's. The "
         'competitor answers are the ones recorded then, unchanged. No reported number here passes through '
         "`comparisons/promptfoo/hard/decoder-parity.mts` (pinned at `c07c705cb`): promptfoo answers are decoded by "
         "`comparisons/promptfoo/hard/run.py`, and driftbench answers by today's `parseJudgeText`.", '',
         'Same model on every side: Claude Haiku 5.5 through `claude -p`, prompt caching disabled for the new calls. These '
         'items were not frozen for this test, so the paired p values are descriptive.', '',
         '| Competitor | Row | Units | Earlier pinned judge | Competitor default | Today default | Today answer audit (opt-in) | Audit vs competitor: only audit / only competitor, exact McNemar p | Default vs competitor: only default / only competitor, p |',
         '|---|---|---|---|---|---|---|---|---|']
    for x in t:
        a, d = x['audit'], x['default']
        L.append(f"| {N[x['competitor']]} | {x['row']} | {x['items']} | {x['earlier_shipped_right']} | {x['competitor_right']} | "
                 f"{d['right']} | {a['right']} | {a['only_ours']} / {a['only_theirs']}, p {p_text(a['mcnemar_exact_p'])} | "
                 f"{d['only_ours']} / {d['only_theirs']}, p {p_text(d['mcnemar_exact_p'])} |")
    L += ['', '## Notes', '',
          "- Today's default is below the earlier pinned judge on promptfoo goal success (64 against 72, 4 inconclusive) and "
          'LLM rubric (68 against 71, 4 inconclusive). The answer audit recovers the rubric row (72) and part of goal success (69).',
          '- Langfuse: the competitor is read at its better threshold, 0.5 (115); at the pre-registered 1.0 it scores 83.',
          '- DeepEval task completion has two recordings. The README bar (72 against 72) is the tool-receipt run '
          '(`baseline-task-receipts-heldout.json`, the row marked "tool receipts, the README bar"). The conversation-evidence '
          'run (`baseline-heldout.json`) has DeepEval at 44 of 72. Both are shown.',
          '- DeepEval G-Eval strict and DAG share the relevancy items; hallucination and faithfulness share the grounding items. '
          'Our judge is asked once per item, so it has one count per set.',
          '- LangWatch: one unit per declared criterion, 120 cases with two criteria each per cohort. Labels are pass, fail or '
          'inconclusive. "Earlier pinned judge" is the PR 115 default at `8195902dd`, the driftbench row the LangWatch page '
          "reports; the competitor is LangWatch's native Scenario judge as recorded then. The earlier harness decoded our "
          "default with the old binary `parseAnswerText`; today's rerun uses the shipped `parseJudgeText`.",
          '- On the LangWatch cohorts the answer audit is well below the default (227 and 186 of 240): it marks "inconclusive" '
          'criteria as failed (13 short, 27 long) and fails or withholds 27 long-cohort passes. The answer audit has no way to '
          'return "the deciding evidence is absent" except an unknown check, and these criteria ask for that verdict.',
          f"- Cost of the rerun: {cost('old-*.jsonl'):.2f} USD for {calls('old-*.jsonl'):,} answered calls (both driftbench modes).", '',
          'Reproduce: `pnpm exec tsx comparisons/hard-peers/run.mts <competitor> <row>:default,<row>:audit --old --replay`, '
          'then `python3 comparisons/hard-peers/score_old.py`.', '']
    (REPO / 'docs/comparison/hard-peers-existing-sets.md').write_text('\n'.join(L))


def langwatch():
    r = json.loads((HERE / 'report-langwatch.json').read_text())
    freeze = json.loads((HERE / 'freeze.json').read_text())['amendment_langwatch']
    names = {'task': 'Task completion', 'knowledge': 'Knowledge retention', 'completeness': 'Conversation completeness'}
    L = ['# Harder held-out cases: LangWatch', '',
         "Added after the promptfoo, Langfuse and DeepEval run, by a freeze amendment in `comparisons/hard-peers/freeze.json` "
         f"({freeze['frozen_at']}), committed before any LangWatch call. Same model on every side: Claude Haiku 5.5 through the "
         'same lean `claude -p` call, prompt caching disabled.', '',
         f"- **Rows.** {freeze['rows']}",
         f"- **Competitor.** {freeze['competitor']}",
         f"- **Disclosure.** {freeze['disclosure']}", '',
         '## Pre-registered primary endpoint', '',
         'Pooled over the three rows, paired by case, driftbench answer audit against the LangWatch default judge. Exact '
         'two-sided McNemar test. An answered call with no usable verdict counts as wrong.', '',
         '| Contestant | Paired cases | driftbench right | LangWatch right | Only driftbench | Only LangWatch | Exact McNemar p |',
         '|---|---|---|---|---|---|---|']
    for key, label in [('primary', 'driftbench answer audit (primary)'), ('secondary', 'driftbench default (secondary)')]:
        v = r[key]
        L.append(f"| {label} | {v['paired_items']} | {v['ours_right']} | {v['theirs_right']} | {v['ours_only_right']} | "
                 f"{v['theirs_only_right']} | {p_text(v['mcnemar_exact_p'])} |")
    L += ['', '## Per row', '', '| Row | driftbench answer audit | driftbench default | LangWatch default |', '|---|---|---|---|']
    for row, s in r['rows'].items():
        cell = lambda k: f"{s[k]['right']}/{s[k]['complete']} ({s[k]['wilson95'][0]} to {s[k]['wilson95'][1]})"
        L.append(f"| {names[row]} | {cell('audit')} | {cell('default')} | {cell('theirs')} |")
    L += ['', '## Per class', '']
    for row, s in r['rows'].items():
        L += [f'### {names[row]}', '', '| Class | Audit | Default | LangWatch |', '|---|---|---|---|']
        for k in s['theirs']['by_class']:
            L.append(f"| {k} | {s['audit']['by_class'][k]} | {s['default']['by_class'][k]} | {s['theirs']['by_class'][k]} |")
        L.append('')
    L += ['## What the result says', '',
          '- The pre-registered test is significant: the answer audit is right on every case and LangWatch on 358 of 378. '
          'All 20 LangWatch misses are on task completion, and all are "inconclusive" answers on two classes: an instruction '
          'to the grader inside the reply (9 of 18 right) and a long reply hiding one wrong value (10 of 18 right).',
          '- Knowledge retention and conversation completeness tie at or near the ceiling.',
          f"- Cost: {cost('langwatch.jsonl'):.2f} USD for {calls('langwatch.jsonl'):,} answered calls; every case completed.", '',
          'Reproduce: `python3 comparisons/hard-peers/generate_langwatch.py`, `pnpm exec tsx comparisons/hard-peers/render_langwatch.mts`, '
          '`pnpm exec tsx comparisons/hard-peers/run.mts langwatch task:theirs,task:default,task:audit --replay`, then '
          '`python3 comparisons/hard-peers/score_langwatch.py`.', '']
    (REPO / 'docs/comparison/hard-peers-langwatch.md').write_text('\n'.join(L))


if __name__ == '__main__':
    existing()
    langwatch()
