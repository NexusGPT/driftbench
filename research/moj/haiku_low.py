"""Collects the Haiku panel member only on practice pairs that the accuracy candidate sends to System 2
(levels 'reference-first+' and 'system2'), and stores the signal next to the others. Other pairs get no Haiku signal."""
import json, sys
from moj.benches import load
from moj.client import run_all
from moj.collect import load_signals, signal_path
from moj.experts import CATALOGUE, Ctx
from moj.score import board
config = json.load(open('configs/acc-c0.95-s0.8.json'))
decisions = board(config)['decisions']
for bench in ('judgebench', 'mmeval'):
    store = load_signals(bench)
    items = [x for x in load(bench) if decisions[f"{bench}|{x['id']}"]['level'] in ('reference-first+', 'system2')]
    def one(item):
        ctx = Ctx(item, '--offline' in sys.argv)
        out = CATALOGUE['hai']['fn'](ctx)
        return item['id'], {'pA': out['pA'], 'detail': out['detail'], 'calls': ctx.calls, 'usd': round(ctx.usd, 6),
                            'seconds': {k: round(sum(v), 3) for k, v in ctx.seconds.items()}, 'missing': ctx.missing}
    for item_id, sig in run_all([lambda i=i: one(i) for i in items], workers=2):
        store[item_id]['hai'] = sig
    json.dump(store, open(signal_path(bench), 'w'), ensure_ascii=False, indent=0)
    print(bench, len(items), 'pairs', round(sum(store[i['id']]['hai']['usd'] for i in items), 3), 'USD')
