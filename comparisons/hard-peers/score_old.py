"""Today's judge on the EXISTING held-out sets the README charts show, paired with the competitor answers recorded then.

Competitor verdicts are read from the earlier recordings, unchanged: promptfoo recorded/heldout-<row>-peer
(goal: peer-full-state), Langfuse heldout-scores.json at its better threshold (0.5), DeepEval baseline-heldout.json.
The earlier shipped-judge counts are read from the same files. Descriptive: these items were not frozen for this test.
Run from the repository root: python3 comparisons/hard-peers/score_old.py
"""
import json
from pathlib import Path

from score import mcnemar_exact, wilson

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DEEPEVAL_METRICS = {'relevancy': ['turn relevancy', 'G-Eval strict', 'DAG'], 'role': ['role adherence'],
                    'completeness': ['conversation completeness'], 'task': ['task completion'],
                    'grounding': ['hallucination', 'faithfulness'], 'knowledge': ['knowledge retention']}


def today(competitor, row, mode):
    data = json.loads((HERE / f'results/old-{competitor}-{row}-{mode}.json').read_text())
    return {r['id']: (r['outcome'] if r['complete'] else None) for r in data['results']}


def recorded():
    """[(competitor, row label, set row, {id: truth}, {id: earlier shipped right}, {id: competitor right})]."""
    out = []
    for row in ['rubric', 'factuality', 'pii', 'goal']:
        load = lambda side: json.loads((ROOT / f'promptfoo/hard/recorded/heldout-{row}-{side}.json').read_text())['rows']
        ok = lambda r: r['outcome'] == ('pass' if r['truth'] else 'fail')
        peer = load('peer-full-state' if row == 'goal' else 'peer')
        out.append(('promptfoo', row, row, {r['id']: r['truth'] for r in peer},
                    {r['id']: ok(r) for r in load('shipped')}, {r['id']: ok(r) for r in peer}))
    lf = json.loads((ROOT / 'langfuse/hard/pr115-scores.json').read_text())
    tf = json.loads((ROOT / 'langfuse/hard/heldout-scores.json').read_text())['variants']['theirs']['rows']
    heldout_rows = [r for r in lf['rows'] if r['set'] == 'heldout-cases.json']
    out.append(('langfuse', 'correctness', 'correctness', {r['id']: r['label'] == 'pass' for r in tf},
                {r['id']: r['prediction'] == r['label'] for r in heldout_rows},
                {r['id']: r['at_half'] == r['label'] for r in tf}))
    de = json.loads((ROOT / 'deepeval/hard/baseline-heldout.json').read_text())['rows']
    for set_row, metrics in DEEPEVAL_METRICS.items():
        for metric in metrics:
            rows = [r for r in de if r['set'] == set_row and r['row'] == metric]
            out.append(('deepeval', metric, set_row, {r['id']: r['truth'] for r in rows},
                        {r['id']: r['ours']['prediction'] == r['truth'] for r in rows},
                        {r['id']: r['theirs']['prediction'] == r['truth'] for r in rows}))
    receipts = json.loads((ROOT / 'deepeval/hard/baseline-task-receipts-heldout.json').read_text())['rows']
    out.append(('deepeval', 'task completion (tool receipts, the README bar)', 'task-receipts',
                {r['id']: r['truth'] for r in receipts},
                {r['id']: r['ours']['prediction'] == r['truth'] for r in receipts},
                {r['id']: r['theirs']['prediction'] == r['truth'] for r in receipts}))
    # LangWatch: one unit per declared criterion; truth is pass, fail or inconclusive. "Earlier" is the PR 115
    # pinned default the comparison page reports; the competitor is its native Scenario judge.
    for row, fixture, stem in [('short', 'judges-entries-v2.json', 'adapter-v2'), ('long', 'longtrace-v2/hard.json', 'longtrace-v2')]:
        cases = json.loads((ROOT / f'langwatch/hard/{fixture}').read_text())
        truth = {f"{c['id']}#{i + 1}": t for c in cases for i, t in enumerate(c['truth'])}
        def recorded_right(variant):
            answers = json.loads((ROOT / f'langwatch/hard/recorded/{stem}-{variant}.json').read_text())['answers']
            return {f"{a['id']}#{i + 1}": pred == truth[f"{a['id']}#{i + 1}"] for a in answers for i, pred in enumerate(a['predictions'])}
        out.append(('langwatch', f'criterion labels, {row} cohort', row, truth, recorded_right('pr115'), recorded_right('theirs')))
    return out


def expected(label):
    return label if isinstance(label, str) else ('pass' if label else 'fail')


def main():
    table = []
    for competitor, label, set_row, truth, earlier, theirs in recorded():
        line = {'competitor': competitor, 'row': label, 'items': len(truth),
                'earlier_shipped_right': sum(earlier.get(i, False) for i in truth),
                'earlier_shipped_items': sum(i in earlier for i in truth),
                'competitor_right': sum(theirs[i] for i in truth)}
        for mode in ('default', 'audit'):
            v = today(competitor, set_row, mode)
            right = {i: v.get(i) == expected(truth[i]) for i in truth}
            done = [i for i in truth if v.get(i) is not None]
            b = sum(right[i] and not theirs[i] for i in done)
            c = sum(theirs[i] and not right[i] for i in done)
            line[mode] = {'right': sum(right[i] for i in done), 'complete': len(done),
                          'wilson95': wilson(sum(right[i] for i in done), len(done)),
                          'only_ours': b, 'only_theirs': c, 'mcnemar_exact_p': mcnemar_exact(b, c)}
        table.append(line)
    (HERE / 'old-report.json').write_text(json.dumps(table, indent=2) + '\n')
    for t in table:
        print(t['competitor'], t['row'], 'earlier', t['earlier_shipped_right'], 'theirs', t['competitor_right'],
              'default', t['default']['right'], '/', t['default']['complete'], 'audit', t['audit']['right'], '/', t['audit']['complete'])


if __name__ == '__main__':
    main()
