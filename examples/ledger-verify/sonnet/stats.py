"""Recording-only comparison. No provider calls and no outcome-driven selection."""
import hashlib
import json
import math
from pathlib import Path
import random
import sys

HERE = Path(__file__).resolve().parent


def wilson(k, n):
    if n == 0:
        return None
    z = 1.959963984540054
    p = k / n
    center = (p + z*z/(2*n))/(1+z*z/n)
    half = z * math.sqrt(p*(1-p)/n + z*z/(4*n*n))/(1+z*z/n)
    return [center-half, center+half]


def exact_mcnemar(wins, losses):
    n = wins + losses
    if not n:
        return 1.0
    return min(1.0, 2 * sum(math.comb(n, k) for k in range(min(wins, losses)+1)) / 2**n)


def compare(pool, ours, peer, audit):
    ids = [r['id'] for r in pool]
    assert len(ids) == len(set(ids))
    def index(decisions):
        assert len({r['id'] for r in decisions}) == len(decisions), 'Duplicate item'
        assert {r['id'] for r in decisions} <= set(ids), 'Unknown item'
        return {r['id']:r for r in decisions}
    maps = [index(ours), index(peer)]
    def valid(row):
        return row is not None and row.get('missing', 0) == 0 and type(row.get('pass')) is bool
    matched = [r for r in pool if all(valid(m.get(r['id'])) for m in maps)]
    values = []
    for item in pool:
        label = audit.get(item['id'], item['correct'])
        correct = [valid(m.get(item['id'])) and m[item['id']]['pass'] == label for m in maps]
        values.append((item, *correct))
    wins = sum(a and not b for _, a, b in values)
    losses = sum(b and not a for _, a, b in values)
    n = len(pool)
    scores = [sum(v[j] for v in values) for j in [1, 2]]
    groups = {}
    for item, a, b in values:
        key = hashlib.sha256(item['question'].encode()).hexdigest()
        groups.setdefault(key, []).append(int(a)-int(b))
    rng = random.Random(20261013)
    clusters = list(groups.values())
    boots = []
    if clusters:
        for _ in range(10000):
            sample = [rng.choice(clusters) for _ in clusters]
            boots.append(sum(sum(c) for c in sample)/sum(len(c) for c in sample))
        boots.sort()
    p = exact_mcnemar(wins, losses)
    balanced = []
    for j in [1,2]:
        rates = []
        for label in [True,False]:
            rows = [r for r in values if audit.get(r[0]['id'],r[0]['correct']) is label]
            if rows:
                rates.append(sum(r[j] for r in rows)/len(rows))
        balanced.append(sum(rates)/len(rates) if rates else None)
    return dict(sealedItems=len(pool), matchedItems=len(matched),
        missing=[len(pool)-sum(valid(m.get(i)) for i in ids) for m in maps],
        correct=scores, accuracy=[k/n if n else None for k in scores], balancedAccuracy=balanced,
        wilson95=[wilson(k,n) for k in scores],
        delta=(scores[0]-scores[1])/n if n else None,
        deltaRequestClusterBootstrap95=[boots[249],boots[9749]] if boots else None,
        bootstrapReplicates=10000, bootstrapSeed=20261013, requestClusters=len(groups),
        wins=wins, losses=losses, twoSidedExactMcNemarP=p,
        holmP=None, holmStatus='Pending full prespecified 18-cell family, supplied to collator',
        bonferroni18UpperBound=min(1.0,18*p),
        verdict='LOSS' if losses>wins and p<0.05 else 'PENDING_HOLM' if wins>losses and p<0.05 else 'TIE',
        missingPolicy='Unparsed and missing verdicts are wrong in official scores; coverage reported separately',
        provisional=len(matched) != len(pool))


def main():
    pool = json.loads((HERE/'evidence/pool.json').read_text())
    audit = json.loads((HERE/'evidence/audit-map.json').read_text())
    rows = []
    for model in ['claude-sonnet-5-5']:
        report = HERE/'results'/f'{model}.json'
        if not report.exists():
            rows.append(dict(model=model, status='pending',
                reason='authorized; execution and validation pending',
                official=None, audited=None))
            continue
        data = json.loads(report.read_text())
        contestants = {r['contestant']:r for r in data['contestants']}
        a, b = [contestants[k] for k in ['driftbench-verify-uncertainty-cascade','promptfoo']]
        rows.append(dict(model=model, status='measured',
            official=compare(pool,a['decisions'],b['decisions'],{}),
            audited=compare(pool,a['decisions'],b['decisions'],audit),
            costUsd=[a['costUsd'],b['costUsd']],
            costPer100SealedItems=[r['costUsd']*100/len(pool) for r in [a,b]],
            report=str(report.relative_to(HERE))))
    labels=[r['correct'] for r in pool]
    output=dict(cells=rows, exposure='previously evaluated split', unit='item',
        auditedCorrections=len(audit),
        cheaters=dict(alwaysPassOfficial=sum(labels)/len(labels),
                      alwaysFailOfficial=1-sum(labels)/len(labels),
                      alwaysPassAudited=sum(audit.get(r['id'],r['correct']) for r in pool)/len(pool)),
        noiseFloor='pending; no fresh repeat measurements',
        primaryEndpoint='Official labels; audited labels are a separately reported sensitivity analysis')
    target=HERE/'evidence/cells.json'
    target.write_text(json.dumps(output,indent=2)+'\n')
    print(json.dumps(output,indent=2))


if __name__ == '__main__':
    main()
