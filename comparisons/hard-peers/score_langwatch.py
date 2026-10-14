"""Score the LangWatch amendment rows: per-row counts and the pre-registered pooled paired test.

LangWatch's verdict is the status its judge returns for the one declared criterion (passed, failed or
inconclusive), read from the structured output as the earlier harness reads it. driftbench verdicts are the
shipped parser's, recorded by run.mts. Same rules as score.py: an answered call with no usable verdict is wrong.
Run from the repository root: python3 comparisons/hard-peers/score_langwatch.py
"""
import json
import re
from pathlib import Path

from score import correct, mcnemar_exact, recordings, wilson

HERE = Path(__file__).resolve().parent
ROWS = ['task', 'knowledge', 'completeness']


def key_of(criterion):
    """comparisons/langwatch/hard/judges.mts keyOf."""
    return re.sub(r'[^a-z0-9]', '_', criterion.replace("'", '').lower())[:70]


def verdicts(row, contestant, calls):
    data = json.loads((HERE / f'results/langwatch-{row}-{contestant}.json').read_text())
    out = {}
    for r in data['results']:
        if not r.get('complete'):
            verdict = None
        elif contestant != 'theirs':
            verdict = r['outcome']
        else:
            call = calls[r['keys'][0]]
            value = call.get('structured')
            if value is None:
                try:
                    value = json.loads(call['text'])
                except ValueError:
                    value = {}
            status = ((value or {}).get('criteria') or {}).get(key_of(call['prompt']['criterion']), {}).get('status')
            verdict = {'passed': 'pass', 'failed': 'fail'}.get(status, 'inconclusive')
        out[r['id']] = (r['truth'], r['kind'], verdict)
    return out


def main():
    calls = recordings()
    table = {row: {m: verdicts(row, m, calls) for m in ('audit', 'default', 'theirs')} for row in ROWS}
    report = {'rows': {}}
    for row, v in table.items():
        ids = sorted(v['theirs'])
        report['rows'][row] = {'items': len(ids)}
        for name, entries in v.items():
            done = [i for i in ids if entries[i][2] is not None]
            right = sum(correct(entries[i]) for i in done)
            report['rows'][row][name] = {
                'complete': len(done), 'right': right, 'inconclusive': sum(entries[i][2] == 'inconclusive' for i in done),
                'wilson95': wilson(right, len(done)),
                'by_class': {k: sum(correct(entries[i]) for i in done if entries[i][1] == k) for k in sorted({entries[i][1] for i in ids})}}
    for ours, name in [('audit', 'primary'), ('default', 'secondary')]:
        b = c = n = right_ours = right_theirs = 0
        for v in table.values():
            for i, theirs in v['theirs'].items():
                if v[ours][i][2] is None or theirs[2] is None:
                    continue
                n += 1
                a, t = correct(v[ours][i]), correct(theirs)
                right_ours += a
                right_theirs += t
                b += a and not t
                c += t and not a
        report[name] = {'contestant': 'driftbench answer-audit (opt-in)' if ours == 'audit' else 'driftbench default',
                        'paired_items': n, 'ours_right': right_ours, 'theirs_right': right_theirs,
                        'ours_only_right': b, 'theirs_only_right': c, 'mcnemar_exact_p': mcnemar_exact(b, c)}
    (HERE / 'report-langwatch.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report['primary']), json.dumps(report['secondary']))
    for row, s in report['rows'].items():
        print('  ', row, {k: (s[k]['right'], s[k]['complete']) for k in ('audit', 'default', 'theirs')})


if __name__ == '__main__':
    main()
