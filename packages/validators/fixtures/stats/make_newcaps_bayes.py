"""Reference values for the group `bayes`: Beta-Binomial summaries and closed-form intervals on a rate.

Standard library only. Rationals are Fractions (exact); sqrt, ln, exp, asin and sin are Decimal series at 120
digits. Every value is cross-checked a second (and often a third) way before it is written. Run:
    PYTHONDONTWRITEBYTECODE=1 python3 make_newcaps_bayes.py
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from ref_common import *  # noqa: F401,F403,E402

functions = []
DOC = "docs/statistics/bayes.md#"
Z95 = 1.959963984540054
Z90 = 1.6448536269514722
Z99 = 2.5758293035489004
Z80 = 1.2815515655446004


def Bint(x, y):
    """Beta function of two positive integers, exactly: (x - 1)! (y - 1)! / (x + y - 1)!"""
    return F(factorial(x - 1) * factorial(y - 1), factorial(x + y - 1))


def poch(x, n):
    """Rising factorial x (x + 1) ... (x + n - 1) as an exact Fraction."""
    r = F(1)
    for i in range(n):
        r *= F(x) + i
    return r


# ---------------------------------------------------------------- beta posterior summaries

def post(a, b, s, f):
    return frac(a) + s, frac(b) + f


cases = []
for a, b, s, f in [(1, 1, 7, 3), (2, 2, 0, 0), (1.5, 2.5, 10, 4), (0.5, 0.5, 20, 5), (1, 1, 1, 1),
                   (0.5, 0.5, 1, 1), (3, 2, 40, 10), (2, 2, 0, 12)]:
    A, B = post(a, b, s, f)
    assert A > 1 and B > 1
    m = (A - 1) / (A + B - 2)
    assert m == (s + frac(a) - 1) / (s + f + frac(a) + frac(b) - 2)
    assert (A - 1) * (1 - m) - (B - 1) * m == 0  # the density's derivative vanishes at the mode
    cases.append(case([a, b, s, f], m))
functions.append(function("betaPosteriorMode", "bayes", DOC + "betaposteriormode", cases,
                          [[1, 1, 0, 0], [1, 1, 5, 0], [1, 1, 0, 5], [0.5, 0.5, 0, 0], [0, 2, 3, 3], [-1, 2, 3, 3],
                           [2, 2, 1.5, 0], [2, 2, -1, 0], [2, "NaN", 1, 1], [2, 2, 1, "Infinity"]]))

cases = []
for a, b, s, f in [(1, 1, 0, 0), (1, 1, 7, 3), (0.5, 0.5, 10, 10), (2.5, 1.5, 40, 60), (1, 1, 0, 25), (3, 7, 120, 380),
                   (0.25, 0.75, 1, 0)]:
    A, B = post(a, b, s, f)
    v = A * B / ((A + B) ** 2 * (A + B + 1))
    mean = A / (A + B)
    assert v == mean * (1 - mean) / (A + B + 1)
    e1 = exp(lbeta(A + 1, B) - lbeta(A, B))
    e2 = exp(lbeta(A + 2, B) - lbeta(A, B))
    close(v, e2 - e1 * e1, rel=1e-30)
    cases.append(case([a, b, s, f], v))
functions.append(function("betaPosteriorVariance", "bayes", DOC + "betaposteriorvariance", cases,
                          [[0, 1, 2, 2], [1, 0, 2, 2], [-0.5, 1, 2, 2], [1, 1, -1, 0], [1, 1, 0, 2.5], [1, "NaN", 0, 0],
                           [1, 1, "Infinity", 0]]))

cases = []
for a, b, s, f in [(1, 1, 7, 3), (0.5, 0.5, 0, 0), (1, 1, 0, 10), (2, 3, 45, 5), (1, 1, 0, 0), (0.1, 0.9, 190, 10),
                   (1.5, 2.5, 3, 97)]:
    A, B = post(a, b, s, f)
    p = (frac(a) + s) / (frac(a) + frac(b) + s + f)
    assert p == A / (A + B)
    close(p, exp(lbeta(A + 1, B) - lbeta(A, B)), rel=1e-30)  # E[theta] = B(A + 1, B) / B(A, B)
    cases.append(case([a, b, s, f], p))
functions.append(function("predictiveProbabilityNext", "bayes", DOC + "predictiveprobabilitynext", cases,
                          [[0, 1, 2, 2], [1, -1, 2, 2], [1, 1, -1, 0], [1, 1, 0, 1.5], [1, "NaN", 0, 0],
                           [1, 1, 0, "Infinity"]]))

# ---------------------------------------------------------------- beta-binomial pmf

cases = []
for k, n, a, b in [(3, 10, 1, 1), (0, 0, 1, 1), (5, 5, 2, 3), (0, 8, 1, 4), (7, 20, 3, 2), (12, 30, 2, 2), (30, 30, 1, 1),
                   (18, 20, 9, 2), (1, 40, 5, 45)]:
    pmf = comb(n, k) * Bint(k + a, n - k + b) / Bint(a, b)
    assert pmf == comb(n, k) * poch(a, k) * poch(b, n - k) / poch(a + b, n)
    close(pmf, comb(n, k) * exp(lbeta(k + a, n - k + b) - lbeta(a, b)), rel=1e-30)
    total = sum(comb(n, j) * Bint(j + a, n - j + b) / Bint(a, b) for j in range(n + 1))
    assert total == 1
    if a == b == 1:
        assert pmf == F(1, n + 1)
    cases.append(case([k, n, a, b], pmf))
functions.append(function("betaBinomialPmf", "bayes", DOC + "betabinomialpmf", cases,
                          [[6, 5, 1, 1], [1, 5, 0, 1], [1, 5, 1, 0], [1, 5, 1.5, 1], [1, 5, 1, 2.5], [-1, 5, 1, 1],
                           [1, 5.5, 1, 1], [1, -5, 1, 1], ["NaN", 5, 1, 1], [1, 5, "Infinity", 1]]))

# ---------------------------------------------------------------- Bayes factor and posterior odds


def null_lik(s, t, p0):
    p0 = frac(p0)
    return p0 ** s * (1 - p0) ** (t - s)


def bf10(s, t, p0):
    m1 = F(factorial(s) * factorial(t - s), factorial(t + 1))  # the marginal likelihood of one sequence, B(s + 1, t - s + 1)
    bf = m1 / null_lik(s, t, p0)
    assert bf == F(1, t + 1) / (comb(t, s) * null_lik(s, t, p0))  # via the binomial pmf, the coefficient cancels
    p0d = dec(frac(p0))
    close(bf, exp(lbeta(s + 1, t - s + 1) - s * ln(p0d) - (t - s) * ln(1 - p0d)), rel=1e-30)
    return bf


cases = []
for s, t, p0 in [(7, 10, 0.5), (0, 0, 0.5), (50, 100, 0.5), (18, 20, 0.5), (3, 20, 0.1), (0, 10, 0.25), (10, 10, 0.9),
                 (30, 40, 0.75), (1, 1, 0.5)]:
    cases.append(case([s, t, p0], bf10(s, t, p0)))
functions.append(function("bayesFactorBinomialPointNull", "bayes", DOC + "bayesfactorbinomialpointnull", cases,
                          [[6, 5, 0.5], [3, 10, 0], [3, 10, 1], [3, 10, -0.1], [3, 10, 1.5], [-1, 10, 0.5],
                           [3, 10.5, 0.5], [3, 10, "NaN"], ["Infinity", 10, 0.5]]))

cases = []
for s, t, p0, o in [(7, 10, 0.5, 1), (7, 10, 0.5, 0.25), (0, 0, 0.5, 3), (18, 20, 0.5, 2), (3, 20, 0.1, 0.5),
                    (50, 100, 0.5, 0.1), (9, 12, 0.6, 4)]:
    bf = bf10(s, t, p0)
    odds = bf * frac(o)
    q = frac(o) / (1 + frac(o))  # the prior probability of the alternative
    m1c, m0c = F(1, t + 1), comb(t, s) * null_lik(s, t, p0)
    pp = q * m1c / (q * m1c + (1 - q) * m0c)
    assert odds == pp / (1 - pp)  # posterior odds read off the posterior probability
    cases.append(case([s, t, p0, o], odds))
functions.append(function("posteriorOddsBinomial", "bayes", DOC + "posteriorOddsBinomial".lower(), cases,
                          [[6, 5, 0.5, 1], [3, 10, 0, 1], [3, 10, 1, 1], [3, 10, 0.5, 0], [3, 10, 0.5, -1],
                           [3, 10, 0.5, "NaN"], [3, 10, 0.5, "Infinity"], [3.5, 10, 0.5, 1]]))

# ---------------------------------------------------------------- beta tail and P(X1 > X2)


def tail(a, b, x):
    x = frac(x)
    n = a + b - 1
    return sum(comb(n, j) * x ** j * (1 - x) ** (n - j) for j in range(a))


def tail_alt(a, b, x):
    x = frac(x)
    integral = sum(comb(b - 1, i) * (-1) ** i * (1 - x ** (a + i)) / (a + i) for i in range(b))
    return integral / Bint(a, b)


cases = []
for a, b, x in [(1, 1, 0.25), (2, 3, 0.5), (5, 5, 0.5), (3, 2, 0), (4, 6, 1), (1, 5, 0.1), (10, 30, 0.2), (8, 3, 0.7),
                (25, 15, 0.6)]:
    t = tail(a, b, x)
    assert t == tail_alt(a, b, x)
    assert t == 1 - tail_alt(b, a, 1 - frac(x))  # P(X > x) = 1 - P(1 - X > 1 - x) with 1 - X ~ Beta(b, a)
    cases.append(case([a, b, x], t))
functions.append(function("betaTailProbability", "bayes", DOC + "betatailprobability", cases,
                          [[2, 3, -0.1], [2, 3, 1.1], [0, 3, 0.5], [2, 0, 0.5], [1.5, 3, 0.5], [2, 2.5, 0.5],
                           [-2, 3, 0.5], [2, 3, "NaN"], [2, 3, "Infinity"]]))


def greater(a1, b1, a2, b2):
    n = a1 + b1 - 1
    return sum(comb(n, j) * Bint(a2 + j, a1 + b1 + b2 - 1 - j) for j in range(a1)) / Bint(a2, b2)


def greater_miller(a1, b1, a2, b2):
    return sum(Bint(a2 + i, b1 + b2) / ((b1 + i) * Bint(1 + i, b1)) for i in range(a1)) / Bint(a2, b2)


cases = []
for a1, b1, a2, b2 in [(1, 1, 1, 1), (2, 1, 1, 1), (8, 4, 5, 7), (13, 9, 10, 12), (1, 5, 5, 1), (3, 3, 3, 3), (20, 10, 15, 15),
                       (1, 1, 7, 1), (31, 71, 24, 80)]:
    g = greater(a1, b1, a2, b2)
    assert g == greater_miller(a1, b1, a2, b2)
    assert g + greater(a2, b2, a1, b1) == 1  # continuous variables, no ties
    if (a1, b1) == (a2, b2):
        assert g == F(1, 2)
    cases.append(case([a1, b1, a2, b2], g))
functions.append(function("posteriorProbabilityBetaGreater", "bayes", DOC + "posteriorprobabilitybetagreater", cases,
                          [[0, 1, 1, 1], [1, 0, 1, 1], [1, 1, 0, 1], [1, 1, 1, 0], [1.5, 1, 1, 1], [1, 1, 1, 2.5],
                           [-1, 1, 1, 1], ["NaN", 1, 1, 1], [1, 1, 1, "Infinity"]]))

# ---------------------------------------------------------------- Dirichlet-multinomial


def dm_pmf(counts, alphas):
    n, A = sum(counts), sum(alphas)
    coef = F(factorial(n))
    for x in counts:
        coef /= factorial(x)
    num_ = F(1)
    for x, al in zip(counts, alphas):
        num_ *= poch(al, x)
    return coef * num_ / poch(A, n)


def dm_urn(counts, alphas):
    """Draw by draw: a Polya urn that starts with alphas[i] balls of colour i and adds one ball of the colour drawn."""
    seq = [i for i, x in enumerate(counts) for _ in range(x)]
    urn, total, prob = [F(al) for al in alphas], F(sum(alphas)), F(1)
    for i in seq:
        prob *= urn[i] / total
        urn[i] += 1
        total += 1
    n = len(seq)
    coef = F(factorial(n))
    for x in counts:
        coef /= factorial(x)
    return coef * prob


def compositions(n, k):
    if k == 1:
        yield (n,)
        return
    for x in range(n + 1):
        for rest in compositions(n - x, k - 1):
            yield (x,) + rest


cases = []
for counts, alphas in [([3, 1, 2], [1, 2, 1]), ([5], [3]), ([0, 0, 0], [1, 1, 1]), ([12, 5, 3], [1, 1, 1]), ([4, 0], [2, 3]),
                       ([7, 2, 1, 0], [2, 2, 1, 5]), ([20, 15, 10, 5], [3, 2, 2, 1]), ([2, 2], [1, 1])]:
    p = dm_pmf(counts, alphas)
    assert p == dm_urn(counts, alphas)
    n, k = sum(counts), len(counts)
    if n <= 12:
        assert sum(dm_pmf(list(c), alphas) for c in compositions(n, k)) == 1
    if all(al == 1 for al in alphas):
        assert p == F(1, comb(n + k - 1, k - 1))  # every composition is equally likely under the flat prior
    if k == 2:
        a, b = alphas
        assert p == comb(n, counts[0]) * Bint(counts[0] + a, counts[1] + b) / Bint(a, b)
    lg = lgamma(sum(alphas)) - lgamma(sum(alphas) + n) + sum(lgamma(x + al) - lgamma(al) for x, al in zip(counts, alphas))
    lg += lgamma(n + 1) - sum(lgamma(x + 1) for x in counts)
    close(p, exp(lg), rel=1e-30)
    cases.append(case([counts, alphas], p))
functions.append(function("dirichletMultinomialPmf", "bayes", DOC + "dirichletmultinomialpmf", cases,
                          [[[], []], [[1, 2], [1]], [[1], [1, 2]], [[1, 2], [1, 0]], [[1, 2], [1, 1.5]], [[1, 2], [1, -1]],
                           [[1, -2], [1, 1]], [[1, 2.5], [1, 1]], [[1, "NaN"], [1, 1]], [[1, 2], [1, "Infinity"]]]))

# ---------------------------------------------------------------- the interval functions (module `intervals`)


def sin_dec(x):
    x = dec(x)
    term, total, n, x2 = x, x, 1, x * x
    while abs(term) > D(10) ** -125:
        term = -term * x2 / ((2 * n) * (2 * n + 1))
        total += term
        n += 1
    return total


def cos_dec(x):
    x = dec(x)
    term, total, n, x2 = D(1), D(1), 1, x * x
    while abs(term) > D(10) ** -125:
        term = -term * x2 / ((2 * n - 1) * (2 * n))
        total += term
        n += 1
    return total


def asin_dec(x):
    """arcsin of x in [0, 1]: Newton on sin from a double start, with the two endpoints set exactly."""
    x = dec(x)
    if x == 0:
        return D(0)
    if x == 1:
        return PI / 2
    t = D(math.asin(float(x)))
    for _ in range(12):
        t -= (sin_dec(t) - x) / cos_dec(t)
    close(sin_dec(t), x, rel=1e-100)
    return t


def checked(raw):
    """A raw bound must not sit so close to a clip edge that a double implementation can land on the other side."""
    raw = dec(raw)
    if raw == 0 or raw == 1:
        return raw
    assert not (-0.005 < raw < 0.005) and not (1 < raw < 1.005), f"too close to a clip edge: {raw}"
    return raw


def clip(x):
    return min(D(1), max(D(0), x))


def result(lo, hi):
    return {"lower": clip(dec(lo)), "upper": clip(dec(hi))}


def interval_cases(rows, build):
    out = []
    for k, n, z in rows:
        lo, hi = build(k, n, z)
        out.append(case([k, n, z], result(lo, hi)))
    return out


INTERVAL_DOMAIN = lambda ok: [[ok[0], 0, Z95], [6, 5, Z95], [-1, 10, Z95], [1.5, 10, Z95], [3, 10.5, Z95],
                              [3, 10, 0], [3, 10, -1.96], [3, 10, "NaN"], [3, 10, "Infinity"], ["NaN", 10, Z95]]

# waldInterval
def wald(k, n, z):
    p = F(k, n)
    half = dec(z) * dec(p * (1 - p) / n).sqrt()
    half2 = dec(z) * dec(F(k * (n - k), n ** 3)).sqrt()
    close(half, half2, rel=1e-100)
    assert abs(float(half) - z * math.sqrt(k * (n - k) / n ** 3)) <= 1e-13 * max(1.0, float(half))
    return checked(dec(p) - half), checked(dec(p) + half)


rows = [(0, 20, Z95), (20, 20, Z95), (1, 1, Z95), (7, 10, Z95), (15, 40, Z95), (180, 200, Z90), (50, 100, Z99), (2, 6, Z95),
        (13, 15, Z95), (9, 12, 1.0), (2, 50, 1.0), (1, 50, Z95)]
functions.append(function("waldInterval", "intervals", DOC + "waldinterval", interval_cases(rows, wald),
                          INTERVAL_DOMAIN([3])))


# agrestiCoullInterval
def agresti(k, n, z):
    z2 = frac(z) ** 2
    nt = n + z2
    pt = (k + z2 / 2) / nt
    half = dec(z) * dec(pt * (1 - pt) / nt).sqrt()
    half2 = dec(z) * dec((k + z2 / 2) * (n - k + z2 / 2) / nt ** 3).sqrt()
    close(half, half2, rel=1e-100)
    return checked(dec(pt) - half), checked(dec(pt) + half)


rows = [(0, 20, Z95), (20, 20, Z95), (1, 1, Z95), (7, 10, Z95), (15, 40, Z95), (180, 200, Z90), (50, 100, Z99), (2, 6, Z95),
        (45, 50, Z95), (4, 5, 1.0)]
functions.append(function("agrestiCoullInterval", "intervals", DOC + "agresticoullinterval",
                          interval_cases(rows, agresti), INTERVAL_DOMAIN([3])))


# plusFourInterval
def plus4(k, n, z):
    kk, nn = k + 2, n + 4
    p = F(kk, nn)
    half = dec(z) * dec(p * (1 - p) / nn).sqrt()
    half2 = dec(z) * dec(F(kk * (nn - kk), nn ** 3)).sqrt()
    close(half, half2, rel=1e-100)
    return checked(dec(p) - half), checked(dec(p) + half)


rows = [(0, 20, Z95), (20, 20, Z95), (0, 1, Z95), (1, 1, Z95), (7, 10, Z95), (15, 40, Z95), (180, 200, Z90), (50, 100, Z99),
        (3, 8, Z95), (2, 30, 1.0)]
functions.append(function("plusFourInterval", "intervals", DOC + "plusfourinterval", interval_cases(rows, plus4),
                          INTERVAL_DOMAIN([3])))


# arcsineInterval
def arcsine(k, n, z):
    p = F(k, n)
    sp, sq = dec(p).sqrt(), dec(1 - p).sqrt()
    theta = asin_dec(sp)
    delta = dec(z) / (2 * dec(n).sqrt())
    lo_raw, hi_raw = theta - delta, theta + delta
    if k > 0:
        assert abs(lo_raw) >= D("0.05"), f"arcsine lower angle too close to 0: {lo_raw}"
    lo_angle, hi_angle = max(D(0), lo_raw), min(PI / 2, hi_raw)
    lower, upper = sin_dec(lo_angle) ** 2, sin_dec(hi_angle) ** 2
    sd, cd = sin_dec(delta), cos_dec(delta)
    if lo_raw > 0:
        close(lower, (sp * cd - sq * sd) ** 2, rel=1e-100)  # sin(t - d) = sin t cos d - cos t sin d
        close(lower, (1 - cos_dec(2 * lo_raw)) / 2, rel=1e-100)
    else:
        assert lower == 0 and sp * cd - sq * sd <= 0
    if hi_raw < PI / 2:
        close(upper, (sp * cd + sq * sd) ** 2, rel=1e-100)
    else:
        assert hi_raw >= PI / 2 and upper == sin_dec(PI / 2) ** 2
    return lower, upper


rows = [(0, 20, Z95), (20, 20, Z95), (1, 1, Z95), (7, 10, Z95), (15, 40, Z95), (180, 200, Z90), (50, 100, Z99), (3, 50, Z80),
        (12, 15, Z95), (9, 12, 1.0), (1, 30, 1.0), (28, 30, Z95)]
functions.append(function("arcsineInterval", "intervals", DOC + "arcsineinterval", interval_cases(rows, arcsine),
                          INTERVAL_DOMAIN([3])))


# logitWaldInterval
def logit_wald(k, n, z):
    se = dec(F(n, k * (n - k))).sqrt()
    center = dec(k).ln() - dec(n - k).ln()
    lo = 1 / (1 + (-(center - dec(z) * se)).exp())
    hi = 1 / (1 + (-(center + dec(z) * se)).exp())
    odds = dec(F(n - k, k))
    close(lo, 1 / (1 + odds * (dec(z) * se).exp()), rel=1e-100)  # p = 1 / (1 + 1 / odds) with odds = k/(n-k) e^(-z se)
    close(hi, 1 / (1 + odds * (-(dec(z) * se)).exp()), rel=1e-100)
    return lo, hi


rows = [(1, 2, Z95), (7, 10, Z95), (15, 40, Z95), (1, 20, Z95), (19, 20, Z95), (180, 200, Z90), (50, 100, Z99), (3, 50, Z80),
        (12, 15, 1.0), (1, 3, Z95)]
functions.append(function("logitWaldInterval", "intervals", DOC + "logitwaldinterval",
                          interval_cases(rows, logit_wald),
                          [[0, 10, Z95], [10, 10, Z95], [0, 1, Z95], [-1, 10, Z95], [11, 10, Z95], [3, 10, 0], [3, 10, -1],
                           [3, 10, "NaN"], [3, 10, "Infinity"], [3.5, 10, Z95], [3, 0, Z95]]))


# wilsonContinuityInterval (Newcombe 1998, method 4)
def wilson_cc(k, n, z):
    z = dec(z)
    nn, kk = dec(n), dec(k)
    p = kk / nn
    den = 2 * (nn + z * z)
    if k == 0:
        lo = D(0)
    else:
        arg = z * z - 2 - 1 / nn + 4 * p * (nn * (1 - p) + 1)
        assert arg > 0
        numer = 2 * kk + z * z - 1 - z * arg.sqrt()
        assert abs(numer) >= D("0.02") * (2 * kk + z * z - 1), "lower numerator cancels"
        lo = numer / den
        # the lower root of (p_hat - p - 1/(2n))^2 = z^2 p (1 - p) / n with p_hat - p - 1/(2n) >= 0
        assert p - lo - 1 / (2 * nn) >= 0
        close((p - lo - 1 / (2 * nn)) ** 2, z * z * lo * (1 - lo) / nn, rel=1e-100)
    if k == n:
        hi = D(1)
    else:
        arg = z * z + 2 - 1 / nn + 4 * p * (nn * (1 - p) - 1)
        assert arg > 0
        hi = (2 * kk + z * z + 1 + z * arg.sqrt()) / den
        assert hi - p - 1 / (2 * nn) >= 0
        close((hi - p - 1 / (2 * nn)) ** 2, z * z * hi * (1 - hi) / nn, rel=1e-100)
    return checked(lo), checked(hi)


rows = [(0, 20, Z95), (20, 20, Z95), (1, 1, Z95), (7, 10, Z95), (15, 40, Z95), (180, 200, Z90), (50, 100, Z99), (3, 50, Z80),
        (4, 5, Z95), (9, 12, 1.0), (19, 20, Z95)]
functions.append(function("wilsonContinuityInterval", "intervals", DOC + "wilsoncontinuityinterval",
                          interval_cases(rows, wilson_cc), INTERVAL_DOMAIN([3])))

# ruleOfThreeUpperBound
cases = []
for n, c in [(1, 0.95), (59, 0.95), (20, 0.99), (300, 0.9), (1000, 0.95), (10, 0.5), (500, 0.5), (200, 0.999)]:
    rest = 1 - frac(c)
    u = 1 - (dec(rest).ln() / n).exp()
    close((1 - u) ** n, dec(rest), rel=1e-100)  # (1 - U)^n gives back the allowed miss probability
    if n == 1:
        close(u, dec(frac(c)), rel=1e-100)
    cases.append(case([n, c], u))
functions.append(function("ruleOfThreeUpperBound", "intervals", DOC + "ruleofthreeupperbound", cases,
                          [[0, 0.95], [-5, 0.95], [2.5, 0.95], [10, 0], [10, 1], [10, -0.1], [10, 1.5], [10, "NaN"],
                           ["Infinity", 0.95]]))

write("bayes", "Exact arithmetic: Fraction for every rational result, Decimal at 120 digits for sqrt, ln, exp, asin, sin and "
      "cos. No driftbench code is run.", functions)

# values printed for the page examples
if os.environ.get("SHOW"):
    for f in functions:
        print(f["fn"])
        for c in f["values"]:
            print("   ", c["args"], "->", c["expected"] if not isinstance(c["expected"], (F, D)) else float(c["expected"]))
