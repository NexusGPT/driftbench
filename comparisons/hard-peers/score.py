"""Score the frozen held-out run: per-row counts and the pre-registered pooled paired test per competitor.

Competitor answers are decoded by the earlier harnesses' own decoders, unchanged: promptfoo's `outcome`
(comparisons/promptfoo/hard/run.py) and Langfuse's `score` (comparisons/langfuse/hard/run.py). DeepEval's verdict
is its metric's own is_successful(). driftbench verdicts are the shipped parser's, recorded by run.mts.
Run from the repository root: python3 comparisons/hard-peers/score.py
"""
import importlib.util
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
ROWS = {'promptfoo': ['rubric', 'factuality', 'pii', 'goal'], 'langfuse': ['correctness'],
        'deepeval': ['task', 'knowledge', 'completeness']}


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def wilson(k, n):
    if not n:
        return [0.0, 0.0]
    z = 1.959963984540054
    p, d = k / n, 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [round(100 * max(0, c - h), 2), round(100 * min(1, c + h), 2)]


def mcnemar_exact(b, c):
    """Two-sided exact McNemar: binomial test of the discordant pairs at one half."""
    n = b + c
    if n == 0:
        return 1.0
    tail = sum(math.comb(n, j) for j in range(min(b, c) + 1)) / 2 ** n
    return min(1.0, 2 * tail)


def recordings():
    calls = {}
    for path in (HERE / 'calls').glob('*.jsonl'):
        if path.name.startswith('failures'):
            continue
        for line in path.read_text().splitlines():
            if line.strip():
                record = json.loads(line)
                calls[record['key']] = record
    return calls


def verdicts(competitor, row, contestant, calls, decoders, threshold=None):
    """{id: (truth, kind, verdict)}; verdict is pass, fail, inconclusive, or None when the case never completed."""
    path = HERE / f'results/{competitor}-{row}-{contestant}.json'
    data = json.loads(path.read_text())
    out = {}
    for r in data['results']:
        if not r.get('complete'):
            verdict = None
        elif contestant in ('default', 'audit'):
            verdict = r['outcome']
        elif competitor == 'deepeval':
            verdict = {True: 'pass', False: 'fail'}.get(r.get('prediction'), 'inconclusive')
        elif competitor == 'promptfoo':
            text = calls[r['keys'][0]]['text']
            verdict = decoders['promptfoo'].outcome(text, 'peer-full-state' if row == 'goal' else 'peer', row)
        else:
            text = calls[r['keys'][0]]['text']
            verdict = decoders['langfuse'].score('theirs', text, threshold)
            verdict = verdict if verdict in ('pass', 'fail') else 'inconclusive'
        out[r['id']] = (r['truth'], r['kind'], verdict)
    return out


def correct(entry):
    truth, _, verdict = entry
    return verdict == ('pass' if truth else 'fail')


def main():
    decoders = {'promptfoo': load(ROOT / 'promptfoo/hard/run.py', 'pf_run'),
                'langfuse': load(ROOT / 'langfuse/hard/run.py', 'lf_run')}
    calls = recordings()
    report = {'competitors': {}}
    for competitor, rows in ROWS.items():
        table = {}
        for row in rows:
            contestants = {m: verdicts(competitor, row, m, calls, decoders) for m in ('default', 'audit')}
            if competitor == 'langfuse':
                # Pre-registered: the template is scored at whichever of 1.0 and 0.5 gives it more correct cases.
                options = {t: verdicts(competitor, row, 'theirs', calls, decoders, t) for t in (1.0, 0.5)}
                best = max(options, key=lambda t: (sum(correct(e) for e in options[t].values() if e[2] is not None), t))
                contestants['theirs'] = options[best]
                table_extra = {'theirs_threshold': best,
                               'theirs_right_at': {str(t): sum(correct(e) for e in v.values() if e[2] is not None) for t, v in options.items()}}
            else:
                contestants['theirs'] = verdicts(competitor, row, 'theirs', calls, decoders)
                table_extra = {}
            ids = sorted(contestants['theirs'])
            row_out = {'items': len(ids), **table_extra}
            for name, v in contestants.items():
                done = [i for i in ids if v[i][2] is not None]
                right = sum(correct(v[i]) for i in done)
                row_out[name] = {'complete': len(done), 'right': right,
                                 'inconclusive': sum(v[i][2] == 'inconclusive' for i in done),
                                 'wilson95': wilson(right, len(done)),
                                 'by_class': {k: sum(correct(v[i]) for i in done if v[i][1] == k) for k in sorted({v[i][1] for i in ids})}}
            table[row] = {'summary': row_out, 'verdicts': contestants}
        pooled = {}
        for ours in ('audit', 'default'):
            b = c = n = 0
            for row in rows:
                v = table[row]['verdicts']
                for i in v['theirs']:
                    if v[ours][i][2] is None or v['theirs'][i][2] is None:
                        continue
                    n += 1
                    a, t = correct(v[ours][i]), correct(v['theirs'][i])
                    b += a and not t
                    c += t and not a
            right_ours = right_theirs = 0
            for row in rows:
                v = table[row]['verdicts']
                for i in v['theirs']:
                    if v[ours][i][2] is not None and v['theirs'][i][2] is not None:
                        right_ours += correct(v[ours][i])
                        right_theirs += correct(v['theirs'][i])
            pooled[ours] = {'paired_items': n, 'ours_right': right_ours, 'theirs_right': right_theirs,
                            'ours_only_right': b, 'theirs_only_right': c, 'mcnemar_exact_p': mcnemar_exact(b, c)}
        report['competitors'][competitor] = {
            'primary': {'contestant': 'driftbench answer-audit (opt-in)', **pooled['audit']},
            'secondary': {'contestant': 'driftbench default', **pooled['default']},
            'rows': {row: table[row]['summary'] for row in rows},
        }
    (HERE / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    for competitor, data in report['competitors'].items():
        print(competitor, json.dumps(data['primary']), json.dumps(data['secondary']))
        for row, s in data['rows'].items():
            print('  ', row, {k: (s[k]['right'], s[k]['complete']) for k in ('audit', 'default', 'theirs')})


if __name__ == '__main__':
    main()
