"""The pointwise adapter: collection, tuning and scoreboard for benchmarks that judge one output.

  python3 -m moj.pointwise collect --bench verify --experts pw_whole,pw_rows,route [--limit 5] [--offline] [--workers 8]
                                   [--offline-partial]   # replay only: an item with a call never recorded gets no signal
  python3 -m moj.pointwise tune configs/pw-moj-luna.json          # confidence boundaries, on the tuning half only
  python3 -m moj.pointwise score configs/pw-moj-luna.json         # one variant, zero model calls
  python3 -m moj.pointwise board configs/pw-*.json                # the scoreboard of every variant and baseline

A point item is the pair shape with the output in `a` and an empty `b`; label "A" is pass and pA is the
probability of a pass. A pair item with rubric rows keeps both replies and is judged one reply at a time.
Experts come from POINT_CATALOGUE in moj/experts.py, benchmarks from POINT_BENCHES in moj/benches.py.
Signals land in results/pointwise/signals/<bench>/<expert>.json, one file per expert, so two collections of
different experts never write the same file. The policy (stage 1, confidence levels, cards, the fitted
combination) is moj/policy.py unchanged. Weights are fitted on the tuning half, pooled over the benchmarks of
one item kind (point or pair): no weight is tied to a benchmark name.
"""
import copy
import glob
import json
import math
import os
import sys
from concurrent.futures import ThreadPoolExecutor

from . import clients_s2
from .benches import HERE, POINT_BENCHES, load_point
from .experts import POINT_CATALOGUE, PointCtx, carried
from .policy import run_variant, score_games, score_verdict, wilson

OUT = os.path.join(HERE, 'results', 'pointwise')
DERIVED = {'pw_rows_min': ('pw_rows', 'min'), 'pw_rows_prod': ('pw_rows', 'prod')}
BASELINES = ['pw_ledger', 'pw_shipped', 'pw_seat', 'pw_promptfoo']
CHEATERS = ['const_fail', 'const_pass', 'length', 'first']
SINGLES = (['pw_whole', 'pw_rows', 'pw_rows_min'] + [f'pw_{unit}_{model}' for unit in ('s2v', 'ref', 'split') for model in ('luna', 'gemini', 'haiku')])


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def signal_path(bench, expert):
    return os.path.join(OUT, 'signals', bench, f'{expert}.json')


def run_expert(item, name, offline=False, repeat=0):
    ctx = PointCtx(item, offline, repeat)
    out = POINT_CATALOGUE[name]['fn'](ctx)
    return {'pA': out['pA'], 'detail': out['detail'], 'calls': ctx.calls, 'usd': round(ctx.usd, 6),
            'seconds': {k: round(sum(v), 3) for k, v in ctx.seconds.items()}, 'missing': ctx.missing}


def _guarded(item, name, offline, repeat):
    """offline == 'partial': an item with a call that was never recorded gets no signal, and nothing is sent."""
    try:
        return run_expert(item, name, bool(offline), repeat)
    except RuntimeError:
        if offline == 'partial':
            return None
        raise


def run_many(items, experts, offline=False, repeat=0, workers=8):
    """{expert: {id: signal}} for the given items. At most eight tasks run at a time; each model has its own limit."""
    tasks = [(item, name) for name in experts for item in items]
    with ThreadPoolExecutor(max_workers=max(1, min(workers, 8))) as pool:
        results = list(pool.map(lambda task: _guarded(task[0], task[1], offline, repeat), tasks))
    out = {name: {} for name in experts}
    for (item, name), signal in zip(tasks, results):
        if signal is not None:
            out[name][item['id']] = signal
    return out


def collect(bench, experts, limit=None, offline=False, workers=8):
    items = load_point(bench)[:limit]
    fresh = run_many(items, experts, offline, 0, workers)
    totals = {'items': len(items), 'signals': {name: len(fresh[name]) for name in experts}, 'jev_calls': 0, 's2_calls': 0, 's2_usd': 0.0, 'missing': 0}
    for name in experts:
        path = signal_path(bench, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        store = json.load(open(path)) if os.path.exists(path) else {}
        store.update(fresh[name])
        json.dump(store, open(path, 'w'), ensure_ascii=False, indent=0)
        for signal in fresh[name].values():
            totals['jev_calls'] += signal['calls']['jev']
            totals['s2_calls'] += signal['calls']['luna']
            totals['s2_usd'] += signal['usd']
            totals['missing'] += signal['missing']
    totals['s2_usd'] = round(totals['s2_usd'], 4)
    totals['spend'] = clients_s2.write_spend()['total_usd']
    totals['stopped'] = clients_s2.stopped()
    return totals


CLASSES = {'rows': 'rows', 'rubric': 'criterion', 'reference': 'criterion', 'question': 'question'}


def meta_of(item):
    # 'carries': what the item brings for the judge to check against. rows (rubric rows), criterion (one criterion text or
    # one reference) or question (nothing but the request). Boundaries and weights are fitted per class of content.
    return {'label': item['label'], 'half': item['half'], 'split': item['split'], 'group': item['group'], 'kind': item['kind'],
            'carries': POINT_BENCHES[item['bench']].get('carries') or CLASSES[carried(item)],
            'language': item['language'], 'swapped': item['swapped'], 'baselines': item.get('baselines', {})}


def derive(signals):
    """Adds the code-only readings of a stored signal (another verdict rule over the same rows): no call."""
    for name, (source, rule) in DERIVED.items():
        if source in signals:
            signals[name] = {**signals[source], 'pA': signals[source]['detail']['rules'][rule]}
    return signals


def load_signals(bench, ids=None):
    """{id: {expert: signal, '_meta': ...}} of one benchmark, from the per-expert files."""
    store = {item['id']: {'_meta': meta_of(item)} for item in load_point(bench) if ids is None or item['id'] in ids}
    for path in sorted(glob.glob(signal_path(bench, '*'))):
        name = os.path.basename(path)[:-5]
        for item_id, signal in json.load(open(path)).items():
            if item_id in store:
                store[item_id][name] = signal
    return {item_id: derive(signals) for item_id, signals in store.items()}


def calibrate(pooled, config):
    """config['calibrate'] = {expert: {class: t}}: moves the yes boundary of an expert from 0.5 to t on point items of one content class.

    A point item has no swap to cancel a constant lean of the decision model, so the boundary is a tuned number.
    """
    shifts = config.get('calibrate') or {}
    if not shifts:
        return pooled
    pooled = copy.deepcopy(pooled)
    for store in pooled.values():
        for signals in store.values():
            if signals['_meta']['kind'] != 'point':
                continue
            for name, by_class in shifts.items():
                boundary = by_class.get(signals['_meta']['carries'])
                p = (signals.get(name) or {}).get('pA')
                if p is not None and boundary is not None:
                    p, boundary = min(max(p, 1e-4), 1 - 1e-4), min(max(boundary, 1e-4), 1 - 1e-4)
                    z = math.log(p / (1 - p)) - math.log(boundary / (1 - boundary))
                    signals[name]['pA'] = 1 / (1 + math.exp(-z))
    return pooled


def pools(pooled):
    """Splits the items by what they carry: {class: {bench: {id: signals}}}. One combination is fitted per class."""
    out = {}
    for bench, store in pooled.items():
        for item_id, signals in store.items():
            out.setdefault(signals['_meta']['carries'], {}).setdefault(bench, {})[item_id] = signals
    return out


def decide_all(config, pooled):
    """Runs the variant per content class. Returns {(bench, id): decision} and the fitted weights per class."""
    decisions, weights = {}, {}
    for name, part in sorted(pools(calibrate(pooled, config)).items()):
        out, combiner = run_variant(config, part)
        decisions.update(out)
        weights[name] = {'+'.join(k): [round(float(x), 2) for x in w] for k, w in combiner.models.items()}
    return decisions, weights


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


def usage_of(signals, experts):
    """Calls, cost and latency of a list of experts on one item. Recorded baselines bring their recorded calls and cost."""
    out = {'jev': 0, 's2': 0, 'usd': 0.0, 'seconds': 0.0, 'by_model': {}}
    for name in experts:
        signal = signals.get(name)
        if not signal:
            continue
        detail = signal['detail'] if isinstance(signal.get('detail'), dict) else {}
        out['jev'] += signal['calls']['jev']
        out['s2'] += signal['calls']['luna'] + (detail.get('recorded_calls') or 0)
        out['usd'] += signal['usd'] + (detail.get('recorded_usd') or 0)
        out['seconds'] += signal['seconds']['jev'] + signal['seconds']['luna']
        for model, count in (signal['calls'].get('s2') or {}).items():
            out['by_model'][model] = out['by_model'].get(model, 0) + count
    return out


def usage_cell(entry, usages):
    if not usages:
        return entry
    n = len(usages)
    entry.update({'s1_per_100': 100 * sum(u['jev'] for u in usages) / n, 's2_per_100': 100 * sum(u['s2'] for u in usages) / n,
                  'usd_per_100': 100 * sum(u['usd'] for u in usages) / n, 'seconds_per_item': sum(u['seconds'] for u in usages) / n})
    models = {}
    for usage in usages:
        for model, count in usage['by_model'].items():
            models[model] = models.get(model, 0) + count
    entry['s2_by_model_per_100'] = {model: round(100 * count / n, 1) for model, count in models.items()}
    return entry


def balanced(pairs):
    """Mean of the accuracy on pass items and on fail items: a constant verdict scores 50."""
    sides = [[score for label, score in pairs if label == side and score is not None] for side in ('A', 'B')]
    sides = [sum(side) / len(side) for side in sides if side]
    return sum(sides) / len(sides) if sides else float('nan')


def board(config, benches=None, pooled=None):
    benches = benches or list(POINT_BENCHES)
    pooled = pooled or {bench: load_signals(bench) for bench in benches}
    decisions, weights = decide_all(config, pooled)
    out = {'variant': config['name'], 'note': config.get('note'), 'weights': weights, 'cells': {}}
    for bench in benches:
        store = pooled[bench]
        for half in ('tune', 'valid'):
            ids = [i for i in store if store[i]['_meta']['half'] == half]
            if not ids:
                continue
            row = {'items': len(ids)}
            scores = [score_verdict(decisions[(bench, i)]['verdict'], store[i]['_meta']['label']) for i in ids]
            moj = cell(scores)
            paid = []
            for i in ids:
                decision = decisions[(bench, i)]
                names = list(decision['path']) + (['route'] if config.get('cards') or config.get('always') else [])
                paid.append(usage_of(store[i], [DERIVED.get(name, (name,))[0] for name in names]))
            usage_cell(moj, paid)
            moj['balanced'] = balanced([(store[i]['_meta']['label'], s) for i, s in zip(ids, scores)])
            moj['levels'] = {level: round(sum(1 for i in ids if decisions[(bench, i)]['level'] == level) / len(ids), 3) for level in ('high', 'middle', 'low')}
            moj['abstain'] = sum(1 for i in ids if decisions[(bench, i)]['verdict'] == 'abstain') / len(ids)
            row['moj'] = moj
            for name in SINGLES + BASELINES + CHEATERS:
                scored = [(i, single_score(store[i], name)) for i in ids]
                scored = [(i, s) for i, s in scored if s is not None]
                entry = cell([s for _, s in scored])
                if scored:
                    usage_cell(entry, [usage_of(store[i], [DERIVED.get(name, (name,))[0]]) for i, _ in scored])
                    entry['balanced'] = balanced([(store[i]['_meta']['label'], s) for i, s in scored])
                    entry['moj_same_items'] = cell([score_verdict(decisions[(bench, i)]['verdict'], store[i]['_meta']['label']) for i, _ in scored])
                row[name] = entry
            out['cells'][f'{bench}.{half}'] = row
    out['decisions'] = {f'{b}|{i}': {**d, 'label': pooled[b][i]['_meta']['label'], 'half': pooled[b][i]['_meta']['half']}
                        for (b, i), d in decisions.items()}
    return out


def tune(config, benches=None):
    """Picks hi, lo and the stage-1 boundaries on the tuning half only, by balanced accuracy. Ties go to the cheaper setting."""
    benches = benches or [bench for bench in POINT_BENCHES if POINT_BENCHES[bench].get('tune', True)]
    pooled = {bench: load_signals(bench) for bench in benches}
    tune_ids = [(b, i) for b in benches for i in pooled[b] if pooled[b][i]['_meta']['half'] == 'tune']

    def tune_score(candidate):
        # The objective is the balanced accuracy on the tuning half, averaged over the benchmarks: a constant verdict
        # earns 50 on a point benchmark, so a variant cannot win by copying the constant-fail cheater.
        decisions, _ = decide_all(candidate, pooled)
        total = 0.0
        for bench in benches:
            ids = [k for k in tune_ids if k[0] == bench]
            total += balanced([(pooled[b][i]['_meta']['label'], score_verdict(decisions[(b, i)]['verdict'], pooled[b][i]['_meta']['label'])) for b, i in ids])
        cost = sum(decisions[k]['calls']['luna'] for k in tune_ids)
        return (round(100 * total / len(benches), 4), -cost)

    best = copy.deepcopy(config)
    best.pop('calibrate', None)
    trail = []
    tolerance = config.get('tune_tolerance_points', 0.0)
    classes = sorted({pooled[b][i]['_meta']['carries'] for b, i in tune_ids if pooled[b][i]['_meta']['kind'] == 'point'})
    for name in config.get('tune_calibrate', []):
        for content in classes:
            options = []
            for boundary in (0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95):
                candidate = copy.deepcopy(best)
                candidate.setdefault('calibrate', {}).setdefault(name, {})[content] = boundary
                candidate.update({'hi': 0.0, 'lo': 0.0})  # the boundary is tuned with no confidence level in play
                options.append((tune_score(candidate), -abs(boundary - 0.5), boundary))
            chosen = max(options)
            best.setdefault('calibrate', {}).setdefault(name, {})[content] = chosen[2]
            trail.append({'calibrate': name, 'class': content, 'boundary': chosen[2], 'tune_balanced': chosen[0][0],
                          'options': [(o[2], o[0][0]) for o in options]})
    if config.get('tune_levels', True) and (config.get('low') or config.get('cards')):
        options = []
        for hi in (0.55, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99):
            for lo in (0.55, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99):
                if lo > hi:
                    continue
                candidate = copy.deepcopy(best)
                candidate.update({'hi': hi, 'lo': lo})
                options.append((tune_score(candidate), hi, lo))
        top = max(options)[0][0]
        # The cheapest setting within the tolerance of the best one: a gain smaller than the noise floor does not buy more calls.
        chosen = max((option for option in options if option[0][0] >= top - tolerance), key=lambda option: (option[0][1], option[0][0]))
        best.update({'hi': chosen[1], 'lo': chosen[2]})
        trail.append({'levels': {'hi': chosen[1], 'lo': chosen[2]}, 'tune_balanced': chosen[0][0], 'best_tune_balanced': top,
                      'tolerance_points': tolerance, 'tune_items': len(tune_ids), 'tune_s2_calls': -chosen[0][1]})
    best['tuned'] = {'on': 'tuning half only', 'trail': trail}
    return best


def fmt_acc(entry):
    if not entry or not entry.get('n'):
        return 'n/a'
    return f"{100 * entry['acc']:.1f} [{100 * entry['low']:.0f}, {100 * entry['high']:.0f}] n={entry['n']}"


def fmt_num(entry, key, digits=1):
    value = (entry or {}).get(key)
    return 'n/a' if value is None else f'{value:.{digits}f}'


ROW_LABELS = {'pw_ledger': 'our judge (recorded)', 'pw_shipped': 'our shipped judge (recorded)', 'pw_seat': 'our judge with a domain seat (recorded)',
              'pw_promptfoo': 'other framework (recorded)', 'pw_s2v_luna': 'other framework default grader, gpt-6-luna (fresh)',
              'pw_s2v_gemini': 'other framework default grader, gemini-3.8-flash (fresh)',
              'pw_s2v_haiku': 'other framework default grader, haiku (fresh)',
              'const_fail': 'cheater: constant fail', 'const_pass': 'cheater: constant pass', 'length': 'cheater: longer wins', 'first': 'cheater: first wins'}


def scoreboard(configs, benches=None):
    """One table per benchmark: MoJ variants, our judge, the other framework, the cheaters, on both halves."""
    benches = benches or list(POINT_BENCHES)
    pooled = {bench: load_signals(bench) for bench in benches}
    boards = [board(config, benches, pooled) for config in configs]
    lines, table = [], {}
    for bench in benches:
        tune_cell, valid_cell = boards[0]['cells'].get(f'{bench}.tune'), boards[0]['cells'].get(f'{bench}.valid')
        if not tune_cell or not valid_cell:
            continue
        lines += [f"## {bench} ({tune_cell['items']} tuning items, {valid_cell['items']} validation items)", '',
                  '| Row | Tuning half: accuracy [95% interval] | Validation half: accuracy [95% interval] | Balanced accuracy, tuning / validation | S1 calls per 100 | S2 calls per 100 | USD per 100 | Seconds per item |',
                  '|---|---|---|---|---:|---:|---:|---:|']
        rows = [(f"MoJ {b['variant']}", b['cells'][f'{bench}.tune']['moj'], b['cells'][f'{bench}.valid']['moj']) for b in boards]
        for name in BASELINES + ['pw_s2v_luna', 'pw_s2v_gemini', 'pw_s2v_haiku'] + CHEATERS:
            if tune_cell[name]['n'] or valid_cell[name]['n']:
                rows.append((ROW_LABELS[name], tune_cell[name], valid_cell[name]))
        for label, on_tune, on_valid in rows:
            usage = on_valid if on_valid.get('n') else on_tune
            both = ' / '.join('n/a' if not e.get('n') else f"{100 * e['balanced']:.0f}" for e in (on_tune, on_valid))
            recorded = '(recorded)' in label  # a recorded baseline has no latency here, and a cost only where its harness stored one
            usd = 'n/a' if recorded and not usage.get('usd_per_100') else fmt_num(usage, 'usd_per_100', 4)
            lines.append(f"| {label} | {fmt_acc(on_tune)} | {fmt_acc(on_valid)} | {both} | {fmt_num(usage, 's1_per_100', 0)} | {fmt_num(usage, 's2_per_100', 0)} | "
                         f"{usd} | {'n/a' if recorded else fmt_num(usage, 'seconds_per_item', 2)} |")
            table.setdefault(bench, []).append({'row': label, 'tune': on_tune, 'valid': on_valid})
        lines.append('')
    return '\n'.join(lines), table, boards


def load_config(path):
    return json.load(open(path))


if __name__ == '__main__':
    command = sys.argv[1] if len(sys.argv) > 1 else ''
    paths = [value for value in sys.argv[2:] if value.endswith('.json')]
    if command == 'collect':
        experts = arg('--experts', 'pw_whole,pw_rows,route').split(',')
        limit = int(arg('--limit')) if arg('--limit') else None
        for bench in arg('--bench', ','.join(POINT_BENCHES)).split(','):
            mode = 'partial' if '--offline-partial' in sys.argv else '--offline' in sys.argv
            print(bench, json.dumps(collect(bench, experts, limit, mode, int(arg('--workers', 8)))), flush=True)
    elif command == 'tune':
        for path in paths:
            tuned = tune(load_config(path))
            json.dump(tuned, open(path, 'w'), indent=1)
            print(path, json.dumps(tuned['tuned']))
    elif command == 'score':
        for path in paths:
            result = board(load_config(path))
            os.makedirs(os.path.join(OUT, 'boards'), exist_ok=True)
            json.dump(result, open(os.path.join(OUT, 'boards', f"{result['variant']}.json"), 'w'), indent=1)
            for name, row in result['cells'].items():
                print(f"{result['variant']:22} {name:18} {fmt_acc(row['moj'])} levels {row['moj']['levels']} S1/100 {fmt_num(row['moj'], 's1_per_100', 0)} "
                      f"S2/100 {fmt_num(row['moj'], 's2_per_100', 0)} USD/100 {fmt_num(row['moj'], 'usd_per_100', 4)}")
    elif command == 'board':
        text, table, boards = scoreboard([load_config(path) for path in paths])
        os.makedirs(os.path.join(OUT, 'boards'), exist_ok=True)
        for result in boards:
            json.dump(result, open(os.path.join(OUT, 'boards', f"{result['variant']}.json"), 'w'), indent=1)
        json.dump(table, open(os.path.join(OUT, 'scoreboard.json'), 'w'), indent=1)
        open(os.path.join(OUT, 'SCOREBOARD.md'), 'w').write(text + '\n')
        print(text)
    else:
        print(__doc__)
