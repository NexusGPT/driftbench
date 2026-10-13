"""Round tools, all from stored signals (zero model calls).

  python3 -m moj.rounds residual configs/<variant>.json   the two numbers the rounds drive to zero
  python3 -m moj.rounds curve configs/<variant>.json      cost and accuracy as the confidence boundaries move
  python3 -m moj.rounds ablate configs/<variant>.json     what the score loses when each component is removed
  python3 -m moj.rounds terrain configs/<variant>.json    accuracy and cost per terrain type, route against oracle
"""
import copy
import json
import os
import random
import sys

from .benches import HERE
from .collect import load_signals
from .policy import score_games, score_verdict
from .score import BASELINES, CHEATERS, COST_ORDER, board, single_score

NOISE_FILE = os.path.join(HERE, 'results', 'noise-floor.json')


def noise_floor():
    return json.load(open(NOISE_FILE)) if os.path.exists(NOISE_FILE) else {}


def pooled(result, half):
    keys = [k for k, d in result['decisions'].items() if half == 'all' or d['half'] == half]
    acc = sum(score_verdict(result['decisions'][k]['verdict'], result['decisions'][k]['label']) for k in keys) / len(keys)
    s1 = sum(result['decisions'][k]['calls']['jev'] for k in keys) / len(keys)
    s2 = sum(result['decisions'][k]['calls']['luna'] for k in keys) / len(keys)
    return acc, s1, s2, len(keys)


def paired_interval(diffs, draws=4000, seed=7):
    rng = random.Random(seed)
    n = len(diffs)
    means = sorted(sum(diffs[rng.randrange(n)] for _ in range(n)) / n for _ in range(draws))
    return means[int(0.025 * draws)], means[int(0.975 * draws)]


def residual(config, quiet=False):
    """Cells where MoJ is not ahead of the best baseline by more than the noise floor (R1), and cells where MoJ
    costs more System-2 calls than the cheapest baseline it does not beat (R2). One cell per benchmark and model."""
    result = board(config)
    floors = noise_floor()
    rows, r1, r2 = [], 0, 0
    for name, row in result['cells'].items():
        bench, half = name.split('.')
        if half != 'all':
            continue
        store = load_signals(bench)
        floor = floors.get(bench, floors.get('default', 0.03))
        best_name, best_acc, detail = None, -1, {}
        for label, expert in list(BASELINES.items()) + [(c, c) for c in CHEATERS]:
            keys = [i for i in store if single_score(store[i], expert) is not None]
            if not keys:
                continue
            base = [single_score(store[i], expert) for i in keys]
            moj = [score_verdict(result['decisions'][f'{bench}|{i}']['verdict'], store[i]['_meta']['label']) for i in keys]
            diffs = [m - b for m, b in zip(moj, base)]
            low, high = paired_interval(diffs)
            s2 = row[expert].get('luna', 0)
            detail[label] = {'n': len(keys), 'baseline': sum(base) / len(base), 'moj_same_pairs': sum(moj) / len(moj),
                             'diff': sum(diffs) / len(diffs), 'diff_low': low, 'diff_high': high, 'baseline_s2_calls': s2}
            if sum(base) / len(base) > best_acc:
                best_name, best_acc = label, sum(base) / len(base)
        ahead = detail[best_name]['diff'] > floor
        valid = result['cells'][f'{bench}.valid']
        not_beaten = [d for d in detail.values() if d['diff'] <= floor]
        cheaper_unbeaten = min((d['baseline_s2_calls'] for d in not_beaten), default=None)
        costly = cheaper_unbeaten is not None and row['moj']['luna'] > cheaper_unbeaten
        r1 += 0 if ahead else 1
        r2 += 1 if costly else 0
        rows.append({'cell': f'{bench} x gpt-6-luna', 'moj': row['moj']['acc'], 'moj_valid': valid['moj']['acc'], 'best_baseline': best_name,
                     'noise_floor': floor, 'ahead': ahead, 'costlier_than_unbeaten': costly, 'moj_s1': row['moj']['jev'], 'moj_s2': row['moj']['luna'],
                     'detail': detail})
    out = {'variant': config['name'], 'R1_cells_not_ahead': r1, 'R2_cells_costlier_than_unbeaten': r2, 'cells': rows}
    if not quiet:
        print(f"{config['name']}: R1 = {r1} of {len(rows)} cells not ahead of the best baseline by more than the noise floor; R2 = {r2}")
        for row in rows:
            print(f"  {row['cell']}: MoJ {100 * row['moj']:.1f} (valid half {100 * row['moj_valid']:.1f}), S1 {row['moj_s1']:.1f} S2 {row['moj_s2']:.2f} calls per pair, floor {100 * row['noise_floor']:.1f}")
            for label, d in row['detail'].items():
                print(f"     vs {label:9} {100 * d['baseline']:.1f} on {d['n']} pairs; MoJ there {100 * d['moj_same_pairs']:.1f}; "
                      f"diff {100 * d['diff']:+.1f} [{100 * d['diff_low']:+.1f}, {100 * d['diff_high']:+.1f}]; baseline S2 calls {d['baseline_s2_calls']:.2f}")
    return out


def curve(config):
    points = []
    grid = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.93, 0.96, 0.99, 1.01]
    for hi in grid:
        for lo in [g for g in grid if g <= hi]:
            variant = copy.deepcopy(config)
            variant['hi'], variant['lo'] = hi, lo
            result = board(variant)
            tune, valid = pooled(result, 'tune'), pooled(result, 'valid')
            points.append({'hi': hi, 'lo': lo, 'tune_acc': tune[0], 'valid_acc': valid[0], 's1': tune[1], 's2': tune[2]})
    # Pareto front on the tuning half: no other point is both cheaper in System-2 calls and more accurate.
    front = [p for p in points if not any(q['s2'] <= p['s2'] and q['tune_acc'] >= p['tune_acc'] and (q['s2'], q['tune_acc']) != (p['s2'], p['tune_acc']) for q in points)]
    front = sorted({(p['s2'], p['tune_acc']): p for p in front}.values(), key=lambda p: p['s2'])
    print(f"{config['name']}: cost and accuracy curve (pooled; boundaries picked on the tuning half)")
    for p in front:
        print(f"  hi {p['hi']:.2f} lo {p['lo']:.2f}: tune {100 * p['tune_acc']:.1f} valid {100 * p['valid_acc']:.1f} S1 {p['s1']:.1f} S2 {p['s2']:.2f} calls per pair")
    return {'points': points, 'front': front}


def ablate(config):
    base = board(config)
    rows = []
    variants = []
    for i, card in enumerate(config.get('cards', [])):
        v = copy.deepcopy(config); v['cards'].pop(i); variants.append((f"card {card['expert']} {card.get('terrain')}", v))
    for i, card in enumerate(config.get('always', [])):
        v = copy.deepcopy(config); v['always'].pop(i); variants.append((f"always {card['expert']} {card.get('terrain')}", v))
    for name in config.get('low', []):
        v = copy.deepcopy(config); v['low'] = [n for n in v['low'] if n != name]; variants.append((f'low {name}', v))
    for name in config['stage1']:
        if len(config['stage1']) > 1:
            v = copy.deepcopy(config); v['stage1'] = [n for n in v['stage1'] if n != name]; variants.append((f'stage1 {name}', v))
    print(f"{config['name']}: ablation (accuracy lost when the component is removed; pooled)")
    for label, variant in variants:
        result = board(variant)
        row = {'removed': label}
        for half in ('tune', 'valid'):
            row[half] = pooled(base, half)[0] - pooled(result, half)[0]
        row['s2_saved'] = pooled(base, 'all')[2] - pooled(result, 'all')[2]
        rows.append(row)
        print(f"  without {label}: tune {100 * row['tune']:+.1f} valid {100 * row['valid']:+.1f} points earned; S2 calls it costs {row['s2_saved']:+.2f}")
    return rows


def terrain_test(config, threshold=0.6):
    result = board(config)
    stores = {}
    table = {}
    rough = {'n': 0, 'recovered': 0}
    for key, d in result['decisions'].items():
        bench, item_id = key.split('|', 1)
        store = stores.setdefault(bench, load_signals(bench))
        land = store[item_id]['route']['detail']
        types = [f for f, v in land.items() if f not in ('chars', 'length_gap', 'non_latin') and v is not None and v >= threshold]
        if land.get('length_gap', 0) >= 0.5:
            types.append('length_gap')
        if land.get('chars', 0) >= 12000:
            types.append('long_context')
        if land.get('non_latin', 0) >= 0.3:
            types.append('non_latin')
        right = score_verdict(d['verdict'], d['label'])
        singles = {n: single_score(store[item_id], n) for n in COST_ORDER}
        if not any(v == 1.0 for v in singles.values()):
            rough['n'] += 1
            rough['recovered'] += right == 1.0
        for t in types or ['plain']:
            row = table.setdefault(t, {'n': 0, 'moj': 0.0, 's2': 0.0, 'singles': {n: [] for n in COST_ORDER}})
            row['n'] += 1; row['moj'] += right; row['s2'] += d['calls']['luna']
            for n, v in singles.items():
                if v is not None:
                    row['singles'][n].append(v)
    print(f"{config['name']}: terrain test (all practice pairs; a pair can sit on several terrains)")
    for t, row in sorted(table.items(), key=lambda kv: -kv[1]['n']):
        singles = ' '.join(f"{n} {100 * sum(v) / len(v):.0f}" for n, v in row['singles'].items() if v)
        print(f"  {t:18} n={row['n']:3} MoJ {100 * row['moj'] / row['n']:.0f} at S2 {row['s2'] / row['n']:.2f} | {singles}")
    print(f"  rough ground (every single design wrong): {rough['n']} pairs, MoJ right on {rough['recovered']}")
    return table


if __name__ == '__main__':
    command, config = sys.argv[1], json.load(open(sys.argv[2]))
    out = {'residual': residual, 'curve': curve, 'ablate': ablate, 'terrain': terrain_test}[command](config)
    os.makedirs(os.path.join(HERE, 'results', 'rounds'), exist_ok=True)
    json.dump(out, open(os.path.join(HERE, 'results', 'rounds', f"{command}-{config['name']}.json"), 'w'), indent=1, default=str)
