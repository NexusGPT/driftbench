"""Exact reference values for the descriptive and robust statistics (docs/statistics/descriptive.md).

Every value is computed with fractions (rational results) or 120-digit decimals (square roots, logarithms,
exponentials), and every case is cross-checked by a second, different derivation before it is written.
Run: PYTHONDONTWRITEBYTECODE=1 python3 make_newcaps_descriptive.py
"""

import os
import sys
from collections import Counter
from math import floor

sys.path.insert(0, os.path.dirname(__file__))
from ref_common import *  # noqa: E402,F401,F403

DOC = "docs/statistics/descriptive.md"
NAN, INF = "NaN", "Infinity"


def doc(name):
    return f"{DOC}#{name.lower()}"


def fr(xs):
    return [F(x) for x in xs]


def mean_of(s):
    return sum(s, F(0)) / len(s)


# ---------------------------------------------------------------- median and its relatives
def median_exact(xs):
    s = sorted(fr(xs))
    n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2


def median_alt(xs):
    """The mean of the lower and the upper median, each found by counting: the smallest value with at least
    ceil(n / 2) (lower) or floor(n / 2) + 1 (upper) values at or below it."""
    s = fr(xs)
    n = len(s)

    def at_least(k):
        return min(v for v in s if sum(1 for x in s if x <= v) >= k)

    return (at_least((n + 1) // 2) + at_least(n // 2 + 1)) / 2


def median_value(xs):
    a = median_exact(xs)
    assert a == median_alt(xs)
    return a


def mad_value(xs):
    m = median_value(xs)
    devs = [abs(x - m) for x in fr(xs)]
    a = median_exact(devs)
    assert a == median_alt(devs)
    # a different derivation: the smallest radius r such that at least half of the values lie within [m - r, m + r]
    n = len(devs)
    r = min(d for d in devs if sum(1 for e in devs if e <= d) * 2 >= n)
    assert r <= a <= max(devs)  # the lower-half radius never exceeds the median of the deviations
    return a


def cut_count(proportion, n):
    g = floor(proportion * n)  # the double product, as the implementation evaluates it
    assert g == floor(F(proportion) * n), f"the double product and the exact product differ for {proportion}, {n}"
    assert 2 * g < n
    return g


def trimmed_value(xs, p):
    s = sorted(fr(xs))
    n = len(s)
    g = cut_count(p, n)
    a = sum(s[g:n - g], F(0)) / (n - 2 * g)
    rest = sorted(fr(xs))  # a different derivation: cut the current minimum and maximum g times
    for _ in range(g):
        rest.remove(min(rest))
        rest.remove(max(rest))
    b = mean_of(rest)
    assert a == b
    return a


def winsor_value(xs, p):
    s = sorted(fr(xs))
    n = len(s)
    g = cut_count(p, n)
    lowered = [s[g]] * g + s[g:n - g] + [s[n - 1 - g]] * g
    a = mean_of(lowered)
    lo, hi = s[g], s[n - 1 - g]
    b = mean_of([min(max(x, lo), hi) for x in fr(xs)])  # a different derivation: clamp every value
    assert a == b
    return a


def quantile7(s, p):
    n = len(s)
    h = (n - 1) * p
    lo = floor(h)
    if lo + 1 >= n:
        return s[n - 1]
    return s[lo] + (h - lo) * (s[lo + 1] - s[lo])


def quantile7_alt(s, p):
    """Linear interpolation through the points (k / (n - 1), s[k]), found by scanning the segments."""
    n = len(s)
    if n == 1:
        return s[0]
    for k in range(n - 1):
        x0, x1 = F(k, n - 1), F(k + 1, n - 1)
        if x0 <= p <= x1:
            return s[k] + (s[k + 1] - s[k]) * (p - x0) / (x1 - x0)
    raise AssertionError


def iqr_value(xs):
    s = sorted(fr(xs))
    a = quantile7(s, F(3, 4)) - quantile7(s, F(1, 4))
    b = quantile7_alt(s, F(3, 4)) - quantile7_alt(s, F(1, 4))
    assert a == b
    return a


functions = []

# median
cases = []
for xs in ([3], [1, 2, 3, 4], [5, 1, 4, 2, 3], [2, 2, 2], [0.1, 0.2, 0.3, 10], [412, 380, 395, 1210, 402, 388],
           [-5, -1, -3, -2], [1, 2, 2, 3], [7, 7, 1, 1]):
    cases.append(case([xs], median_value(xs)))
functions.append(function("median", "descriptive", doc("median"), cases,
                          [[[]], [[1, NAN]], [[INF, 2]]]))

# medianAbsoluteDeviation
cases = []
for xs in ([1, 1, 2, 2, 4, 6, 9], [5], [1, 2, 3, 4], [2, 2, 2], [0.82, 0.79, 0.91, 0.85, 0.3, 0.88],
           [412, 380, 395, 1210, 402, 388], [-3, 10, -1, 4], [1, 3]):
    cases.append(case([xs], mad_value(xs)))
functions.append(function("medianAbsoluteDeviation", "descriptive", doc("medianAbsoluteDeviation"), cases,
                          [[[]], [[1, 2, NAN]], [["-Infinity", 2]]]))

# trimmedMean
cases = []
for xs, p in (([1, 2, 3, 4, 5, 6, 7, 8, 9, 100], 0.1), ([4, 8, 15, 16, 23, 42], 0), ([10, 2, 7, 3, 99], 0.25),
              ([1, 50, 3], 0.4), ([9, 1, 5, 7], 0.2), ([2, 4, 6, 8, 10, 12, 100], 0.45),
              ([0.91, 0.88, 0.95, 0.12, 0.9, 0.93, 0.89, 0.97, 0.9, 0.31, 0.92, 0.94], 0.25), ([5], 0.3),
              ([3, 3, 3, 3], 0.25)):
    cases.append(case([xs, p], trimmed_value(xs, p)))
functions.append(function("trimmedMean", "descriptive", doc("trimmedMean"), cases,
                          [[[1, 2, 3], 0.5], [[1, 2, 3], -0.1], [[1, 2, 3], 0.75], [[], 0.1], [[1, 2], NAN],
                           [[1, 2], INF]]))

# winsorizedMean
cases = []
for xs, p in (([1, 2, 4, 8, 16, 32, 64, 128, 256, 1000], 0.1), ([4, 8, 15, 16, 23, 42], 0), ([10, 2, 7, 3, 99], 0.25),
              ([1, 50, 3], 0.4), ([9, 1, 5, 7], 0.2), ([2, 4, 6, 8, 10, 12, 100], 0.45),
              ([0.91, 0.88, 0.95, 0.12, 0.9, 0.93, 0.89, 0.97, 0.9, 0.31, 0.92, 0.94], 0.25), ([5], 0.3),
              ([-8, 1, 1, 2, 2, 3, 40], 0.3)):
    cases.append(case([xs, p], winsor_value(xs, p)))
functions.append(function("winsorizedMean", "descriptive", doc("winsorizedMean"), cases,
                          [[[1, 2, 3], 0.5], [[1, 2, 3], -0.1], [[1, 2, 3], 0.75], [[], 0.1], [[1, 2], NAN],
                           [[1, 2], INF]]))

# interquartileRange
cases = []
for xs in ([1, 2, 3, 4, 5], [1, 2, 3, 4], [7], [2, 2, 2, 2], [9, 1, 4, 6, 2, 8, 3, 5, 7, 10], [1, 2],
           [412, 380, 395, 1210, 402, 388], [0.12, 0.8, 0.5, 0.33, 0.95, 0.61, 0.7], [-4, -1, 0, 0, 3, 10, 11]):
    cases.append(case([xs], iqr_value(xs)))
functions.append(function("interquartileRange", "descriptive", doc("interquartileRange"), cases,
                          [[[]], [[1, NAN]], [[1, INF]]]))


# ---------------------------------------------------------------- shape
def central_moments(s):
    n = len(s)
    mu = mean_of(s)
    return mu, *[sum(((x - mu) ** k for x in s), F(0)) / n for k in (2, 3, 4)]


def raw_central(s):
    """The same moments from raw moments, a different derivation (exact in fractions)."""
    n = len(s)
    mu = mean_of(s)
    e = {k: sum((x**k for x in s), F(0)) / n for k in (1, 2, 3, 4)}
    m3 = e[3] - 3 * mu * e[2] + 2 * mu**3
    m4 = e[4] - 4 * mu * e[3] + 6 * mu**2 * e[2] - 3 * mu**4
    return m3, m4


def skew_value(xs):
    s = fr(xs)
    if min(s) == max(s):
        return F(0)
    mu, m2, m3, m4 = central_moments(s)
    r3, _ = raw_central(s)
    assert r3 == m3
    g1 = dec(m3) / (dec(m2) * dec(m2).sqrt())
    close(g1 * g1, dec(m3 * m3 / m2**3))
    assert (g1 > 0) == (m3 > 0) and (g1 < 0) == (m3 < 0)
    return g1


def kurt_value(xs):
    s = fr(xs)
    if min(s) == max(s):
        return F(0)
    mu, m2, m3, m4 = central_moments(s)
    _, r4 = raw_central(s)
    assert r4 == m4
    g2 = m4 / m2**2 - 3
    z4 = sum(((dec(x - mu) / dec(m2).sqrt()) ** 4 for x in s), D(0)) / len(s) - 3
    close(dec(g2), z4)
    return g2


cases = []
for xs in ([1, 2, 3, 10], [1, 2, 3, 4, 5], [4, 4, 4], [5], [2, 3, 5, 7, 11, 13], [0, 0, 0, 1], [-9, 1, 2, 2, 3],
           [0.9, 0.92, 0.95, 0.97, 0.5], [10, 1, 2]):
    cases.append(case([xs], skew_value(xs)))
functions.append(function("skewness", "shape", doc("skewness"), cases, [[[]], [[1, 2, NAN]], [[INF]]]))

cases = []
for xs in ([1, 2], [1, 2, 3, 4, 5], [1, 1, 1, 1, 10], [0, 0, 1, 1], [4, 4, 4], [5], [2, 3, 5, 7, 11, 13],
           [412, 380, 395, 1210, 402, 388], [-6, 0, 0, 0, 0, 6]):
    cases.append(case([xs], kurt_value(xs)))
functions.append(function("excessKurtosis", "shape", doc("excessKurtosis"), cases, [[[]], [[1, 2, NAN]], [["-Infinity"]]]))


# ---------------------------------------------------------------- means
def geo_value(xs):
    s = fr(xs)
    n = len(s)
    a = (sum((dec(x).ln() for x in s), D(0)) / n).exp()
    prod = F(1)
    for x in s:
        prod *= x
    b = (dec(prod).ln() / n).exp()
    close(a, b, 1e-25)
    return a


def harm_value(xs):
    s = fr(xs)
    n = len(s)
    a = n / sum((1 / x for x in s), F(0))
    prod = F(1)
    for x in s:
        prod *= x
    b = n * prod / sum((prod / x for x in s), F(0))  # the common denominator form
    assert a == b
    return a


cases = []
for xs in ([1, 2, 4], [5], [2, 8], [1, 10, 100], [1.1, 0.95, 1.2, 1.05], [1e10] * 400, [1e-200, 1e200],
           [3, 3, 3], [0.5, 2, 8, 32]):
    cases.append(case([xs], geo_value(xs)))
functions.append(function("geometricMean", "means", doc("geometricMean"), cases,
                          [[[]], [[1, 0]], [[1, -2]], [[2, NAN]], [[INF, 1]]]))

cases = []
for xs in ([1, 2, 4], [2, 2], [5], [1, 4, 4], [40, 60], [0.5, 2, 8], [30, 60, 45, 90], [1e-3, 1e3],
           [0.8, 0.8, 0.5]):
    cases.append(case([xs], harm_value(xs)))
functions.append(function("harmonicMean", "means", doc("harmonicMean"), cases,
                          [[[]], [[1, 0]], [[1, -2]], [[2, NAN]], [[INF, 1]]]))


# ---------------------------------------------------------------- spread of the sample
def cv_value(xs):
    s = fr(xs)
    n = len(s)
    mu = mean_of(s)
    assert mu != 0
    if min(s) == max(s):
        return F(0)
    var = sum(((x - mu) ** 2 for x in s), F(0)) / (n - 1)
    assert var == (sum((x * x for x in s), F(0)) - n * mu * mu) / (n - 1)
    cv = dec(var).sqrt() / abs(dec(mu))
    close(cv * cv, dec(var / (mu * mu)))
    return cv


cases = []
for xs in ([2, 4, 4, 4, 5, 5, 7, 9], [10, 10], [1, 3], [-4, -6, -5], [120, 135, 128, 410, 131, 126],
           [0.82, 0.79, 0.91, 0.85, 0.88], [1, 2, 3, 4, 5, 6], [-1, -1, -1]):
    cases.append(case([xs], cv_value(xs)))
functions.append(function("coefficientOfVariation", "descriptive", doc("coefficientOfVariation"), cases,
                          [[[]], [[5]], [[-1, 1]], [[-2, 0, 2]], [[0, 0]], [[1, NAN]]]))

# ---------------------------------------------------------------- correlation
def sums(xs, ys):
    sx, sy = fr(xs), fr(ys)
    n = len(sx)
    mx, my = mean_of(sx), mean_of(sy)
    sxx = sum(((x - mx) ** 2 for x in sx), F(0))
    syy = sum(((y - my) ** 2 for y in sy), F(0))
    sxy = sum(((x - mx) * (y - my) for x, y in zip(sx, sy)), F(0))
    return n, mx, my, sxx, syy, sxy


def cov_value(xs, ys):
    n, mx, my, sxx, syy, sxy = sums(xs, ys)
    a = sxy / (n - 1)
    sx, sy = fr(xs), fr(ys)
    b = (sum((x * y for x, y in zip(sx, sy)), F(0)) - n * mx * my) / (n - 1)
    c = sum(((sx[i] - sx[j]) * (sy[i] - sy[j]) for i in range(n) for j in range(i + 1, n)), F(0)) / (n * (n - 1))
    assert a == b == c
    return a


def pearson_exact(sx, sy):
    """Pearson on exact inputs; 0 when either side is constant."""
    n = len(sx)
    mx, my = mean_of(sx), mean_of(sy)
    sxx = sum(((x - mx) ** 2 for x in sx), F(0))
    syy = sum(((y - my) ** 2 for y in sy), F(0))
    sxy = sum(((x - mx) * (y - my) for x, y in zip(sx, sy)), F(0))
    if sxx == 0 or syy == 0:
        return D(0), sxx, syy, sxy
    r = dec(sxy) / (dec(sxx) * dec(syy)).sqrt()
    return r, sxx, syy, sxy


def pearson_value(xs, ys):
    sx, sy = fr(xs), fr(ys)
    if min(sx) == max(sx) or min(sy) == max(sy):
        return F(0)
    r, sxx, syy, sxy = pearson_exact(sx, sy)
    close(r * r, dec(sxy * sxy / (sxx * syy)))
    assert (r > 0) == (sxy > 0) and (r < 0) == (sxy < 0)
    n = len(sx)
    covariance = cov_value(xs, ys)
    sdx, sdy = dec(sxx / (n - 1)).sqrt(), dec(syy / (n - 1)).sqrt()
    close(r, dec(covariance) / (sdx * sdy), 1e-25)  # covariance over the product of the standard deviations
    return r


cases = []
for xs, ys in (([1, 2, 3, 4], [2, 4, 6, 8]), ([1, 3], [2, 8]), ([1, 2, 3], [5, 5, 5]), ([4, 1, 3, 2], [1, 4, 2, 3]),
               ([0.82, 0.79, 0.91, 0.85, 0.88], [0.8, 0.7, 0.95, 0.9, 0.86]), ([-2, -1, 0, 1, 2], [4, 1, 0, 1, 4]),
               ([10, 20, 30], [1, 1, 4])):
    cases.append(case([xs, ys], cov_value(xs, ys)))
functions.append(function("sampleCovariance", "correlation", doc("sampleCovariance"), cases,
                          [[[1], [1]], [[], []], [[1, 2], [1]], [[1, 2, 3], [1, 2]], [[1, NAN], [1, 2]],
                           [[1, 2], [1, INF]]]))

cases = []
for xs, ys in (([1, 2, 3], [2, 4, 6]), ([1, 2, 3], [9, 6, 3]), ([1, 2, 3, 4, 5], [2, 1, 4, 3, 5]),
               ([3, 3, 3], [1, 2, 3]), ([1, 2, 3], [4, 4, 4]), ([-1, 0, 1], [1, -2, 1]), ([1, 2], [5, 3]),
               ([0.82, 0.79, 0.91, 0.85, 0.88, 0.7], [0.8, 0.7, 0.95, 0.9, 0.86, 0.6]),
               ([120, 135, 128, 410, 131], [3, 4, 3, 9, 4])):
    cases.append(case([xs, ys], pearson_value(xs, ys)))
functions.append(function("pearsonCorrelation", "correlation", doc("pearsonCorrelation"), cases,
                          [[[1], [1]], [[], []], [[1, 2], [1]], [[1, 2, 3], [1, 2]], [[1, NAN], [1, 2]],
                           [[1, 2], [1, INF]]]))


def rank_alt(xs):
    """Mid-rank by counting: values below, plus half of the values equal to it, plus a half."""
    return [F(sum(1 for y in xs if y < x)) + F(sum(1 for y in xs if y == x) + 1, 2) for x in xs]


def spearman_value(xs, ys):
    rx, ry = ranks(xs), ranks(ys)
    assert rx == rank_alt(xs) and ry == rank_alt(ys)
    if min(rx) == max(rx) or min(ry) == max(ry):
        return F(0)
    r, sxx, syy, sxy = pearson_exact(rx, ry)
    n = len(rx)
    close(r * r, dec(sxy * sxy / (sxx * syy)))
    # a different derivation: sums of squared rank deviations and squared rank differences
    sd2 = sum(((a - b) ** 2 for a, b in zip(rx, ry)), F(0))
    alt = dec(sxx + syy - sd2) / (2 * (dec(sxx) * dec(syy)).sqrt())
    close(r, alt, 1e-25)
    if len(set(xs)) == n and len(set(ys)) == n:  # no ties: the classical formula
        close(r, dec(1 - F(6) * sd2 / (n * (n * n - 1))), 1e-25)
    return r


cases = []
for xs, ys in (([1, 2, 3, 4], [1, 8, 27, 64]), ([1, 2, 2, 3], [1, 3, 2, 2]), ([1, 2, 3, 4, 5], [5, 4, 3, 2, 1]),
               ([2, 2, 2], [1, 2, 3]), ([1, 2], [2, 1]), ([3, 1, 2, 5, 4], [1, 2, 3, 4, 5]),
               ([4, 4, 5, 3, 5, 2, 1, 4], [3, 4, 5, 3, 4, 1, 2, 5]), ([1, 2, 3], [7, 7, 7]),
               ([0.9, 0.1, 0.5, 0.5, 0.7], [10, 3, 8, 6, 1]), ([-1, 0, 1], [1, -2, 1])):
    cases.append(case([xs, ys], spearman_value(xs, ys)))
functions.append(function("spearmanRho", "correlation", doc("spearmanRho"), cases,
                          [[[1], [1]], [[], []], [[1, 2], [1]], [[1, 2, 3], [1, 2]], [[1, NAN], [1, 2]],
                           [[1, 2], [1, INF]]]))


def kendall_value(xs, ys):
    n = len(xs)
    sx, sy = fr(xs), fr(ys)
    n0 = n * (n - 1) // 2
    n1 = sum(t * (t - 1) // 2 for t in Counter(xs).values())
    n2 = sum(t * (t - 1) // 2 for t in Counter(ys).values())
    conc = disc = 0
    for i in range(n):
        for j in range(i + 1, n):
            p = (sx[i] - sx[j]) * (sy[i] - sy[j])
            conc += p > 0
            disc += p < 0
    # a different derivation: the signed sum, and the tied pairs counted pair by pair
    sign = lambda v: (v > 0) - (v < 0)  # noqa: E731
    s = sum(sign(sx[i] - sx[j]) * sign(sy[i] - sy[j]) for i in range(n) for j in range(i + 1, n))
    tx = sum(1 for i in range(n) for j in range(i + 1, n) if sx[i] == sx[j])
    ty = sum(1 for i in range(n) for j in range(i + 1, n) if sy[i] == sy[j])
    assert s == conc - disc and tx == n1 and ty == n2
    den = (n0 - n1) * (n0 - n2)
    if den == 0:
        return F(0)
    tau = dec(conc - disc) / dec(den).sqrt()
    close(tau * tau, dec(F((conc - disc) ** 2, den)))
    return tau


cases = []
for xs, ys in (([1, 2, 3, 4, 5], [3, 1, 2, 5, 4]), ([1, 2], [2, 1]), ([1, 2, 2, 3], [1, 3, 2, 2]),
               ([3, 3, 3], [1, 2, 3]), ([1, 2, 3, 4], [1, 2, 3, 4]), ([1, 1, 2, 2], [1, 2, 1, 2]),
               ([4, 4, 5, 3, 5, 2, 1, 4], [3, 4, 5, 3, 4, 1, 2, 5]), ([1, 2, 3], [7, 7, 7]),
               ([0.9, 0.1, 0.5, 0.5, 0.7], [10, 3, 8, 6, 1]), ([5, 6, 6], [1, 1, 2])):
    cases.append(case([xs, ys], kendall_value(xs, ys)))
functions.append(function("kendallTauB", "correlation", doc("kendallTauB"), cases,
                          [[[1], [1]], [[], []], [[1, 2], [1]], [[1, 2, 3], [1, 2]], [[1, NAN], [1, 2]],
                           [[1, 2], [1, INF]]]))


# ---------------------------------------------------------------- mode and weighted median
def mode_value(xs):
    count = Counter(xs)
    top = max(count.values())
    a = min(v for v, c in count.items() if c == top)
    best, run, prev, winner = 0, 0, None, None  # a different derivation: scan the sorted values for runs
    for v in sorted(xs):
        run = run + 1 if v == prev else 1
        if run > best:
            best, winner = run, v
        prev = v
    assert winner == a and best == top
    return a


cases = []
for xs in ([1, 2, 2, 3], [1, 1, 2, 2], [5], [3, 1, 2], [-2, -2, 0, 0, 5], [4, 5, 5, 3, 4, 5, 2, 4], [0.5, 0.1, 0.5, 0.1],
           [9, 9, 9], [7, 3, 7, 3, 7, 3, 1]):
    cases.append(case([xs], mode_value(xs)))
functions.append(function("mode", "descriptive", doc("mode"), cases, [[[]], [[1, NAN]], [[INF, INF]]]))


def wmedian_value(xs, ws):
    n = len(xs)
    sx, sw = fr(xs), fr(ws)
    total = sum(sw, F(0))
    cum = F(0)
    a = None
    for v, w in sorted(zip(sx, sw)):  # the first entry whose cumulative weight reaches half of the total
        cum += w
        if cum * 2 >= total:
            a = v
            break
    hits = [v for v in sorted(set(sx))
            if sum((w for x, w in zip(sx, sw) if x < v), F(0)) * 2 < total
            and sum((w for x, w in zip(sx, sw) if x <= v), F(0)) * 2 >= total]
    assert hits == [a]  # the unique value with less than half the weight below it and at least half at or below
    if len(set(ws)) == 1:
        assert a == sorted(sx)[(n - 1) // 2]  # equal weights give the lower median
    return a


cases = []
for xs, ws in (([1, 2, 3], [1, 1, 1]), ([1, 2], [1, 1]), ([1, 2, 3], [1, 1, 5]), ([2, 2, 5], [1, 1, 1]),
               ([30, 10, 40, 20], [0.25, 0.25, 0.25, 0.25]), ([7], [3]), ([5, 1, 9, 3], [2, 0.5, 0.25, 2.25]),
               ([120, 135, 128, 410, 131], [4, 1, 2, 1, 8]), ([1, 2, 3, 4], [1, 2, 2, 1])):
    cases.append(case([xs, ws], wmedian_value(xs, ws)))
functions.append(function("weightedMedian", "descriptive", doc("weightedMedian"), cases,
                          [[[], []], [[1, 2], [1]], [[1, 2], [1, 0]], [[1, 2], [1, -1]], [[1, 2], [1, NAN]],
                           [[1, NAN], [1, 1]], [[1, 2], [1, INF]]]))

write("descriptive", "Computed with fractions and 120-digit decimals by make_newcaps_descriptive.py; every case "
      "is cross-checked by a second derivation.", functions)
