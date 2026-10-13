"""Offline probability calibration and finite-sample confidence routing.

Run ``python3 -m moj.confidence --help``. Only numpy and the standard library.
No client, collector, model endpoint, credential or raw benchmark is imported.
"""
import argparse
import csv
import hashlib
import html
import json
import math
from functools import lru_cache
from pathlib import Path

import numpy as np

from .policy import Combiner, x_of

FULL = ('s1p', 's1r', 'ref', 's2v', 's2h')
LEVELS = ('stop', 'one_more', 'full')
GRID = (0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1.0, 1.01)
PRACTICE = {'pilot', 'noise', 'fixtures', 'dev', 'practice', 'tune', 'valid'}


def probability(p):
    return isinstance(p, (int, float, np.number)) and not isinstance(p, bool) and np.isfinite(p) and 0 <= p <= 1


def verdict(p):
    return 'A' if p > 0.5 else 'B' if p < 0.5 else 'tie'


def pair_confidence(ab, ba):
    """AB and BA are P(FIRST wins); BA must be complemented before averaging."""
    if not probability(ab) or not probability(ba):
        return {'pA': None, 'confidence': None, 'margin': None,
                'order_disagreement': None, 'order_gap': None, 'order_tie': None}
    pa = (float(ab) + (1 - float(ba))) / 2
    return {'pA': pa, 'confidence': max(pa, 1 - pa), 'margin': abs(2 * pa - 1),
            'order_disagreement': bool((ab - 0.5) * (0.5 - ba) < 0),
            'order_gap': float(abs(ab - (1 - ba))), 'order_tie': bool(ab == 0.5 or ba == 0.5)}


class Isotonic:
    """Weighted PAVA after pooling duplicate x. Linear monotone interpolation."""

    def __init__(self, x=(), y=()):
        self.x, self.y = np.asarray(x, dtype=float), np.asarray(y, dtype=float)

    @classmethod
    def fit(cls, x, y):
        x, y = np.asarray(x, dtype=float), np.asarray(y, dtype=float)
        if x.ndim != 1 or x.shape != y.shape or not len(x):
            raise ValueError('nonempty equal-length vectors required')
        if not (np.isfinite(x).all() and np.isfinite(y).all()) or np.any((x < 0) | (x > 1) | (y < 0) | (y > 1)):
            raise ValueError('calibration values must be in [0, 1]')
        unique, inverse, count = np.unique(x, return_inverse=True, return_counts=True)
        sums = np.bincount(inverse, weights=y)
        blocks = []
        for i, (total, weight) in enumerate(zip(sums, count)):
            blocks.append([i, i + 1, float(total), int(weight)])
            while len(blocks) > 1 and blocks[-2][2] / blocks[-2][3] > blocks[-1][2] / blocks[-1][3]:
                b = blocks.pop()
                a = blocks.pop()
                blocks.append([a[0], b[1], a[2] + b[2], a[3] + b[3]])
        fitted = np.empty(len(unique))
        for start, end, total, weight in blocks:
            fitted[start:end] = total / weight
        return cls(unique, fitted)

    def predict(self, x):
        if not len(self.x):
            raise ValueError('calibration map is not fitted')
        return np.interp(x, self.x, self.y)

    def to_dict(self):
        return {'x': self.x.tolist(), 'y': self.y.tolist()}


def reliability(p, y, bins=10):
    """Binary probability ECE for event A (not top-label confidence ECE)."""
    p, y = np.asarray(p, float), np.asarray(y, float)
    if p.shape != y.shape or bins < 1:
        raise ValueError('invalid reliability inputs')
    curve, error = [], 0.0
    for b in range(bins):
        mask = (p >= b / bins) & ((p < (b + 1) / bins) | ((b == bins - 1) & (p == 1)))
        n = int(mask.sum())
        avg, freq = (float(p[mask].mean()), float(y[mask].mean())) if n else (None, None)
        if n:
            error += n * abs(avg - freq)
        curve.append({'low': b / bins, 'high': (b + 1) / bins, 'n': n, 'mean_probability': avg, 'frequency_A': freq})
    return {'n': len(p), 'ece': error / len(p) if len(p) else None, 'curve': curve,
            'brier': float(np.mean((p - y) ** 2)) if len(p) else None}


def calibrate_experts(train, validation):
    names = sorted({k for row in train + validation for k in row if not k.startswith('_') and k != 'route'})
    out = {}
    for name in names:
        tr = [r for r in train if valid_signal(r.get(name))]
        va = [r for r in validation if valid_signal(r.get(name))]
        p = [r[name]['pA'] for r in va]
        y = [int(r['_meta']['label'] == 'A') for r in va]
        model = Isotonic.fit([r[name]['pA'] for r in tr], [int(r['_meta']['label'] == 'A') for r in tr]) if tr else None
        out[name] = {'tune_n': len(tr), 'validation_n': len(va), 'map': model.to_dict() if model else None,
                     'before': reliability(p, y), 'after': reliability(model.predict(p), y) if model else None,
                     'signal_kind': 'probability_or_recorded_vote_fraction'}
    return out


def valid_signal(signal):
    return isinstance(signal, dict) and probability(signal.get('pA')) and not signal.get('missing', 0)


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, allow_nan=False).encode()).hexdigest()


def validate_rows(rows):
    """Reject unknown provenance; never silently include a TEST row."""
    for row in rows:
        meta = row.get('_meta', {})
        if str(meta.get('split', '')).lower() not in PRACTICE or meta.get('half') not in ('tune', 'valid'):
            raise ValueError('only explicitly marked practice tune/valid signals are allowed')
        if meta.get('label') not in ('A', 'B'):
            raise ValueError('binary gold label required')


def group_key(row):
    return row['_meta'].get('group_key') or row['_id']


def group_partition(rows, rng, parts=2):
    """Keep source groups together. Legacy signals only have a pair identifier."""
    groups = sorted({group_key(r) for r in rows})
    chunks = np.array_split(rng.permutation(groups), parts)
    return [[r for r in rows if group_key(r) in set(chunk.tolist())] for chunk in chunks]


def cost_of(row, experts):
    """Counts are replayed inference cost; cached answers are not free inference."""
    out = {'jev': 0.0, 'luna': 0.0, 'recorded_luna_usd': 0.0}
    for name in dict.fromkeys(experts):
        s = row[name]
        detail = s.get('detail') or {}
        out['jev'] += s.get('calls', {}).get('jev', 0)
        out['luna'] += s.get('calls', {}).get('luna', 0) + (detail.get('recorded_calls') or 0)
        out['recorded_luna_usd'] += s.get('usd') or 0
    return out


class ConfidenceModel:
    """Frozen reference, middle combiner, and confidence-to-gold-correctness map.

    The confidence map preserves the raw S1 verdict. Values below 0.5 mean
    empirically worse than chance, not a license to flip a verdict.
    """

    def __init__(self, train, full_experts=FULL, extra='ref', s1='s1p', s2_weight=10.0, reference_version=None):
        validate_rows(train)
        if not train:
            raise ValueError('nonempty training set required')
        self.full_experts, self.extra, self.s1 = tuple(full_experts), extra, s1
        if s1 == extra or not self.full_experts:
            raise ValueError('extra must differ from S1; full judge cannot be empty')
        if not np.isfinite(s2_weight) or s2_weight <= 0:
            raise ValueError('positive S2 call weight required')
        self.s2_weight = float(s2_weight)
        self.reference_version = reference_version or hashlib.sha256(Path(__file__).with_name('policy.py').read_bytes()).hexdigest()
        self.neutralize_open_reference = x_of({'ref': {'pA': 1.0, 'detail': {'kind': 'open'}}}, 'ref') == 0
        self.required = tuple(dict.fromkeys((s1, extra) + self.full_experts))
        complete = [r for r in train if self.complete(r)]
        if not complete:
            raise ValueError('no complete training signals for requested experts')
        combiner = Combiner(complete)
        self.middle_weights = combiner.weights((s1, extra)).tolist()
        self.full_weights = combiner.weights(self.full_experts).tolist()
        pairs = [pair_confidence(r[s1]['detail'].get('AB'), r[s1]['detail'].get('BA')) for r in complete]
        usable = [(r, p) for r, p in zip(complete, pairs) if p['pA'] is not None]
        if not usable:
            raise ValueError('two-order S1 probabilities missing')
        self.calibrator = Isotonic.fit([p['confidence'] for _, p in usable],
                                      [float(verdict(p['pA']) == r['_meta']['label']) for r, p in usable])

    def complete(self, row):
        return all(valid_signal(row.get(name)) for name in self.required)

    def combine(self, row, experts, weights):
        z = sum(w * (0.0 if self.neutralize_open_reference and e == 'ref' and
                      (row[e].get('detail') or {}).get('kind') == 'open' else 2 * row[e]['pA'] - 1)
                for e, w in zip(experts, weights))
        return 1 / (1 + math.exp(-max(-30, min(30, z))))

    def to_dict(self):
        return {'full_experts': list(self.full_experts), 'extra': self.extra, 's1': self.s1,
                'full_weights': self.full_weights, 'middle_weights': self.middle_weights,
                'calibrator': self.calibrator.to_dict(), 's2_weight': self.s2_weight,
                'reference_version': self.reference_version,
                'neutralize_open_reference': self.neutralize_open_reference}

    @classmethod
    def from_dict(cls, value):
        obj = cls.__new__(cls)
        obj.full_experts = tuple(value['full_experts'])
        for name in ('extra', 's1', 'full_weights', 'middle_weights', 's2_weight', 'reference_version'):
            setattr(obj, name, value[name])
        obj.required = tuple(dict.fromkeys((obj.s1, obj.extra) + obj.full_experts))
        obj.calibrator = Isotonic(**value['calibrator'])
        obj.neutralize_open_reference = value.get('neutralize_open_reference', False)
        return obj

    @property
    def signature(self):
        return fingerprint(self.to_dict())


def choose_level(signals, model, hi=0.9, lo=0.7, raw=False, certificate=None):
    """Public API. Only S1 signals are needed; no gold or reference is inspected.

    Return {level, confidence, raw_confidence, pA, margin, order_disagreement,...}.
    Certificate binds model and thresholds. Missing orders safely request full.
    """
    if not (np.isfinite(hi) and np.isfinite(lo) and 0 <= lo <= hi <= 1.01):
        raise ValueError('require 0 <= lo <= hi <= 1.01')
    if certificate is not None:
        if certificate['model_signature'] != model.signature or certificate['hi'] != hi or certificate['lo'] != lo or raw:
            raise ValueError('certificate is stale: recertify the frozen model and thresholds')
    s = signals.get(model.s1, {})
    d = s.get('detail') or {}
    p = pair_confidence(d.get('AB'), d.get('BA'))
    if p['pA'] is None or not valid_signal(s):
        return {**p, 'level': 'full', 'raw_confidence': None, 'reason': 'missing S1 probability or order'}
    confidence = float(model.calibrator.predict(p['confidence']))
    gate = p['confidence'] if raw else confidence
    level = 'stop' if gate >= hi else 'one_more' if gate >= lo else 'full'
    # Order disagreement is its own safety signal, not a fabricated margin.
    if p['order_disagreement'] or p['order_tie'] or p['pA'] == 0.5:
        level = 'full'
    return {**p, 'level': level, 'raw_confidence': p['confidence'], 'confidence': confidence,
            'reason': 'order conflict or tie' if level == 'full' and (p['order_disagreement'] or p['order_tie']) else None}


def prepare(rows, model):
    out = []
    for r in rows:
        if not model.complete(r):
            continue
        first = choose_level(r, model)
        if first['pA'] is None:
            continue
        predictions = [verdict(first['pA']), verdict(model.combine(r, (model.s1, model.extra), model.middle_weights)),
                       verdict(model.combine(r, model.full_experts, model.full_weights))]
        costs = [cost_of(r, names) for names in ((model.s1,), (model.s1, model.extra),
                                                (model.s1,) + model.full_experts)]
        out.append({'id': r['_id'], 'group_key': group_key(r),
                    'confidence': first['confidence'], 'raw_confidence': first['raw_confidence'],
                    'forced_full': bool(first['order_disagreement'] or first['order_tie'] or first['pA'] == 0.5),
                    'order_disagreement': first['order_disagreement'], 'order_gap': first['order_gap'],
                    'margin': first['margin'], 'predictions': predictions, 'gold': r['_meta']['label'],
                    'costs': costs, 'units': [c['jev'] + model.s2_weight * c['luna'] for c in costs]})
    return out


def indices(records, hi, lo, raw=False):
    return np.array([2 if r['forced_full'] else 0 if r['raw_confidence' if raw else 'confidence'] >= hi
                     else 1 if r['raw_confidence' if raw else 'confidence'] >= lo else 2 for r in records], dtype=int)


def metrics(records, hi, lo, raw=False):
    idx = indices(records, hi, lo, raw)
    levels = {}
    selected = [r['predictions'][int(i)] for r, i in zip(records, idx)]
    gold = np.array([float(p == r['gold']) if p != 'tie' else 0.5 for r, p in zip(records, selected)])
    agreement = np.array([float(p == r['predictions'][2]) for r, p in zip(records, selected)])
    units = np.array([r['units'][int(i)] for r, i in zip(records, idx)])
    for i, level in enumerate(LEVELS):
        mask = idx == i
        n = int(mask.sum())
        levels[level] = {'n': n, 'share': n / len(records) if records else None,
                         'gold_accuracy': float(gold[mask].mean()) if n else None,
                         'full_agreement': float(agreement[mask].mean()) if n else None}
    costs = {key: float(np.mean([r['costs'][int(i)][key] for r, i in zip(records, idx)])) if records else None
             for key in ('jev', 'luna', 'recorded_luna_usd')}
    return {'n': len(records), 'hi': hi, 'lo': lo, 'raw_gate': raw,
            'gold_accuracy': float(gold.mean()) if len(gold) else None,
            'full_agreement': float(agreement.mean()) if len(agreement) else None,
            'cost_units': float(units.mean()) if len(units) else None, **costs, 'levels': levels}


@lru_cache(maxsize=100000)
def binomial_lower(successes, n, risk=0.05):
    """Exact one-sided Clopper-Pearson lower confidence bound, using log tails."""
    if int(n) != n or int(successes) != successes or not 0 <= successes <= n or not 0 < risk < 1:
        raise ValueError('invalid binomial counts or risk')
    if successes == 0:
        return 0.0
    if successes == n:
        return risk ** (1 / n)
    k = np.arange(successes, n + 1, dtype=float)
    logc = np.array([math.lgamma(n + 1) - math.lgamma(int(j) + 1) - math.lgamma(n - int(j) + 1) for j in k])
    low, high = 0.0, 1.0
    for _ in range(60):
        p = (low + high) / 2
        values = logc + k * math.log(p) + (n - k) * math.log1p(-p)
        top = values.max()
        logtail = float(top + np.log(np.exp(values - top).sum()))
        if logtail < math.log(risk):
            low = p
        else:
            high = p
    return low


def minimum_labels(target=0.9, risk=0.05, comparisons=1):
    """Best case: this many independent, error-free accepted calibration items."""
    if not 0 < target < 1 or not 0 < risk < 1 or comparisons < 1:
        raise ValueError('target and risk must be inside (0, 1)')
    return math.ceil(math.log(risk / comparisons) / math.log(target))


def threshold_grid():
    return [(hi, lo) for hi in GRID for lo in GRID if lo <= hi]


def certify(records, model, target=0.9, risk=0.05):
    """Simultaneous binomial lower bounds over predeclared policies and exits.

    Training and these calibration records MUST be independent. For each
    policy both early exit regions need a bound >= target. Empty regions
    are not certified. A disabled region (threshold > 1) needs no samples.
    Full fallback agrees with itself; that identity is not a learned guarantee.
    """
    grid = threshold_grid()
    comparisons = 2 * len(grid)
    alpha = risk / comparisons
    minimum = minimum_labels(target, risk, comparisons)
    repeated_groups = len({r.get('group_key', r['id']) for r in records}) != len(records)
    accepted = []
    for hi, lo in grid:
        idx = indices(records, hi, lo)
        bounds, ok = {}, True
        for j, name in enumerate(LEVELS[:2]):
            enabled = hi <= 1 if j == 0 else lo <= 1 and lo < hi
            selected = [r for r, i in zip(records, idx) if i == j]
            k = sum(r['predictions'][j] == r['predictions'][2] for r in selected)
            lower = binomial_lower(k, len(selected), alpha) if selected else 0.0
            bounds[name] = {'n': len(selected), 'successes': k, 'lower': lower, 'enabled': enabled}
            if enabled and lower < target:
                ok = False
        if ok and (not repeated_groups or (hi > 1 and lo > 1)):
            accepted.append((metrics(records, hi, lo)['cost_units'] or 0, hi, lo, bounds))
    _, hi, lo, bounds = min(accepted, key=lambda x: (x[0], x[1], x[2]))
    return {'hi': hi, 'lo': lo, 'target_full_agreement': target, 'risk': risk,
            'comparisons': comparisons, 'per_bound_risk': alpha, 'bounds': bounds,
            'minimum_error_free_labels_per_enabled_exit': minimum,
            'nontrivial': hi <= 1 or lo <= 1, 'model_signature': model.signature,
            'method': 'exact_binomial_bonferroni', 'calibration_n': len(records),
            'repeated_calibration_groups': repeated_groups}


def crossfit(rows, full_experts=FULL, extra='ref', s2_weight=10.0, seed=13):
    groups = sorted({group_key(r) for r in rows})
    if len(groups) < 2:
        return []
    order = np.random.default_rng(seed).permutation(groups)
    out = []
    for held in np.array_split(order, min(5, len(groups))):
        hs = set(held.tolist())
        train = [r for r in rows if group_key(r) not in hs]
        model = ConfidenceModel(train, full_experts, extra, s2_weight=s2_weight)
        out.extend(prepare([r for r in rows if group_key(r) in hs], model))
    return out


def operating_points(curve, accuracy_target=0.8, cost_budget=None):
    """Choose on out-of-fold tuning metrics only. No validation lookup."""
    if not curve:
        return {}
    cheapest = min(curve, key=lambda m: (m['cost_units'], -m['gold_accuracy'], m['hi'], m['lo']))
    accurate = min(curve, key=lambda m: (-m['gold_accuracy'], m['cost_units'], m['hi'], m['lo']))
    feasible = [m for m in curve if m['gold_accuracy'] >= accuracy_target and
                (cost_budget is None or m['cost_units'] <= cost_budget)]
    balanced = min(feasible, key=lambda m: (m['cost_units'], -m['gold_accuracy'])) if feasible else accurate
    return {name: {'hi': m['hi'], 'lo': m['lo'], 'tuning': m,
                   'target_feasible': bool(feasible) if name == 'balanced' else None}
            for name, m in [('cheapest', cheapest), ('balanced', balanced), ('most_accurate', accurate)]}


def random_split_audit(rows, repetitions, full_experts, extra, s2_weight, target, risk, accuracy_target, budget, seed):
    """Practice-only sensitivity audit; not 1000 independent experiments."""
    rng = np.random.default_rng(seed)
    results = []
    if len({group_key(r) for r in rows}) < 4:
        return {'status': 'insufficient practice rows', 'splits': [], 'summary': {}}
    for rep in range(repetitions):
        # Source groups, when present, never cross any fit/calibration/validation boundary.
        tuning, validation = group_partition(rows, rng)
        train, calibration = group_partition(tuning, rng)
        model = ConfidenceModel(train, full_experts, extra, s2_weight=s2_weight)
        cal, val = prepare(calibration, model), prepare(validation, model)
        certificate = certify(cal, model, target, risk)
        cv = crossfit(tuning, full_experts, extra, s2_weight, seed + rep)
        points = operating_points([metrics(cv, hi, lo) for hi, lo in threshold_grid()], accuracy_target, budget)
        best = points['balanced']
        cv_model = ConfidenceModel(tuning, full_experts, extra, s2_weight=s2_weight)
        cv_val = prepare(validation, cv_model)
        methods = {'fixed_0.9': metrics(val, 0.9, 0.7, raw=True),
                   'cross_validated': metrics(cv_val, best['hi'], best['lo']),
                   'guaranteed': metrics(val, certificate['hi'], certificate['lo'])}
        for name, m in methods.items():
            early_n = sum(m['levels'][l]['n'] for l in LEVELS[:2])
            early_success = sum((m['levels'][l]['full_agreement'] or 0) * m['levels'][l]['n'] for l in LEVELS[:2])
            results.append({'split': rep, 'method': name, 'hi': m['hi'], 'lo': m['lo'],
                            'gold_accuracy': m['gold_accuracy'], 'full_agreement': m['full_agreement'],
                            'held': m['full_agreement'] >= target, 'early_n': early_n,
                            'early_held': early_success / early_n >= target if early_n else None,
                            'nontrivial_certificate': certificate['nontrivial'] if name == 'guaranteed' else False,
                            'cost_units': m['cost_units'],
                            **{l + '_' + field: m['levels'][l][field] for l in LEVELS
                               for field in ('n', 'share', 'gold_accuracy', 'full_agreement')}})
    summary = {}
    for name in ('fixed_0.9', 'cross_validated', 'guaranteed'):
        selected = [r for r in results if r['method'] == name]
        nonempty = [r for r in selected if r['early_n']]
        summary[name] = {'splits': len(selected), 'overall_target_held': sum(r['held'] for r in selected),
                         'nonempty_early_splits': len(nonempty), 'early_target_held': sum(r['early_held'] for r in nonempty),
                         'nontrivial_certificates': sum(r['nontrivial_certificate'] for r in selected),
                         'mean_gold_accuracy': float(np.mean([r['gold_accuracy'] for r in selected])),
                         'mean_full_agreement': float(np.mean([r['full_agreement'] for r in selected]))}
        summary[name]['levels'] = {}
        for level in LEVELS:
            n = sum(r[level + '_n'] for r in selected)
            summary[name]['levels'][level] = {
                'mean_share': float(np.mean([r[level + '_share'] for r in selected])),
                'gold_accuracy': sum((r[level + '_gold_accuracy'] or 0) * r[level + '_n'] for r in selected) / n if n else None,
                'full_agreement': sum((r[level + '_full_agreement'] or 0) * r[level + '_n'] for r in selected) / n if n else None}
    return {'status': 'practice sensitivity only; overlapping random splits', 'splits': results, 'summary': summary}


def run_benchmark(store, args):
    rows = [{**r, '_id': key} for key, r in sorted(store.items())]
    validate_rows(rows)
    required = tuple(dict.fromkeys(('s1p', args.extra) + tuple(args.full_experts)))
    missing = {name: sum(not valid_signal(r.get(name)) for r in rows) for name in required}
    usable = [r for r in rows if all(valid_signal(r.get(n)) for n in required) and
              pair_confidence((r['s1p'].get('detail') or {}).get('AB'), (r['s1p'].get('detail') or {}).get('BA'))['pA'] is not None]
    train = [r for r in usable if r['_meta']['half'] == 'tune']
    val = [r for r in usable if r['_meta']['half'] == 'valid']
    report = {'practice_n': len(rows), 'complete_n': len(usable), 'excluded_n': len(rows) - len(usable),
              'tune_n': len(train), 'valid_n': len(val), 'missing_experts': missing,
              'group_metadata_complete': all(r['_meta'].get('group_key') for r in rows),
              'split_versions': sorted({r['_meta'].get('split_version', 'legacy-unspecified') for r in rows}),
              'calibration': calibrate_experts([r for r in rows if r['_meta']['half'] == 'tune'],
                                               [r for r in rows if r['_meta']['half'] == 'valid'])}
    if not train:
        return {**report, 'status': 'missing complete tuning signals'}
    if {group_key(r) for r in train} & {group_key(r) for r in val}:
        return {**report, 'status': 'source groups overlap tuning and validation; corrected split required'}
    model = ConfidenceModel(train, args.full_experts, args.extra, s2_weight=args.s2_weight)
    validation = prepare(val, model)
    cv = crossfit(train, args.full_experts, args.extra, args.s2_weight, args.seed)
    curve = [metrics(cv, hi, lo) for hi, lo in threshold_grid()] if cv else []
    points = operating_points(curve, args.accuracy_target, args.cost_budget)
    for point in points.values():
        point['validation'] = metrics(validation, point['hi'], point['lo'])
    fit, calibration = group_partition(train, np.random.default_rng(args.seed))
    certified_model = ConfidenceModel(fit, args.full_experts, args.extra, s2_weight=args.s2_weight)
    certificate = certify(prepare(calibration, certified_model), certified_model, args.target, args.risk)
    methods = {'fixed_0.9': metrics(validation, 0.9, 0.7, raw=True),
               'guaranteed': metrics(prepare(val, certified_model), certificate['hi'], certificate['lo'])}
    if points:
        methods['cross_validated'] = points['balanced']['validation']
    report.update({'status': 'measured' if val else 'no validation signals', 'model': model.to_dict(),
                   'certified_model': certified_model.to_dict(), 'certificate': certificate,
                   'fit_ids': [r['_id'] for r in fit], 'certification_ids': [r['_id'] for r in calibration],
                   'validation_ids': [r['_id'] for r in val], 'operating_points': points,
                   'methods': methods, 'curve_tuning_oof': curve,
                   'curve_validation': [metrics(validation, hi, lo) for hi, lo in threshold_grid()],
                   'pair_signals_validation': validation,
                   'random_audit': random_split_audit(usable, args.splits, args.full_experts, args.extra,
                       args.s2_weight, args.target, args.risk, args.accuracy_target, args.cost_budget, args.seed)})
    return report


def write_curve(output, bench, result):
    """Dependency-free, standalone scatter curve; validation is descriptive only."""
    curve = result.get('curve_validation', [])
    if not curve or not curve[0]['n']:
        return
    fields = ('hi', 'lo', 'gold_accuracy', 'full_agreement', 'cost_units', 'jev', 'luna')
    with (output / (bench + '-curve.csv')).open('w') as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, lineterminator='\n')
        writer.writeheader()
        writer.writerows({k: m[k] for k in fields} for m in curve)
    xmax = max(m['cost_units'] for m in curve) * 1.05
    x = lambda v: 70 + 620 * v / max(1, xmax)
    y = lambda v: 340 - 280 * v
    svg = ['<svg xmlns="http://www.w3.org/2000/svg" width="760" height="450" viewBox="0 0 760 450">',
           '<rect width="760" height="450" fill="white"/>',
           f'<text x="70" y="28" font-family="sans-serif" font-size="18">{html.escape(bench)}: validation threshold sweep</text>']
    for tick in (0, 0.25, 0.5, 0.75, 1):
        svg += [f'<path d="M70 {y(tick)} H690" stroke="#ddd"/>',
                f'<text x="22" y="{y(tick)+5}" font-family="sans-serif">{tick:.0%}</text>']
    for tick in np.linspace(0, xmax, 6):
        svg.append(f'<text x="{x(tick)-12}" y="365" font-family="sans-serif">{tick:.1f}</text>')
    for key, color in [('gold_accuracy', '#1265ae'), ('full_agreement', '#c14e00')]:
        for m in curve:
            svg.append(f'<circle cx="{x(m["cost_units"])}" cy="{y(m[key])}" r="4" fill="{color}" opacity="0.55"><title>hi={m["hi"]}, lo={m["lo"]}, {key}={m[key]:.4f}</title></circle>')
    svg += ['<text x="70" y="400" fill="#1265ae" font-family="sans-serif">Blue: gold accuracy</text>',
            '<text x="330" y="400" fill="#c14e00" font-family="sans-serif">Orange: full-judge agreement</text>',
            '<text x="70" y="430" font-family="sans-serif" font-size="12">Cost units = S1 calls + configured weight x S2 calls. Points chosen on tuning only.</text>', '</svg>']
    (output / (bench + '-curve.svg')).write_text('\n'.join(svg) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--benches', default='judgebench,mmeval,writing')
    parser.add_argument('--full-experts', default=','.join(FULL))
    parser.add_argument('--extra', default='ref')
    parser.add_argument('--target', type=float, default=0.9)
    parser.add_argument('--risk', type=float, default=0.05)
    parser.add_argument('--accuracy-target', type=float, default=0.8)
    parser.add_argument('--cost-budget', type=float)
    parser.add_argument('--s2-weight', type=float, default=10.0)
    parser.add_argument('--splits', type=int, default=1000)
    parser.add_argument('--seed', type=int, default=13)
    parser.add_argument('--output', default='results/confidence/run-v1')
    args = parser.parse_args()
    args.full_experts = tuple(args.full_experts.split(','))
    minimum_labels(args.target, args.risk)
    if args.splits < 0 or not 0 <= args.accuracy_target <= 1:
        parser.error('invalid split count or accuracy target')
    root = Path(__file__).resolve().parents[1]
    output = root / args.output
    if not output.resolve().is_relative_to((root / 'results/confidence').resolve()):
        parser.error('output must be inside results/confidence')
    output.mkdir(parents=True, exist_ok=False)
    manifest = {'settings': vars(args), 'inputs': {}, 'guarantee_minimum_labels': {
        'one_frozen_region': minimum_labels(args.target, args.risk),
        'two_frozen_regions': minimum_labels(args.target, args.risk, 2),
        'grid_each_enabled_exit': minimum_labels(args.target, args.risk, 2 * len(threshold_grid()))}}
    table = ['| Benchmark | S1 ECE before / after | Point | Gold accuracy | Full agreement | S1 / S2 calls |',
             '|---|---:|---|---:|---:|---:|']
    for bench in args.benches.split(','):
        if bench not in ('judgebench', 'mmeval', 'writing'):
            parser.error('only the three approved practice signal files are read')
        path = root / 'results/signals' / (bench + '.json')
        raw = path.read_bytes()
        manifest['inputs'][bench] = {'path': str(path.relative_to(root)), 'sha256': hashlib.sha256(raw).hexdigest()}
        result = run_benchmark(json.loads(raw), args)
        write_curve(output, bench, result)
        audit = result.get('random_audit', {})
        splits = audit.pop('splits', [])
        if splits:
            with (output / (bench + '-splits.csv')).open('w') as handle:
                writer = csv.DictWriter(handle, fieldnames=list(splits[0]), lineterminator='\n')
                writer.writeheader()
                writer.writerows(splits)
        (output / (bench + '.json')).write_text(json.dumps(result, indent=2, allow_nan=False) + '\n')
        cal = result['calibration']['s1p']
        def fmt(x):
            return 'n/a' if x is None else f'{x:.3f}'
        ece = fmt(cal['before']['ece']) + ' / ' + fmt(cal['after']['ece'] if cal['after'] else None)
        for name, point in result.get('operating_points', {}).items():
            m = point['validation']
            table.append(f"| {bench} (n={m['n']}) | {ece} | {name} | {fmt(m['gold_accuracy'])} | {fmt(m['full_agreement'])} | {fmt(m['jev'])} / {fmt(m['luna'])} |")
        print(bench, result['practice_n'], 'pairs;', result.get('certificate', {}), flush=True)
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (output / 'summary.md').write_text('\n'.join(table) + '\n')
    print('\n'.join(table))


if __name__ == '__main__':
    main()
