"""Runs catalogue experts on practice pairs and stores one signal per (pair, expert).

  python3 -m moj.collect --bench judgebench --experts s1p,s1r,route [--limit 5] [--offline]

Signals land in results/signals/<bench>.json. Calls are replayed from recordings when they exist, so a
second run costs nothing, and `--offline` fails on any call that was never recorded.
"""
import json
import os
import sys

from .benches import BENCHES, HERE, load
from .client import run_all
from .experts import CATALOGUE, Ctx


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def signal_path(bench):
    return os.path.join(HERE, 'results', 'signals', f'{bench}.json')


def load_signals(bench):
    path = signal_path(bench)
    return json.load(open(path)) if os.path.exists(path) else {}


def collect(bench, experts, limit=None, offline=False):
    items = load(bench)[:limit]
    store = load_signals(bench)

    def one(item, name):
        ctx = Ctx(item, offline)
        out = CATALOGUE[name]['fn'](ctx)
        return item['id'], name, {'pA': out['pA'], 'detail': out['detail'], 'calls': ctx.calls, 'usd': round(ctx.usd, 6),
                                  'seconds': {k: round(sum(v), 3) for k, v in ctx.seconds.items()}, 'missing': ctx.missing}

    tasks = [lambda item=item, name=name: one(item, name) for name in experts for item in items]
    for item_id, name, signal in run_all(tasks):
        store.setdefault(item_id, {})[name] = signal
    for item in items:
        store[item['id']]['_meta'] = {'label': item['label'], 'half': item['half'], 'split': item['split'], 'group': item['group'],
                                      'language': item['language'], 'swapped': item['swapped'],
                                      'baselines': item.get('baselines', {})}
    os.makedirs(os.path.dirname(signal_path(bench)), exist_ok=True)
    json.dump(store, open(signal_path(bench), 'w'), ensure_ascii=False, indent=0)
    totals = {'pairs': len(items), 'jev_calls': 0, 'luna_calls': 0, 'luna_usd': 0.0, 'missing': 0}
    for item in items:
        for name in experts:
            signal = store[item['id']][name]
            totals['jev_calls'] += signal['calls']['jev']
            totals['luna_calls'] += signal['calls']['luna']
            totals['luna_usd'] += signal['usd']
            totals['missing'] += signal['missing']
    totals['luna_usd'] = round(totals['luna_usd'], 4)
    return totals


if __name__ == '__main__':
    benches = arg('--bench', ','.join(BENCHES)).split(',')
    experts = arg('--experts', ','.join(CATALOGUE)).split(',')
    limit = int(arg('--limit')) if arg('--limit') else None
    for bench in benches:
        print(bench, json.dumps(collect(bench, experts, limit, '--offline' in sys.argv)))
