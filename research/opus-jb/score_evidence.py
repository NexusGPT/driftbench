"""Score reference3 plus evidence arbitration on JudgeBench dev, official and audited, with fix/break lists.

Gates (pre-registered before the full run; G1 is primary):
- G1: both option orders name the same winner, at least one quote is validated in the retrieved text,
      and both confidences are at least 70.
- G0: both orders agree and both confidences are at least 70 (no quote needed). Diagnostic only.
- ALL: evidence winner whenever both orders agree. Diagnostic only.
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CJB = '/Users/assem/Documents/GitHub/driftbench/.worktrees/codex-jb/examples/judge-benchmarks/jb-results'
items = json.load(open(f'{CJB}/driftbench-reference3-items.json'))
audit = json.load(open(f'{CJB}/label-audit.json'))
excluded = {e['id'] if isinstance(e, dict) else e for e in audit['excluded']}
res_file = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'results', 'evidence-dev.jsonl')
ev = {json.loads(l)['id']: json.loads(l) for l in open(res_file) if l.strip()}
REF3_USD_PER_100 = 0.7720  # from report-jb.md, recorded original prices


def conf(x):
    try:
        return float(x)
    except Exception:
        return -1.0


def gate(e, name):
    w = [r['winner'] for r in e['runs']]
    if None in w or w[0] != w[1]:
        return None
    cs = [conf(r['confidence']) for r in e['runs']]
    if name == 'G1' and (min(cs) < 70 or not any(r['quote_valid'] for r in e['runs'])):
        return None
    if name == 'G0' and min(cs) < 70:
        return None
    return 'A' if w[0] == e['fa'] else 'B'


def pair_ok(games, label):
    s = sum(1 if g == label else (-1 if g in ('A', 'B') else 0) for g in games)
    return s > 0


ev_cost = sum(e['cost'] for e in ev.values())
print(f'evidence items {len(ev)}, evidence cost {ev_cost:.4f} USD, per 100 dev pairs {100 * ev_cost / len(items):.4f}')
for name in ('BASE', 'G1', 'G0', 'ALL'):
    off = aud = naud = 0
    fixes, breaks, overrides = [], [], 0
    for r in items:
        games = list(r['games'])
        if name != 'BASE' and r['id'] in ev:
            g = gate(ev[r['id']], name)
            if g:
                overrides += 1
                games = [g, g]
        ok = pair_ok(games, r['label'])
        base_ok = pair_ok(r['games'], r['label'])
        off += ok
        if r['id'] not in excluded:
            naud += 1
            aud += ok
        if ok and not base_ok:
            fixes.append(r['id'][:8])
        if base_ok and not ok:
            breaks.append(r['id'][:8])
    cost = REF3_USD_PER_100 + (0 if name == 'BASE' else 100 * ev_cost / len(items))
    print(f'{name}: official {off}/{len(items)} ({100 * off / len(items):.1f}), audited {aud}/{naud} '
          f'({100 * aud / naud:.1f}), overrides {overrides}, fixes {fixes}, breaks {breaks}, USD/100 {cost:.4f}')
# evidence-alone accuracy on the contested MCQ pairs it covered
lab = {r['id']: r['label'] for r in items}
agree = sum(1 for e in ev.values() if gate(e, 'ALL') == lab[e['id']])
dis = sum(1 for e in ev.values() if gate(e, 'ALL') is None)
print(f'evidence alone on {len(ev)} contested pairs: right {agree}, split orders {dis}')
