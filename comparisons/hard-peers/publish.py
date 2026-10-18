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
    sens = json.loads((HERE / 'sensitivity.json').read_text())
    lines += ['', '## What the result says', '',
              '- promptfoo: no measurable difference. The answer audit is right on 500 of 504 cases and the promptfoo defaults on 496; the pre-registered test does not separate them. The driftbench default ties at 496. Both sides are still near the ceiling on these classes with Claude Haiku 5.5.',
              '- Langfuse: no measurable difference, and the Correctness template is ahead in raw counts (123 against 118 for the answer audit and 122 for the default) when read at its better threshold, 0.5. At 1.0 the template scores 108.',
              '- DeepEval: the pre-registered test is decisive. The answer audit is right on 353 of 378 cases and the default metrics on 269. The gap comes from task completion (82 of 126) and conversation completeness (64 of 126); knowledge retention is close (123 of 126).',
              '- The opt-in answer audit is not uniformly better than the driftbench default: it is behind on Langfuse correctness (118 against 122) and DeepEval task completion (119 against 126), both on the long-one-wrong class.',
              '', '## Defects found in the frozen sets after the run', '',
              'Reading the misses after the results were in showed defects in the construction. The frozen sets and the pre-registered numbers above are left as they are. This section is post hoc.', '',
              '- **D1, a bug.** In DeepEval conversation completeness, the double-negation and long-one-wrong pairs kept the base user question while the replies answer a different one. The nine double-negation cases labelled pass leave two questions open, and the nine long-one-wrong cases labelled fail answer every question asked. Both driftbench modes judged these 18 cases against their labels and were right about the text.',
              '- **D2, ambiguous labels.** In DeepEval task completion, long-one-wrong, the user asks for "the references" and the reply labelled pass gives one. In Langfuse correctness, long-one-wrong, the reply labelled pass adds "I have checked the plan record for you", which a strict reader can call an unsupported assertion. The answer audit failed 7 and 8 of those pass cases for exactly these reasons.', '',
              'Pooled paired tests with those pairs removed (36 cases for D1; 72 for D1 and D2):', '',
              '| Exclusion | Competitor | driftbench mode | Paired cases | driftbench right | Competitor right | Only driftbench | Only competitor | Exact McNemar p |',
              '|---|---|---|---|---|---|---|---|---|']
    for name, label in [('without_D1', 'D1 removed'), ('without_D1_and_D2', 'D1 and D2 removed')]:
        for c, modes in sens[name].items():
            for mode, v in modes.items():
                lines.append(f"| {label} | {NAMES[c]} | {'answer audit' if mode == 'audit' else 'default'} | {v['paired_items']} | {v['ours_right']} | "
                             f"{v['theirs_right']} | {v['ours_only_right']} | {v['theirs_only_right']} | {p_text(v['mcnemar_exact_p'])} |")
    lines += ['', 'The conclusions do not change: decisive against DeepEval, no measurable difference against promptfoo and Langfuse.',
              '', '## Run', '',
              '- 3,610 answered calls on the frozen sets, 1.54 USD, concurrency 2, every case completed for every contestant. Four calls made before the freeze-gated run hit an account session limit, returned no answer at zero cost, and were sent again later.',
              '- For about ten minutes two DeepEval runner processes from an aborted launch ran beside the main runner, so up to four calls were in flight. Their answered calls are part of the recording; no answered call was sent twice.',
              '- The runner file changed twice after the first freeze commit and was refrozen each time, both before any answered call on these sets (commits `47917b194`, `2452e1001`).']
    lines += ['', '## Reproduce', '', 'See `comparisons/hard-peers/README.md`. `--replay` re-scores the recorded answers without a model call.', '']
    (REPO / 'docs/comparison/hard-peers-heldout.md').write_text('\n'.join(lines))


if __name__ == '__main__':
    main()
