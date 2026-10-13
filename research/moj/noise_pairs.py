"""Noise floor for the pairwise benchmarks: two fresh repeats of the System-2 verdict (promptfoo select-best,
gpt-6-luna) on 30 fixed practice pairs per benchmark. Repeat 0 is the stored signal. Recorded at results/noise-floor.json."""
import hashlib, json, re, sys
from moj.benches import BENCHES, load
from moj.client import luna, run_all
from moj.collect import load_signals
from moj.experts import PF_TEMPLATE, games_to_p
from moj.policy import score_games
OFF = '--offline' in sys.argv
out = json.load(open('results/noise-floor.json'))
for bench in sys.argv[1].split(','):
    items = sorted(load(bench), key=lambda x: hashlib.sha256(('moj-noise-v1:' + x['id']).encode()).hexdigest())[:30]
    sig = load_signals(bench)
    def run(item, rep):
        games = []
        for order in ('AB', 'BA'):
            a, b = (item['a'], item['b']) if order == 'AB' else (item['b'], item['a'])
            system = PF_TEMPLATE.format(criteria=f"{BENCHES[bench]['criterion']} The question: {item['question']}", a=a, b=b)
            text, _ = luna([{'role': 'system', 'content': system}, {'role': 'user', 'content': 'Output the index now.'}],
                           tag=f'select-best-repeat-{rep}', effort='medium', offline=OFF)
            pick = re.search(r'-?\d+', (text or '').strip()); pick = pick.group(0) if pick else None
            games.append(('A' if order == 'AB' else 'B') if pick == '0' else ('B' if order == 'AB' else 'A') if pick == '1' else None)
        return games
    reps = [[sig[x['id']]['s2v']['detail']['games'] for x in items]]
    for rep in (1, 2):
        reps.append(run_all([lambda x=x, r=rep: run(x, r) for x in items]))
    accs = [sum(score_games(g, x['label']) for g, x in zip(r, items)) / 30 for r in reps]
    flips = sum(1 for i in range(30) if len({tuple(r[i]) for r in reps}) > 1) / 30
    out['detail'][bench + '-moj-measured'] = {'n': 30, 'acc': [round(a, 4) for a in accs], 'range': round(max(accs) - min(accs), 4), 'flip_share': round(flips, 3)}
    print(bench, out['detail'][bench + '-moj-measured'])
json.dump(out, open('results/noise-floor.json', 'w'), indent=1)
