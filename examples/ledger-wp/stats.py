"""Recording-only writing analysis. No network, provider calls or label edits."""
import collections
import json
import model_cells
import math
from pathlib import Path
import random

HERE = Path(__file__).resolve().parent

def wilson(k, n):
    if not n: return None
    z = 1.959963984540054
    p = k / n
    center = (p + z*z/(2*n)) / (1+z*z/n)
    half = z * math.sqrt(p*(1-p)/n+z*z/(4*n*n)) / (1+z*z/n)
    return [100*(center-half), 100*(center+half)]

def mcnemar(wins, losses):
    n = wins + losses
    return 1.0 if n == 0 else min(1.0, 2 * sum(math.comb(n, k) for k in range(min(wins, losses)+1)) / 2**n)

def cluster_interval(items, differences, draws=5000):
    strata = collections.defaultdict(lambda: collections.defaultdict(list))
    for item, difference in zip(items, differences, strict=True):
        strata[item['language']][item['requestId']].extend(difference)
    rng = random.Random('ledger-wp-cluster-2026-10-13')
    estimates = []
    for _ in range(draws):
        total = 0
        count = 0
        for groups in strata.values():
            clusters = list(groups.values())
            for sampled in rng.choices(clusters, k=len(clusters)):
                total += sum(sampled)
                count += len(sampled)
        estimates.append(100*total/count)
    estimates.sort()
    return [estimates[int(draws*.025)], estimates[min(draws-1, int(draws*.975))]] if estimates else None

def summarize(items, results, baseline=None):
    by_id = {r['id']: r for r in results}
    present = [x for x in items if x['id'] in by_id]
    correct = sum(g == item['label'] for item in present for g in by_id[item['id']]['games'])
    games = 2*len(present)
    result = {'pairs': len(present), 'games': games, 'correct': correct,
              'accuracy': 100*correct/games if games else None, 'wilson95': wilson(correct, games),
              'recipeUsd': sum(by_id[x['id']].get('costUsd', 0) for x in present),
              'graderErrors': sum(by_id[x['id']].get('graderErrors', 0) for x in present),
              'ties': sum(g == 'tie' for x in present for g in by_id[x['id']]['games'])}
    result['usdPer100Pairs'] = 100*result['recipeUsd']/len(present) if present else None
    result['usdPer100Games'] = 100*result['recipeUsd']/games if games else None
    if baseline is not None:
        peers = {r['id']: r for r in baseline}
        matched = [x for x in present if x['id'] in peers]
        wins = losses = 0
        differences = []
        for item in matched:
            delta = []
            for a, b in zip(by_id[item['id']]['games'], peers[item['id']]['games'], strict=True):
                d = int(a == item['label']) - int(b == item['label'])
                wins += d == 1
                losses += d == -1
                delta.append(d)
            differences.append(delta)
        result['comparison'] = {'matchedPairs': len(matched), 'wins': wins, 'losses': losses,
                                'deltaPoints': 100*(wins-losses)/(2*len(matched)) if matched else None,
                                'requestCluster95': cluster_interval(matched, differences) if matched else None,
                                'mcnemarTwoSided': mcnemar(wins, losses) if matched else None,
                                'holm18': None, 'holmStatus': 'pending full cross-benchmark family; reader-first excluded from primary family'}
    return result

def main():
    items = json.loads((HERE/'seals/test.json').read_text())
    results = []
    file = HERE/'results/decisions.jsonl'
    if file.exists(): results = [json.loads(x) for x in file.read_text().splitlines() if x]
    cells = []
    for model in model_cells.models():
        peer = [r for r in results if r['model'] == model and r['contestant'] == 'promptfoo' and r['split'] == 'test' and r.get('sample',0) == 0]
        for contestant in model_cells.contestants(model):
            rows = [r for r in results if r['model'] == model and r['contestant'] == contestant and r['split'] == 'test' and r.get('sample',0) == 0]
            cells.append({'model': model, 'contestant': contestant,
                          'status': 'complete' if len(rows) == len(items) else 'pending or partial',
                          **summarize(items, rows, peer if contestant != 'promptfoo' else None)})
    for contestant in ['longer-wins', 'constant-FIRST', 'refusal-wins']:
        rows = [r for r in results if r['contestant'] == contestant and r['split'] == 'test']
        cells.append({'model': 'machine', 'contestant': contestant, **summarize(items, rows)})
    report = {'unit': 'presentation game; ties and unparsed games wrong',
              'confidence': 'Wilson single-game rate; paired difference uses language-stratified request-cluster bootstrap',
              'testCaveat': 'Game McNemar is the requested nominal test; both orders and shared requests are dependent. Interpret alongside clustered intervals.',
              'cells': cells}
    (HERE/'results').mkdir(exist_ok=True)
    (HERE/'results/cells.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))

if __name__ == '__main__': main()
