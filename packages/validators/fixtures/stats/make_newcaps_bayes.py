"""Reference values for the group `bayes`: closed-form intervals on a rate.

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
