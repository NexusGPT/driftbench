"""Generator of newcaps-exacttests.json: exact reference values for exact-test functions.

Run: PYTHONDONTWRITEBYTECODE=1 python3 make_newcaps_exacttests.py

Every p-value that is a sum of rational probabilities is computed with fractions.Fraction (the inputs are the exact
binary values of the doubles). The hypergeometric cross-check uses Decimal at 120 digits. Each value is checked a second, different way.
"""

import os
import sys
from math import comb, factorial

sys.path.insert(0, os.path.dirname(__file__))
from ref_common import *  # noqa: F401,F403,E402

GROUP = "exacttests"
DOC = "docs/statistics/exacttests.md"
SLACK = F(10000001, 10000000)  # 1 + 1e-7: the relative slack of the small-probabilities rule
SHOW = os.environ.get("SHOW")


def doc(fn):
    return f"{DOC}#{fn.lower()}"


def say(fn, args, value):
    if SHOW:
        print(fn, args if len(str(args)) < 160 else str(args)[:160] + "...", "->", float(value) if not isinstance(value, dict) else {k: float(v) for k, v in value.items()})


def well_separated(ratio):
    """A probability ratio is either an exact tie or at least 1e-5 away from one: the slack never decides a case."""
    assert ratio == 1 or abs(ratio - 1) > F(1, 100000), f"near tie {float(ratio)}"


def C(n, k):
    return comb(n, k) if 0 <= k <= n else 0


functions = []

# ---------------------------------------------------------------- fisherExact


def fisher_p(a, b, c, d):
    r1, c1, n = a + b, a + c, a + b + c + d
    lo, hi = max(0, r1 + c1 - n), min(r1, c1)

    def P(x):
        return F(comb(c1, x) * comb(n - c1, r1 - x), comb(n, r1))

    pa = P(a)
    total = F(0)
    for x in range(lo, hi + 1):
        well_separated(P(x) / pa)
        if P(x) <= pa * SLACK:
            total += P(x)
    return min(total, F(1))


def fisher_alt(a, b, c, d):
    """All tables with the margins, each by the factorial form; p = 1 - (mass of the tables more probable than observed)."""
    r1, r2, c1, c2, n = a + b, c + d, a + c, b + d, a + b + c + d

    def P(a_):
        b_, c_ = r1 - a_, c1 - a_
        d_ = r2 - c_
        if min(b_, c_, d_) < 0:
            return None
        return F(factorial(r1) * factorial(r2) * factorial(c1) * factorial(c2),
                 factorial(n) * factorial(a_) * factorial(b_) * factorial(c_) * factorial(d_))

    probs = [p for p in (P(x) for x in range(0, min(r1, c1) + 1)) if p is not None]
    assert sum(probs) == 1
    pa = P(a)
    more = sum(p for p in probs if not p <= pa * SLACK)
    return 1 - more


fisher_values = []
for t in ([3, 1, 1, 3], [5, 0, 0, 5], [0, 0, 5, 5], [2, 2, 2, 2], [12, 5, 3, 10], [18, 7, 9, 21], [1, 9, 11, 3],
          [0, 1, 1, 0], [7, 2, 8, 1]):
    p = fisher_p(*t)
    assert p == fisher_alt(*t)
    say("fisherExact", t, p)
    fisher_values.append(case([{"a": t[0], "b": t[1], "c": t[2], "d": t[3]}], p))
functions.append(function("fisherExact", "exact", doc("fisherExact"), fisher_values,
                          [[{"a": -1, "b": 2, "c": 3, "d": 4}], [{"a": 0, "b": 0, "c": 0, "d": 0}],
                           [{"a": 1.5, "b": 2, "c": 3, "d": 4}], [{"a": "NaN", "b": 2, "c": 3, "d": 4}]]))

# ---------------------------------------------------------------- hypergeometricPmf


def hyper(k, N, K, n):
    return F(C(K, k) * C(N - K, n - k), comb(N, n))


def hyper_alt(k, N, K, n):
    """Product form: K!/(k!(K-k)!) times ... written as a falling-factorial ratio."""
    if k > K or k > n or n - k > N - K:
        return F(0)
    num = F(1)
    for i in range(k):
        num *= F(K - i, i + 1)
    for i in range(n - k):
        num *= F(N - K - i, i + 1)
    den = F(1)
    for i in range(n):
        den *= F(N - i, i + 1)
    return num / den


def hyper_log(k, N, K, n):
    if hyper(k, N, K, n) == 0:
        return D(0)
    lc = lambda a, b: lgamma(a + 1) - lgamma(b + 1) - lgamma(a - b + 1)
    return exp(lc(K, k) + lc(N - K, n - k) - lc(N, n))


hyper_values = []
for t in ([2, 10, 4, 5], [3, 20, 7, 5], [5, 1000, 100, 50], [0, 10, 4, 0], [5, 10, 4, 5], [3, 5, 5, 3], [2, 5, 5, 3],
          [4, 10, 4, 4], [0, 12, 3, 9]):
    v = hyper(*t)
    assert v == hyper_alt(*t)
    close(v, hyper_log(*t), rel=1e-25)
    say("hypergeometricPmf", t, v)
    hyper_values.append(case(list(t), v))
functions.append(function("hypergeometricPmf", "exact", doc("hypergeometricPmf"), hyper_values,
                          [[1, 3, 5, 2], [1, 3, 2, 5], [-1, 10, 4, 5], [1.5, 10, 4, 5], [1, 10, "NaN", 5]]))

# ---------------------------------------------------------------- binomial routine (cross-check of signTestExact)


def binom_pmf(i, n, p):
    return F(comb(n, i)) * p**i * (1 - p) ** (n - i)


def binom_p(k, n, p0):
    p = frac(p0)
    pk = binom_pmf(k, n, p)
    total = F(0)
    for i in range(n + 1):
        pi = binom_pmf(i, n, p)
        if pk > 0:
            well_separated(pi / pk)
        if pi <= pk * SLACK:
            total += pi
    return min(total, F(1))


# ---------------------------------------------------------------- signTestExact


def sign_p(pos, neg):
    n = pos + neg
    m = min(pos, neg)
    return min(F(1), F(2 * sum(comb(n, i) for i in range(m + 1)), 2**n))


sign_values = []
for t in ([8, 2], [5, 5], [0, 6], [12, 7], [1, 0], [30, 10], [4, 13], [20, 20], [0, 1]):
    v = sign_p(*t)
    # the small-probabilities rule at 1/2, from the binomial routine, with k the positives
    assert v == binom_p(t[0], sum(t), F(1, 2))
    say("signTestExact", t, v)
    sign_values.append(case(list(t), v))
functions.append(function("signTestExact", "exact", doc("signTestExact"), sign_values,
                          [[0, 0], [-1, 3], [2.5, 3], ["NaN", 1]]))

# ---------------------------------------------------------------- wilcoxonSignedRankExactP


def wilcoxon_p(diffs):
    n = len(diffs)
    order = sorted(range(n), key=lambda i: abs(diffs[i]))
    rank = [0] * n
    for r, i in enumerate(order, 1):
        rank[i] = r
    wp = sum(rank[i] for i in range(n) if diffs[i] > 0)
    tot = n * (n + 1) // 2
    m = min(wp, tot - wp)
    counts = [0] * (tot + 1)
    counts[0] = 1
    for r in range(1, n + 1):
        new = counts[:]
        for s in range(tot - r + 1):
            new[s + r] += counts[s]
        counts = new
    assert sum(counts) == 2**n
    return min(F(1), F(2 * sum(counts[: m + 1]), 2**n)), wp, tot


def wilcoxon_alt(diffs):
    """Brute force over the 2^n sign patterns (n <= 16), or meet in the middle over two halves of the ranks."""
    n = len(diffs)
    order = sorted(range(n), key=lambda i: abs(diffs[i]))
    rank = [0] * n
    for r, i in enumerate(order, 1):
        rank[i] = r
    wp = sum(rank[i] for i in range(n) if diffs[i] > 0)
    tot = n * (n + 1) // 2
    m = min(wp, tot - wp)
    if n <= 16:
        cnt = 0
        for mask in range(2**n):
            if sum(r for j, r in enumerate(range(1, n + 1)) if mask >> j & 1) <= m:
                cnt += 1
    else:
        h = n // 2

        def sums(rs):
            out = {0: 1}
            for r in rs:
                nxt = dict(out)
                for s, c in out.items():
                    nxt[s + r] = nxt.get(s + r, 0) + c
                out = nxt
            return out

        left, right = sums(range(1, h + 1)), sums(range(h + 1, n + 1))
        cnt = sum(c1 * c2 for s1, c1 in left.items() for s2, c2 in right.items() if s1 + s2 <= m)
    return min(F(1), F(2 * cnt, 2**n))


wil_cases = [
    [2.5],
    [1.2, 2.3, 0.4, 3.1, 1.8],
    [1.5, -2.5, 3.1, 0.4, -0.9, 2.2, 5.0, -1.1],
    [0.8, -0.3, 1.4, 0.9, -0.2, 1.1, 0.5, 1.7, -0.6, 0.35, 1.25, 0.15],
    [(-1 if i % 3 == 0 else 1) * ((i * 7) % 31) / 10 for i in range(1, 31)],
    [3, -1, -2],
    [-4.5, -1.5, -3.5, -0.5, -2.5, 6.0],
    [0.12, 0.31, -0.07, 0.22, 0.4, 0.05, -0.18, 0.27, 0.09, 0.33, -0.02, 0.14, 0.26, 0.19, 0.08, 0.37, -0.11, 0.24, 0.29, 0.16,
     0.21, 0.34, 0.01, 0.38, 0.28],
]
wil_values = []
for d in wil_cases:
    p, wp, tot = wilcoxon_p(d)
    assert p == wilcoxon_alt(d)
    say("wilcoxonSignedRankExactP", d, p)
    wil_values.append(case([d], p))
functions.append(function("wilcoxonSignedRankExactP", "nonparametric", doc("wilcoxonSignedRankExactP"), wil_values,
                          [[[]], [[1, 0, 2]], [[1, -1, 2]], [[float(i) + 0.5 for i in range(1, 32)]], [[1, "NaN", 2]]]))

# ---------------------------------------------------------------- Friedman statistic (cross-check of cochranQ)


def fr_q(M):
    b, k = len(M), len(M[0])
    R = [F(0)] * k
    ties = F(0)
    for row in M:
        rk = ranks(row)
        for j in range(k):
            R[j] += rk[j]
        for v in set(row):
            t = row.count(v)
            ties += t**3 - t
    C_ = 1 - ties / (b * k * (k * k - 1))
    return (F(12, b * k * (k + 1)) * sum(r * r for r in R) - 3 * b * (k + 1)) / C_


# ---------------------------------------------------------------- cochranQ


def cq(M):
    b, k = len(M), len(M[0])
    Cj = [sum(row[j] for row in M) for j in range(k)]
    Ri = [sum(row) for row in M]
    T = sum(Ri)
    den = k * T - sum(r * r for r in Ri)
    return F((k - 1) * (k * sum(c * c for c in Cj) - T * T), den)


cq_cases = [
    [[1, 0, 0], [1, 1, 0], [1, 1, 1], [0, 1, 0], [1, 1, 0], [0, 0, 1]],
    [[1, 0, 1]],
    [[1, 1, 0, 0], [1, 0, 0, 0], [1, 1, 1, 0], [0, 0, 0, 1], [1, 1, 0, 0], [1, 0, 1, 1], [1, 1, 1, 1]],
    [[1, 0], [1, 0], [1, 0], [0, 1]],
    [[1, 1, 0], [1, 0, 0], [1, 1, 1], [1, 0, 1], [0, 0, 0], [1, 1, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [1, 1, 1]],
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    [[0, 1, 1, 0, 1], [1, 1, 1, 0, 1], [0, 0, 1, 0, 0], [1, 1, 0, 1, 1]],
]
cq_values = []
for M in cq_cases:
    q = cq(M)
    assert q == fr_q(M), "Cochran Q is the tie-corrected Friedman statistic on 0/1 data"
    say("cochranQ", M, q)
    cq_values.append(case([M], q))
functions.append(function("cochranQ", "rank-tests", doc("cochranQ"), cq_values,
                          [[[]], [[[1], [0]]], [[[1, 0], [1]]], [[[1, 2], [0, 1]]], [[[1, 1], [0, 0]]], [[[1, 0], [1, 0.5]]]]))

# ---------------------------------------------------------------- mantelHaenszelOddsRatio


def mh(tables):
    num = sum(F(t["a"] * t["d"], sum(t.values())) for t in tables)
    den = sum(F(t["b"] * t["c"], sum(t.values())) for t in tables)
    return num / den


def mh_alt(tables):
    L = 1
    for t in tables:
        n = sum(t.values())
        L = L * n // __import__("math").gcd(L, n)
    num = sum(t["a"] * t["d"] * (L // sum(t.values())) for t in tables)
    den = sum(t["b"] * t["c"] * (L // sum(t.values())) for t in tables)
    r = F(num, den)
    if all(t["b"] * t["c"] > 0 for t in tables):
        w = [F(t["b"] * t["c"], sum(t.values())) for t in tables]
        orr = [F(t["a"] * t["d"], t["b"] * t["c"]) for t in tables]
        assert r == sum(x * y for x, y in zip(w, orr)) / sum(w)
    return r


def T(a, b, c, d):
    return {"a": a, "b": b, "c": c, "d": d}


mh_cases = [
    [T(12, 5, 6, 14), T(8, 7, 3, 12), T(15, 4, 9, 11)],
    [T(7, 3, 2, 9)],
    [T(0, 5, 3, 4), T(2, 2, 2, 0)],
    [T(20, 10, 8, 22), T(30, 12, 11, 40), T(25, 15, 10, 30), T(18, 9, 7, 26)],
    [T(5, 0, 2, 4), T(3, 4, 1, 6)],
    [T(10, 10, 10, 10), T(5, 5, 5, 5)],
    [T(1, 1, 1, 1), T(40, 3, 2, 55)],
]
mh_values = []
for ts in mh_cases:
    v = mh(ts)
    assert v == mh_alt(ts)
    say("mantelHaenszelOddsRatio", ts, v)
    mh_values.append(case([ts], v))
functions.append(function("mantelHaenszelOddsRatio", "tables", doc("mantelHaenszelOddsRatio"), mh_values,
                          [[[]], [[T(0, 0, 0, 0)]], [[T(5, 0, 2, 4)]], [[T(-1, 2, 3, 4)]], [[T(1.5, 2, 3, 4)]],
                           [[T(1, 2, 3, 4), T(0, 0, 0, 0)]]]))

write(GROUP, "Exact rational arithmetic (fractions) for every enumerated p-value and exact statistic; Decimal at 120 digits "
      "for exp, ln and lgamma. Each value is cross-checked by a second method inside make_newcaps_exacttests.py.", functions)
