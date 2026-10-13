"""Noise floor: repeats one variant on a fixed 30-item subset per benchmark and reports the spread.

  python3 -m moj.noise configs/pw-moj-luna.json [--n 30] [--repeats 3] [--bench verify,hardrows] [--offline] [--workers 4]

Repeat 0 is the main collection. Each further repeat asks every call of the variant again as a fresh sample
(the request is the same, the recording key carries the repeat number), so a repeat replays offline like any
other call. The combination weights and boundaries stay those of the main collection: only the model answers
move. Reported per benchmark:

  accuracy per repeat, their range (highest minus lowest, in points) and standard deviation
  flips    share of items whose verdict is not the same in every repeat
  floor    the range: a lead on this subset counts as "more than noise" only above this number
  stage 1  the same numbers for the stage-1 experts alone (System 1 only)
  recorded the same numbers for the baselines whose three repeats were recorded by their own harness

The result lands in results/pointwise/noise/<variant>.json.
"""
import hashlib
import json
import os
import sys

from .benches import POINT_BENCHES
from .pointwise import OUT, arg, calibrate, derive, load_signals, meta_of, pools, run_many
from .benches import load_point
from .policy import Combiner, decide, score_games, score_verdict


def subset(bench, n):
    """The fixed noise subset of one benchmark: the first n items by a hash of the id."""
    items = load_point(bench)
    return sorted(items, key=lambda item: hashlib.sha256(('moj-noise-v1:' + item['id']).encode()).hexdigest())[:n]


def experts_of(config):
    names = list(config['stage1']) + [card['expert'] for card in config.get('cards', []) + config.get('always', [])] + list(config.get('low', []))
    if config.get('cards') or config.get('always'):
        names.append('route')
    seen = []
    for name in names:
        if name not in seen:
            seen.append(name)
    return seen


def spread(per_repeat):
    """per_repeat: [[score per item] per repeat], verdicts aligned. Returns accuracy per repeat, range and standard deviation."""
    accs = [sum(scores) / len(scores) for scores in per_repeat]
    mean = sum(accs) / len(accs)
    sd = (sum((a - mean) ** 2 for a in accs) / (len(accs) - 1)) ** 0.5 if len(accs) > 1 else 0.0
    return {'accuracy': [round(100 * a, 1) for a in accs], 'mean': round(100 * mean, 1),
            'range_points': round(100 * (max(accs) - min(accs)), 1), 'sd_points': round(100 * sd, 1)}


def flips(per_repeat_verdicts):
    items = list(zip(*per_repeat_verdicts))
    return round(sum(1 for verdicts in items if len(set(verdicts)) > 1) / len(items), 3)


def noise(config, benches, n=30, repeats=3, offline=False, workers=4):
    out = {'variant': config['name'], 'items_per_bench': n, 'repeats': repeats, 'benches': {}}
    names = experts_of(config)
    for bench in benches:
        main = calibrate({b: load_signals(b) for b in POINT_BENCHES}, config)
        # one fixed combination per content class, fitted on the tuning half of the main collection
        fitted = {name: Combiner([s for store in part.values() for s in store.values() if s['_meta']['half'] == 'tune'], config.get('l2', 1.0))
                  for name, part in pools(main).items()}
        items = subset(bench, n)
        verdicts, scores, stage1_verdicts, stage1_scores, usage = [], [], [], [], []
        for repeat in range(repeats):
            if repeat == 0:
                store = {item['id']: main[bench][item['id']] for item in items}
            else:
                fresh = run_many(items, names, offline, repeat, workers)
                store = {item['id']: derive({'_meta': meta_of(item), **{name: fresh[name][item['id']] for name in fresh}}) for item in items}
                store = calibrate({bench: store}, config)[bench]
            of = {item['id']: fitted[store[item['id']]['_meta']['carries']] for item in items}
            decisions = {item['id']: decide(config, store[item['id']], of[item['id']]) for item in items}
            verdicts.append([decisions[item['id']]['verdict'] for item in items])
            scores.append([score_verdict(decisions[item['id']]['verdict'], item['label']) for item in items])
            first = {item['id']: of[item['id']].p(store[item['id']], list(config['stage1'])) for item in items}
            stage1_verdicts.append(['A' if first[item['id']] > 0.5 else 'B' if first[item['id']] < 0.5 else 'tie' for item in items])
            stage1_scores.append([score_verdict(v, item['label']) for v, item in zip(stage1_verdicts[-1], items)])
            usage.append({'s1_calls': sum(d['calls']['jev'] for d in decisions.values()), 's2_calls': sum(d['calls']['luna'] for d in decisions.values()),
                          'usd': round(sum(d['calls']['usd'] for d in decisions.values()), 4)})
        entry = {'items': len(items), 'variant': {**spread(scores), 'flips': flips(verdicts)},
                 'stage1': {**spread(stage1_scores), 'flips': flips(stage1_verdicts)}, 'usage_per_repeat': usage, 'recorded': {}}
        entry['floor_points'] = entry['variant']['range_points']
        for name in POINT_BENCHES[bench]['baselines']:  # repeats recorded by the baseline's own harness, on its own noise items
            rows = [(item['label'], item['baselines'][name]['repeats']) for item in load_point(bench)
                    if 'repeats' in item.get('baselines', {}).get(name, {})]
            if rows:
                per_repeat = [[score_games(games[r], label) for label, games in rows] for r in range(3)]
                entry['recorded'][name] = {'items': len(rows), **spread(per_repeat), 'flips': flips([[tuple(games[r]) for _, games in rows] for r in range(3)])}
        out['benches'][bench] = entry
    return out


def render(result):
    lines = [f"Noise floor of {result['variant']}: {result['repeats']} repeats on {result['items_per_bench']} items per benchmark", '',
             '| Benchmark | Row | Accuracy per repeat | Range (points) | SD (points) | Items that flip |', '|---|---|---|---:|---:|---:|']
    for bench, entry in result['benches'].items():
        rows = [(f"MoJ {result['variant']}", entry['variant']), ('stage 1 alone', entry['stage1'])]
        rows += [(f'{name} (recorded repeats, n={value["items"]})', value) for name, value in entry['recorded'].items()]
        for label, value in rows:
            lines.append(f"| {bench} | {label} | {', '.join(str(a) for a in value['accuracy'])} | {value['range_points']} | {value['sd_points']} | {100 * value['flips']:.0f}% |")
    return '\n'.join(lines)


if __name__ == '__main__':
    paths = [value for value in sys.argv[1:] if value.endswith('.json')]
    benches = arg('--bench', ','.join(b for b in POINT_BENCHES if POINT_BENCHES[b].get('tune', True))).split(',')
    for path in paths:
        config = json.load(open(path))
        result = noise(config, benches, int(arg('--n', 30)), int(arg('--repeats', 3)), '--offline' in sys.argv, int(arg('--workers', 4)))
        os.makedirs(os.path.join(OUT, 'noise'), exist_ok=True)
        json.dump(result, open(os.path.join(OUT, 'noise', f"{config['name']}.json"), 'w'), indent=1)
        print(render(result))
