"""Score the default-on-v7 README run against the recorded peer answers, as fixed in PREREGISTRATION.json."""
import json, math, sys
from pathlib import Path

Z = 1.959963984540054


def wilson(right, n):
    """Wilson 95 percent interval in percent; the formula of tools/readme-charts.mjs."""
    p = right / n
    d = 1 + Z * Z / n
    c = (p + Z * Z / (2 * n)) / d
    h = Z * math.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n)) / d
    return [max(0.0, (c - h) * 100), min(100.0, (c + h) * 100)]


def exact_paired(b, c):
    """Exact two-sided binomial test on the discordant pairs (McNemar)."""
    n = b + c
    if n == 0:
        return 1.0
    k = min(b, c)
    tail = sum(math.comb(n, i) for i in range(k + 1)) / 2 ** n
    return min(1.0, 2 * tail)


def holm(ps):
    order = sorted(range(len(ps)), key=lambda i: ps[i])
    out, running = [0.0] * len(ps), 0.0
    for rank, i in enumerate(order):
        running = max(running, min(1.0, (len(ps) - rank) * ps[i]))
        out[i] = running
    return out


def standing_by_intervals(ours, theirs, n):
    a, b = wilson(ours, n), wilson(theirs, n)
    return 'lead' if a[0] > b[1] else 'deficit' if a[1] < b[0] else 'close'


manifest = json.loads(Path(sys.argv[1]).read_text())
results = [json.loads(l) for l in Path(sys.argv[2]).read_text().splitlines() if l.strip()]
frozen = sys.argv[3]
latest = {}
for r in results:
    if r.get('frozen') == frozen and r.get('variant') == 'new':
        latest[(r['dataset'], r['id'])] = r
FRESH = ('G-Eval strict', 'Knowledge retention')
rows, missing = [], []
for row in manifest['rows']:
    ids = sorted(row['peerCorrect'])
    v7, cost, verdicts = {}, 0.0, {}
    for i in ids:
        r = latest.get((row['dataset'], i))
        if r is None or r['status'] != 'returned':
            missing.append({'row': row['row'], 'id': i, 'status': None if r is None else r['status']})
            v7[i] = False
            continue
        v7[i] = r['prediction'] == r['gold']
        verdicts[i] = r['prediction']
        cost += (r.get('result') or {}).get('costUsd') or 0.0
    n = len(ids)
    ours, theirs, old = sum(v7.values()), sum(row['peerCorrect'].values()), sum(row['oldOursCorrect'].values())
    paired_ids = [i for i in ids if i in verdicts]
    b = sum(1 for i in paired_ids if v7[i] and not row['peerCorrect'][i])
    c = sum(1 for i in paired_ids if not v7[i] and row['peerCorrect'][i])
    bo = sum(1 for i in ids if v7[i] and not row['oldOursCorrect'][i])
    co = sum(1 for i in ids if not v7[i] and row['oldOursCorrect'][i])
    rows.append({'row': row['row'], 'lane': row['lane'], 'dataset': row['dataset'], 'n': n, 'v7': ours, 'peer': theirs,
                 'earlierJudge': old, 'v7Ci': wilson(ours, n), 'peerCi': wilson(theirs, n),
                 'returned': len(verdicts), 'v7OnlyRight': b, 'peerOnlyRight': c, 'pairedN': len(paired_ids),
                 'pairedP': exact_paired(b, c), 'v7VsEarlier': {'fixed': bo, 'broken': co, 'p': exact_paired(bo, co)},
                 'v7CostUsd': cost, 'v7UsdPer100': cost / max(1, len(verdicts)) * 100,
                 **({'setting': row['setting']} if row.get('setting') else {})})
fresh = [r for r in rows if r['row'] in FRESH]
for r, adj in zip(fresh, holm([r['pairedP'] for r in fresh])):
    r['pairedHolmP'] = adj
for r, adj in zip(rows, holm([r['pairedP'] for r in rows])):
    r['secondaryHolm18'] = adj
for r, adj in zip(rows, holm([r['v7VsEarlier']['p'] for r in rows])):
    r['v7VsEarlier']['holm18'] = adj
for r in rows:
    if r['row'] in FRESH:
        r['standing'] = ('lead' if r['v7'] > r['peer'] else 'deficit') if r['pairedHolmP'] <= 0.05 and r['v7'] != r['peer'] else 'close'
    else:
        r['standing'] = standing_by_intervals(r['v7'], r['peer'], r['n'])
out = {'frozen': frozen, 'rows': rows, 'notReturned': missing,
       'totalV7CostUsd': sum(r['v7CostUsd'] for r in rows if r['row'] != 'Model-graded fact')}
Path(sys.argv[4]).write_text(json.dumps(out, indent=1) + '\n')
for r in rows:
    print(f"{r['row']}: v7 {r['v7']}/{r['n']} (earlier {r['earlierJudge']}), peer {r['peer']}, {r['standing']}, paired p {r['pairedP']:.4g}")
