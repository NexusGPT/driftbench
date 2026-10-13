"""Write docs/comparison/hard-peers-heldout.md from report.json. Formatting only; score.py does the analysis."""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
NAMES = {'promptfoo': 'promptfoo', 'langfuse': 'Langfuse', 'deepeval': 'DeepEval 4.2.8'}
ROW_NAMES = {'rubric': 'LLM rubric', 'factuality': 'Factuality', 'pii': 'Personal data', 'goal': 'Goal success',
             'correctness': 'Reference correctness', 'task': 'Task completion', 'knowledge': 'Knowledge retention',
             'completeness': 'Conversation completeness'}


def p_text(p):
    return f'{p:.2g}' if p >= 0.001 else f'{p:.1e}'


def main():
    report = json.loads((HERE / 'report.json').read_text())
    freeze = json.loads((HERE / 'freeze.json').read_text())
    lines = ['# Harder held-out cases: promptfoo, Langfuse and DeepEval', '',
             'Every side uses Claude Haiku 5.5 through the same lean `claude -p` call, with prompt caching disabled. '
             'Each competitor runs its own default grader, unchanged. driftbench runs the judge in `packages/judges/src` '
             'at this commit, with no pinned commit, as two contestants: the default judge and the opt-in answer audit.', '',
             f"The sets, prompts, judge source, runners and analysis were frozen in `comparisons/hard-peers/freeze.json` "
             f"({freeze['frozen_at']}) before any model call on these sets. Each row has 126 fictional cases: seven deviation "
             'classes, nine counterfactual pairs per class, one pass and one fail per pair.', '',
             '## Pre-registered primary endpoint', '',
             'Per competitor: all its rows pooled, paired by case, driftbench answer audit against the competitor default. '
             'Exact two-sided McNemar test on the discordant pairs. An answered call with no usable verdict counts as wrong.', '',
             '| Competitor | Paired cases | driftbench answer audit right | Competitor default right | Only audit right | Only competitor right | Exact McNemar p |',
             '|---|---|---|---|---|---|---|']
    for c, data in report['competitors'].items():
        a = data['primary']
        lines.append(f"| {NAMES[c]} | {a['paired_items']} | {a['ours_right']} | {a['theirs_right']} | {a['ours_only_right']} | "
                     f"{a['theirs_only_right']} | {p_text(a['mcnemar_exact_p'])} |")
    lines += ['', '## Secondary: driftbench default judge against each competitor default', '',
              '| Competitor | Paired cases | driftbench default right | Competitor default right | Only driftbench right | Only competitor right | Exact McNemar p |',
              '|---|---|---|---|---|---|---|']
    for c, data in report['competitors'].items():
        a = data['secondary']
        lines.append(f"| {NAMES[c]} | {a['paired_items']} | {a['ours_right']} | {a['theirs_right']} | {a['ours_only_right']} | "
                     f"{a['theirs_only_right']} | {p_text(a['mcnemar_exact_p'])} |")
    lines += ['', '## Per row', '', 'Right answers out of completed cases, with Wilson 95 percent intervals in percent.', '',
              '| Competitor | Row | driftbench answer audit | driftbench default | Competitor default |', '|---|---|---|---|---|']
    for c, data in report['competitors'].items():
        for row, s in data['rows'].items():
            cell = lambda k: f"{s[k]['right']}/{s[k]['complete']} ({s[k]['wilson95'][0]} to {s[k]['wilson95'][1]})"
            note = f" (threshold {s['theirs_threshold']})" if 'theirs_threshold' in s else ''
            lines.append(f"| {NAMES[c]} | {ROW_NAMES[row]} | {cell('audit')} | {cell('default')} | {cell('theirs')}{note} |")
    lines += ['', '## Per class', '', 'Right answers out of 18 cases per class (fewer when a case never completed).', '']
    for c, data in report['competitors'].items():
        for row, s in data['rows'].items():
            lines += [f"### {NAMES[c]}: {ROW_NAMES[row]}", '', '| Class | Audit | Default | Competitor |', '|---|---|---|---|']
            for k in s['theirs']['by_class']:
                lines.append(f"| {k} | {s['audit']['by_class'][k]} | {s['default']['by_class'][k]} | {s['theirs']['by_class'][k]} |")
            lines.append('')
    lines += ['## Deviation classes', '', 'Each class stands for a real agent failure mode:', '']
    lines += [f'- **{k}**: {v}' for k, v in freeze['classes'].items()]
    lines += ['', '## Rows', '']
    lines += [f'- **{k}**: {v}' for k, v in freeze['rows'].items()]
    if 'run' in report:
        lines += ['', '## Run', '', *report['run']]
    lines += ['', '## Reproduce', '', 'See `comparisons/hard-peers/README.md`. `--replay` re-scores the recorded answers without a model call.', '']
    (REPO / 'docs/comparison/hard-peers-heldout.md').write_text('\n'.join(lines))


if __name__ == '__main__':
    main()
