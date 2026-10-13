"""Offline replay of the final practice-selected pointwise configuration.

The three accepted terrain cells retain their frozen policy. Bare questions use
the previously measured Luna solve plus S1 compare expert. No label audit enters
the route, and none of the validation oracle thresholds is deployed.
"""
import hashlib
import json
from . import pointwise_router as r
from . import two_step as t
from . import two_step_terrain as z

CONFIG = r.ROOT / 'configs/pw-final-frozen.json'
OUT = r.OUT / 'final'


def decide(item, stores, config):
    if t.shape(item) == 'question':
        s = r.old_signal(item, config['bare_question_expert'], stores)
        return {'pA': s['pA'], 'verdict': r.verdict(s['pA']),
                'usage': s['usage'], 'path': ['solve-compare'], 'level': 'expert'}
    return z.decide(item, stores, config['terrain_config'], offline=True)


def report():
    cfg = json.loads(CONFIG.read_text())
    for path, digest in cfg['source_hashes'].items():
        assert hashlib.sha256((r.ROOT / path).read_bytes()).hexdigest() == digest, path
    r.setup_client()
    items = t.population('valid'); stores = r.load_stores(True)
    ds = {r.key(i): decide(i, stores, cfg) for i in items}
    old = json.loads((r.OUT / 'v3/validation.json').read_text())
    cells = {}; comparisons = {}; residual = 0
    for bench in (*r.BENCHES, r.DIAGNOSTIC):
        its = [i for i in items if i['bench'] == bench]
        cell = r.metrics(its, ds); cells[bench] = cell
        floor = old['benchmarks'][bench]['noise_floor_points'] or 0.
        comparisons[bench] = {}
        full_met = []
        for name, historical in old['benchmarks'][bench]['rows'].items():
            if name == 'MoJ':
                continue
            bd = r.baseline_decisions(its, stores, name)
            subset = [i for i in its if r.key(i) in bd]
            assert len(subset) == historical['n'], (bench, name, len(subset), historical['n'])
            baseline = r.metrics(subset, bd); ours = r.metrics(subset, ds)
            assert abs(baseline['accuracy'] - historical['accuracy']) < 1e-12
            delta = 100 * (ours['accuracy'] - baseline['accuracy'])
            met = delta > floor
            if bench == 'hardrows' and baseline['accuracy'] == 1.:
                met = delta >= -floor and ours['s2_per_100'] < baseline['s2_per_100']
            if bench == 'rubricbench' and name == 'pw_seat':
                # Owner's separate matched-subset target is a ceiling tie.
                met = delta >= -floor and ours['s2_per_100'] < baseline['s2_per_100']
            comparisons[bench][name] = {'baseline': baseline, 'MoJ_same_items': ours,
                'delta_points': delta, 'paired_interval': r.paired_interval(subset, ds, bd),
                'full_coverage': len(subset) == len(its), 'target_met': met}
            if len(subset) == len(its):
                full_met.append(met)
        if bench in r.BENCHES and not all(full_met):
            residual += 1
    thresholds = {'rubricbench': 43/46, 'hardrows': 52/54, 'verify': 39/49, 'verify-with-reference': 54/55}
    retention = sum(cells[b]['accuracy'] < x-1e-12 for b,x in thresholds.items())
    strengthened = sum(cells[b]['accuracy'] < x-1e-12 for b,x in thresholds.items() if b != 'verify')
    strengthened += not (100*(cells['verify']['accuracy']-42/49) > 3.3 and cells['verify']['sensitivity'] > 0)
    result = {'split_version': r.SPLIT_VERSION, 'cells': cells, 'baselines': comparisons,
        'primary_full_coverage_residual': residual, 'previous_four_cell_retention_residual': retention,
        'strengthened_four_cell_residual': int(strengthened), 'config_sha256': hashlib.sha256(CONFIG.read_bytes()).hexdigest(),
        'selection_caveat': 'Practice validation has been inspected across multiple owner-directed rounds. These are descriptive validation results, not fresh confirmatory evidence.'}
    r.save(OUT / 'validation-decisions.json', ds); r.save(OUT / 'validation.json', result)
    lines = ['# Frozen pointwise practice comparison', '',
        'Percentages except calls and known System-2 USD. System-1 price is unknown. Partial baselines use matched entries.',
        'New arms use gpt-6-luna. Historical mixed, Gemini and Haiku baselines are retained as context, not same-model contestants.',
        '', '| Benchmark | Arm | n | Accuracy | Balanced | Recall | Specificity | S2/100 | USD/100 |',
        '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|']
    def line(b, n, c):
        return f"| {b} | {n} | {c['n']} | " + ' | '.join('NA' if c[k] is None else f'{100*c[k]:.1f}' for k in ('accuracy','balanced','sensitivity','specificity')) + f" | {c['s2_per_100']:.1f} | {c['known_usd_per_100']:.6f} |"
    for b, cell in cells.items():
        lines.append(line(b, 'Frozen MoJ', cell))
        for name, comparison in comparisons[b].items():
            lines.append(line(b, name, comparison['baseline']))
            if not comparison['full_coverage']:
                lines.append(line(b, 'MoJ matched to '+name, comparison['MoJ_same_items']))
    lines += ['', f'Primary full-coverage residual: {residual}/3. Previous four-cell retention residual: {retention}/4. Strengthened owner bar: {int(strengthened)}/4.',
              'Hard rows do not tie the 100% ceiling inside the 1.7-point noise proxy. RubricBench ties its best full-coverage baseline; blind Verify remains below always-fail.',
              'Noise proxies and matched paired intervals are recorded in validation.json. All official labels remain unchanged.']
    (OUT / 'SCOREBOARD.md').write_text('\n'.join(lines)+'\n')
    print(json.dumps({'cells': cells, 'residual': residual, 'strengthened_residual': int(strengthened)}, indent=2))


if __name__ == '__main__':
    report()
