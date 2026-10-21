"""Generator of newcaps-design.json: sample sizes, power, allocation and variance estimates (exact arithmetic)."""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from ref_common import *  # noqa: E402,F403

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


# ---------------------------------------------------------------- sample size

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

# ---------------------------------------------------------------- variance


def svar(xs):
    n = len(xs)
    m = sum(xs) / n
    return sum((x - m) ** 2 for x in xs) / (n - 1)


WA = [27.5, 21.0, 19.0, 23.6, 17.0, 17.9, 16.9, 20.1, 21.9, 22.6, 23.1, 19.6, 19.0, 21.7, 21.4]
WB = [27.1, 22.0, 20.8, 23.4, 23.4, 23.5, 25.8, 22.0, 24.8, 20.2, 21.9, 22.1, 22.9, 20.5, 24.4]

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

if __name__ == "__main__":
    write("design", "Exact rational and 120 digit decimal arithmetic; sample sizes ceilinged after rounding to 9 decimals; "
                    "every value cross-checked by a second derivation.", functions)
    import json

    if "--show" in sys.argv:
        for f in functions:
            print(f["fn"])
            for c in f["values"]:
                print("   ", json.dumps(c["args"]), "->", json.dumps(__import__("ref_common")._clean(c["expected"])))
