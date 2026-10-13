"""Offline paired census comparison. Never calls or changes a judge."""
import json
import math
from datetime import datetime, timezone
from fractions import Fraction
from pathlib import Path

ROOT = Path(__file__).resolve().parent
load = lambda name: json.loads((ROOT / name).read_text())

def correct(result):
    label = result['item']['label']
    opposite = 'B' if label == 'A' else 'A'
    return sum(1 if g == label else -1 if g == opposite else 0
               for g in result['games']) > 0

def exact(b, c):
    n = b + c
    return min(Fraction(1), Fraction(2 * sum(math.comb(n, i)
                                           for i in range(min(b, c) + 1)), 2 ** n))

assert exact(0, 0) == 1 and exact(10, 0) == Fraction(2, 1024)
assert exact(5, 5) == 1 and exact(3, 8) == exact(8, 3)
peers = load('test-peer-replay.json')
tonight = load('final-test.json')
decisions = load('final-test-decisions.json')
audit = load('test-label-audit.json')
excluded = {x['id'] for x in audit['excluded']}
all_decisions = {**peers['decisions'], **decisions}
scores = {}
for run in peers['runs'] + [tonight]:
    for c in run['contestants']:
        rs = all_decisions[c['contestant']]
        by_id = {r['item']['id']: r for r in rs}
        assert len(by_id) == len(rs) == 229
        k = sum(map(correct, rs))
        assert abs(k / 229 - c['summary']['value']['estimate']) < 1e-12
        retained = [r for r in rs if r['item']['id'] not in excluded]
        scores[c['contestant']] = {
            'correct': k, 'n': 229, 'percent': k / 229 * 100,
            'cost100': c['costUsd'] / 229 * 100,
            'missingGames': sum(r['missing'] for r in rs),
            'completePairs': sum(r['missing'] == 0 for r in rs),
            'auditedCorrect': sum(map(correct, retained)), 'auditedN': len(retained),
            'auditedPercent': sum(map(correct, retained)) / len(retained) * 100,
        }
ranked = [s for key, s in scores.items() if key != 'driftbench-reference3-format']
for key, score in scores.items():
    score['rank'] = 1 + sum(s['correct'] > score['correct'] for s in ranked)

comparisons = []
for ours in tonight['contestants']:
    our_id = ours['contestant']
    a = {r['item']['id']: r for r in decisions[our_id]}
    rows = []
    for peer_id, peer_rs in peers['decisions'].items():
        b = {r['item']['id']: r for r in peer_rs}
        assert a.keys() == b.keys()
        assert all(a[i]['item'] == b[i]['item'] for i in a)
        wins = sum(correct(a[i]) and not correct(b[i]) for i in a)
        losses = sum(correct(b[i]) and not correct(a[i]) for i in a)
        assert wins - losses == scores[our_id]['correct'] - scores[peer_id]['correct']
        shared = [i for i in a if a[i]['missing'] == b[i]['missing'] == 0]
        sw = sum(correct(a[i]) and not correct(b[i]) for i in shared)
        sl = sum(correct(b[i]) and not correct(a[i]) for i in shared)
        p = exact(wins, losses)
        rows.append({'ours': our_id, 'peer': peer_id, 'n': 229,
                     'oursOnlyCorrect': wins, 'peerOnlyCorrect': losses,
                     'differencePercentagePoints': (wins - losses) / 229 * 100,
                     'exactTwoSidedP': float(p), 'exactP': str(p),
                     'sharedComplete': {'n': len(shared),
                        'oursCorrect': sum(correct(a[i]) for i in shared),
                        'peerCorrect': sum(correct(b[i]) for i in shared),
                        'oursOnlyCorrect': sw, 'peerOnlyCorrect': sl,
                        'differencePercentagePoints': (sw - sl) / len(shared) * 100,
                        'exactTwoSidedP': float(exact(sw, sl))}})
    # Holm family correction for six comparisons to this fixed configuration.
    ordered = sorted(rows, key=lambda r: r['exactTwoSidedP'])
    running = 0
    for index, row in enumerate(ordered):
        running = max(running, min(1, (len(rows) - index) * row['exactTwoSidedP']))
        row['holmAdjustedP'] = running
    comparisons.extend(rows)

result = {'stamp': datetime.now(timezone.utc).isoformat(),
          'method': 'Exact two-sided McNemar conditional binomial test on discordant pair correctness. Full 229-pair metric counts missing answers as incorrect. Shared-complete comparison excludes missing pairs. Holm adjustment is separate for each six-peer family.',
          'sources': ['final-test.json', 'final-test-decisions.json', 'test-peer-replay.json'],
          'scores': scores, 'comparisons': comparisons,
          'rankPopulation': 'Seven methods: six census peers plus frozen reference3. Format parsing is a tied ablation, not an extra method in the rank denominator.',
          'sameDecisionsWithFormat': decisions['driftbench-reference3'] == decisions['driftbench-reference3-format']}
(ROOT / 'test-paired-comparison.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
