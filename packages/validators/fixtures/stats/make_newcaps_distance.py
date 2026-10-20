"""Cases for the group `distance` (docs/statistics/distance.md): distances between distributions, trend
tests and control charts. Run:  PYTHONDONTWRITEBYTECODE=1 python3 packages/validators/fixtures/stats/make_newcaps_distance.py

Every value is computed from the definition in the page with exact arithmetic (Fraction for rationals, Decimal at
120 digits for ln and sqrt) and cross-checked by a second, different derivation; the doubles are rounded once.
"""

import os
import sys
from itertools import permutations

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ref_common import *  # noqa: E402,F403

functions = []
INF = "Infinity"


def pf(xs):
    return [F(x) for x in xs]


def chk_prob(p):
    assert abs(sum(pf(p)) - 1) <= F(1, 10**9) and all(F(x) >= 0 for x in p), p


def xlogx(a):
    return dec(a) * ln(dec(a)) if a > 0 else D(0)


# ---------------------------------------------------------------------------------------------- divergence
def kl_exact(p, q):
    s = D(0)
    for a, b in zip(pf(p), pf(q)):
        if a > 0:
            assert b > 0
            s += dec(a) * ln(dec(a / b))
    return s


def kl_alt(p, q):  # sum p ln p - sum p ln q over the support of p
    s = D(0)
    for a, b in zip(pf(p), pf(q)):
        if a > 0:
            s += xlogx(a) - dec(a) * ln(dec(b))
    return s


PV_DOMAIN = [
    [[0.5, 0.5], [0.5, 0.25, 0.25]],  # lengths differ
    [[], []],  # empty
    [[0.5, 0.6], [0.5, 0.5]],  # p sums to 1.1
    [[0.5, 0.5], [0.4, 0.4]],  # q sums to 0.8
    [[0.5, 0.500001], [0.5, 0.5]],  # sum off by 1e-6, above the 1e-9 slack
    [[1.5, -0.5], [0.5, 0.5]],  # sums to 1 but holds a negative entry
    [[0.5, "NaN"], [0.5, 0.5]],
    [[0.5, 0.5], [0.5, INF]],
]

cases = []
for p, q in [
    ([0.5, 0.5], [0.25, 0.75]),
    ([0.5, 0.25, 0.25], [0.5, 0.25, 0.25]),
    ([0, 0.5, 0.5], [0.2, 0.3, 0.5]),
    ([1, 0], [0.5, 0.5]),
    ([0.6, 0.4, 0], [0.5, 0.5, 0]),
    ([0.05, 0.15, 0.4, 0.3, 0.1], [0.1, 0.2, 0.3, 0.25, 0.15]),
    ([0.9, 0.1], [0.5, 0.5]),
    ([0.5, 0.5], [0.9, 0.1]),
]:
    chk_prob(p), chk_prob(q)
    a = kl_exact(p, q)
    close(a, kl_alt(p, q))
    cases.append(case([p, q], a))
functions.append(function("klDivergence", "divergence", "docs/statistics/distance.md#kldivergence", cases,
                          PV_DOMAIN + [[[0.5, 0.5], [1, 0]], [[0.2, 0.3, 0.5], [0.5, 0.5, 0]]]))


def js_exact(p, q):
    s = D(0)
    for a, b in zip(pf(p), pf(q)):
        m = (a + b) / 2
        if a > 0:
            s += dec(a) * ln(dec(a / m)) / 2
        if b > 0:
            s += dec(b) * ln(dec(b / m)) / 2
    return s


def js_alt(p, q):  # 1/2 sum p ln p + 1/2 sum q ln q - sum m ln m
    s = D(0)
    for a, b in zip(pf(p), pf(q)):
        s += xlogx(a) / 2 + xlogx(b) / 2 - xlogx((a + b) / 2)
    return s


cases = []
for p, q in [
    ([0.5, 0.5], [0.5, 0.5]),
    ([1, 0], [0, 1]),
    ([0.4, 0.6], [0.1, 0.9]),
    ([0.9, 0.1], [0.4, 0.6]),
    ([0.5, 0.5, 0], [0, 0.5, 0.5]),
    ([0.05, 0.15, 0.4, 0.3, 0.1], [0.1, 0.2, 0.3, 0.25, 0.15]),
    ([0.25, 0.25, 0.5], [0.5, 0.25, 0.25]),
]:
    chk_prob(p), chk_prob(q)
    a = js_exact(p, q)
    close(a, js_alt(p, q))
    cases.append(case([p, q], a))
functions.append(function("jensenShannonDivergence", "divergence",
                          "docs/statistics/distance.md#jensenshannondivergence", cases, PV_DOMAIN))


def hel_exact(p, q):
    s = D(0)
    for a, b in zip(pf(p), pf(q)):
        s += (dec(a).sqrt() - dec(b).sqrt()) ** 2
    return (s / 2).sqrt()


def hel_alt(p, q):  # sqrt(1/2 (sum p + sum q) - sum sqrt(p q))
    sp, sq = sum(pf(p)), sum(pf(q))
    cross = sum((dec(a * b).sqrt() for a, b in zip(pf(p), pf(q))), D(0))
    return ((dec(sp) + dec(sq)) / 2 - cross).sqrt()


cases = []
for p, q in [
    ([0.5, 0.5], [0.25, 0.75]),
    ([0.5, 0.25, 0.25], [0.5, 0.25, 0.25]),
    ([1, 0], [0, 1]),
    ([0.5, 0.5, 0], [0, 0.5, 0.5]),
    ([0.05, 0.15, 0.4, 0.3, 0.1], [0.1, 0.2, 0.3, 0.25, 0.15]),
    ([0.7, 0.2, 0.1], [0.2, 0.3, 0.5]),
]:
    chk_prob(p), chk_prob(q)
    a = hel_exact(p, q)
    close(a, hel_alt(p, q), rel=1e-25)
    cases.append(case([p, q], a))
functions.append(function("hellingerDistance", "divergence",
                          "docs/statistics/distance.md#hellingerdistance", cases, PV_DOMAIN))


def tv_exact(p, q):
    return sum(abs(a - b) for a, b in zip(pf(p), pf(q))) / 2


def tv_alt(p, q):  # 1/2 (sum p + sum q) - sum min(p, q)
    return (sum(pf(p)) + sum(pf(q))) / 2 - sum(min(a, b) for a, b in zip(pf(p), pf(q)))


cases = []
for p, q in [
    ([0.5, 0.5], [0.25, 0.75]),
    ([0.5, 0.25, 0.25], [0.5, 0.25, 0.25]),
    ([1, 0], [0, 1]),
    ([0.05, 0.15, 0.4, 0.3, 0.1], [0.1, 0.2, 0.3, 0.25, 0.15]),
    ([0.7, 0.2, 0.1], [0.2, 0.3, 0.5]),
    ([0.3, 0.7, 0], [0.3, 0.3, 0.4]),
]:
    chk_prob(p), chk_prob(q)
    a = tv_exact(p, q)
    assert abs(a - tv_alt(p, q)) < F(1, 10**15)
    close(a, tv_alt(p, q), rel=1e-15)
    cases.append(case([p, q], a))
functions.append(function("totalVariationDistance", "divergence",
                          "docs/statistics/distance.md#totalvariationdistance", cases, PV_DOMAIN))


def psi_exact(e, a):
    s = D(0)
    for x, y in zip(pf(e), pf(a)):
        s += dec(y - x) * ln(dec(y / x))
    return s


cases = []
for e, a in [
    ([0.25, 0.25, 0.25, 0.25], [0.2, 0.3, 0.25, 0.25]),
    ([0.5, 0.25, 0.25], [0.5, 0.25, 0.25]),
    ([0.5, 0.5], [0.9, 0.1]),
    ([0.1, 0.2, 0.4, 0.2, 0.1], [0.05, 0.15, 0.4, 0.25, 0.15]),
    ([0.05, 0.15, 0.4, 0.3, 0.1], [0.1, 0.2, 0.3, 0.25, 0.15]),
    ([0.7, 0.3], [0.4, 0.6]),
]:
    chk_prob(e), chk_prob(a)
    v = psi_exact(e, a)
    close(v, kl_exact(a, e) + kl_exact(e, a))  # PSI is the sum of the two KL directions
    cases.append(case([e, a], v))
functions.append(function("populationStabilityIndex", "divergence",
                          "docs/statistics/distance.md#populationstabilityindex", cases,
                          PV_DOMAIN + [[[0.5, 0.5, 0], [0.4, 0.3, 0.3]], [[0.4, 0.3, 0.3], [0.5, 0.5, 0]],
                                       [[1, 0], [0.5, 0.5]]]))

# ---------------------------------------------------------------------------------------------- distance
def w1_exact(a, b):
    sa, sb = sorted(pf(a)), sorted(pf(b))
    return sum(abs(x - y) for x, y in zip(sa, sb)) / len(sa)


def cdf_integral(a, b, power):
    """integral of |Fa - Fb|^power dx between the empirical CDFs, by walking the merged sorted values."""
    fa, fb = pf(a), pf(b)
    pts = sorted(set(fa) | set(fb))
    tot = F(0)
    for lo, hi in zip(pts, pts[1:]):
        ga = F(sum(1 for x in fa if x <= lo), len(fa))
        gb = F(sum(1 for x in fb if x <= lo), len(fb))
        tot += abs(ga - gb) ** power * (hi - lo)
    return tot


cases = []
for a, b in [
    ([1, 2, 3], [1, 2, 3]),
    ([0, 1], [2, 3]),
    ([3, 1, 2], [10, 12, 11]),
    ([0.82, 1.1, 0.95, 1.4, 0.77], [0.9, 1.25, 1.05, 1.6, 0.88]),
    ([5], [2]),
    ([1, 1, 2, 2], [1, 2, 2, 3]),
    ([-2, 0, 2], [-1, 1, 5]),
]:
    v = w1_exact(a, b)
    assert v == cdf_integral(a, b, 1), (a, b)
    cases.append(case([a, b], v))
functions.append(function("wassersteinDistance1D", "distance",
                          "docs/statistics/distance.md#wassersteindistance1d", cases,
                          [[[1, 2], [1]], [[], []], [[1, "NaN"], [1, 2]], [[1, 2], [1, INF]], [[1], []]]))


def energy_exact(a, b):
    fa, fb = pf(a), pf(b)
    xy = sum(abs(x - y) for x in fa for y in fb) / (len(fa) * len(fb))
    xx = sum(abs(x - y) for x in fa for y in fa) / (len(fa) ** 2)
    yy = sum(abs(x - y) for x in fb for y in fb) / (len(fb) ** 2)
    return 2 * xy - xx - yy


cases = []
for a, b in [
    ([0], [1]),
    ([1, 2, 3], [3, 2, 1]),
    ([0, 1], [2, 3]),
    ([1, 2, 3, 4], [2.5]),
    ([0.82, 1.1, 0.95, 1.4, 0.77], [0.9, 1.25, 1.05, 1.6, 0.88, 1.12]),
    ([2, 2, 2], [2, 2]),
    ([1, 1, 5], [1, 5, 5]),
    ([1, 2], [1, 1, 2, 2]),
]:
    v = energy_exact(a, b)
    assert v == 2 * cdf_integral(a, b, 2), (a, b)  # in one dimension: 2 * integral (Fa - Fb)^2 dx
    cases.append(case([a, b], v))
functions.append(function("energyDistance1D", "distance",
                          "docs/statistics/distance.md#energydistance1d", cases,
                          [[[], [1]], [[1], []], [[1, "NaN"], [1]], [[1], [INF]], [[], []]]))

# ---------------------------------------------------------------------------------------------- trend
def sign(x):
    return (x > 0) - (x < 0)


def mk_s(xs):
    f = pf(xs)
    return sum(sign(f[j] - f[i]) for i in range(len(f)) for j in range(i + 1, len(f)))


def mk_s_alt(xs):  # total pairs - tied pairs - 2 * decreasing pairs
    f = pf(xs)
    n = len(f)
    dec_ = sum(1 for i in range(n) for j in range(i + 1, n) if f[j] < f[i])
    tie = sum(1 for i in range(n) for j in range(i + 1, n) if f[j] == f[i])
    return n * (n - 1) // 2 - tie - 2 * dec_


REAL = [0.71, 0.74, 0.73, 0.78, 0.77, 0.81, 0.80, 0.84]
REAL_T = [0.71, 0.74, 0.74, 0.78, 0.77, 0.81, 0.81, 0.84]
cases = []
for xs in ([1, 2, 3, 4, 5], [5, 4, 3, 2, 1], [1, 1, 1], [2, 1, 3, 3, 5, 4], REAL, REAL_T, [3, 1], [2, 2, 1, 1, 3]):
    v = mk_s(xs)
    assert v == mk_s_alt(xs)
    cases.append(case([xs], v))
functions.append(function("mannKendallS", "trend", "docs/statistics/distance.md#mannkendalls", cases,
                          [[[]], [[1]], [[1, "NaN", 2]], [[1, 2, INF]]]))


def mk_var(xs):
    f = pf(xs)
    n = len(f)
    out = F(n * (n - 1) * (2 * n + 5))
    seen = {}
    for x in f:
        seen[x] = seen.get(x, 0) + 1
    for t in seen.values():
        out -= t * (t - 1) * (2 * t + 5)
    return out / 18


def mk_var_perm(xs):  # the variance of S over all n! orderings of the values
    f = pf(xs)
    n = len(f)
    tot = tot2 = 0
    cnt = 0
    for perm in permutations(f):
        s = sum(sign(perm[j] - perm[i]) for i in range(n) for j in range(i + 1, n))
        tot += s
        tot2 += s * s
        cnt += 1
    return F(tot2, cnt) - F(tot, cnt) ** 2


cases = []
for xs in ([1, 2, 3, 4], [1, 1, 2, 2, 3], [5, 5, 5, 5], [3, 1], REAL_T, [1, 2, 2, 2, 3, 3], [4, 1, 3, 2, 5, 6, 7]):
    v = mk_var(xs)
    assert v == mk_var_perm(xs), xs
    cases.append(case([xs], v))
functions.append(function("mannKendallVariance", "trend", "docs/statistics/distance.md#mannkendallvariance",
                          cases, [[[]], [[1]], [[1, "NaN", 2]], [[INF, 2]]]))


def ts_exact(xs):
    f = pf(xs)
    n = len(f)
    sl = sorted((f[j] - f[i]) / (j - i) for i in range(n) for j in range(i + 1, n))
    m = len(sl)
    return sl[m // 2] if m % 2 else (sl[m // 2 - 1] + sl[m // 2]) / 2, sl


def ts_alt(xs):  # enumerate by lag, use the library median
    import statistics

    f = pf(xs)
    n = len(f)
    sl = [(f[i + d] - f[i]) / d for d in range(1, n) for i in range(n - d)]
    return statistics.median(sl)


cases = []
for xs in ([1, 2, 3, 4], [4, 3, 2, 1], [1, 3, 2, 5, 4], [2, 2, 2], [1, 4], [1, 2, 3, 4, 100], REAL, [0.9, 0.7, 0.8, 0.6, 0.65, 0.5]):
    v, sl = ts_exact(xs)
    assert v == ts_alt(xs)
    m = len(sl)
    if m % 2 == 0:  # guard: the two middle slopes must not cancel in doubles
        a, b = sl[m // 2 - 1], sl[m // 2]
        assert a == b or abs(a + b) >= F(1, 100) * max(abs(a), abs(b)), xs
    cases.append(case([xs], v))
functions.append(function("theilSenSlope", "trend", "docs/statistics/distance.md#theilsenslope", cases,
                          [[[]], [[1]], [[1, "NaN"]], [[1, 2, INF]]]))


def acf(xs, lag):
    f = pf(xs)
    n = len(f)
    mu = sum(f) / n
    num_ = sum((f[t] - mu) * (f[t + lag] - mu) for t in range(n - lag))
    den = sum((x - mu) ** 2 for x in f)
    return num_ / den


def acf_alt(xs, lag):  # raw sums: sum x_t x_{t+lag} - mu (head + tail) + (n - lag) mu^2 over sum x^2 - n mu^2
    f = pf(xs)
    n = len(f)
    mu = sum(f) / n
    head, tail = sum(f[: n - lag]), sum(f[lag:])
    num_ = sum(f[t] * f[t + lag] for t in range(n - lag)) - mu * (head + tail) + (n - lag) * mu * mu
    den = sum(x * x for x in f) - n * mu * mu
    return num_ / den


REAL_A = [0.71, 0.74, 0.73, 0.78, 0.77, 0.81, 0.80, 0.84]
cases = []
for xs, lag in [
    ([1, 2, 3, 4, 5], 1),
    ([1, 2, 3, 4, 5], 2),
    ([1, 2, 3, 4, 5], 4),
    ([1, -1, 1, -1], 1),
    (REAL_A, 1),
    (REAL_A, 2),
    ([4, 7, 1, 9, 3, 8], 3),
    ([3, 1], 1),
]:
    v = acf(xs, lag)
    assert v == acf_alt(xs, lag)
    cases.append(case([xs, lag], v))
functions.append(function("autocorrelationLag", "trend", "docs/statistics/distance.md#autocorrelationlag",
                          cases, [[[], 1], [[1], 1], [[1, 2, 3], 0], [[1, 2, 3], 3], [[1, 2, 3], 1.5],
                                  [[1, 2, 3], -1], [[1, 2, 3], "NaN"], [[2, 2, 2, 2], 1], [[1, "NaN", 3], 1]]))


def dw(e):
    f = pf(e)
    return sum((f[t] - f[t - 1]) ** 2 for t in range(1, len(f))) / sum(x * x for x in f)


def dw_alt(e):  # (sum_{t>=2} e_t^2 + sum_{t<=n-1} e_t^2 - 2 sum e_t e_{t-1}) / sum e^2
    f = pf(e)
    n = len(f)
    top = sum(f[t] ** 2 for t in range(1, n)) + sum(f[t] ** 2 for t in range(n - 1)) - 2 * sum(f[t] * f[t - 1] for t in range(1, n))
    return top / sum(x * x for x in f)


cases = []
for e in ([1, -1, 1, -1], [1, 2, 3, 4, 5], [2, 2, 2], [1, -1],
          [0.3, -0.2, 0.1, 0.4, -0.5, 0.2, -0.1, 0.25], [0.5, 0.4, 0.45, 0.3, -0.1, -0.35, -0.3, -0.5], [0, 3, 0, 0, 4]):
    v = dw(e)
    assert v == dw_alt(e)
    cases.append(case([e], v))
functions.append(function("durbinWatson", "trend", "docs/statistics/distance.md#durbinwatson", cases,
                          [[[]], [[0.5]], [[0, 0, 0]], [[0, 0]], [[1, "NaN"]], [[1, INF, 2]]]))


def sse(seg):
    mu = sum(seg) / len(seg)
    return sum((x - mu) ** 2 for x in seg)


def sse_alt(seg):
    return sum(x * x for x in seg) - sum(seg) ** 2 / len(seg)


def best_split(xs):
    f = pf(xs)
    n = len(f)
    sst = sse(f)
    sses = []
    for k in range(1, n):
        a, b = sse(f[:k]), sse(f[k:])
        assert a + b == sse_alt(f[:k]) + sse_alt(f[k:])
        sses.append(a + b)
    low = min(sses)
    exact_k = sses.index(low) + 1
    # the page's rule: a later split replaces the best only if it is smaller by more than 1e-9 * SST
    best_k, best = 1, sses[0]
    for k in range(2, n):
        if sses[k - 1] < best - F(1, 10**9) * sst:
            best_k, best = k, sses[k - 1]
    assert best_k == exact_k
    for s in sses:  # guard: every split is an exact tie or clearly worse
        assert s == low or s - low > F(1, 10**6) * sst, xs
    return exact_k, low


cases = []
for xs in ([1, 1, 1, 5, 5, 5], [3, 7], [2, 2, 2, 2], [0, 1, 0, 1],
           [0.71, 0.72, 0.70, 0.73, 0.72, 0.81, 0.83, 0.80, 0.82],
           [1, 2, 1, 2, 10, 11, 10, 12, 11, 10], [9, 8, 9, 1, 2, 1, 2], [4, 4, 4, 9, 9, 4, 4]):
    k, s = best_split(xs)
    cases.append(case([xs], {"index": k, "sse": s}))
functions.append(function("changePointBestSplit", "trend", "docs/statistics/distance.md#changepointbestsplit",
                          cases, [[[]], [[1]], [[1, "NaN", 2]], [[1, 2, INF]]]))

# ---------------------------------------------------------------------------------------------- control
def ewma_exact(xs, lam):
    f = pf(xs)
    lam = F(lam)
    z = f[0]
    out = []
    for x in f:
        z = lam * x + (1 - lam) * z
        out.append(z)
    return out


def ewma_alt(xs, lam):  # closed form: z_t = (1 - lam)^t x_1 + sum_s lam (1 - lam)^(t - s) x_s
    f = pf(xs)
    lam = F(lam)
    out = []
    for t in range(1, len(f) + 1):
        out.append((1 - lam) ** t * f[0] + sum(lam * (1 - lam) ** (t - s) * f[s - 1] for s in range(1, t + 1)))
    return out


cases = []
for xs, lam in [
    ([1, 2, 3], 0.5),
    ([5], 0.2),
    ([3, 1, 4], 1),
    ([0.8, 0.82, 0.79, 0.85, 0.9, 0.88], 0.2),
    ([2, 2, 2], 0.3),
    ([-1, 4, -2, 6, 0], 0.25),
    ([10, 20, 30, 40], 0.75),
]:
    v = ewma_exact(xs, lam)
    assert v == ewma_alt(xs, lam)
    cases.append(case([xs, lam], v))
functions.append(function("ewmaSeries", "control", "docs/statistics/distance.md#ewmaseries", cases,
                          [[[], 0.5], [[1, 2], 0], [[1, 2], 1.5], [[1, 2], -0.2], [[1, 2], "NaN"], [[1, "NaN"], 0.5]]))


def ewma_width(sigma, lam, L, t):
    lam, sigma, L = dec(lam), dec(sigma), dec(L)
    inner = lam / (2 - lam) * (1 - (1 - lam) ** (2 * t))
    return L * sigma * inner.sqrt()


def ewma_width_alt(sigma, lam, L, t):  # Var(z_t) = sigma^2 lam^2 sum_{s=0}^{t-1} (1 - lam)^(2 s)
    lam, sigma, L = dec(lam), dec(sigma), dec(L)
    r = (1 - lam) ** 2
    tot = D(0)
    for s in range(t):
        tot += D(1) if s == 0 else r**s
    return L * (sigma * sigma * lam * lam * tot).sqrt()


cases = []
for mean, sigma, lam, L, t in [
    (0, 1, 0.2, 3, 1),
    (0, 1, 0.2, 3, 10),
    (0, 1, 0.2, 3, 1000),
    (10, 2, 1, 3, 3),
    (0.82, 0.05, 0.2, 2.7, 5),
    (-4, 1.5, 0.4, 2, 2),
    (100, 4, 0.01, 3, 1),
]:
    w = ewma_width(sigma, lam, L, t)
    close(w, ewma_width_alt(sigma, lam, L, t))
    cases.append(case([mean, sigma, lam, L, t], {"lower": dec(mean) - w, "upper": dec(mean) + w}))
functions.append(function("ewmaControlLimits", "control", "docs/statistics/distance.md#ewmacontrollimits",
                          cases, [[0, 0, 0.2, 3, 1], [0, -1, 0.2, 3, 1], [0, 1, 0, 3, 1], [0, 1, 1.5, 3, 1],
                                  [0, 1, 0.2, 0, 1], [0, 1, 0.2, -3, 1], [0, 1, 0.2, 3, 0], [0, 1, 0.2, 3, 1.5],
                                  [0, 1, 0.2, 3, -2], ["NaN", 1, 0.2, 3, 1], [0, 1, 0.2, INF, 1]]))

cases = []
for mean, sigma, n, L in [
    (50, 2, 4, 3),
    (10, 1, 1, 3),
    (0.82, 0.05, 25, 3),
    (-3, 1.5, 10, 2.5),
    (100, 12, 5, 3),
]:
    h = dec(L) * dec(sigma) / dec(n).sqrt()
    close(h, (dec(L) ** 2 * dec(sigma) ** 2 / dec(n)).sqrt())
    cases.append(case([mean, sigma, n, L], {"lower": dec(mean) - h, "center": dec(mean), "upper": dec(mean) + h}))
functions.append(function("shewhartXbarLimits", "control", "docs/statistics/distance.md#shewhartxbarlimits",
                          cases, [[0, 0, 4, 3], [0, -1, 4, 3], [0, 1, 0, 3], [0, 1, 2.5, 3], [0, 1, -4, 3],
                                  [0, 1, 4, 0], [0, 1, 4, -3], ["NaN", 1, 4, 3], [0, INF, 4, 3]]))

write("distance", "Exact Fraction and 120 digit Decimal arithmetic from the definitions in docs/statistics/distance.md; each value is cross-checked by a second derivation inside make_newcaps_distance.py", functions)
