"""The MoJ policy: stage 1, confidence levels, the terrain router and the code that combines experts.

A variant is one JSON config (configs/*.json):

  stage1   experts run on every item (System 1 first pass)
  hi, lo   confidence boundaries. conf >= hi: stop. lo <= conf < hi: add one expert picked by the terrain.
           conf < lo: add the experts of `low` (the full mixed judge) on top.
  cards    ordered capability cards: {"expert": name, "terrain": {feature: minimum}}. The first card whose terrain
           matches and whose expert is not used yet is the one added at the middle level. A terrain decision
           inside the unsure band counts as a match: an unsure route takes the safer, more expensive expert.
  always   cards applied to every item whatever the confidence (for example a stability judge when lengths differ)
  low      experts added at the low level
  no_escalate   terrain cards {"terrain": {...}}: on a match the item stays with stage 1 whatever its confidence
  force_low     terrain cards: on a match the item goes to the low level whatever its confidence
  abstain_below   final confidence under this value is an explicit abstention (scored as a tie)
  combine  'raw' uses the plain mean of the experts' probabilities in place of fitted weights
  low_mode 'replace': the experts of `low` decide alone (an escalation), in place of joining the combination
  escalate_share  the dial: the boundary is set so this share of training items escalates

Combination is a logistic regression without intercept on x = 2 pA - 1 of the experts used so far, one model per
set of experts, fitted on training items only. No intercept means swapping A and B flips the verdict exactly.
"""
import math

import numpy as np

UNSURE = (0.4, 0.6)


def x_of(signals, name):
    signal = signals.get(name) or {}
    if name == 'ref' and (signal.get('detail') or {}).get('kind') == 'open':
        return 0.0  # no reference exists for an open task: the check carries no verdict
    p = signal.get('pA')
    return 0.0 if p is None else 2 * p - 1


def fit_logistic(X, y, l2=1.0, steps=400):
    """No-intercept logistic regression, L2 penalty, Newton steps. y in {0, 1}; rows are mirrored for symmetry."""
    X = np.vstack([X, -X])
    y = np.concatenate([y, 1 - y])
    w = np.zeros(X.shape[1])
    for _ in range(steps):
        p = 1 / (1 + np.exp(-X @ w))
        grad = X.T @ (p - y) + l2 * w
        hess = (X * (p * (1 - p))[:, None]).T @ X + l2 * np.eye(X.shape[1])
        step = np.linalg.solve(hess, grad)
        w -= step
        if np.abs(step).max() < 1e-8:
            break
    return w


class Combiner:
    """One fitted model per set of experts, trained lazily on the training items."""

    def __init__(self, train, l2=1.0, raw=False):
        self.train, self.l2, self.models, self.raw = train, l2, {}, raw

    def weights(self, experts):
        key = tuple(experts)
        if key not in self.models:
            rows = [s for s in self.train if s['_meta']['label'] in ('A', 'B')]
            X = np.array([[x_of(s, name) for name in key] for s in rows], dtype=float)
            y = np.array([1.0 if s['_meta']['label'] == 'A' else 0.0 for s in rows])
            self.models[key] = fit_logistic(X, y, self.l2) if len(rows) else np.ones(len(key))
        return self.models[key]

    def boundary(self, experts, share):
        key = ('boundary', tuple(experts), share)
        if key not in self.models:
            confs = sorted(max(q, 1 - q) for q in (self.p(s, experts) for s in self.train))
            self.models[key] = confs[min(len(confs) - 1, int(share * len(confs)))] if share > 0 else 0.0
        return self.models[key]

    def p(self, signals, experts):
        if self.raw:  # no fitted weights: the plain mean of the experts' probabilities
            values = [signals[name]['pA'] for name in experts if signals.get(name, {}).get('pA') is not None]
            return sum(values) / len(values) if values else 0.5
        w = self.weights(experts)
        z = float(sum(wi * x_of(signals, name) for wi, name in zip(w, experts)))
        return 1 / (1 + math.exp(-max(-30, min(30, z))))


def terrain(signals, used=()):
    """The terrain of an item: the router's content decisions, plus features derived from experts already run."""
    land = dict(signals.get('route', {}).get('detail', {}) or {})
    s1p = signals.get('s1p', {}).get('detail') or {}
    if 's1p' in used and s1p.get('AB') is not None and s1p.get('BA') is not None:
        land['order_split'] = 1.0 if (s1p['AB'] > 0.5) == (s1p['BA'] > 0.5) else 0.0  # both orders pick the same position
        land['first_bias'] = abs(s1p['AB'] + s1p['BA'] - 1)
    conflict = 0.0
    if 's1pr' in used and (signals.get('s1pr', {}).get('detail') or {}).get('conflict'):
        conflict = 1.0
    signs = [x_of(signals, name) for name in ('s1p', 's1r', 's1pr', 's1cf') if name in used and signals.get(name, {}).get('pA') is not None]
    if signs and min(signs) < -0.1 and max(signs) > 0.1:
        conflict = 1.0
    land['s1_conflict'] = conflict
    return land


def matches(card, land):
    for feature, minimum in card.get('terrain', {}).items():
        value = land.get(feature)
        if value is None:
            return False
        if isinstance(minimum, list):  # [low, high] band, both inclusive
            if not (minimum[0] <= value <= minimum[1]):
                return False
        elif feature in ('chars', 'length_gap', 'non_latin', 'order_split', 'first_bias', 's1_conflict'):
            if value < minimum:
                return False
        elif value < min(minimum, UNSURE[0]) if minimum >= 0.5 else value < minimum:
            return False
    return True


def calls_of(signals, experts):
    jev = luna = 0
    usd = seconds = 0.0
    for name in experts:
        signal = signals.get(name)
        if not signal:
            continue
        jev += signal['calls']['jev']
        luna += signal['calls']['luna'] + (signal['detail'].get('recorded_calls') or 0 if isinstance(signal.get('detail'), dict) else 0)
        usd += signal['usd']
        seconds += signal['seconds']['jev'] + signal['seconds']['luna']
    return {'jev': jev, 'luna': luna, 'usd': usd, 'seconds': seconds}


def decide(config, signals, combiner):
    """Runs one item through the variant. Returns verdict, confidence, level, path and calls."""
    hi, lo = config.get('hi', 0.9), config.get('lo', 0.7)
    if config.get('escalate_share') is not None:  # the dial: this share of training items sits under the boundary
        hi = lo = combiner.boundary(config['stage1'], config['escalate_share'])
    used = list(config['stage1'])
    land = terrain(signals, used)
    paid = list(used) + (['route'] if config.get('cards') or config.get('always') else [])
    for card in config.get('always', []):
        if matches(card, land) and card['expert'] not in used:
            used.append(card['expert'])
            paid.append(card['expert'])
    p = combiner.p(signals, used)
    conf = max(p, 1 - p)
    level = 'high'
    held = any(matches(card, land) for card in config.get('no_escalate', []))  # terrain where escalation does not pay
    forced = any(matches(card, land) for card in config.get('force_low', []))  # terrain System 1 must not decide alone
    if forced:
        conf = min(conf, lo - 1e-9)
    if conf < hi and held:
        level = 'held'
    elif conf < hi:
        level = 'middle' if conf >= lo else 'low'
        added = 0
        for card in config.get('cards', []):
            if added >= config.get('middle_max', 1):
                break
            land = terrain(signals, used)
            if card['expert'] not in used and matches(card, land) and signals.get(card['expert'], {}).get('pA') is not None:
                used.append(card['expert'])
                paid.append(card['expert'])
                added += 1
        if added:
            p = combiner.p(signals, used)
            conf = max(p, 1 - p)
        if level == 'low' or (config.get('low_after_middle', True) and conf < lo):
            level = 'low'
            added_low = []
            for name in config.get('low', []):
                if name not in used and signals.get(name, {}).get('pA') is not None:
                    used.append(name)
                    paid.append(name)
                    added_low.append(name)
            if config.get('low_mode') == 'replace' and added_low:
                p = combiner.p(signals, added_low)  # the escalated judge decides alone
                if signals[added_low[0]]['pA'] == 0.5 and len(added_low) == 1:
                    p = 0.5  # a recorded tie stays a tie
            else:
                p = combiner.p(signals, used)
            conf = max(p, 1 - p)
    verdict = 'A' if p > 0.5 else 'B' if p < 0.5 else 'tie'
    reason = None
    if config.get('abstain_below') and conf < config['abstain_below']:
        verdict, reason = 'abstain', f'final confidence {conf:.2f} under {config["abstain_below"]}'
    return {'verdict': verdict, 'p': p, 'confidence': conf, 'level': level, 'path': used, 'reason': reason,
            'calls': calls_of(signals, paid)}


def score_verdict(verdict, label):
    return 1.0 if verdict == label else 0.5 if verdict in ('tie', 'abstain') else 0.0


def score_games(games, label):
    return sum(1.0 if game == label else 0.5 if game == 'tie' else 0.0 for game in games) / len(games)


def wilson(mean, n, z=1.96):
    if n == 0:
        return (0.0, 0.0)
    denom = 1 + z * z / n
    centre = (mean + z * z / (2 * n)) / denom
    half = z * math.sqrt(mean * (1 - mean) / n + z * z / (4 * n * n)) / denom
    return (max(0.0, centre - half), min(1.0, centre + half))


def folds(ids, k=5):
    import hashlib
    order = sorted(ids, key=lambda i: hashlib.sha256(('moj-fold-v1:' + i).encode()).hexdigest())
    return [order[i::k] for i in range(k)]


def run_variant(config, pooled):
    """pooled: {bench: {id: signals}}. Returns per-item decisions.

    Tuning half: 5-fold cross-fitted (weights never see the item they score).
    Validation half: weights fitted on the whole tuning half.
    The combiner is fitted on the pooled tuning items of every benchmark: no weight is tied to a benchmark label.
    """
    everything = {(bench, item_id): s for bench, store in pooled.items() for item_id, s in store.items()}
    tune = [key for key, s in everything.items() if s['_meta']['half'] == 'tune']
    valid = [key for key, s in everything.items() if s['_meta']['half'] == 'valid']
    out = {}
    l2 = config.get('l2', 1.0)
    group_of = {key: everything[key]['_meta'].get('group_key', key[1]) for key in tune}
    for fold in folds(sorted(set(group_of.values()))):  # folds are made of groups: a prompt never sits on both sides
        inside = set(fold)
        held = {key for key in tune if group_of[key] in inside}
        combiner = Combiner([everything[key] for key in tune if key not in held], l2, config.get('combine') == 'raw')
        for key in held:
            out[key] = decide(config, everything[key], combiner)
    combiner = Combiner([everything[key] for key in tune], l2, config.get('combine') == 'raw')
    for key in valid:
        out[key] = decide(config, everything[key], combiner)
    return out, combiner
