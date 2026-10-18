"""Writes edges.json: expected values of the documented statistics on edge inputs.

Each case names the function of @agent-nexus/driftbench-stats, its arguments, the fields compared and their expected values,
the tolerance, and the need it serves (a docs page or a command that prints the value). Expected values come from
scipy, from exact rational arithmetic (fractions, math.comb) or from 60-digit decimals, never from the package under
test. Edge classes: n = 1, all pass, all fail, ties, huge n, extreme weights or tiny rates. NaN and infinite inputs are
covered by the degenerate level. Run from the repository root:
python3 packages/validators/fixtures/stats/make_edges.py, then
npx biome format --write packages/validators/fixtures/stats/edges.json. Fictional data only.
"""
import json
import math
from decimal import Decimal, getcontext
from fractions import Fraction
from pathlib import Path

from scipy import stats

getcontext().prec = 60
Z = stats.norm.ppf(0.975)
cases = []

NEED = {
    'intervals': 'docs/concepts/statistics.md "reports every rate with an interval"; driftbench report prints a Wilson interval on every rate',
    'zero': 'docs/concepts/statistics.md zeroFailureBound: "59 for 5 percent at 95 percent"; the runs to claim a failure rate below p',
    'reliability': 'docs/concepts/statistics.md pass^k and pass@k; driftbench report prints them per spec line',
    'paired': 'docs/concepts/statistics.md mcnemar and wilcoxonSignedRank; driftbench compare prints their p-values',
    'drift': 'docs/concepts/statistics.md ksTest; driftbench monitor alarms on it (docs/traces.md)',
    'multiple': 'docs/concepts/statistics.md benjaminiHochberg; driftbench compare and the pilot wording test adjust with it',
    'agreement': 'docs/concepts/statistics.md cohenKappa and krippendorffAlpha; driftbench judges calibrate prints kappa (docs/concepts/judges.md)',
    'power': 'docs/concepts/statistics.md mde; campaign plan prints the minimum detectable effect',
}


def case(key, fn, edge, args, want, tol, need, rel=False):
    cases.append(dict(id=f'{fn}.{key}', fn=fn, edge=edge, args=args, want=want, tol=tol, rel=rel, need=NEED[need]))


# --- Wilson, in 60-digit decimals ----------------------------------------------------------------------------
def wilson(k, n, z=Z):
    k, n, z = Decimal(k), Decimal(n), Decimal(repr(float(z)))
    p = k / n
    den = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / den
    half = z * ((p * (1 - p) / n + z * z / (4 * n * n)).sqrt()) / den
    lo, hi = centre - half, centre + half
    return dict(estimate=float(p), lower=max(0.0, float(lo)), upper=min(1.0, float(hi)))


for key, k, n, edge in [
    ('n1-fail', 0, 1, 'n = 1, all fail'),
    ('n1-pass', 1, 1, 'n = 1, all pass'),
    ('all-fail-1e6', 0, 10**6, 'all fail, huge n'),
    ('all-pass-1e9', 10**9, 10**9, 'all pass, huge n'),
    ('one-in-1e9', 1, 10**9, 'one pass in a huge n'),
]:
    case(key, 'wilson', edge, [k, n], wilson(k, n), 1e-12, 'intervals', rel=True)


# --- Clopper-Pearson from scipy's beta quantile ----------------------------------------------------------------
def cp(k, n, a=0.05):
    lo = 0.0 if k == 0 else float(stats.beta.ppf(a / 2, k, n - k + 1))
    hi = 1.0 if k == n else float(stats.beta.ppf(1 - a / 2, k + 1, n - k))
    return dict(estimate=k / n, lower=lo, upper=hi)


for key, k, n, a, edge in [
    ('n1-fail', 0, 1, 0.05, 'n = 1, all fail'),
    ('n1-pass', 1, 1, 0.05, 'n = 1, all pass'),
    ('one-in-1e6', 1, 10**6, 0.05, 'one pass in a huge n'),
    ('all-pass-1e5', 10**5, 10**5, 0.05, 'all pass, huge n'),
    ('alpha-0.001', 3, 7, 0.001, 'a far tail level'),
]:
    case(key, 'clopperPearson', edge, [k, n, a], cp(k, n, a), 1e-9, 'intervals', rel=True)


# --- zeroFailureBound in 60-digit decimals, checked by the defining inequality -----------------------------------
def zfb(p, a):
    p, a = Decimal(repr(p)), Decimal(repr(a))
    n = int((a.ln() / (1 - p).ln()).to_integral_value(rounding='ROUND_CEILING'))
    # The smallest n with (1 - p)^n <= alpha, by the logarithms in 60 digits.
    while n > 1 and (n - 1) * (1 - p).ln() <= a.ln():
        n -= 1
    while n * (1 - p).ln() > a.ln():
        n += 1
    return n


for p in [1e-6, 1e-9]:
    case(f'p{p}', 'zeroFailureBound', 'a tiny failure rate', [p, 0.05], zfb(p, 0.05), 0, 'zero')


# --- pass^k and pass@k, exact rationals -------------------------------------------------------------------------
def pass_k(c, n, k):
    return float(Fraction(math.comb(c, k), math.comb(n, k)))


def pass_at_k(c, n, k):
    return float(1 - Fraction(math.comb(n - c, k), math.comb(n, k)))


for key, c, n, k, edge in [
    ('huge-n', 99000, 100000, 50, 'huge n'),
    ('huge-k', 9000, 10000, 100, 'huge n and k'),
    ('all-pass', 40, 40, 40, 'all pass, k = n'),
    ('one-pass-k2', 1, 100000, 2, 'fewer passes than k'),
]:
    case(key, 'passK', edge, [c, n, k], pass_k(c, n, k), 1e-9, 'reliability', rel=True)
for key, c, n, k, edge in [
    ('huge-n', 10, 100000, 50, 'huge n, rare passes'),
    ('all-fail', 0, 30, 5, 'all fail'),
    ('one-pass', 1, 10**5, 1000, 'one pass in a huge n'),
]:
    case(key, 'passAtK', edge, [c, n, k], pass_at_k(c, n, k), 1e-9, 'reliability', rel=True)


# --- McNemar --------------------------------------------------------------------------------------------------------
def mcnemar_cc(b, c):
    stat = (abs(b - c) - 1) ** 2 / (b + c)
    return dict(statistic=stat, pValue=float(stats.chi2.sf(stat, 1)))


case('no-discordant', 'mcnemar', 'no discordant pair', [0, 0], dict(pValue=1.0), 0, 'paired')
case('huge', 'mcnemar', 'huge n', [10**6, 10**6 + 3000], mcnemar_cc(10**6, 10**6 + 3000), 1e-9, 'paired', rel=True)
case('exact-one-sided', 'mcnemar', 'all discordant one way', [0, 12],
     dict(pValue=float(stats.binomtest(0, 12, 0.5).pvalue)), 1e-12, 'paired', rel=True)

# --- Wilcoxon signed rank, scipy's default choice (method auto, zero_method wilcox, no correction) -------------------
for key, x, y, edge in [
    ('ties-zeros', [1, 2, 3, 4, 5, 6, 7, 8], [1, 1, 2, 2, 4, 6, 6, 6], 'ties and zero differences'),
    ('n1', [3], [1], 'n = 1'),
    ('equal-magnitudes', [2, 0, 2, 0, 2, 0, 2, 0, 2, 0], [0, 2, 0, 2, 0, 2, 0, 2, 0, 0], 'every difference ties in size'),
    ('n60-ties', [(i * 7) % 13 for i in range(60)], [(i * 5) % 11 for i in range(60)], 'n above 50 with ties and zeros'),
]:
    r = stats.wilcoxon(x, y)
    case(key, 'wilcoxonSignedRank', edge, [x, y], dict(statistic=float(r.statistic), pValue=float(r.pvalue)),
         1e-9, 'paired', rel=True)

# --- Kolmogorov-Smirnov, exact up to 10000 values per sample ---------------------------------------------------------
for key, a, b, edge in [
    ('ties', [1, 2, 2, 3, 3, 3], [2, 3, 3, 4, 4, 5], 'ties across the samples'),
    ('unequal', [0.1, 0.4, 0.5], [0.2, 0.3, 0.6, 0.7, 0.8, 0.9, 1.0], 'unequal sizes'),
    ('one-each', [0.3], [0.7], 'one value per sample'),
    ('one-vs-many', [5.0], [1.0, 2.0, 3.0, 4.0, 6.0, 7.0, 8.0, 9.0], 'one value against many'),
]:
    r = stats.ks_2samp(a, b, method='exact')
    case(key, 'ksTest', edge, [a, b], dict(statistic=float(r.statistic), pValue=float(r.pvalue)), 1e-9, 'drift',
         rel=True)


# --- Benjamini-Hochberg, the step-up rule written here -------------------------------------------------------------
def bh(p, q=0.05):
    m = len(p)
    order = sorted(range(m), key=lambda i: p[i])
    adj = [0.0] * m
    running = 1.0
    for rank in range(m, 0, -1):
        i = order[rank - 1]
        running = min(running, p[i] * m / rank)
        adj[i] = min(1.0, running)
    kmax = max([r for r in range(1, m + 1) if p[order[r - 1]] <= q * r / m], default=0)
    rejected = [False] * m
    for r in range(kmax):
        rejected[order[r]] = True
    return dict(adjusted=adj, rejected=rejected)


for key, p, q, edge in [
    ('ties', [0.01, 0.01, 0.01, 0.5], 0.05, 'tied p-values'),
    ('zero-and-one', [0.0, 1.0, 0.03, 0.04], 0.05, 'p-values of 0 and 1'),
    ('single', [0.04], 0.05, 'one hypothesis'),
    ('none-rejected', [0.2, 0.3, 0.9], 0.05, 'nothing rejected'),
]:
    case(key, 'benjaminiHochberg', edge, [p, q], bh(p, q), 1e-12, 'multiple')


# --- Cohen's kappa, weighted, written here -------------------------------------------------------------------------
def kappa(a, b, cats, weights='none'):
    K = len(cats)
    idx = {c: i for i, c in enumerate(cats)}
    n = len(a)
    o = [[0.0] * K for _ in range(K)]
    for x, y in zip(a, b):
        o[idx[x]][idx[y]] += 1 / n
    ra = [sum(row) for row in o]
    cb = [sum(o[i][j] for i in range(K)) for j in range(K)]

    def w(i, j):
        if weights == 'linear':
            return abs(i - j) / (K - 1)
        if weights == 'quadratic':
            return ((i - j) / (K - 1)) ** 2
        return 0.0 if i == j else 1.0

    do = sum(w(i, j) * o[i][j] for i in range(K) for j in range(K))
    de = sum(w(i, j) * ra[i] * cb[j] for i in range(K) for j in range(K))
    return 1 - do / de


A = ['low', 'mid', 'high', 'mid', 'low', 'high', 'mid', 'mid']
B = ['low', 'high', 'high', 'mid', 'mid', 'high', 'low', 'mid']
CATS = ['low', 'mid', 'high', 'top']
for weights in ['linear', 'quadratic']:
    case(f'{weights}-unused-category', 'cohenKappa', 'an ordered category no rater used',
         [A, B, dict(weights=weights, categories=CATS)], dict(kappa=kappa(A, B, CATS, weights)), 1e-12, 'agreement')
case('all-disagree', 'cohenKappa', 'raters never agree', [['a', 'b', 'a', 'b'], ['b', 'a', 'b', 'a']],
     dict(kappa=kappa(['a', 'b', 'a', 'b'], ['b', 'a', 'b', 'a'], ['a', 'b'])), 1e-12, 'agreement')


# --- Krippendorff's alpha, the coincidence-matrix algorithm written here --------------------------------------------
def kalpha(matrix, level='nominal'):
    units = list(zip(*matrix))
    values = sorted({v for u in units for v in u if v is not None})
    idx = {v: i for i, v in enumerate(values)}
    V = len(values)
    o = [[0.0] * V for _ in range(V)]
    for u in units:
        vals = [v for v in u if v is not None]
        m = len(vals)
        if m < 2:
            continue
        for i in range(m):
            for j in range(m):
                if i != j:
                    o[idx[vals[i]]][idx[vals[j]]] += 1 / (m - 1)
    nc = [sum(row) for row in o]
    n = sum(nc)

    def d2(c, k):
        a, b = values[c], values[k]
        if level == 'nominal':
            return 0.0 if c == k else 1.0
        if level == 'interval':
            return (a - b) ** 2
        if level == 'ratio':
            return 0.0 if a + b == 0 else ((a - b) / (a + b)) ** 2
        lo, hi = min(c, k), max(c, k)
        return (sum(nc[g] for g in range(lo, hi + 1)) - (nc[c] + nc[k]) / 2) ** 2

    do = sum(o[c][k] * d2(c, k) for c in range(V) for k in range(V)) / n
    de = sum(nc[c] * nc[k] * d2(c, k) for c in range(V) for k in range(V)) / (n * (n - 1))
    return 1 - do / de


MISSING = [[1, 2, 3, None, 2, None, 4], [1, 2, None, 3, 2, 4, None], [None, 2, 3, 3, 1, 4, 4]]
for level in ['nominal', 'ordinal', 'interval', 'ratio']:
    case(f'missing-{level}', 'krippendorffAlpha', 'missing ratings, units with one rating',
         [MISSING, dict(level=level)], dict(alpha=kalpha(MISSING, level)), 1e-12, 'agreement')
ZEROS = [[0, 0, 1, 2, 0, 3], [0, 1, 1, 2, 0, 3]]
case('ratio-zeros', 'krippendorffAlpha', 'ratio level with zero values', [ZEROS, dict(level='ratio')],
     dict(alpha=kalpha(ZEROS, 'ratio')), 1e-12, 'agreement')


# --- mde: the documented power equation, bisection in 60 digits -----------------------------------------------------
def mde(n, p1, repeats=1, rho=0.0, power=0.8, alpha=0.05):
    za = Decimal(repr(float(stats.norm.ppf(1 - alpha / 2))))
    zb = Decimal(repr(float(stats.norm.ppf(power))))
    de = 1 + (repeats - 1) * rho
    N = Decimal(n * repeats) / Decimal(repr(de))
    p1 = Decimal(repr(p1))

    def gap(d):
        p2 = p1 - d
        pb = (p1 + p2) / 2
        return za * (2 * pb * (1 - pb)).sqrt() + zb * (p1 * (1 - p1) + p2 * (1 - p2)).sqrt() - d * N.sqrt()

    if p1 == 0 or gap(p1) > 0:
        return None
    lo, hi = Decimal(0), p1
    for _ in range(200):
        mid = (lo + hi) / 2
        if gap(mid) > 0:
            lo = mid
        else:
            hi = mid
    return float((lo + hi) / 2)


for key, kw, edge in [
    ('n1', dict(n=1, baselineRate=0.5), 'n = 1'),
    ('baseline-all-pass', dict(n=50, baselineRate=1.0), 'a baseline where every run passes'),
    ('baseline-all-fail', dict(n=50, baselineRate=0.0), 'a baseline where every run fails'),
    ('baseline-near-zero', dict(n=200000, baselineRate=0.001), 'a baseline that almost never passes, huge n'),
    ('rho-1', dict(n=40, repeats=6, baselineRate=0.85, rho=1.0), 'repeats that always agree'),
    ('huge-n', dict(n=10**7, repeats=3, baselineRate=0.9, rho=0.2), 'huge n'),
]:
    want = mde(kw['n'], kw['baselineRate'], kw.get('repeats', 1), kw.get('rho', 0.0))
    case(key, 'mde', edge, [kw], dict(effect=want), 1e-9, 'power', rel=True)

out = Path(__file__).with_name('edges.json')
out.write_text(json.dumps(dict(
    note='Expected values of the documented statistics on edge inputs, from scipy, exact rationals and 60-digit decimals; written by make_edges.py.',
    cases=cases), indent=1) + '\n')
print(len(cases), 'cases written to', out)
