"""Reference values for the effect-size group: standardised mean differences, rank effect sizes, odds and risk
measures of a 2x2 table, association measures, and three effect sizes for proportions, ANOVA and goodness of fit.

Every value is computed with Fraction or with 120-digit Decimal arithmetic and checked a second, different way
before it is written. Run: PYTHONDONTWRITEBYTECODE=1 python3 make_newcaps_effectsize.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from ref_common import *  # noqa: E402,F403

NAN = "NaN"
INF = "Infinity"
DOC = "docs/statistics/effectsize.md"
functions = []


def add(fn, module, values, domain, tol=None):
    functions.append(function(fn, module, f"{DOC}#{fn.lower()}", values, domain, tol))


# ---------------------------------------------------------------------------------------------------------------
# Standardised mean differences
# ---------------------------------------------------------------------------------------------------------------


def mean_f(xs):
    return sum((F(x) for x in xs), F(0)) / len(xs)


def svar(xs):
    m = mean_f(xs)
    return sum(((F(x) - m) ** 2 for x in xs), F(0)) / (len(xs) - 1)


def svar_pairs(xs):
    """The sample variance from the squared differences of all pairs: a different derivation."""
    n = len(xs)
    return sum(((F(xs[i]) - F(xs[j])) ** 2 for i in range(n) for j in range(i + 1, n)), F(0)) / (n * (n - 1))


def pooled(a, b):
    return ((len(a) - 1) * svar(a) + (len(b) - 1) * svar(b)) / (len(a) + len(b) - 2)


def pooled_pairs(a, b):
    return ((len(a) - 1) * svar_pairs(a) + (len(b) - 1) * svar_pairs(b)) / (len(a) + len(b) - 2)


def cohens_d(a, b):
    p = pooled(a, b)
    assert p == pooled_pairs(a, b)
    diff = mean_f(a) - mean_f(b)
    d = dec(diff) / sqrt(p)
    close(d * d, dec(diff * diff / p))  # the square, from exact rationals only
    assert (d > 0) == (diff > 0) and (d == 0) == (diff == 0)
    return d


def synth(n, mul, mod, base=3, step=F(1, 4)):
    """A deterministic list of multiples of a quarter: exact in binary."""
    return [float(base + ((mul * i) % mod) * step) for i in range(n)]


D_CASES = [
    ([5, 7, 9], [1, 3, 5]),  # both variances 4, means 7 and 3: d = 2 exactly
    ([4.2, 3.8, 4.5, 4.0, 4.4, 3.9], [3.6, 3.9, 3.5, 4.1, 3.7]),  # judge scores of two agent versions
    ([1, 3], [2, 6]),  # the minimum size: two values per group
    ([10, 12, 11, 13, 9, 14, 10], [15, 16, 14, 18]),  # the second group is higher: d < 0
    ([1, 2, 3], [3, 2, 1]),  # equal means: d = 0
    (synth(30, 7, 11), synth(24, 5, 13, base=2.5)),  # larger groups
]

vals = [case([a, b], cohens_d(a, b)) for a, b in D_CASES]
add("cohensD", "effect-size", vals,
    [[[1], [1, 2]], [[1, 2], [3]], [[], [1, 2]], [[2, 2, 2], [5, 5]], [[1, 2], [1, NAN]], [[1, INF], [1, 2]]])


def j_lgamma(df):
    return exp(lgamma(D(df) / 2) - lgamma(D(df - 1) / 2)) / (D(df) / 2).sqrt()


def j_exact(df):
    """J from Gamma at integers and half integers (factorials and sqrt(pi)): no log-gamma."""
    if df % 2 == 0:
        m = df // 2
        ratio = D(factorial(m - 1)) ** 2 * D(4) ** (m - 1) / (D(factorial(2 * m - 2)) * PI.sqrt())
        return ratio / D(m).sqrt()
    k = (df - 1) // 2
    ratio = D(factorial(2 * k)) * PI.sqrt() / (D(4) ** k * D(factorial(k)) * D(factorial(k - 1)))
    return ratio / (D(df) / 2).sqrt()


def hedges_g(a, b):
    df = len(a) + len(b) - 2
    j = j_lgamma(df)
    close(j, j_exact(df))
    assert D("0.5") < j < 1
    return j * cohens_d(a, b)


G_CASES = D_CASES + [([6, 8], [3, 5, 4])]  # df = 3, an odd df
add("hedgesG", "effect-size", [case([a, b], hedges_g(a, b)) for a, b in G_CASES],
    [[[1], [1, 2]], [[1, 2], [3]], [[], [1, 2]], [[2, 2, 2], [5, 5]], [[1, 2], [1, NAN]], [[1, 2], [3, INF]]])


def glass_delta(t, c):
    v = svar(c)
    assert v == svar_pairs(c)
    diff = mean_f(t) - mean_f(c)
    r = dec(diff) / sqrt(v)
    close(r * r, dec(diff * diff / v))
    return r


GL_CASES = [
    ([5, 7, 9], [1, 3, 5]),  # control sd 2, difference 4: 2 exactly
    ([4.2, 3.8, 4.5, 4.0, 4.4, 3.9], [3.6, 3.9, 3.5, 4.1, 3.7]),
    ([8], [2, 4]),  # one treated value is enough; control sd sqrt(2)
    ([10, 12, 11, 13, 9, 14, 10], [15, 16, 14, 18]),
    ([1, 2, 3], [3, 2, 1]),
    ([21, 35, 28, 30, 25, 33, 29], [20, 24, 22, 27]),
]
add("glassDelta", "effect-size", [case([t, c], glass_delta(t, c)) for t, c in GL_CASES],
    [[[], [1, 2]], [[1, 2], [3]], [[1, 2, 3], [4, 4, 4]], [[1, 2], [1, NAN]], [[NAN, 2], [1, 2]]])


# ---------------------------------------------------------------------------------------------------------------
# Rank effect sizes
# ---------------------------------------------------------------------------------------------------------------


def counts_gt_lt_eq(a, b):
    gt = sum(1 for x in a for y in b if x > y)
    lt = sum(1 for x in a for y in b if x < y)
    eq = sum(1 for x in a for y in b if x == y)
    assert gt + lt + eq == len(a) * len(b)
    return gt, lt, eq


def cliffs(a, b):
    gt, lt, _ = counts_gt_lt_eq(a, b)
    out = F(gt - lt, len(a) * len(b))
    # a different way: the rank sum of the first sample gives U, A = U / (n1 n2), delta = 2A - 1
    r = ranks(list(a) + list(b))
    u = sum(r[: len(a)], F(0)) - F(len(a) * (len(a) + 1), 2)
    assert out == 2 * u / (len(a) * len(b)) - 1
    return out


def vargha(a, b):
    gt, _, eq = counts_gt_lt_eq(a, b)
    out = (gt + F(eq, 2)) / (len(a) * len(b))
    r = ranks(list(a) + list(b))
    r1 = sum(r[: len(a)], F(0))
    assert out == (r1 / len(a) - F(len(a) + 1, 2)) / len(b)
    return out


RANK_CASES = [
    ([1, 2, 3], [4, 5, 6]),  # complete separation, the first sample lower
    ([4, 5, 6], [1, 2, 3]),  # complete separation, the first sample higher
    ([2, 2, 2], [2, 2]),  # all values equal
    ([1, 2, 2, 3], [2, 3, 4]),  # ties across the samples
    ([0.62, 0.71, 0.55, 0.80, 0.67, 0.74], [0.58, 0.66, 0.61, 0.70, 0.52]),  # task scores of two versions
    ([7], [3]),  # the minimum size
    ([3, 1, 4, 1, 5, 9, 2, 6], [5, 3, 5, 8, 9, 7]),  # ties inside and across the samples
]
RANK_DOMAIN = [[[], [1]], [[1], []], [[1, NAN], [1]], [[1], [INF, 2]]]
add("cliffsDelta", "effect-size", [case([a, b], cliffs(a, b)) for a, b in RANK_CASES], RANK_DOMAIN)
add("varghaDelaneyA", "effect-size", [case([a, b], vargha(a, b)) for a, b in RANK_CASES], RANK_DOMAIN)

# ---------------------------------------------------------------------------------------------------------------
# Rates in a 2x2 table: a, b = event and no event in group 1; c, d = event and no event in group 2
# ---------------------------------------------------------------------------------------------------------------


def T(a, b, c, d):
    return {"a": a, "b": b, "c": c, "d": d}


def odds_ratio(t):
    a, b, c, d = t["a"], t["b"], t["c"], t["d"]
    out = F(a * d, b * c)
    assert out == (F(a, b)) / F(c, d) if d else True
    if a and d:
        close(dec(out), exp(ln(a) + ln(d) - ln(b) - ln(c)))
    return out


OR_TABLES = [
    T(10, 20, 5, 40),  # 4
    T(45, 55, 30, 70),  # realistic: pass counts of two agent versions
    T(0, 7, 3, 9),  # no event in group 1: the ratio is 0
    T(1, 1, 1, 1),  # equal odds: 1
    T(3, 12, 9, 6),  # below 1... 3*6 / (12*9) = 1/6
    T(2, 98, 1, 99),  # rare events
]
add("oddsRatio", "rates", [case([t], odds_ratio(t)) for t in OR_TABLES],
    [[T(1, 0, 3, 4)], [T(1, 2, 0, 4)], [T(0, 0, 0, 0)], [T(-1, 2, 3, 4)], [T(1.5, 2, 3, 4)], [T(1, 2, 3, NAN)]])


def log_or_interval(t, z):
    a, b, c, d = t["a"], t["b"], t["c"], t["d"]
    est = ln(F(a * d, b * c))
    close(est, ln(a) + ln(d) - ln(b) - ln(c))
    var = F(1, a) + F(1, b) + F(1, c) + F(1, d)
    assert var == F(a + b, a * b) + F(c + d, c * d)
    se = sqrt(var)
    return {"estimate": est, "standardError": se, "lower": est - dec(z) * se, "upper": est + dec(z) * se}


LOR_CASES = [
    (T(10, 20, 5, 40), 1.959963984540054),
    (T(45, 55, 30, 70), 1.959963984540054),
    (T(1, 1, 1, 1), 1.0),  # estimate 0
    (T(3, 12, 9, 6), 2.5758293035489004),
    (T(2, 98, 1, 99), 1.6448536269514722),  # rare events: a wide interval
    (T(500, 1500, 400, 1600), 1.959963984540054),  # large counts
]
add("logOddsRatioInterval", "rates", [case([t, z], log_or_interval(t, z)) for t, z in LOR_CASES],
    [[T(0, 2, 3, 4), 1.96], [T(1, 0, 3, 4), 1.96], [T(1, 2, 0, 4), 1.96], [T(1, 2, 3, 0), 1.96],
     [T(1, 2, 3, 4), 0], [T(1, 2, 3, 4), -1.96], [T(1, 2, 3, 4), NAN], [T(1, 2, 3, 4.5), 1.96]])


def risk_ratio(t):
    a, b, c, d = t["a"], t["b"], t["c"], t["d"]
    out = F(a * (c + d), c * (a + b))
    assert out == F(a, a + b) / F(c, c + d)
    return out


RR_TABLES = [
    T(10, 20, 5, 40),  # 10/30 over 5/45
    T(45, 55, 30, 70),
    T(0, 8, 3, 9),  # zero risk in group 1: ratio 0
    T(4, 0, 2, 0),  # every unit has the event: ratio 1
    T(3, 97, 6, 94),
    T(30, 70, 10, 90),  # 3
]
add("riskRatio", "rates", [case([t], risk_ratio(t)) for t in RR_TABLES],
    [[T(0, 0, 3, 4)], [T(1, 2, 0, 4)], [T(1, 2, 0, 0)], [T(1, 2, 3, -4)], [T(1, 2, 3, 4.5)], [T(1, 2, NAN, 4)]])


def rr_interval(t, z):
    a, b, c, d = t["a"], t["b"], t["c"], t["d"]
    rr = risk_ratio(t)
    var = F(b, a * (a + b)) + F(d, c * (c + d))
    assert var == F(1, a) - F(1, a + b) + F(1, c) - F(1, c + d)
    se = sqrt(var)
    est = ln(rr)
    lo = exp(est - dec(z) * se)
    hi = exp(est + dec(z) * se)
    close(est, ln(a) + ln(c + d) - ln(c) - ln(a + b))
    return {"estimate": rr, "standardError": se, "lower": lo, "upper": hi}


RRI_CASES = [
    (T(10, 20, 5, 40), 1.959963984540054),
    (T(45, 55, 30, 70), 1.959963984540054),
    (T(4, 0, 2, 0), 1.959963984540054),  # b = d = 0: the standard error is 0
    (T(3, 97, 6, 94), 1.6448536269514722),
    (T(30, 70, 10, 90), 2.5758293035489004),
    (T(200, 800, 150, 850), 1.959963984540054),
]
add("riskRatioInterval", "rates", [case([t, z], rr_interval(t, z)) for t, z in RRI_CASES],
    [[T(0, 2, 3, 4), 1.96], [T(1, 2, 0, 4), 1.96], [T(0, 0, 0, 0), 1.96], [T(1, 2, 3, 4), 0],
     [T(1, 2, 3, 4), -2], [T(1, 2, 3, 4), INF], [T(1, 2, 3, -4), 1.96]])


def rd_interval(t, z):
    a, b, c, d = t["a"], t["b"], t["c"], t["d"]
    n1, n2 = a + b, c + d
    rd = F(a * n2 - c * n1, n1 * n2)
    assert rd == F(a, n1) - F(c, n2)
    var = F(a * b, n1**3) + F(c * d, n2**3)
    p1, p2 = F(a, n1), F(c, n2)
    assert var == p1 * (1 - p1) / n1 + p2 * (1 - p2) / n2
    se = sqrt(var)
    return {"estimate": rd, "standardError": se, "lower": dec(rd) - dec(z) * se, "upper": dec(rd) + dec(z) * se}


RD_CASES = [
    (T(10, 20, 5, 40), 1.959963984540054),
    (T(45, 55, 30, 70), 1.959963984540054),
    (T(5, 5, 10, 10), 1.959963984540054),  # equal risks: the estimate is 0
    (T(7, 0, 0, 9), 1.959963984540054),  # risks 1 and 0: the standard error is 0, the interval is a point
    (T(3, 97, 6, 94), 1.6448536269514722),
    (T(9, 1, 1, 1), 2.5),  # the upper bound is above 1: not clipped
    (T(1, 3, 3, 1), 3.0),  # the lower bound is below -1: not clipped
]
add("riskDifferenceInterval", "rates", [case([t, z], rd_interval(t, z)) for t, z in RD_CASES],
    [[T(0, 0, 3, 4), 1.96], [T(1, 2, 0, 0), 1.96], [T(1, 2, 3, 4), 0], [T(1, 2, 3, 4), -1.96],
     [T(1, 2, 3, NAN), 1.96], [T(1, 2, -3, 4), 1.96]])


def nnt(t):
    a, b, c, d = t["a"], t["b"], t["c"], t["d"]
    n1, n2 = a + b, c + d
    out = F(n1 * n2, abs(a * n2 - c * n1))
    assert out == 1 / abs(F(a, n1) - F(c, n2))
    return out


NNT_TABLES = [
    T(10, 20, 5, 40),  # 1 / (1/3 - 1/9) = 4.5
    T(45, 55, 30, 70),  # 1 / 0.15
    T(5, 15, 10, 10),  # the first group has the lower risk: the sign is dropped
    T(7, 0, 0, 9),  # risks 1 and 0: 1
    T(3, 97, 6, 94),
    T(120, 880, 95, 905),
]
add("numberNeededToTreat", "rates", [case([t], nnt(t)) for t in NNT_TABLES],
    [[T(10, 90, 10, 90)], [T(5, 5, 10, 10)], [T(0, 0, 3, 4)], [T(1, 2, 0, 0)], [T(0, 3, 0, 4)], [T(1, 2, 3, 4.5)]])

# ---------------------------------------------------------------------------------------------------------------
# Association
# ---------------------------------------------------------------------------------------------------------------


def chi_square(m):
    r = [sum(row) for row in m]
    c = [sum(col) for col in zip(*m)]
    n = sum(r)
    chi = sum(((F(m[i][j]) - F(r[i] * c[j], n)) ** 2 / F(r[i] * c[j], n) for i in range(len(m)) for j in range(len(c))), F(0))
    alt = n * (sum((F(m[i][j] ** 2, r[i] * c[j]) for i in range(len(m)) for j in range(len(c))), F(0)) - 1)
    assert chi == alt
    return chi, n


def phi(t):
    a, b, c, d = t["a"], t["b"], t["c"], t["d"]
    den = (a + b) * (c + d) * (a + c) * (b + d)
    num_ = a * d - b * c
    out = dec(num_) / sqrt(den)
    chi, n = chi_square([[a, b], [c, d]])
    mag = sqrt(chi / n)
    close(abs(out), mag)
    assert (num_ > 0) == (out > 0) and (num_ == 0) == (out == 0)
    return out


PHI_TABLES = [
    T(10, 20, 5, 40),
    T(45, 55, 30, 70),
    T(5, 0, 0, 7),  # complete association: 1
    T(0, 5, 7, 0),  # complete negative association: -1
    T(10, 10, 20, 20),  # independence: 0
    T(8, 2, 3, 12),
]
add("phiCoefficient", "association", [case([t], phi(t)) for t in PHI_TABLES],
    [[T(0, 0, 3, 4)], [T(1, 2, 0, 0)], [T(0, 3, 0, 4)], [T(3, 0, 4, 0)], [T(1, 2, 3, -4)], [T(1, 2, 3, 4.5)]])


def cramers_v(m):
    chi, n = chi_square(m)
    k = min(len(m), len(m[0])) - 1
    out = sqrt(chi / (n * k))
    if len(m) == 2 and len(m[0]) == 2:
        close(out, abs(phi(T(m[0][0], m[0][1], m[1][0], m[1][1]))))
    return out


V_MATRICES = [
    [[10, 20], [5, 40]],  # 2x2: equals |phi|
    [[30, 10, 5], [10, 25, 15], [5, 15, 35]],  # 3x3
    [[10, 20], [20, 40]],  # independence: 0
    [[5, 0], [0, 7]],  # complete association: 1
    [[12, 7, 9, 4], [3, 14, 6, 11]],  # 2x4: k = 1
    [[18, 6], [7, 14], [4, 22], [9, 9]],  # 4x2
    [[40, 5, 5], [10, 30, 10], [3, 7, 40], [20, 20, 20]],  # 4x3: k = 2
]
add("cramersV", "association", [case([m], cramers_v(m)) for m in V_MATRICES],
    [[[[1, 2]]], [[[1], [2]]], [[[1, 0], [2, 0]]], [[[0, 0], [1, 2], [3, 4]]], [[[1, 2], [3]]], [[[1, 2], [3, -4]]],
     [[[1, 2], [3, 4.5]]], [[]]])

# ---------------------------------------------------------------------------------------------------------------
# Proportions, ANOVA and goodness of fit
# ---------------------------------------------------------------------------------------------------------------


def atan_d(x):
    x = dec(x)
    if x < 0:
        return -atan_d(-x)
    k = 0
    while x > D("0.1"):
        x = x / (1 + (1 + x * x).sqrt())
        k += 1
    total, term, n, x2 = D(0), x, 0, x * x
    while abs(term) > D(10) ** -125:
        total += term / (2 * n + 1) * (-1 if n % 2 else 1)
        term *= x2
        n += 1
    return total * D(2) ** k


def cos_d(x):
    x = dec(x)
    total, term, n = D(1), D(1), 0
    while abs(term) > D(10) ** -125:
        n += 1
        term = -term * x * x / ((2 * n - 1) * (2 * n))
        total += term
    return total


def arcsine_transform(p):
    """phi(p) = 2 asin(sqrt p) = 2 atan(sqrt(p / (1 - p))), with phi(1) = pi."""
    p = dec(p)
    if p == 0:
        return D(0)
    if p == 1:
        return PI
    phi_ = 2 * atan_d((p / (1 - p)).sqrt())
    close(cos_d(phi_), 1 - 2 * p, rel=1e-100)  # a different check: cos(phi) = 1 - 2p
    return phi_


def cohens_h(p1, p2):
    return arcsine_transform(p1) - arcsine_transform(p2)


H_CASES = [(0.5, 0.3), (0.9, 0.1), (0.25, 0.25), (1, 0), (0.82, 0.74), (0.05, 0.02), (0.6, 0.95)]
add("cohensH", "anova", [case([p, q], cohens_h(p, q)) for p, q in H_CASES],
    [[1.5, 0.5], [0.5, -0.1], [0.5, NAN], [INF, 0.5]])


def omega_squared(ssb, ssw, dfb, dfw):
    ssb, ssw = frac(ssb), frac(ssw)
    out = (dfw * ssb - dfb * ssw) / (dfw * (ssb + ssw) + ssw)
    msw = ssw / dfw
    assert out == (ssb - dfb * msw) / (ssb + ssw + msw)
    return out


def O(ssb, ssw, dfb, dfw):
    return {"ssBetween": ssb, "ssWithin": ssw, "dfBetween": dfb, "dfWithin": dfw}


OM_CASES = [
    (12.4, 85.6, 2, 57),  # three agent versions, 60 scored runs
    (50, 50, 1, 98),
    (0, 40, 3, 36),  # no between variance: negative, not clipped
    (30, 10, 4, 45),
    (2.5, 100, 2, 27),  # F below 1: negative
    (9, 3, 2, 3),  # small error degrees of freedom
]
add("omegaSquared", "anova", [case([O(*c)], omega_squared(*c)) for c in OM_CASES],
    [[O(-1, 10, 2, 20)], [O(5, 0, 2, 20)], [O(5, -2, 2, 20)], [O(5, 10, 0, 20)], [O(5, 10, 2, 0)],
     [O(5, 10, 1.5, 20)], [O(5, 10, 2, 20.5)], [O(5, NAN, 2, 20)], [O(INF, 10, 2, 20)]])


def cohens_w(obs, exp_):
    n = sum(obs)
    p = [F(x) for x in exp_]
    w2 = sum(((F(o, n) - pi) ** 2 / pi for o, pi in zip(obs, p)), F(0))
    chi = sum(((F(o) - n * pi) ** 2 / (n * pi) for o, pi in zip(obs, p)), F(0))
    assert chi / n == w2
    return sqrt(w2)


W_CASES = [
    ([30, 30, 40], [0.2, 0.3, 0.5]),
    ([25, 25, 25, 25], [0.25, 0.25, 0.25, 0.25]),  # equal to the expected: 0
    ([10, 0], [0.5, 0.5]),  # one cell empty: 1
    ([50, 30, 20], [0.5, 0.25, 0.25]),
    ([12, 18, 22, 8, 40], [0.125, 0.25, 0.25, 0.125, 0.25]),
    ([7, 3], [0.75, 0.25]),
    ([0, 0, 90], [0.25, 0.25, 0.5]),
]
add("cohensW", "anova", [case([o, e], cohens_w(o, e)) for o, e in W_CASES],
    [[[1, 2, 3], [0.5, 0.5]], [[5], [1]], [[5, 5], [1, 0]], [[5, 5], [0.7, 0.2]], [[5, 5], [0.7, 0.4]], [[0, 0], [0.5, 0.5]],
     [[5, -1], [0.5, 0.5]], [[5, 1.5], [0.5, 0.5]], [[5, 5], [0.5, NAN]], [[5, 5], [0.5, -0.5]]])

write("effectsize", "Exact reference values, computed by make_newcaps_effectsize.py with Fraction and 120-digit "
      "Decimal arithmetic; each value is checked a second way inside the script.", functions)
