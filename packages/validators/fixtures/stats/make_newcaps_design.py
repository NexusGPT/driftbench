"""Generator of newcaps-design.json: sample sizes, power, allocation and variance estimates (exact arithmetic)."""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from ref_common import *  # noqa: E402,F403

NINE = F(1, 10**9)
functions = []


def fl(x):
    """The double nearest to an exact value, as the caller would pass it."""
    return float(x)


Z95 = 1.959963984540054  # the package constant Z95
Z975 = fl(normal_quantile(F(9875, 10000)))
Z995 = fl(normal_quantile(F(995, 1000)))
Z80 = fl(normal_quantile(F(80, 100)))
Z90 = fl(normal_quantile(F(90, 100)))
Z95ONE = fl(normal_quantile(F(95, 100)))


def ceil9(v):
    """The smallest integer not below v after v is rounded to 9 decimals (v a Fraction or a Decimal)."""
    v = frac(v) if not isinstance(v, D) else v
    if isinstance(v, D):
        r = v.quantize(D(1).scaleb(-9))
        return math.ceil(r)
    r = F(round(v / NINE)) * NINE
    return math.ceil(r)


def away_from_integer(v, allow_int=False):
    """The exact value sits at least 1e-6 from an integer, so a double computation cannot change the ceiling."""
    v = dec(v)
    fr = v - v.to_integral_value(rounding="ROUND_FLOOR")
    if allow_int and fr == 0:
        return
    assert D("1e-6") < fr < 1 - D("1e-6"), f"too close to an integer: {v}"


def search_ceil(ok):
    """The smallest positive integer n with ok(n): a search, the second way to a ceiling."""
    n = 1
    while not ok(n):
        n += 1
    return n


# ---------------------------------------------------------------- sample size

def two_means_exact(sd, delta, za, zb):
    sd, delta, za, zb = frac(sd), frac(delta), frac(za), frac(zb)
    return 2 * ((za + zb) * sd / delta) ** 2


cases = []
for sd, delta, za, zb, allow in (
    (1.0, 0.5, Z95, Z80, False),
    (2.0, 1.0, 1.0, 1.0, True),
    (15.0, -5.0, 1.96, 1.2815515655446004, False),
    (0.8, 0.3, Z995, Z95ONE, False),
    (1.0, 0.1, Z95, 0.0, False),
    (1.0, 100.0, 1.96, 0.84, False),
    (12.5, 4.0, Z975, Z90, False),
):
    v = two_means_exact(sd, delta, za, zb)
    away_from_integer(v, allow)
    a = ceil9(v)
    s2, d2, t2 = frac(sd) ** 2, frac(delta) ** 2, (frac(za) + frac(zb)) ** 2
    b = search_ceil(lambda n: n * d2 >= 2 * t2 * s2)
    assert a == b, (sd, delta, a, b)
    cases.append(case([sd, delta, za, zb], a))
TWO_MEANS_CASES = cases
functions.append(function(
    "sampleSizeTwoMeans", "sample-size", "docs/statistics/design.md#samplesizetwomeans", cases,
    [[0, 0.5, 1.96, 0.84], [-1, 0.5, 1.96, 0.84], [1, 0, 1.96, 0.84], [1, 0.5, 0, 0.84], [1, 0.5, 1.96, -0.1],
     [1, "NaN", 1.96, 0.84], [1, 0.5, "Infinity", 0.84]]))


def exact_two_props(p1, p2, za, zb):
    p1, p2, za, zb = frac(p1), frac(p2), frac(za), frac(zb)
    pbar = (p1 + p2) / 2
    qbar = 1 - pbar
    a = dec(za) * sqrt(2 * pbar * qbar)
    b = dec(zb) * sqrt(p1 * (1 - p1) + p2 * (1 - p2))
    return (a + b) ** 2 / dec((p1 - p2) ** 2)


def alt_two_props(p1, p2, za, zb):
    p1, p2, za, zb = frac(p1), frac(p2), frac(za), frac(zb)
    pbar = (p1 + p2) / 2
    qbar = 1 - pbar
    u = 2 * pbar * qbar
    w = p1 * (1 - p1) + p2 * (1 - p2)
    num_ = dec(za * za * u + zb * zb * w) + 2 * dec(za * zb) * sqrt(u * w)
    return num_ / dec((p1 - p2) ** 2)


cases = []
for p1, p2, za, zb in (
    (0.5, 0.6, Z95, Z80),
    (0.1, 0.2, Z95, Z80),
    (0.3, 0.5, Z975, Z90),
    (0.02, 0.01, Z95, Z80),
    (0.9, 0.95, 1.96, 1.2815515655446004),
    (0.0, 0.3, Z95, Z80),
    (0.45, 0.55, Z995, 0.0),
):
    v = exact_two_props(p1, p2, za, zb)
    away_from_integer(v)
    close(v, alt_two_props(p1, p2, za, zb))
    a = ceil9(v)
    pbar = (frac(p1) + frac(p2)) / 2
    ta = dec(frac(za)) * sqrt(2 * pbar * (1 - pbar))
    tb = dec(frac(zb)) * sqrt(frac(p1) * (1 - frac(p1)) + frac(p2) * (1 - frac(p2)))
    dd = abs(dec(frac(p1) - frac(p2)))
    b = search_ceil(lambda n: sqrt(n) * dd >= ta + tb)
    assert a == b, (p1, p2, a, b)
    cases.append(case([p1, p2, za, zb], a))
TWO_PROPS_CASES = cases
functions.append(function(
    "sampleSizeTwoProportions", "sample-size", "docs/statistics/design.md#samplesizetwoproportions", cases,
    [[0.5, 0.5, 1.96, 0.84], [-0.1, 0.5, 1.96, 0.84], [0.5, 1.2, 1.96, 0.84], [0.4, 0.5, 0, 0.84],
     [0.4, 0.5, 1.96, -1], [0.4, "NaN", 1.96, 0.84]]))

cases = []
for p, margin, z in (
    (0.5, 0.05, 1.96),
    (0.3, 0.04, Z95),
    (0.9, 0.02, Z995),
    (0.05, 0.01, Z90),
    (0.5, 0.5, 1.96),
    (0.25, 0.1, 1.0),
):
    v = frac(z) ** 2 * frac(p) * (1 - frac(p)) / frac(margin) ** 2
    away_from_integer(v)
    a = ceil9(v)
    b = search_ceil(lambda n: n * frac(margin) ** 2 >= frac(z) ** 2 * frac(p) * (1 - frac(p)))
    assert a == b, (p, margin, a, b)
    # a third route: the half width of the interval at n is z sqrt(p q / n); it is at most the margin
    assert sqrt(frac(p) * (1 - frac(p)) / a) * dec(frac(z)) <= dec(frac(margin)) * (1 + D("1e-30"))
    cases.append(case([p, margin, z], a))
PROP_MARGIN_CASES = cases
functions.append(function(
    "sampleSizeProportionMargin", "sample-size", "docs/statistics/design.md#samplesizeproportionmargin", cases,
    [[0, 0.05, 1.96], [1, 0.05, 1.96], [0.5, 0, 1.96], [0.5, -0.05, 1.96], [0.5, 0.05, 0], [0.5, 0.05, "NaN"]]))

cases = []
for sd, margin, z in (
    (15.0, 2.0, 1.96),
    (1.0, 0.1, Z95),
    (0.25, 0.01, Z995),
    (3.2, 0.5, Z90),
    (10.0, 100.0, 1.96),
    (4.0, 1.0, 1.0),
):
    v = (frac(z) * frac(sd) / frac(margin)) ** 2
    away_from_integer(v, (sd, margin, z) == (4.0, 1.0, 1.0))
    a = ceil9(v)
    b = search_ceil(lambda n: n * frac(margin) ** 2 >= frac(z) ** 2 * frac(sd) ** 2)
    assert a == b, (sd, margin, a, b)
    cases.append(case([sd, margin, z], a))
MEAN_MARGIN_CASES = cases
functions.append(function(
    "sampleSizeMeanMargin", "sample-size", "docs/statistics/design.md#samplesizemeanmargin", cases,
    [[0, 0.5, 1.96], [-1, 0.5, 1.96], [1, 0, 1.96], [1, -0.5, 1.96], [1, 0.5, 0], [1, 0.5, "Infinity"]]))

cases = []
for n, pop in ((100.0, 1000), (385.0, 5000), (50.0, 50), (1.0, 1), (384.16, 2000), (10.5, 20), (30.0, 1)):
    n_, N_ = frac(n), F(pop)
    a = n_ / (1 + (n_ - 1) / N_)
    b = n_ * N_ / (N_ + n_ - 1)
    assert a == b
    assert 0 < a < N_ or (a == N_ and n_ == 1) or a <= N_
    cases.append(case([n, pop], a))
FPC_CASES = cases
functions.append(function(
    "finitePopulationCorrection", "sample-size", "docs/statistics/design.md#finitepopulationcorrection", cases,
    [[0, 100], [-5, 100], [10, 0], [10, 1.5], [10, -3], ["NaN", 100], [10, "Infinity"]]))

cases = []
for n0, m, rho in ((100.0, 10.0, 0.05), (385.0, 25.0, 0.02), (96.5, 1.0, 0.3), (200.0, 8.0, 0.0), (50.0, 4.0, 1.0),
                   (300.0, 12.5, 0.1), (1.0, 100.0, 0.01)):
    a = frac(n0) * (1 + (frac(m) - 1) * frac(rho))
    b = frac(n0) * (1 - frac(rho)) + frac(n0) * frac(m) * frac(rho)
    assert a == b
    cases.append(case([n0, m, rho], a))
CLUSTER_CASES = cases
functions.append(function(
    "clusterSampleSize", "sample-size", "docs/statistics/design.md#clustersamplesize", cases,
    [[0, 10, 0.05], [-1, 10, 0.05], [100, 0.5, 0.05], [100, 0, 0.05], [100, 10, -0.1], [100, 10, 1.5],
     [100, 10, "NaN"]]))

# ---------------------------------------------------------------- power


def power_exact(delta, se, za):
    d = dec(frac(delta)) / se
    za = dec(frac(za))
    return normal_cdf(d - za) + normal_cdf(-d - za)


def power_alt(delta, se, za):
    d = abs(dec(frac(delta)) / se)
    za = dec(frac(za))
    return 1 - (normal_cdf(za - d) - normal_cdf(-za - d))


def power_libm(delta, se, za):
    d = abs(float(dec(frac(delta)) / se))
    return 0.5 * math.erfc((float(za) - d) / math.sqrt(2)) + 0.5 * math.erfc((float(za) + d) / math.sqrt(2))


cases = []
for delta, sd, n, za in (
    (0.5, 1.0, 32, Z95),
    (0.0, 1.0, 50, Z95),
    (-0.5, 1.0, 32, Z95),
    (2.0, 10.0, 100, 1.96),
    (0.2, 1.0, 10, Z975),
    (1.0, 2.0, 1, Z95),
    (3.0, 5.0, 150, Z995),
):
    se = dec(frac(sd)) / sqrt(n)
    a = power_exact(delta, se, za)
    close(a, power_alt(delta, se, za))
    assert abs(float(a) - power_libm(delta, se, za)) <= 1e-12 * max(float(a), 1e-300)
    cases.append(case([delta, sd, n, za], a))
P1_CASES = cases
functions.append(function(
    "powerOneSampleZ", "design-power", "docs/statistics/design.md#poweronesamplez", cases,
    [[0.5, 0, 25, 1.96], [0.5, -1, 25, 1.96], [0.5, 1, 0, 1.96], [0.5, 1, 2.5, 1.96], [0.5, 1, -4, 1.96],
     [0.5, 1, 25, 0], [0.5, 1, 25, -1.96], ["NaN", 1, 25, 1.96], [0.5, 1, 25, "Infinity"]]))

cases = []
for delta, sd, n, za in (
    (0.5, 1.0, 64, Z95),
    (0.0, 2.0, 40, Z95),
    (-0.5, 1.0, 64, Z95),
    (5.0, 15.0, 100, 1.96),
    (0.3, 1.0, 20, Z975),
    (1.0, 1.0, 1, Z95),
    (0.25, 1.0, 400, Z995),
):
    se = dec(frac(sd)) * sqrt(F(2, n))
    a = power_exact(delta, se, za)
    close(a, power_alt(delta, se, za))
    assert abs(float(a) - power_libm(delta, se, za)) <= 1e-12 * max(float(a), 1e-300)
    cases.append(case([delta, sd, n, za], a))
P2_CASES = cases
functions.append(function(
    "powerTwoSampleZ", "design-power", "docs/statistics/design.md#powertwosamplez", cases,
    [[0.5, 0, 25, 1.96], [0.5, -1, 25, 1.96], [0.5, 1, 0, 1.96], [0.5, 1, 2.5, 1.96], [0.5, 1, 25, 0],
     [0.5, 1, 25, -1.96], [0.5, "NaN", 25, 1.96], [0.5, 1, 25, "Infinity"]]))

cases = []
for sd, n, za, zb in (
    (1.0, 64, Z95, Z80),
    (15.0, 100, 1.96, 1.2815515655446004),
    (2.0, 1, 1.0, 1.0),
    (0.4, 250, Z995, Z90),
    (1.0, 32, Z95, 0.0),
    (7.5, 12, Z975, Z95ONE),
):
    s2 = dec(frac(sd)) ** 2
    a = (dec(frac(za)) + dec(frac(zb))) * dec(frac(sd)) * sqrt(F(2, n))
    b = sqrt(2 * (dec(frac(za)) + dec(frac(zb))) ** 2 * s2 / n)
    close(a, b)
    # the sample size formula gives back n at this difference
    close(2 * ((dec(frac(za)) + dec(frac(zb))) * dec(frac(sd)) / a) ** 2, n)
    cases.append(case([sd, n, za, zb], a))
MDD_CASES = cases
functions.append(function(
    "minimumDetectableMeanDifference", "design-power", "docs/statistics/design.md#minimumdetectablemeandifference",
    cases,
    [[0, 25, 1.96, 0.84], [-1, 25, 1.96, 0.84], [1, 0, 1.96, 0.84], [1, 2.5, 1.96, 0.84], [1, 25, 0, 0.84],
     [1, 25, 1.96, -0.1], [1, 25, 1.96, "NaN"]]))

# ---------------------------------------------------------------- allocation

cases = []
for ws in ([1.0, 1.0, 1.0], [1.0, 2.0, 3.0, 4.0], [0.5, 1.0, 1.0, 2.5], [5.0], [0.8, 1.2, 1.0, 1.5, 0.9, 2.2, 1.1],
           [0.25, 4.0], [1.0, 1.0, 1.0, 1.0, 10.0]):
    w = [frac(x) for x in ws]
    n = len(w)
    a = n * sum(x * x for x in w) / sum(w) ** 2
    mean_w = sum(w) / n
    var_pop = sum((x - mean_w) ** 2 for x in w) / n
    b = 1 + var_pop / mean_w ** 2
    assert a == b
    cases.append(case([ws], a))
KISH_CASES = cases
functions.append(function(
    "kishDesignEffect", "allocation", "docs/statistics/design.md#kishdesigneffect", cases,
    [[[]], [[1, 0, 2]], [[1, -2, 3]], [[1, "NaN"]], [[1, "Infinity"]]]))


def largest_remainder(sizes, n):
    total = sum(sizes)
    quotas = [F(n * s, total) for s in sizes]
    base = [q.numerator // q.denominator for q in quotas]
    left = n - sum(base)
    order = sorted(range(len(sizes)), key=lambda i: (-(quotas[i] - base[i]), i))
    out = list(base)
    for i in order[:left]:
        out[i] += 1
    return out


def brute_allocation(sizes, n):
    """Enumerate every vector with each part at floor or floor + 1 that sums to n; take the least squared
    distance to the quotas, ties to the lexicographically greatest vector (the extra units go to low indexes)."""
    import itertools

    total = sum(sizes)
    quotas = [F(n * s, total) for s in sizes]
    base = [q.numerator // q.denominator for q in quotas]
    best = None
    for bits in itertools.product((0, 1), repeat=len(sizes)):
        vec = [b + x for b, x in zip(base, bits)]
        if sum(vec) != n:
            continue
        dist = sum((v - q) ** 2 for v, q in zip(vec, quotas))
        key = (dist, [-v for v in vec])
        if best is None or key < best[0]:
            best = (key, vec)
    return best[1]


cases = []
for sizes, n in (
    ([10, 20, 30], 10),
    ([1, 1, 1], 2),
    ([1200, 800, 350, 150], 100),
    ([5], 3),
    ([0, 40, 60], 7),
    ([3, 3, 3, 1], 5),
    ([7, 1, 2], 0),
    ([10, 20, 30], 60),
    ([100, 1, 1, 1], 4),
    ([2, 2], 3),
):
    a = largest_remainder(sizes, n)
    assert a == brute_allocation(sizes, n), (sizes, n, a)
    assert sum(a) == n
    cases.append(case([sizes, n], a))
PROP_ALLOC_CASES = cases
functions.append(function(
    "proportionalAllocation", "allocation", "docs/statistics/design.md#proportionalallocation", cases,
    [[[], 5], [[10, -5], 3], [[10, 2.5], 3], [[0, 0], 0], [[10, 20], 31], [[10, 20], -1], [[10, 20], 2.5],
     [[10, "NaN"], 3], [[10, 20], "NaN"]]))


def cost_alloc(sizes, sds, costs, n):
    w = [dec(s) * dec(frac(sd)) / dec(frac(c)).sqrt() for s, sd, c in zip(sizes, sds, costs)]
    tot = sum(w)
    return [dec(n) * x / tot for x in w]


def cost_alloc_alt(sizes, sds, costs, n):
    w = [dec(s) * dec(frac(sd)) * dec(frac(c)).sqrt() / dec(frac(c)) for s, sd, c in zip(sizes, sds, costs)]
    tot = sum(w)
    out = [dec(n) * x / tot for x in w]
    # optimality: n_h sqrt(c_h) / (N_h sd_h) is the same for every stratum
    ratios = [o * dec(frac(c)).sqrt() / (dec(s) * dec(frac(sd))) for o, s, sd, c in zip(out, sizes, sds, costs)]
    for r in ratios:
        close(r, ratios[0])
    return out


cases = []
for sizes, sds, costs, n in (
    ([1000, 2000, 500], [10.0, 15.0, 20.0], [1.0, 4.0, 9.0], 100),
    ([100, 100], [5.0, 5.0], [2.0, 2.0], 50),
    ([4000], [3.5], [2.5], 40),
    ([1200, 800, 350, 150], [0.4, 0.3, 0.5, 0.2], [1.0, 1.5, 4.0, 9.0], 200),
    ([10, 20, 30], [1.0, 1.0, 1.0], [1.0, 1.0, 1.0], 12),
    ([300, 600], [2.0, 1.0], [16.0, 1.0], 0),
    ([50, 70, 90], [0.9, 2.2, 1.3], [3.0, 1.0, 7.0], 33),
):
    a = cost_alloc(sizes, sds, costs, n)
    b = cost_alloc_alt(sizes, sds, costs, n)
    for x, y in zip(a, b):
        close(x, y)
    close(sum(a), n)
    cases.append(case([sizes, sds, costs, n], a))
COST_CASES = cases
functions.append(function(
    "costOptimalAllocation", "allocation", "docs/statistics/design.md#costoptimalallocation", cases,
    [[[], [], [], 10], [[10, 20], [1], [1, 1], 10], [[10, 20], [1, 1], [1], 10], [[10, 0], [1, 1], [1, 1], 10],
     [[10, 20], [1, 0], [1, 1], 10], [[10, 20], [1, 1], [1, -1], 10], [[10, 20], [1, 1], [1, 0], 10],
     [[10, 2.5], [1, 1], [1, 1], 10], [[10, 20], [1, 1], [1, 1], -1], [[10, 20], [1, 1], [1, 1], 2.5],
     [[10, 20], [1, "NaN"], [1, 1], 10]]))

# ---------------------------------------------------------------- variance


def svar(xs):
    n = len(xs)
    m = sum(xs) / n
    return sum((x - m) ** 2 for x in xs) / (n - 1)


def svar_pairs(xs):
    n = len(xs)
    return sum((xs[i] - xs[j]) ** 2 for i in range(n) for j in range(i + 1, n)) / (n * (n - 1))


def svar_raw(xs):
    n = len(xs)
    return (sum(x * x for x in xs) - sum(xs) ** 2 / n) / (n - 1)


def welch_exact(a, b):
    a_, b_ = [frac(x) for x in a], [frac(x) for x in b]
    na, nb = len(a_), len(b_)
    va, vb = svar(a_), svar(b_)
    assert va == svar_pairs(a_) == svar_raw(a_) and vb == svar_pairs(b_) == svar_raw(b_)
    sa, sb = va / na, vb / nb
    se2 = sa + sb
    diff = sum(a_) / na - sum(b_) / nb
    t = dec(diff) / dec(se2).sqrt()
    t_alt = (1 if diff >= 0 else -1) * dec(diff * diff / se2).sqrt() if diff != 0 else D(0)
    close(t, t_alt)
    df = se2 * se2 / (sa * sa / (na - 1) + sb * sb / (nb - 1))
    # the same degrees of freedom through the weights c_i = 1 / n_i
    df_alt = (va / na + vb / nb) ** 2 / ((va / na) ** 2 / (na - 1) + (vb / nb) ** 2 / (nb - 1))
    assert df == df_alt
    return {"t": t, "df": df}


cases = []
WA = [27.5, 21.0, 19.0, 23.6, 17.0, 17.9, 16.9, 20.1, 21.9, 22.6, 23.1, 19.6, 19.0, 21.7, 21.4]
WB = [27.1, 22.0, 20.8, 23.4, 23.4, 23.5, 25.8, 22.0, 24.8, 20.2, 21.9, 22.1, 22.9, 20.5, 24.4]
for a, b in (
    (WA, WB),
    ([1.0, 3.0], [2.0, 6.0]),
    ([5.0, 5.0, 5.0], [4.0, 6.0, 8.0]),
    ([1.0, 2.0, 3.0], [0.0, 2.0, 4.0, 2.0]),
    ([0.61, 0.58, 0.66, 0.71, 0.64, 0.69], [0.72, 0.75, 0.70, 0.78]),
    ([10.0, 12.0, 11.0, 13.0, 9.0, 14.0, 10.0, 12.0], [8.0, 9.0, 7.5, 10.0]),
    ([2.0, 2.0, 2.0, 4.0], [3.0, 3.0]),
):
    cases.append(case([a, b], welch_exact(a, b)))
WELCH_CASES = cases
functions.append(function(
    "welchT", "variance-estimates", "docs/statistics/design.md#welcht", cases,
    [[[], [1, 2]], [[1], [1, 2]], [[1, 2], [3]], [[1, 2], []], [[3, 3], [7, 7]], [[1, 2, "NaN"], [1, 2]],
     [[1, 2], [1, "Infinity"]]]))

cases = []
for a, b in (
    ([2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0], [1.0, 2.0, 3.0]),
    ([1.0, 2.0], [3.0, 5.0]),
    ([3.0, 3.0], [7.0, 7.0]),
    ([0.61, 0.58, 0.66, 0.71, 0.64, 0.69], [0.72, 0.75, 0.70, 0.78]),
    (WA, WB),
    ([1.0, 1.0, 1.0, 4.0], [2.0, 8.0]),
):
    a_, b_ = [frac(x) for x in a], [frac(x) for x in b]
    p = ((len(a_) - 1) * svar(a_) + (len(b_) - 1) * svar(b_)) / (len(a_) + len(b_) - 2)
    ma, mb = sum(a_) / len(a_), sum(b_) / len(b_)
    q = (sum((x - ma) ** 2 for x in a_) + sum((x - mb) ** 2 for x in b_)) / (len(a_) + len(b_) - 2)
    assert p == q
    cases.append(case([a, b], p))
POOLED_CASES = cases
functions.append(function(
    "pooledVariance", "variance-estimates", "docs/statistics/design.md#pooledvariance", cases,
    [[[], [1, 2]], [[1], [1, 2]], [[1, 2], [3]], [[1, 2], []], [[1, 2, "NaN"], [1, 2]]]))

cases = []
for xs in ([1.0, 3.0], [4.0, 4.0, 4.0], [2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0], [0.82, 0.79, 0.91, 0.85, 0.77, 0.88],
           [10.0, -10.0, 5.0], [0.5, 0.25, 0.125, 0.0625, 1.0, 2.0, 4.0]):
    x = [frac(v) for v in xs]
    n = len(x)
    m = sum(x) / n
    loo = [(sum(x) - v) / (n - 1) for v in x]
    md = sum(loo) / n
    a = F(n - 1, n) * sum((l - md) ** 2 for l in loo)
    b = svar(x) / n
    assert a == b, xs
    cases.append(case([xs], a))
JACK_CASES = cases
functions.append(function(
    "jackknifeMeanVariance", "variance-estimates", "docs/statistics/design.md#jackknifemeanvariance", cases,
    [[[]], [[1]], [[1, 2, "NaN"]], [[1, "Infinity", 3]]]))


def icc_exact(mat):
    x = [[frac(v) for v in row] for row in mat]
    n, k = len(x), len(x[0])
    grand = sum(sum(r) for r in x) / (n * k)
    rm = [sum(r) / k for r in x]
    cm = [sum(x[i][j] for i in range(n)) / n for j in range(k)]
    ssr = k * sum((m - grand) ** 2 for m in rm)
    ssc = n * sum((m - grand) ** 2 for m in cm)
    sse = sum((x[i][j] - rm[i] - cm[j] + grand) ** 2 for i in range(n) for j in range(k))
    sst = sum((v - grand) ** 2 for r in x for v in r)
    assert ssr + ssc + sse == sst
    msr, msc, mse = ssr / (n - 1), ssc / (k - 1), sse / ((n - 1) * (k - 1))
    den = msr + (k - 1) * mse + k * (msc - mse) / n
    assert den != 0
    a = (msr - mse) / den
    # variance components: ICC = s_subject / (s_subject + s_rater + s_error)
    s_sub, s_rat, s_err = (msr - mse) / k, (msc - mse) / n, mse
    b = s_sub / (s_sub + s_rat + s_err)
    assert a == b
    return a


cases = []
SF = [[9, 2, 5, 8], [6, 1, 3, 2], [8, 4, 6, 8], [7, 1, 2, 6], [10, 5, 6, 9], [6, 2, 4, 7]]
for mat in (
    SF,
    [[1, 1], [2, 2], [3, 3]],
    [[1, 2], [3, 5]],
    [[7, 8, 7], [4, 5, 6], [9, 9, 8], [2, 3, 3], [6, 6, 7]],
    [[1, 2], [2, 1], [3, 5], [5, 3]],
    [[0.5, 0.75, 0.5, 0.25], [0.25, 0.25, 0.5, 0.0], [1.0, 0.75, 1.0, 0.75]],
    [[4, 4, 5], [4, 5, 4], [5, 4, 4]],
):
    cases.append(case([mat], icc_exact(mat)))
ICC_CASES = cases
functions.append(function(
    "iccTwoWayAgreement", "variance-estimates", "docs/statistics/design.md#icctwowayagreement", cases,
    [[[]], [[[1, 2]]], [[[1], [2], [3]]], [[[1, 2], [3]]], [[[1, 2], [3, 4, 5]]], [[[3, 3], [3, 3], [3, 3]]],
     [[[1, 2], [3, "NaN"]]], [[[1, 2], [3, "Infinity"]]]]))

if __name__ == "__main__":
    write("design", "Exact rational and 120 digit decimal arithmetic; sample sizes ceilinged after rounding to 9 decimals; "
                    "every value cross-checked by a second derivation.", functions)
    import json

    if "--show" in sys.argv:
        for f in functions:
            print(f["fn"])
            for c in f["values"]:
                print("   ", json.dumps(c["args"]), "->", json.dumps(__import__("ref_common")._clean(c["expected"])))
