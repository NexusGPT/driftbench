"""Sealed TEST cell report from recordings only. No model calls.

Missing items (no model answer after the transport retries) are reported separately and are
excluded from the paired cohort. They never count as a loss. The registered all-in score, where
a missing game scores zero, is kept beside it for transparency.
"""
from collections import Counter, defaultdict
import json
from pathlib import Path
from stats import compare
from prepare import GROUPS

HERE = Path(__file__).parent
MODELS = ['haiku', 'gpt-6-luna', 'gemini-3.8-flash']
CONTESTANTS = ['ledger', 'promptfoo']


def lines(path):
    return [json.loads(x) for x in path.read_text().splitlines() if x.strip()] if path.exists() else []


def strip(cell):
    return {k: v for k, v in cell.items() if k != 'items'}


def report(iterations=20000):
    pool = json.loads((HERE / 'artifacts/pool.json').read_text())
    last = {}
    for r in lines(HERE / 'recordings/decisions.jsonl'):
        if r['phase'] == 'test':
            last[(r['model'], r['id'], r['contestant'])] = r  # a later eligibility round supersedes a no-answer row
    decisions = list(last.values())
    calls = [r for r in lines(HERE / 'recordings/calls.jsonl') if r['phase'] == 'test']
    attempts = [r for r in lines(HERE / 'recordings/attempts.jsonl') if r['phase'] == 'test']
    spend = {}
    for r in lines(HERE / 'recordings/spend.jsonl'):
        spend[r['key']] = r
    test_spend = [r for r in spend.values() if r.get('phase') == 'test']
    out = {'planned': len(pool), 'models': {},
           'spend': {'knownUsd': sum(r.get('usd', 0) for r in test_spend),
                     'retainedReserveUsd': sum(r['reserve'] for r in test_spend if 'usd' not in r),
                     'laneTotalUsdIncludingDevAndReserves': sum(r.get('usd', r['reserve']) for r in spend.values()),
                     'capUsd': 20}}
    for model in MODELS:
        rows = [r for r in decisions if r['model'] == model]
        if not rows:
            out['models'][model] = {'status': 'not run'}
            continue
        missing = defaultdict(dict)
        for r in rows:
            if r.get('error'):
                missing[r['id']][r['contestant']] = r['error']
        recorded = {(r['id'], r['contestant']) for r in rows}
        unrecorded = [x['id'] for x in pool if any((x['id'], c) not in recorded for c in CONTESTANTS)]
        cohort = [x for x in pool if x['id'] not in missing and x['id'] not in unrecorded]
        primary = compare(cohort, rows, model, iterations=iterations)
        all_in = compare(pool, rows, model, iterations=iterations)
        losses_by_group = Counter(i['group'] for i in primary.get('items', []) if i['difference'] < 0)
        wins_by_group = Counter(i['group'] for i in primary.get('items', []) if i['difference'] > 0)
        mcalls = [c for c in calls if c['model'] == model]
        mattempts = [a for a in attempts if a['model'] == model]
        ok_keys = {c['key'] for c in mcalls if not c.get('error')}
        stage0_exhausted = Counter(c['stage'] for c in mcalls if c.get('transportExhausted') and c['stage'] in ('harm', 'compute'))
        cost = {}
        for c in CONTESTANTS:
            known = sum(r.get('usd', 0) for r in test_spend if r.get('model') == model and r.get('contestant') == c)
            retained = sum(r['reserve'] for r in test_spend if r.get('model') == model and r.get('contestant') == c and 'usd' not in r)
            cost[c] = {'knownUsd': known, 'retainedReserveUsd': retained, 'knownUsdPer100Items': 100 * known / len(pool)}
        out['models'][model] = {
            'primary': strip(primary),
            'registeredAllIn': {k: all_in.get(k) for k in ['matched', 'scores', 'difference', 'wins', 'losses', 'pTwoSided', 'graderErrors']},
            'missing': {'items': len(missing), 'byContestant': dict(Counter(c for v in missing.values() for c in v)),
                        'errors': dict(Counter(e for v in missing.values() for e in v.values())), 'ids': sorted(missing)},
            'unrecordedItems': unrecorded,
            'stage0CallsExhausted': dict(stage0_exhausted),
            'retries': {'failedTries': len(mattempts), 'callsRecoveredByRetry': len({a['key'] for a in mattempts} & ok_keys),
                        'tryErrors': dict(Counter(a['error'] for a in mattempts))},
            'lossesByGroup': {g: losses_by_group.get(g, 0) for g in GROUPS},
            'winsByGroup': {g: wins_by_group.get(g, 0) for g in GROUPS},
            'cost': cost,
            'items': primary.get('items', []),
        }
    return out


if __name__ == '__main__':
    result = report()
    (HERE / 'test-results.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'spend': result['spend'], 'models': {m: {k: v for k, v in r.items() if k != 'items'} for m, r in result['models'].items()}}, indent=2))
