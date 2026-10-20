"""Independent log-tail references for the documented two-sided normal intervals and power equation.

Run: python3 packages/validators/fixtures/stats/make_exact_log_alpha.py
Then: pnpm exec biome format --write packages/validators/fixtures/stats/exact-log-alpha.json
Requires mpmath. No product code is imported or executed. Inputs are converted from their binary64 values;
in particular Number.MIN_VALUE is exactly 2**-1074, and its half is retained at arbitrary precision.
Normal quantiles solve log(erfc(z / sqrt(2)) / 2) = log(alpha) - log(2), at 100 decimal digits.
"""

import json
from pathlib import Path

import mpmath as mp

mp.mp.dps = 100


def real(value):
    return mp.mpf(float(value))


def z_for(alpha):
    target = mp.log(alpha) - mp.log(2)
    lo, hi = mp.mpf(0), mp.mpf(50)
    for _ in range(400):
        mid = (lo + hi) / 2
        if mp.log(mp.erfc(mid / mp.sqrt(2)) / 2) > target:
            lo = mid
        else:
            hi = mid
    result = (lo + hi) / 2
    assert abs(mp.log(mp.erfc(result / mp.sqrt(2)) / 2) - target) < mp.mpf('1e-90')
    return result


def wilson(p, n, z):
    center = (n * p + z*z / 2) / (n + z*z)
    half = z * mp.sqrt(n * p * (1-p) + z*z / 4) / (n + z*z)
    return max(0, center-half), min(1, center+half)


def finite_json(value):
    if isinstance(value, dict):
        return {key: finite_json(item) for key, item in value.items()}
    if isinstance(value, list):
        return [finite_json(item) for item in value]
    if isinstance(value, mp.mpf):
        assert mp.isfinite(value)
        return float(value)
    return value


out = {'_provenance': {
    'precision': '100 decimal digits; mpmath log-erfc root, no binary64 alpha/2 intermediate',
    'formulas': 'docs/concepts/statistics.md: power equation, Wilson effective runs, Newcombe method 10, unweighted kappa interval',
    'generator': 'make_exact_log_alpha.py',
}}


def put(fn, aspect, row, expected):
    out[f'{fn}.{aspect}'] = [finite_json({**row, 'expected': expected})]


for aspect, alpha in [('log-alpha-min', mp.mpf(2) ** -1074), ('log-alpha-small-normal', real(1e-300))]:
    z = z_for(alpha)
    put('zFor', aspect, {'alpha': alpha}, z)
    p1, effect, power = real(0.73), real(0.2), real(0.8)
    zb = mp.sqrt(2) * mp.erfinv(2*power-1)

    def numerator(delta):
        p2 = p1-delta
        pbar = (p1+p2)/2
        return z * mp.sqrt(2*pbar*(1-pbar)) + zb * mp.sqrt(p1*(1-p1)+p2*(1-p2))

    required = (numerator(effect) / effect) ** 2
    n = int(mp.ceil(required))
    assert n-1 < required <= n
    put('sampleSizeForEffect', aspect,
        {'effect': effect, 'baselineRate': p1, 'power': power, 'alpha': alpha},
        {'n': n, 'effectiveN': n, 'designEffect': 1})

    n_mde = 20000
    lo, hi = mp.mpf(0), p1
    assert numerator(hi) - hi * mp.sqrt(n_mde) < 0
    for _ in range(400):
        mid = (lo+hi)/2
        if numerator(mid) > mid * mp.sqrt(n_mde):
            lo = mid
        else:
            hi = mid
    put('mde', aspect, {'n': n_mde, 'baselineRate': p1, 'power': power, 'alpha': alpha},
        {'effect': (lo+hi)/2, 'effectiveN': n_mde, 'designEffect': 1})

    clusters = [{'n': 40, 'k': 31}, {'n': 60, 'k': 40}, {'n': 30, 'k': 18}, {'n': 50, 'k': 39}]
    n_total = sum(c['n'] for c in clusters)
    p = mp.mpf(sum(c['k'] for c in clusters))/n_total
    g = len(clusters)
    variance = mp.mpf(g)/(g-1) * sum((c['k']-p*c['n'])**2 for c in clusters) / n_total**2
    effective_n = min(n_total, max(1, p*(1-p)/variance))
    lower, upper = wilson(p, effective_n, z)
    put('wilsonEffective', aspect, {'clusters': clusters, 'alpha': alpha},
        {'estimate': p, 'lower': lower, 'upper': upper, 'n': n_total, 'clusters': g,
         'effectiveN': effective_n, 'designEffect': n_total/effective_n, 'degenerate': False})

    a, b, c, d = 120, 30, 15, 85
    n_total = a+b+c+d
    p, q = mp.mpf(a+b)/n_total, mp.mpf(a+c)/n_total
    lower_p, upper_p = wilson(p, n_total, z)
    lower_q, upper_q = wilson(q, n_total, z)
    covariance = a*d-b*c
    corrected = max(0, mp.mpf(covariance)-mp.mpf(n_total)/2) if covariance > 0 else covariance
    phi = corrected/mp.sqrt((a+b)*(c+d)*(a+c)*(b+d))
    dl1, du1, dl2, du2 = p-lower_p, upper_p-p, q-lower_q, upper_q-q
    lower = p-q-mp.sqrt(dl1**2-2*phi*dl1*du2+du2**2)
    upper = p-q+mp.sqrt(du1**2-2*phi*du1*dl2+dl2**2)
    put('pairedRateDifference', aspect,
        {'table': {'bothPass': a, 'regressed': b, 'improved': c, 'bothFail': d}, 'alpha': alpha},
        {'estimate': p-q, 'lower': max(-1, lower), 'upper': min(1, upper), 'n': n_total})

    table = [[4200, 800], [600, 4400]]
    n_total = sum(map(sum, table))
    po = mp.mpf(table[0][0]+table[1][1])/n_total
    pe = sum(mp.mpf(sum(table[i])) * sum(row[i] for row in table) for i in range(2))/n_total**2
    kappa = (po-pe)/(1-pe)
    se = mp.sqrt(po*(1-po)/n_total)/(1-pe)
    lower, upper = kappa-z*se, kappa+z*se
    assert -1 < lower < upper < 1  # Infinity must not pass by clipping both bounds.
    put('kappaInterval', aspect, {'table': table, 'alpha': alpha},
        {'kappa': kappa, 'se': se, 'lower': lower, 'upper': upper})

Path(__file__).with_name('exact-log-alpha.json').write_text(json.dumps(out, indent=2) + '\n')
