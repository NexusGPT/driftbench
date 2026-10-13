"""Scoreboard of one MoJ variant against the baselines, from stored signals (zero model calls).

  python3 -m moj.score configs/<variant>.json [--json]

Per benchmark and per half (tune, valid): accuracy with a Wilson 95 percent interval, calls per pair of each
kind, share of items per confidence level, calibration error, the route against the oracle route, and the two
numbers the rounds drive to zero.
"""
import json
import os
import sys

from .benches import BENCHES, HERE
from .collect import load_signals
from .experts import CATALOGUE
from .policy import calls_of, run_variant, score_games, score_verdict, terrain, wilson, x_of

JUDGES = ['s1p', 's1pr', 's1r', 's1cf', 'ref', 'adv', 'debate', 's2v', 's2h', 's2l']
BASELINES = {'ledger': 's2l', 'promptfoo': 's2v'}
CHEATERS = ['length', 'first']
# Order of cost for the oracle route: System-1 units first, then mixed, then System 2.
COST_ORDER = ['s1p', 's1cf', 's1pr', 's1r', 'ref', 's2v', 's2h', 'adv', 'debate', 's2l']


def single_score(signals, name):
    signal = signals.get(name)
    if not signal or signal['pA'] is None:
        return None
    label = signals['_meta']['label']
    games = signal['detail'].get('games') if isinstance(signal['detail'], dict) else None
    if games:
        return score_games(games, label)
    p = signal['pA']
    return score_verdict('A' if p > 0.5 else 'B' if p < 0.5 else 'tie', label)


def cell(scores):
    scores = [s for s in scores if s is not None]
    n = len(scores)
    mean = sum(scores) / n if n else float('nan')
    low, high = wilson(mean, n) if n else (float('nan'), float('nan'))
    return {'n': n, 'acc': mean, 'low': low, 'high': high}


def ece(decisions, signals_by_key, bins=10):
    rows = [(d['confidence'], score_verdict('A' if d['p'] > 0.5 else 'B', signals_by_key[key]['_meta']['label']))
            for key, d in decisions.items() if d['p'] != 0.5]
    total, error, curve = len(rows), 0.0, []
    for b in range(bins // 2, bins):
        low, high = b / bins, (b + 1) / bins
        inside = [(c, s) for c, s in rows if (low <= c < high) or (b == bins - 1 and c == 1.0)]
        if not inside:
            continue
        conf = sum(c for c, _ in inside) / len(inside)
        acc = sum(s for _, s in inside) / len(inside)
        error += len(inside) / total * abs(conf - acc)
        curve.append({'bin': f'{low:.1f}-{high:.1f}', 'n': len(inside), 'confidence': round(conf, 3), 'accuracy': round(acc, 3)})
    return error, curve


def board(config, benches=None):
    benches = benches or [b for b in BENCHES if os.path.exists(os.path.join(HERE, 'results', 'signals', f'{b}.json'))]
    pooled = {bench: load_signals(bench) for bench in benches}
    decisions, combiner = run_variant(config, pooled)
    by_key = {(bench, item_id): s for bench, store in pooled.items() for item_id, s in store.items()}
    out = {'variant': config['name'], 'cells': {}, 'weights': {'+'.join(k): [round(float(x), 2) for x in w] for k, w in combiner.models.items() if k and k[0] != 'boundary'}}
    for bench in benches:
        for half in ('tune', 'valid', 'all'):
            keys = [k for k in by_key if k[0] == bench and (half == 'all' or by_key[k]['_meta']['half'] == half)]
            if not keys:
                continue
            row = {'pairs': len(keys)}
            moj = [score_verdict(decisions[k]['verdict'], by_key[k]['_meta']['label']) for k in keys]
            row['moj'] = cell(moj)
            for kind in ('jev', 'luna', 'usd', 'seconds'):
                row['moj'][kind] = sum(decisions[k]['calls'][kind] for k in keys) / len(keys)
            row['moj']['levels'] = {}
            for level in ('high', 'middle', 'low'):
                inside = [k for k in keys if decisions[k]['level'] == level]
                row['moj']['levels'][level] = {'share': len(inside) / len(keys),
                                               'acc': cell([score_verdict(decisions[k]['verdict'], by_key[k]['_meta']['label']) for k in inside])['acc']}
            row['moj']['abstain'] = sum(1 for k in keys if decisions[k]['verdict'] == 'abstain') / len(keys)
            row['moj']['ece'], row['moj']['curve'] = ece({k: decisions[k] for k in keys}, by_key)
            for name in JUDGES + CHEATERS:
                scores = [single_score(by_key[k], name) for k in keys]
                entry = cell(scores)
                used = [calls_of(by_key[k], [name]) for k in keys if single_score(by_key[k], name) is not None]
                if used:
                    for kind in ('jev', 'luna', 'usd', 'seconds'):
                        entry[kind] = sum(u[kind] for u in used) / len(used)
                row[name] = entry
            # MoJ on the same pairs as each recorded baseline (a baseline may cover a subset only).
            for label, name in BASELINES.items():
                same = [k for k in keys if single_score(by_key[k], name) is not None]
                row[f'moj_on_{label}_pairs'] = cell([score_verdict(decisions[k]['verdict'], by_key[k]['_meta']['label']) for k in same])
            # Oracle route: the cheapest expert that gets the item right.
            oracle, chosen_right, rough = {}, 0, 0
            for k in keys:
                right = [name for name in COST_ORDER if single_score(by_key[k], name) == 1.0]
                if not right:
                    rough += 1
                    continue
                oracle[right[0]] = oracle.get(right[0], 0) + 1
                chosen_right += score_verdict(decisions[k]['verdict'], by_key[k]['_meta']['label']) == 1.0
            row['oracle'] = {'cheapest_right': oracle, 'rough_ground': rough, 'oracle_acc': 1 - rough / len(keys),
                             'route_acc': chosen_right / max(1, len(keys) - rough),
                             'rough_recovered': sum(1 for k in keys if not any(single_score(by_key[k], n) == 1.0 for n in COST_ORDER)
                                                    and score_verdict(decisions[k]['verdict'], by_key[k]['_meta']['label']) == 1.0)}
            out['cells'][f'{bench}.{half}'] = row
    out['decisions'] = {f'{b}|{i}': {**d, 'label': by_key[(b, i)]['_meta']['label'], 'half': by_key[(b, i)]['_meta']['half']}
                        for (b, i), d in decisions.items()}
    return out


def fmt(entry, calls=True):
    if not entry or entry.get('n', 0) == 0:
        return 'n/a'
    text = f"{100 * entry['acc']:.1f} [{100 * entry['low']:.0f}, {100 * entry['high']:.0f}] n={entry['n']}"
    if calls and 'jev' in entry:
        text += f" S1 {entry['jev']:.1f} S2 {entry['luna']:.2f}"
    return text


def print_board(result):
    print(f"# {result['variant']}")
    for name, row in result['cells'].items():
        if name.endswith('.all'):
            continue
        print(f"\n## {name} ({row['pairs']} pairs)")
        print('  MoJ        ', fmt(row['moj']), '| levels', {k: f"{100 * v['share']:.0f}% at {100 * v['acc']:.0f}" for k, v in row['moj']['levels'].items()},
              f"| ECE {row['moj']['ece']:.3f}")
        for label in ('ledger', 'promptfoo'):
            print(f'  {label:11}', fmt(row[BASELINES[label]]), '| MoJ on the same pairs', fmt(row[f'moj_on_{label}_pairs'], False))
        print('  experts    ', ' | '.join(f"{n} {100 * row[n]['acc']:.0f}" for n in JUDGES if row[n]['n']))
        print('  cheaters   ', ' | '.join(f"{n} {100 * row[n]['acc']:.0f}" for n in CHEATERS))
        print('  oracle     ', f"ceiling {100 * row['oracle']['oracle_acc']:.0f}, rough ground {row['oracle']['rough_ground']}, "
              f"route accuracy {100 * row['oracle']['route_acc']:.0f}, cheapest right {row['oracle']['cheapest_right']}")


if __name__ == '__main__':
    config = json.load(open(sys.argv[1]))
    result = board(config)
    os.makedirs(os.path.join(HERE, 'results', 'boards'), exist_ok=True)
    json.dump(result, open(os.path.join(HERE, 'results', 'boards', f"{config['name']}.json"), 'w'), indent=1)
    print_board(result)
