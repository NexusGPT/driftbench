"""Recording-only MM statistics. No model calls and no outcome-dependent filtering."""
import argparse
from collections import defaultdict
import json
import math
from pathlib import Path
import random
from prepare import GROUPS, refuses


def game_score(decision, label):
    # Unavailable and grader errors are zero, not abstention credit.
    return 1.0 if decision == label else 0.5 if decision == 'tie' else 0.0


def item_score(row, label):
    games = row.get('games', [])
    if len(games) != 2:
        return 0.0
    return sum(game_score(g, label) for g in games) / 2


def macro(values):
    groups = defaultdict(list)
    for g, value in values:
        groups[g].append(value)
    if set(groups) != set(GROUPS):
        raise ValueError('All five subsets are required for the registered macro score')
    return sum(sum(groups[g]) / len(groups[g]) for g in GROUPS) / len(GROUPS)


def exact_sign(wins, losses):
    n = wins + losses
    return min(1.0, 2 * sum(math.comb(n, k) for k in range(min(wins, losses) + 1)) / 2 ** n) if n else 1.0


def bootstrap(values, iterations=20000, seed=20261013):
    groups = defaultdict(list)
    for g, value in values:
        groups[g].append(value)
    rng = random.Random(seed)
    draws = []
    for _ in range(iterations):
        means = []
        for g in GROUPS:
            xs = groups[g]
            means.append(sum(xs[rng.randrange(len(xs))] for _ in xs) / len(xs))
        draws.append(sum(means) / len(means))
    draws.sort()
    return [draws[int(iterations * .025)], draws[min(iterations - 1, int(iterations * .975))]]


def cheaters(pool):
    values = {key: [] for key in ['constant-first', 'longer-wins', 'refusal-wins']}
    for x in pool:
        longer = 'A' if len(x['a']) > len(x['b']) else 'B' if len(x['b']) > len(x['a']) else 'tie'
        a, b = refuses(x['a']), refuses(x['b'])
        refusal = 'A' if a and not b else 'B' if b and not a else 'tie'
        values['constant-first'].append((x['group'], .5))  # Always first in each of the two orders.
        values['longer-wins'].append((x['group'], game_score(longer, x['label'])))
        values['refusal-wins'].append((x['group'], game_score(refusal, x['label'])))
    return {key: macro(v) for key, v in values.items()}


def compare(pool, records, model, phase='test', iterations=20000):
    rec = {(r['id'], r['contestant']): r for r in records if r['model'] == model and r['phase'] == phase}
    # Complete matched items only form the inferential cohort. Missing coverage stays visible.
    paired = [x for x in pool if all((x['id'], c) in rec for c in ['ledger', 'promptfoo'])]
    if not paired or {x['group'] for x in paired} != set(GROUPS):
        return {'model': model, 'status': 'pending', 'matched': len(paired), 'planned': len(pool)}
    values, individual, by = [], [], {'ledger': [], 'promptfoo': []}
    for x in paired:
        scores = {c: item_score(rec[(x['id'], c)], x['label']) for c in by}
        for c in by:
            by[c].append((x['group'], scores[c]))
        diff = scores['ledger'] - scores['promptfoo']
        values.append((x['group'], diff))
        individual.append({'id': x['id'], 'group': x['group'], 'label': x['label'], **scores, 'difference': diff})
    wins, losses = sum(d > 0 for _, d in values), sum(d < 0 for _, d in values)
    return {'model': model, 'status': 'complete' if len(paired) == len(pool) else 'partial',
            'matched': len(paired), 'planned': len(pool), 'scores': {k: macro(v) for k, v in by.items()},
            'intervals': {k: bootstrap(v, iterations) for k, v in by.items()},
            'difference': macro(values), 'differenceInterval': bootstrap(values, iterations),
            'wins': wins, 'losses': losses, 'pTwoSided': exact_sign(wins, losses),
            'holmP': None, 'holmStatus': 'pending pooled 18-cell collation',
            'cheaters': cheaters(paired), 'items': individual,
            'graderErrors': {c: sum(bool(rec[(x['id'], c)].get('graderError')) for x in paired) for c in by}}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--pool', type=Path, default=Path(__file__).parent / 'artifacts/pool.json')
    ap.add_argument('--records', type=Path, required=True)
    ap.add_argument('--out', type=Path, required=True)
    args = ap.parse_args()
    pool = json.loads(args.pool.read_text())
    records = [json.loads(x) for x in args.records.read_text().splitlines() if x.strip()]
    report = {m: compare(pool, records, m) for m in ['haiku', 'gpt-6-luna', 'gemini-3.8-flash']}
    args.out.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({m: {k: v for k, v in r.items() if k != 'items'} for m, r in report.items()}, indent=2))


if __name__ == '__main__':
    main()
