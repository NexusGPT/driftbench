"""Second sealed run: accuracy mode (primary) and economy mode (secondary) on the second draw.

  python3 sealed/draw-2/run.py freeze     fits on ALL practice pairs, writes sealed/draw-2/freeze.json (no sealed call)
  python3 sealed/draw-2/run.py probe      10 probes of the System-1 gateway and of gpt-6-luna; all must answer
  python3 sealed/draw-2/run.py collect    experts on the sealed pairs, 2 calls in flight; rerun = recover missing only
  python3 sealed/draw-2/run.py score      one scoring pass (no call)

Run from research/moj. Recorded ledger and promptfoo answers of the ledger harness are the baselines on JudgeBench and
on the 173 writing pairs it scored; the ledger on MM-Eval and on the 44 never-scored writing pairs comes from
sealed/ledger_run.mts with this folder as input.
"""
import hashlib, json, math, os, random, sys
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)
import moj.client as client
from moj.benches import _swap, group_key
from moj.client import jev, luna, run_all
from moj.collect import load_signals
from moj.experts import CATALOGUE, Ctx
from moj.policy import Combiner, decide, score_games, score_verdict, wilson

HERE = os.path.join(ROOT, 'sealed', 'draw-2')
OUT = os.path.join(ROOT, 'results', 'sealed-2')
PRIMARY, SECONDARY = 'configs/moj-accuracy.json', 'configs/moj-economy.json'
BENCH_LIST = ('judgebench', 'mmeval', 'writing')
EXPERTS = ['s1p', 'route', 'route2', 'ref', 's2v', 'f_len', 'length']
W = '/Users/assem/Documents/GitHub/driftbench/.worktrees'
FROZEN_FILES = ['moj/policy.py', 'moj/experts.py', 'moj/features.py', 'moj/client.py', 'moj/benches.py', PRIMARY, SECONDARY,
                'sealed/draw-2/run.py', 'sealed/draw-2/draw.py', 'sealed/ledger_run.mts', 'sealed/draw-2/sealed-ids.json',
                'results/signals/judgebench.json', 'results/signals/mmeval.json', 'results/signals/writing.json']


def practice():
    return [s for b in BENCH_LIST for s in load_signals(b).values()]


def combiner_for(config):
    return Combiner(practice(), config.get('l2', 1.0))


def freeze():
    out = {'primary': json.load(open(os.path.join(ROOT, PRIMARY))), 'secondary': json.load(open(os.path.join(ROOT, SECONDARY)))}
    rows = practice()
    weights = {}
    for name in ('primary', 'secondary'):
        comb = combiner_for(out[name])
        for s in rows:
            decide(out[name], s, comb)  # fills every fitted model the configuration can use
        weights[name] = {json.dumps(k): [float(x) for x in v] for k, v in comb.models.items() if k and k[0] != 'boundary'}
    out.update({
        'weights_fitted_on': f'all practice pairs ({len(rows)}); the weights are refitted from the hashed practice signals at score time and must equal these',
        'weights': weights,
        'models': {'system1': 'jev-latest (gateway)', 'system2': 'gpt-6-luna, medium effort, no temperature',
                   'second_family_member_of_accuracy_mode': 'Claude Haiku through the claude CLI, low effort, on reasoning terrain under the stop only'},
        'file_sha256': {f: hashlib.sha256(open(os.path.join(ROOT, f), 'rb').read()).hexdigest() for f in FROZEN_FILES},
        'cells': {
            'mmeval': 'CONFIRMATORY, the only cell in the test family: 600 never-scored ids, one per prompt group, disjoint from practice and from the first sealed run.',
            'judgebench': 'SECONDARY, outside the test family: 179 Claude-response pairs, unseen by MoJ, previously scored by the ledger harness, whose after-the-fact analysis informed the MoJ design. Cannot confirm anything alone.',
            'writing': 'SECONDARY, outside the test family: 217 pairs (44 never scored plus 173 unseen by MoJ, previously scored by the ledger harness, whose after-the-fact analysis informed the MoJ design). Cannot confirm anything alone.'},
        'endpoints': {
            'primary': 'MM-Eval: accuracy mode minus promptfoo select-best (gpt-6-luna medium, both orders), paired by pair, half credit for a split. One test, two-sided 0.05; a paired bootstrap (20,000 draws) gives the interval and the p-value.',
            'secondary': ['MM-Eval: accuracy mode minus our ledger', 'MM-Eval: accuracy mode minus economy mode',
                          'JudgeBench and writing: the same three differences, with intervals, labelled secondary',
                          'Writing: accuracy mode against longer wins; the target is level with longer wins and well above promptfoo, no claim of beating the length rule'],
            'reported_both': 'strict both-order rule and half credit, on every benchmark'},
        'rule_for_a_win': 'Accuracy mode wins the confirmatory cell when the lower bound of the 95 percent paired interval against promptfoo is above 0 and its System-2-family calls per pair are at or under 2.',
        'power': {'mmeval_n': 600, 'sd_of_paired_difference_from_first_sealed_run': 0.155,
                  'power_5_point_gap': round(1 - _phi(1.96 - 0.05 * math.sqrt(600) / 0.155), 3), 'power_2_point_gap': round(1 - _phi(1.96 - 0.02 * math.sqrt(600) / 0.155), 3),
                  'judgebench_n179_5_point_gap': 0.44, 'writing_n217_5_point_gap': 0.33},
        'network_rules': '10 healthy probes before the first sealed call; 2 calls in flight; a transport no-answer is recovered missing-only; a pair counts as a MoJ loss only after a final recovery cycle (gateway 403 by content: a loss).',
        'budget': '25 USD of System-2 spend for this round; projected after the first 50 pairs of each benchmark.'})
    os.makedirs(OUT, exist_ok=True)
    json.dump(out, open(os.path.join(HERE, 'freeze.json'), 'w'), indent=1)
    print('frozen', {k: len(v) for k, v in weights.items()}, out['power'])


def _phi(z):
    return 0.5 * (1 + math.erf(z / math.sqrt(2)))


def probe():
    ok = {'jev': 0, 'luna': 0}
    for i in range(10):
        p, row = jev({'request': f'Fictional probe {i}: is Marrow Bay the capital of Veldoria in the story?', 'reply': 'Yes, Marrow Bay.'},
                     {'ok': {'question': 'Does the reply say yes?'}})
        ok['jev'] += p['ok'] is not None
        text, row = luna([{'role': 'user', 'content': f'Fictional probe {i}. Answer with the single word: ready'}], tag='probe-draw-2', effort='low')
        ok['luna'] += text is not None
    print(ok)
    if ok != {'jev': 10, 'luna': 10}:
        raise SystemExit('network not healthy: do not start')


def load_sealed(bench):
    items = json.load(open(os.path.join(HERE, f'{bench}.json')))
    flip = {'A': 'B', 'B': 'A', 'tie': 'tie', None: None}
    recorded = recorded_baselines(bench)
    for item in items:
        item['bench'] = bench; item['id'] = str(item['id']); item['half'] = 'sealed-2'
        item['baselines'] = dict(recorded.get(item['id'], {}))
        item['swapped'] = _swap(item['id'])
        if item['swapped']:
            item['a'], item['b'] = item['b'], item['a']; item['label'] = flip[item['label']]
            for base in item['baselines'].values():
                base['games'] = [flip.get(g) for g in base['games']]
    return items


def recorded_baselines(bench):
    """Recorded gpt-6-luna (medium effort) answers of the ledger harness, in the original A and B orientation."""
    out = {}
    if bench == 'judgebench':
        for line in open(f'{W}/ledger-jb/examples/ledger-jb/results/decisions-test-gpt-6-luna.jsonl'):
            r = json.loads(line)
            if r.get('model') == 'gpt-6-luna' and r.get('repeat', 0) == 0:
                out.setdefault(r['itemId'], {})[r['contestant']] = {'games': r['games'], 'calls': r.get('calls')}
    if bench == 'writing':
        for line in open(f'{W}/ledger-wp/examples/ledger-wp/results/decisions.jsonl'):
            r = json.loads(line)
            name = {'pair-ledger': 'ledger', 'promptfoo': 'promptfoo'}.get(r.get('contestant'))
            if r.get('model') == 'gpt-6-luna' and r.get('split') == 'test' and name and r.get('sample', 0) == 0:
                out.setdefault(r['id'], {})[name] = {'games': r['games'], 'calls': r.get('callCount'), 'usd': r.get('costUsd')}
    return out


def signal_path(bench):
    return os.path.join(OUT, f'signals-{bench}.json')


def run_expert(item, name):
    ctx = Ctx(item, False)
    out = CATALOGUE[name]['fn'](ctx)
    return item['id'], name, {'pA': out['pA'], 'detail': out['detail'], 'calls': ctx.calls, 'usd': round(ctx.usd, 6),
                              'seconds': {k: round(sum(v), 3) for k, v in ctx.seconds.items()}, 'missing': ctx.missing}


def collect():
    client._jev_gate = __import__('threading').Semaphore(2)
    os.makedirs(OUT, exist_ok=True)
    fr = json.load(open(os.path.join(HERE, 'freeze.json')))
    comb = combiner_for(fr['primary'])
    limit = int(sys.argv[sys.argv.index('--limit') + 1]) if '--limit' in sys.argv else None
    for bench in BENCH_LIST:
        items = load_sealed(bench)[:limit]
        store = json.load(open(signal_path(bench))) if os.path.exists(signal_path(bench)) else {}
        need = lambda i, n: n not in store.get(i['id'], {}) or store[i['id']][n].get('missing')
        for item_id, name, sig in run_all([lambda i=i, n=n: run_expert(i, n) for n in EXPERTS for i in items if need(i, n)], workers=2):
            store.setdefault(item_id, {})[name] = sig
        for item in items:
            store[item['id']]['_meta'] = {'label': item['label'], 'half': 'sealed-2', 'group_key': group_key(item), 'swapped': item['swapped'],
                                          'group': item.get('group'), 'language': item.get('language'), 'origin': item.get('origin'), 'baselines': item['baselines']}
        # the Haiku member is asked only where the frozen accuracy mode would use it: the route is decided without it
        wants = [i for i in items if 'hai' in route_experts(fr['primary'], store[i['id']], comb) and need(i, 'hai')]
        for item_id, name, sig in run_all([lambda i=i: run_expert(i, 'hai') for i in wants], workers=2):
            store[item_id][name] = sig
        json.dump(store, open(signal_path(bench), 'w'), ensure_ascii=False)
        done = [store[i['id']] for i in items]
        usd = sum(s[n]['usd'] for s in done for n in s if n != '_meta')
        print(bench, len(items), 'pairs; signals still missing an answer:', sum(1 for s in done for n in EXPERTS + ['hai'] if (s.get(n) or {}).get('missing')),
              '; Haiku asked on', sum(1 for s in done if 'hai' in s), '; USD so far', round(usd, 4), flush=True)


def route_experts(config, signals, comb):
    """Experts the frozen configuration would call for this pair, with a placeholder Haiku signal so the route shows it."""
    probe_signals = dict(signals)
    probe_signals.setdefault('hai', {'pA': 0.5, 'detail': {}, 'calls': {'jev': 0, 'luna': 0}, 'usd': 0.0, 'seconds': {'jev': 0, 'luna': 0}})
    return decide(config, probe_signals, comb)['path']


def strict(games, label):
    return 1.0 if all(g == label for g in games) else 0.0


def boot(diffs, groups, draws=20000, seed=23):
    by = {}
    for d, g in zip(diffs, groups):
        by.setdefault(g, []).append(d)
    keys = list(by); rng = random.Random(seed); means = []
    for _ in range(draws):
        flat = [x for _ in keys for x in by[keys[rng.randrange(len(keys))]]]
        means.append(sum(flat) / len(flat))
    means.sort()
    p = 2 * min(sum(1 for x in means if x <= 0), sum(1 for x in means if x >= 0)) / draws
    return {'diff': sum(diffs) / len(diffs), 'low': means[int(.025 * draws)], 'high': means[int(.975 * draws)], 'p': min(1.0, p), 'n': len(diffs)}


def score():
    fr = json.load(open(os.path.join(HERE, 'freeze.json')))
    changed = [f for f, d in fr['file_sha256'].items() if hashlib.sha256(open(os.path.join(ROOT, f), 'rb').read()).hexdigest() != d]
    combs = {name: combiner_for(fr[name]) for name in ('primary', 'secondary')}
    for name in combs:
        for s in practice():
            decide(fr[name], s, combs[name])
        now = {json.dumps(k): [float(x) for x in v] for k, v in combs[name].models.items() if k and k[0] != 'boundary'}
        assert all(max(abs(a - b) for a, b in zip(now[k], fr['weights'][name][k])) < 1e-9 for k in fr['weights'][name]), 'weights differ from the freeze'
    report = {'files_changed_since_freeze': changed}
    flip = {'A': 'B', 'B': 'A', 'tie': 'tie', None: None}
    for bench in BENCH_LIST:
        store = json.load(open(signal_path(bench)))
        ledger_fresh, per_pair = {}, {}
        for path in (os.path.join(OUT, f'ledger-{bench}.jsonl'),):
            if os.path.exists(path):
                for line in open(path):
                    r = json.loads(line); ledger_fresh[str(r['id'])] = r
        cp = os.path.join(OUT, 'ledger-calls.jsonl')
        if os.path.exists(cp):
            for line in open(cp):
                r = json.loads(line)
                if r.get('response') and r['meta'].get('bench') == bench:
                    e = per_pair.setdefault(str(r['meta']['id']), {'calls': 0, 'usd': 0.0}); e['calls'] += 1; e['usd'] += r['usd']
        rows = []
        for item_id, s in store.items():
            label, meta = s['_meta']['label'], s['_meta']
            lost = s['s1p'].get('pA') is None
            d = {name: decide(fr[name], s, combs[name]) for name in ('primary', 'secondary')}
            pf = s['s2v']['detail']['games']
            rec = meta['baselines'].get('ledger')
            if rec:
                lgames, lcalls, lusd = rec['games'], rec.get('calls'), rec.get('usd')
            elif item_id in ledger_fresh and ledger_fresh[item_id].get('games'):
                g = ledger_fresh[item_id]['games']
                lgames = [flip[x] if meta['swapped'] else x for x in g]
                lcalls, lusd = per_pair.get(item_id, {}).get('calls'), per_pair.get(item_id, {}).get('usd')
            else:
                lgames = lcalls = lusd = None
            row = {'id': item_id, 'group': meta['group_key'], 'lost': lost,
                   'acc': 0.0 if lost else score_verdict(d['primary']['verdict'], label), 'eco': 0.0 if lost else score_verdict(d['secondary']['verdict'], label),
                   'pf': score_games(pf, label), 'pf_strict': strict(pf, label),
                   'ledger': score_games(lgames, label) if lgames else None, 'ledger_strict': strict(lgames, label) if lgames else None,
                   'length': score_verdict('A' if s['length']['pA'] > .5 else 'B' if s['length']['pA'] < .5 else 'tie', label),
                   'pf_source': s['s2v']['detail'].get('source'), 'pf_usd': s['s2v']['usd'], 'ledger_calls': lcalls, 'ledger_usd': lusd}
            for name, key in (('primary', 'acc'), ('secondary', 'eco')):
                c = d[name]['calls']
                row.update({f'{key}_strict': 0.0 if lost else (1.0 if d[name]['verdict'] == label else 0.0), f'{key}_s1': c['jev'], f'{key}_s2': c['luna'],
                            f'{key}_usd': c['usd'], f'{key}_sec': c['seconds'], f'{key}_level': d[name]['level']})
            rows.append(row)
        n = len(rows)
        def cell(col):
            v = [r[col] for r in rows if r[col] is not None]
            if not v: return None
            m = sum(v) / len(v); lo, hi = wilson(m, len(v)); return {'n': len(v), 'acc': m, 'low': lo, 'high': hi}
        out = {'pairs': n, 'moj_unanswered_counted_as_loss': sum(r['lost'] for r in rows)}
        for col in ['acc', 'acc_strict', 'eco', 'eco_strict', 'pf', 'pf_strict', 'ledger', 'ledger_strict', 'length']:
            out[col] = cell(col)
        mean = lambda col, sel=rows: (sum(r[col] for r in sel if r[col] is not None) / max(1, sum(1 for r in sel if r[col] is not None)))
        out['per_100_pairs'] = {'accuracy': {'s1_calls': 100 * mean('acc_s1'), 's2_family_calls': 100 * mean('acc_s2'), 'usd': 100 * mean('acc_usd')},
                                'economy': {'s1_calls': 100 * mean('eco_s1'), 's2_calls': 100 * mean('eco_s2'), 'usd': 100 * mean('eco_usd')},
                                'promptfoo': {'s2_calls': 200, 'usd_fresh_pairs_only': 100 * mean('pf_usd', [r for r in rows if r['pf_source'] == 'fresh'])},
                                'ledger': {'s2_calls': 100 * mean('ledger_calls'), 'usd_where_recorded': 100 * mean('ledger_usd')}}
        out['accuracy_seconds_per_pair'] = mean('acc_sec')
        levels = sorted({r['acc_level'] for r in rows})
        out['accuracy_levels'] = {lv: {'share': sum(1 for r in rows if r['acc_level'] == lv) / n, 'acc': mean('acc', [r for r in rows if r['acc_level'] == lv])} for lv in levels}
        groups = [r['group'] for r in rows]
        comp = {}
        for name, a, b in [('accuracy_minus_promptfoo', 'acc', 'pf'), ('accuracy_minus_promptfoo_strict', 'acc_strict', 'pf_strict'), ('accuracy_minus_ledger', 'acc', 'ledger'),
                           ('accuracy_minus_ledger_strict', 'acc_strict', 'ledger_strict'), ('accuracy_minus_economy', 'acc', 'eco'), ('economy_minus_promptfoo', 'eco', 'pf'),
                           ('accuracy_minus_longer_wins', 'acc', 'length')]:
            sel = [r for r in rows if r[a] is not None and r[b] is not None]
            comp[name] = boot([r[a] - r[b] for r in sel], [r['group'] for r in sel]) if sel else None
        out['paired'] = comp
        report[bench] = out
    json.dump(report, open(os.path.join(OUT, 'report.json'), 'w'), indent=1)
    print('scored; files changed since freeze:', changed)


if __name__ == '__main__':
    {'freeze': freeze, 'probe': probe, 'collect': collect, 'score': score}[sys.argv[1]]()
