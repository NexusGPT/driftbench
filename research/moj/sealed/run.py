"""Sealed confirmation run of the frozen MoJ configuration.

  python3 -m sealed.run freeze      fits the combination on ALL practice pairs and writes sealed/freeze.json
  python3 -m sealed.run collect     runs the experts the frozen config and the baselines need, on sealed pairs
  python3 -m sealed.run score       applies the frozen weights; scores MoJ and baselines (no call)

Run from research/moj. The ledger baseline runs separately (sealed/ledger_run.mjs) and lands in
results/sealed/ledger-<bench>.jsonl.
"""
import hashlib, json, os, random, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from moj.benches import BENCHES, HERE, _swap, group_key, half
from moj.client import run_all
from moj.collect import load_signals
from moj.experts import CATALOGUE, Ctx
from moj.policy import Combiner, decide, score_games, score_verdict, wilson

CONFIG = 'configs/r9-two-step.json'      # primary, frozen 2026-10-13 after round 9
SECONDARY = 'configs/r6-ref-first.json'  # the configuration frozen first; reported beside the primary, outside the Holm family
EXPERTS = ['s1p', 'route', 'ref', 's2v', 'length']
SETS = [['s1p'], ['s1p', 'ref'], ['s1p', 's2v'], ['s1p', 'ref', 's2v']]
OUT = os.path.join(HERE, 'results', 'sealed')
BENCH_LIST = ('judgebench', 'mmeval', 'writing')


def freeze():
    config = json.load(open(os.path.join(HERE, CONFIG)))
    practice = [s for b in BENCH_LIST for s in load_signals(b).values()]
    comb = Combiner(practice, config.get('l2', 1.0))
    weights = {'+'.join(k): [float(x) for x in comb.weights(k)] for k in SETS}
    files = ['moj/policy.py', 'moj/experts.py', 'moj/client.py', 'moj/benches.py', CONFIG, SECONDARY, 'sealed/run.py', 'sealed/build.py', 'data/sealed-confirmation.json']
    digests = {f: hashlib.sha256(open(os.path.join(HERE, f), 'rb').read()).hexdigest() for f in files}
    freeze = {'config': config, 'secondary_config': json.load(open(os.path.join(HERE, SECONDARY))),
              'note': 'Sealed signals (s1p, route, ref, s2v, length) were collected under the first freeze (r6, commit 60da2848) and never scored. The primary was changed to r9-two-step before any sealed score was computed or read; both configurations use the same experts and the same frozen weights.', 'weights_fitted_on': f'all practice pairs ({len(practice)})', 'weights': weights,
              'models': {'system1': 'jev-latest (answered as jev-1.13.0)', 'system2': 'gpt-6-luna, medium effort, no temperature'},
              'file_sha256': digests,
              'rule_for_a_win': ('Per benchmark and baseline: paired bootstrap (20,000 draws, resampling prompt groups) of MoJ minus baseline. '
                                 'Holm over the 6 comparisons (3 benchmarks x promptfoo and our ledger). A win when the Holm-adjusted lower bound is above 0 '
                                 'at no more System-2 calls per pair than that baseline; a loss when the upper bound is below 0; else a tie. '
                                 'Overall better only if every cell is a win or a tie and at least one is a win. On writing a win also needs MoJ above longer wins; '
                                 'else the report says the benchmark does not measure judging there.'),
              'scoring': 'JudgeBench: a pair is right only when both games are right (strict); half credit reported beside it. MM-Eval and writing: tie or split counts half.'}
    os.makedirs(OUT, exist_ok=True)
    json.dump(freeze, open(os.path.join(HERE, 'sealed', 'freeze.json'), 'w'), indent=1)
    print(json.dumps(weights))


def load_sealed(bench):
    items = json.load(open(os.path.join(HERE, 'sealed', f'{bench}.json')))
    flip = {'A': 'B', 'B': 'A'}
    for item in items:
        item['bench'] = bench; item['id'] = str(item['id']); item['half'] = 'sealed'
        item['swapped'] = _swap(item['id'])
        if item['swapped']:
            item['a'], item['b'] = item['b'], item['a']; item['label'] = flip[item['label']]
    return items


def signal_path(bench):
    return os.path.join(OUT, f'signals-{bench}.json')


def collect():
    for bench in BENCH_LIST:
        items = load_sealed(bench)
        store = json.load(open(signal_path(bench))) if os.path.exists(signal_path(bench)) else {}

        def one(item, name):
            ctx = Ctx(item, False)
            out = CATALOGUE[name]['fn'](ctx)
            return item['id'], name, {'pA': out['pA'], 'detail': out['detail'], 'calls': ctx.calls, 'usd': round(ctx.usd, 6),
                                      'seconds': {k: round(sum(v), 3) for k, v in ctx.seconds.items()}, 'missing': ctx.missing}
        todo = [lambda i=i, n=n: one(i, n) for n in EXPERTS for i in items if n not in store.get(i['id'], {}) or store[i['id']][n].get('missing')]
        for item_id, name, sig in run_all(todo):
            store.setdefault(item_id, {})[name] = sig
        for item in items:
            store[item['id']]['_meta'] = {'label': item['label'], 'half': 'sealed', 'group_key': group_key(item), 'swapped': item['swapped'],
                                          'group': item.get('group'), 'language': item.get('language')}
        json.dump(store, open(signal_path(bench), 'w'), ensure_ascii=False)
        print(bench, len(items), 'pairs', sum(1 for s in store.values() for n in EXPERTS if (s.get(n) or {}).get('missing')), 'expert signals with a missing answer')


class Frozen(Combiner):
    def __init__(self, weights):
        super().__init__([], 1.0)
        self.models = {tuple(k.split('+')): __import__('numpy').array(w) for k, w in weights.items()}


def strict(games, label):
    return 1.0 if all(g == label for g in games) else 0.0


def boot(diffs, groups, draws=20000, seed=11):
    by = {}
    for d, g in zip(diffs, groups):
        by.setdefault(g, []).append(d)
    keys = list(by); rng = random.Random(seed); n = len(diffs); means = []
    for _ in range(draws):
        pick = [by[keys[rng.randrange(len(keys))]] for _ in keys]
        flat = [x for p in pick for x in p]
        means.append(sum(flat) / len(flat))
    means.sort()
    return means


def score():
    fr = json.load(open(os.path.join(HERE, 'sealed', 'freeze.json')))
    comb = Frozen(fr['weights'])
    report, comparisons = {}, []
    for bench in BENCH_LIST:
        store = json.load(open(signal_path(bench)))
        ledger = {}
        lp = os.path.join(OUT, f'ledger-{bench}.jsonl')
        if os.path.exists(lp):
            for line in open(lp):
                r = json.loads(line); ledger[r['id']] = r
        rows = []
        for item_id, s in store.items():
            d = decide(fr['config'], s, comb)
            d2 = decide(fr['secondary_config'], s, comb)
            label = s['_meta']['label']
            flip = {'A': 'B', 'B': 'A', 'tie': 'tie', None: None}
            lg = ledger.get(item_id)
            lgames = [flip[g] if s['_meta']['swapped'] else g for g in lg['games']] if lg and lg.get('games') else None
            pf = s['s2v']['detail']['games']
            rows.append({'id': item_id, 'group': s['_meta']['group_key'], 'label': label,
                         'moj': score_verdict(d['verdict'], label), 'moj_strict': 1.0 if d['verdict'] == label else 0.0,
                         'pf': score_games(pf, label), 'pf_strict': strict(pf, label),
                         'ledger': score_games(lgames, label) if lgames else None, 'ledger_strict': strict(lgames, label) if lgames else None,
                         'length': score_verdict('A' if s['length']['pA'] > .5 else 'B' if s['length']['pA'] < .5 else 'tie', label),
                         'moj_s1': d['calls']['jev'], 'moj_s2': d['calls']['luna'], 'moj_usd': d['calls']['usd'], 'moj_sec': d['calls']['seconds'],
                         'pf_usd': s['s2v']['usd'], 'ledger_usd': lg.get('usd') if lg else None, 'ledger_calls': lg.get('calls') if lg else None,
                         'level': d['level'], 'confidence': d['confidence'],
                         'r6': score_verdict(d2['verdict'], label), 'r6_s1': d2['calls']['jev'], 'r6_s2': d2['calls']['luna']})
        key = 'strict' if bench == 'judgebench' else ''
        def acc(col):
            v = [r[col] for r in rows if r[col] is not None]; m = sum(v) / len(v); lo, hi = wilson(m, len(v)); return {'n': len(v), 'acc': m, 'low': lo, 'high': hi}
        out = {'pairs': len(rows)}
        for col in ['moj', 'moj_strict', 'r6', 'pf', 'pf_strict', 'ledger', 'ledger_strict', 'length']:
            out[col] = acc(col)
        n = len(rows)
        out['cost_per_100'] = {'moj_s1_calls': 100 * sum(r['moj_s1'] for r in rows) / n, 'moj_s2_calls': 100 * sum(r['moj_s2'] for r in rows) / n,
                               'moj_usd': 100 * sum(r['moj_usd'] for r in rows) / n, 'pf_s2_calls': 200, 'pf_usd': 100 * sum(r['pf_usd'] for r in rows) / n,
                               'ledger_calls': 100 * sum(r['ledger_calls'] or 0 for r in rows) / max(1, sum(1 for r in rows if r['ledger_calls'])),
                               'ledger_usd': 100 * sum(r['ledger_usd'] or 0 for r in rows) / max(1, sum(1 for r in rows if r['ledger_usd'] is not None))}
        out['secondary_r6_calls_per_100'] = {'s1': 100 * sum(r['r6_s1'] for r in rows) / n, 's2': 100 * sum(r['r6_s2'] for r in rows) / n}
        out['moj_seconds_per_pair'] = sum(r['moj_sec'] for r in rows) / n
        out['levels'] = {lv: sum(1 for r in rows if r['level'] == lv) / n for lv in sorted({r['level'] for r in rows})}
        out['level_accuracy'] = {lv: sum(r['moj'] for r in rows if r['level'] == lv) / max(1, sum(1 for r in rows if r['level'] == lv)) for lv in sorted({r['level'] for r in rows})}
        for base, col in [('promptfoo', 'pf'), ('ledger', 'ledger')]:
            sel = [r for r in rows if r[col] is not None]
            m_col, b_col = ('moj_strict', col + '_strict') if bench == 'judgebench' else ('moj', col)
            diffs = [r[m_col] - r[b_col] for r in sel]
            dist = boot(diffs, [r['group'] for r in sel])
            comparisons.append({'bench': bench, 'baseline': base, 'n': len(sel), 'diff': sum(diffs) / len(diffs), 'dist': dist,
                                'moj_s2': sum(r['moj_s2'] for r in sel) / len(sel),
                                'base_s2': 2.0 if base == 'promptfoo' else sum(r['ledger_calls'] or 0 for r in sel) / len(sel)})
        report[bench] = out
    # Holm on the bootstrap p-values (two-sided: share of draws on the far side of 0, doubled)
    for c in comparisons:
        d = c.pop('dist'); m = len(d)
        p = 2 * min(sum(1 for x in d if x <= 0) / m, sum(1 for x in d if x >= 0) / m)
        c['p'] = min(1.0, p); c['ci95'] = [d[int(.025 * m)], d[int(.975 * m)]]
    order = sorted(range(len(comparisons)), key=lambda i: comparisons[i]['p'])
    running = 0
    for rank, i in enumerate(order):
        running = max(running, min(1.0, (len(order) - rank) * comparisons[i]['p']))
        comparisons[i]['p_holm'] = running
    for c in comparisons:
        cheap = c['moj_s2'] <= c['base_s2']
        c['verdict'] = 'win' if c['p_holm'] < .05 and c['diff'] > 0 and cheap else 'loss' if c['p_holm'] < .05 and c['diff'] < 0 else 'tie'
    report['comparisons'] = comparisons
    json.dump(report, open(os.path.join(OUT, 'report.json'), 'w'), indent=1)
    print(json.dumps(report, indent=1)[:6000])


if __name__ == '__main__':
    {'freeze': freeze, 'collect': collect, 'score': score}[sys.argv[1]]()
