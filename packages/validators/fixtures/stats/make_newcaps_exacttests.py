"""Generator of newcaps-exacttests.json: exact reference values for sixteen exact-test functions.

Run: PYTHONDONTWRITEBYTECODE=1 python3 make_newcaps_exacttests.py

Every p-value that is a sum of rational probabilities is computed with fractions.Fraction (the inputs are the exact
binary values of the doubles). Poisson and G use Decimal at 120 digits. Each value is checked a second, different way.
"""

import itertools
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

# ---------------------------------------------------------------- binomialTestExact


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


def binom_alt(k, n, p0):
    p = frac(p0)
    pk = binom_pmf(k, n, p)
    more = sum(binom_pmf(i, n, p) for i in range(n + 1) if not binom_pmf(i, n, p) <= pk * SLACK)
    assert sum(binom_pmf(i, n, p) for i in range(n + 1)) == 1
    return 1 - more


bin_values = []
for t in ([7, 10, 0.5], [9, 10, 0.5], [0, 10, 0.5], [3, 20, 0.3], [41, 50, 0.7], [5, 5, 1], [5, 5, 0], [1, 1, 0.5],
          [12, 40, 0.25], [8, 8, 0.9]):
    v = binom_p(*t)
    assert v == binom_alt(*t)
    say("binomialTestExact", t, v)
    bin_values.append(case(list(t), v))
functions.append(function("binomialTestExact", "exact", doc("binomialTestExact"), bin_values,
                          [[11, 10, 0.5], [3, 10, 1.5], [3, 10, "NaN"], [0, 0, 0.5], [-1, 10, 0.5], [3, 10, -0.1]]))

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

# ---------------------------------------------------------------- poissonTestExact


def pois_limit(k, mean):
    """Largest integer not above k + 10 sqrt(mean) + 50, exactly."""
    m = frac(mean)
    from math import isqrt
    # floor(10 sqrt(m)) = floor(sqrt(100 m)); 100 m is a Fraction: floor(sqrt(x)) for x = p/q is isqrt(floor(x)) when exact floor is used
    x = 100 * m
    r = isqrt(x.numerator // x.denominator)
    # isqrt(floor(x)) = floor(sqrt(x)) for any x >= 0
    return k + r + 50


def pois_p(k, mean):
    m = frac(mean)
    L = pois_limit(k, mean)
    w = [F(1)]
    for i in range(1, L + 1):
        w.append(w[-1] * m / i)
    wk = w[k]
    sel = []
    for i in range(L + 1):
        well_separated(w[i] / wk)
        if w[i] <= wk * SLACK:
            sel.append(i)
    S = sum(w[i] for i in sel)
    # the terms beyond the limit: bounded by a geometric series, negligible next to the smallest selected term
    ratio = m / (L + 2)
    assert ratio < 1
    tail_bound = w[L] * ratio / (1 - ratio)
    assert tail_bound < F(1, 10**18) * min(w[i] for i in sel) or S * F(1, 10**18) > tail_bound, "truncation matters"
    p = min(D(1), exp(-dec(m)) * dec(S))
    return p, sel, L


def pois_alt(k, mean, sel):
    """The same set summed from log-probabilities (lgamma), and checked against the complement."""
    m = dec(frac(mean))
    L = pois_limit(k, mean)
    logp = lambda i: -m + i * ln(m) - lgamma(i + 1)
    lk = logp(k)
    sel2 = [i for i in range(L + 1) if logp(i) <= lk + ln(D(SLACK.numerator) / D(SLACK.denominator))]
    assert sel2 == sel
    s = sum(exp(logp(i)) for i in sel2)
    allp = sum(exp(logp(i)) for i in range(L + 1))
    rest = sum(exp(logp(i)) for i in range(L + 1) if i not in sel2)
    close(allp, s + rest, rel=1e-100)
    return min(D(1), s)


pois_values = []
for t in ([3, 2.5], [0, 1], [10, 4.2], [2, 3], [25, 12.5], [0, 0.5], [7, 3.2], [45, 20], [4, 4.5], [1, 0.1]):
    p, sel, L = pois_p(*t)
    close(p, pois_alt(*t, sel), rel=1e-25)
    say("poissonTestExact", t, p)
    pois_values.append(case(list(t), p))
functions.append(function("poissonTestExact", "exact", doc("poissonTestExact"), pois_values,
                          [[3, 0], [3, -1], [3, 21], [201, 5], [-1, 5], [2.5, 5], [3, "NaN"]]))

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

# ---------------------------------------------------------------- mannWhitneyUExactP


def mw_u(a, b):
    return sum(1 for x in a for y in b if x > y)


def mw_p(a, b):
    m, n = len(a), len(b)
    mn = m * n
    ua = mw_u(a, b)
    k = min(ua, mn - ua)
    f = {}
    for i in range(m + 1):
        for j in range(n + 1):
            if i == 0 or j == 0:
                f[(i, j)] = [1] + [0] * (i * j)
            else:
                cur = [0] * (i * j + 1)
                for u, c in enumerate(f[(i - 1, j)]):  # the largest value is in a: it beats all j values of b
                    cur[u + j] += c
                for u, c in enumerate(f[(i, j - 1)]):  # the largest value is in b
                    cur[u] += c
                f[(i, j)] = cur
    dist = f[(m, n)]
    assert sum(dist) == comb(m + n, m)
    return min(F(1), F(2 * sum(dist[: k + 1]), comb(m + n, m))), ua


def mw_alt(a, b):
    m, n = len(a), len(b)
    mn = m * n
    ua = mw_u(a, b)
    k = min(ua, mn - ua)
    total = comb(m + n, m)
    if m + n <= 14:
        cnt = 0
        for ranks_a in itertools.combinations(range(1, m + n + 1), m):
            if sum(ranks_a) - m * (m + 1) // 2 <= k:
                cnt += 1
    else:
        poly = [0] * (mn + 1)
        poly[0] = 1
        for i in range(1, m + 1):
            sh = n + i
            poly = [poly[s] - (poly[s - sh] if s >= sh else 0) for s in range(mn + 1)]
            out = [0] * (mn + 1)
            for s in range(mn + 1):
                out[s] = poly[s] + (out[s - i] if s >= i else 0)
            poly = out
        assert sum(poly) == total
        cnt = sum(poly[: k + 1])
    return min(F(1), F(2 * cnt, total))


mw_cases = [
    ([1.1, 2.3, 3.2], [4.5, 5.1, 6.0, 7.2]),
    ([5.1], [3.2]),
    ([3.4, 1.2, 5.6, 2.8], [2.1, 4.5, 3.9, 6.7, 0.8]),
    ([78, 85, 91, 66, 88, 74, 92, 81, 69, 95], [72, 64, 79, 58, 83, 61, 70, 67, 76]),
    ([((i * 17) % 29) / 4 + 0.01 * i for i in range(12)], [((i * 11) % 31) / 4 + 0.5 + 0.013 * i for i in range(13)]),
    ([7.1, 7.2, 7.3, 7.4, 7.5, 7.6], [1.1, 1.2, 1.3, 1.4, 1.5, 1.6]),
    ([1, 4], [2, 3]),
    ([0.62, 0.71, 0.58, 0.80, 0.77, 0.69, 0.74, 0.66], [0.55, 0.61, 0.64, 0.59, 0.70, 0.52, 0.63, 0.67, 0.57]),
]
mw_values = []
for a, b in mw_cases:
    assert len(set(a + b)) == len(a) + len(b)
    p, ua = mw_p(a, b)
    assert p == mw_alt(a, b)
    say("mannWhitneyUExactP", (a, b), p)
    mw_values.append(case([a, b], p))
functions.append(function("mannWhitneyUExactP", "nonparametric", doc("mannWhitneyUExactP"), mw_values,
                          [[[], [1, 2]], [[1, 2], []], [[1, 2], [2, 3]], [[1, 1], [3, 4, 5]],
                           [[float(i) for i in range(1, 32)], [100.5]], [[1, "NaN"], [2, 3]]]))

# ---------------------------------------------------------------- permutationTestMeanDifference


def perm_p(a, b):
    m, nb = len(a), len(b)
    N = m + nb
    vals = [frac(x) for x in a + b]
    T = sum(vals)
    dobs = sum(vals[:m]) / m - sum(vals[m:]) / nb
    thr = abs(dobs) * (1 - F(1, 10**12))
    cnt = 0
    total = 0
    for idx in itertools.combinations(range(N), m):
        sa = sum(vals[i] for i in idx)
        d = sa / m - (T - sa) / nb
        total += 1
        ad = abs(d)
        if ad < abs(dobs):
            assert ad <= abs(dobs) * (1 - F(1, 10**8)) or ad >= thr, "near tie"
        if ad >= thr:
            cnt += 1
    return F(cnt, total)


def perm_alt(a, b):
    """Dynamic programming over (size of group a, scaled sum of group a): counts of partitions by sum."""
    m, nb = len(a), len(b)
    vals = [frac(x) for x in a + b]
    den = 1
    for v in vals:
        den = den * v.denominator // __import__("math").gcd(den, v.denominator)
    iv = [int(v * den) for v in vals]
    T = sum(iv)
    dp = [dict() for _ in range(m + 1)]
    dp[0][0] = 1
    for x in iv:
        for j in range(m - 1, -1, -1):
            for s, c in list(dp[j].items()):
                dp[j + 1][s + x] = dp[j + 1].get(s + x, 0) + c
    dobs = F(sum(iv[:m]), m) - F(sum(iv[m:]), nb)
    thr = abs(dobs) * (1 - F(1, 10**12))
    cnt = sum(c for s, c in dp[m].items() if abs(F(s, m) - F(T - s, nb)) >= thr)
    assert sum(dp[m].values()) == comb(m + nb, m)
    return F(cnt, comb(m + nb, m))


perm_cases = [
    ([3.1, 4.2, 5.3], [1.0, 2.0, 2.5, 3.0]),
    ([2], [5]),
    ([4, 4, 4], [4, 4, 4, 4]),
    ([0.71, 0.64, 0.80, 0.77, 0.69, 0.73], [0.62, 0.58, 0.66, 0.70, 0.61, 0.65, 0.59]),
    ([12, 15, 11, 18, 14, 16, 13, 17], [10, 12, 9, 14, 11, 13, 8, 15]),
    ([1, 2, 3], [4, 5, 6]),
    ([5, 1], [2, 3, 4]),
    ([2.5, 2.5, 7.5, 1.0], [2.5, 3.0]),
]
perm_values = []
for a, b in perm_cases:
    p = perm_p(a, b)
    assert p == perm_alt(a, b)
    say("permutationTestMeanDifference", (a, b), p)
    perm_values.append(case([a, b], p))
functions.append(function("permutationTestMeanDifference", "nonparametric", doc("permutationTestMeanDifference"),
                          perm_values,
                          [[[], [1, 2]], [[1, 2], []], [[float(i) for i in range(1, 21)], [float(i) + 0.5 for i in range(1, 21)]],
                           [[1, "NaN"], [2, 3]], [[1, "Infinity"], [2, 3]]]))

# ---------------------------------------------------------------- waldWolfowitzRunsExactP


def runs_of(seq):
    return 1 + sum(1 for i in range(1, len(seq)) if seq[i] != seq[i - 1])


def ww_dist(n1, n0):
    out = {}
    for r in range(2, n1 + n0 + 1):
        if r % 2 == 0:
            k = r // 2
            c = 2 * C(n1 - 1, k - 1) * C(n0 - 1, k - 1)
        else:
            k = (r - 1) // 2
            c = C(n1 - 1, k - 1) * C(n0 - 1, k) + C(n1 - 1, k) * C(n0 - 1, k - 1)
        if c:
            out[r] = F(c, comb(n1 + n0, n1))
    assert sum(out.values()) == 1
    return out


def ww_p(seq):
    n1 = sum(seq)
    n0 = len(seq) - n1
    dist = ww_dist(n1, n0)
    pr = dist[runs_of(seq)]
    total = F(0)
    for r, p in dist.items():
        well_separated(p / pr)
        if p <= pr * SLACK:
            total += p
    return min(total, F(1)), runs_of(seq)


def ww_alt(seq):
    """The distribution of runs from a dynamic program over sequences (and brute force for short ones)."""
    n1 = sum(seq)
    n0 = len(seq) - n1
    dp = {(1, 0, 1): 1, (0, 1, 0): 1}  # (ones used, zeros used, last symbol) -> {runs: count}
    states = {(1, 0, 1): {1: 1}, (0, 1, 0): {1: 1}}
    for _ in range(n1 + n0 - 1):
        nxt = {}
        for (o, z, last), rd in states.items():
            for sym in (0, 1):
                o2, z2 = o + (sym == 1), z + (sym == 0)
                if o2 > n1 or z2 > n0:
                    continue
                tgt = nxt.setdefault((o2, z2, sym), {})
                for r, c in rd.items():
                    r2 = r + (sym != last)
                    tgt[r2] = tgt.get(r2, 0) + c
        states = nxt
    counts = {}
    for (o, z, last), rd in states.items():
        if o == n1 and z == n0:
            for r, c in rd.items():
                counts[r] = counts.get(r, 0) + c
    total = comb(n1 + n0, n1)
    assert sum(counts.values()) == total
    dist = {r: F(c, total) for r, c in counts.items()}
    assert dist == ww_dist(n1, n0)
    if len(seq) <= 14:
        bf = {}
        for ones in itertools.combinations(range(len(seq)), n1):
            s = [1 if i in ones else 0 for i in range(len(seq))]
            bf[runs_of(s)] = bf.get(runs_of(s), 0) + 1
        assert bf == counts
    pr = dist[runs_of(seq)]
    return min(F(1), 1 - sum(p for p in dist.values() if not p <= pr * SLACK))


ww_cases = [
    [0, 0, 0, 1, 1, 1],
    [0, 1, 0, 1, 0, 1, 0, 1],
    [0, 1],
    [1, 1, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1],
    [1, 0, 0],
    [1, 1, 0, 0, 1, 1, 0, 0, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1],
    [0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 1, 0, 0, 1],
]
ww_values = []
for s in ww_cases:
    p, r = ww_p(s)
    assert p == ww_alt(s)
    say("waldWolfowitzRunsExactP", s, p)
    ww_values.append(case([s], p))
functions.append(function("waldWolfowitzRunsExactP", "nonparametric", doc("waldWolfowitzRunsExactP"), ww_values,
                          [[[1, 1, 1]], [[0, 0]], [[1]], [[0, 2, 1]], [[0, 0.5, 1]], [[i % 2 for i in range(401)]]]))

# ---------------------------------------------------------------- kruskalWallisH


def kw_h(groups):
    flat = [x for g in groups for x in g]
    N = len(flat)
    rk = ranks(flat)
    R, pos = [], 0
    for g in groups:
        R.append(sum(rk[pos:pos + len(g)]))
        pos += len(g)
    ties = F(0)
    for v in set(flat):
        t = flat.count(v)
        ties += t**3 - t
    C_ = 1 - ties / (N**3 - N)
    H = (F(12, N * (N + 1)) * sum(r * r / len(g) for r, g in zip(R, groups)) - 3 * (N + 1)) / C_
    return H


def kw_alt(groups):
    flat = [x for g in groups for x in g]
    N = len(flat)
    rk = ranks(flat)
    mid = F(N + 1, 2)
    sst = sum((r - mid) ** 2 for r in rk)
    ssb, pos = F(0), 0
    for g in groups:
        rbar = sum(rk[pos:pos + len(g)]) / len(g)
        ssb += len(g) * (rbar - mid) ** 2
        pos += len(g)
    return (N - 1) * ssb / sst


kw_cases = [
    [[27, 2, 4, 18, 7, 9], [20, 8, 14, 36, 21, 22], [34, 31, 3, 23, 30, 6]],
    [[1, 2, 2], [2, 3, 4], [5, 5, 6, 7]],
    [[1], [2]],
    [[0.82, 0.74, 0.91, 0.88, 0.79], [0.65, 0.71, 0.69, 0.77, 0.73, 0.70], [0.55, 0.62, 0.58, 0.66]],
    [[3, 3, 3], [3, 3, 4]],
    [[5, 9, 7], [5, 9, 7], [5, 9, 7], [5, 9, 8]],
    [[10, 12], [11], [9, 13, 14, 8, 15]],
    [[4.5, 4.5, 4.5, 6], [4.5, 6, 6], [6, 7.5, 7.5, 7.5, 9]],
]
kw_values = []
for g in kw_cases:
    h = kw_h(g)
    assert h == kw_alt(g)
    say("kruskalWallisH", g, h)
    kw_values.append(case([g], h))
functions.append(function("kruskalWallisH", "rank-tests", doc("kruskalWallisH"), kw_values,
                          [[[[1, 2, 3]]], [[[1, 2], []]], [[[2, 2], [2, 2, 2]]], [[]], [[[1, 2], [3, "NaN"]]]]))

# ---------------------------------------------------------------- friedmanStatistic


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


def fr_alt(M):
    b, k = len(M), len(M[0])
    R = [sum(ranks(row)[j] for row in M) for j in range(k)]
    mid = F(k + 1, 2)
    sst = sum((r - mid) ** 2 for row in M for r in ranks(row))
    ssb = sum((Rj - b * mid) ** 2 for Rj in R)
    return (k - 1) * ssb / sst


fr_cases = [
    [[1, 2, 3], [2, 1, 3], [1, 3, 2], [1, 2, 3]],
    [[5.1, 4.8, 6.0], [4.9, 4.9, 5.5], [6.2, 5.0, 5.0], [5.5, 5.5, 5.5]],
    [[3, 1, 2]],
    [[10, 20], [30, 25], [5, 6], [8, 7], [3, 9]],
    [[0.81, 0.77, 0.74, 0.69], [0.84, 0.80, 0.75, 0.72], [0.79, 0.81, 0.70, 0.71], [0.88, 0.83, 0.78, 0.73],
     [0.82, 0.79, 0.76, 0.76], [0.85, 0.82, 0.77, 0.70]],
    [[1, 1, 2], [3, 3, 3], [2, 1, 2]],
    [[4, 2], [4, 2], [4, 2], [4, 2]],
    [[7, 3, 5, 9, 1], [2, 8, 6, 4, 10], [5, 5, 3, 3, 1], [9, 7, 8, 6, 2], [1, 2, 3, 4, 5]],
]
fr_values = []
for M in fr_cases:
    q = fr_q(M)
    assert q == fr_alt(M)
    say("friedmanStatistic", M, q)
    fr_values.append(case([M], q))
functions.append(function("friedmanStatistic", "rank-tests", doc("friedmanStatistic"), fr_values,
                          [[[]], [[[1], [2]]], [[[1, 2], [3]]], [[[2, 2, 2], [5, 5, 5]]], [[[1, 2], [3, "NaN"]]]]))

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

# ---------------------------------------------------------------- chiSquareIndependenceStatistic


def chi_ind(counts):
    r, c = len(counts), len(counts[0])
    n = sum(sum(row) for row in counts)
    R = [sum(row) for row in counts]
    Cj = [sum(row[j] for row in counts) for j in range(c)]
    stat = F(0)
    for i in range(r):
        for j in range(c):
            E = F(R[i] * Cj[j], n)
            stat += (counts[i][j] - E) ** 2 / E
    return stat, (r - 1) * (c - 1)


def chi_ind_alt(counts):
    r, c = len(counts), len(counts[0])
    n = sum(sum(row) for row in counts)
    R = [sum(row) for row in counts]
    Cj = [sum(row[j] for row in counts) for j in range(c)]
    return sum(F(counts[i][j] ** 2 * n, R[i] * Cj[j]) for i in range(r) for j in range(c)) - n


ci_cases = [
    [[10, 20], [30, 40]],
    [[20, 15, 10], [10, 25, 30], [5, 12, 40]],
    [[10, 20], [30, 50]],
    [[0, 8], [5, 7]],
    [[12, 18, 25, 9], [20, 11, 14, 22]],
    [[3, 0, 7], [2, 6, 1]],
    [[50, 30], [20, 40], [10, 35]],
    [[1, 2], [2, 1]],
]
ci_values = []
for m in ci_cases:
    s, df = chi_ind(m)
    assert s == chi_ind_alt(m)
    say("chiSquareIndependenceStatistic", m, s)
    ci_values.append(case([m], {"statistic": s, "df": df}))
functions.append(function("chiSquareIndependenceStatistic", "tables", doc("chiSquareIndependenceStatistic"), ci_values,
                          [[[[1, 2]]], [[[1], [2]]], [[[0, 0], [3, 4]]], [[[0, 3], [0, 4]]], [[[1, 2], [3]]],
                           [[[1, -2], [3, 4]]], [[[1, 2.5], [3, 4]]]]))

# ---------------------------------------------------------------- chiSquareGoodnessOfFitStatistic and gTestStatistic


def expected_of(obs, props):
    n = sum(obs)
    p = [frac(x) for x in props]
    S = sum(p)
    return n, [n * x / S for x in p]


def chi_gof(obs, props):
    n, E = expected_of(obs, props)
    return sum((o - e) ** 2 / e for o, e in zip(obs, E)), len(obs) - 1


def chi_gof_alt(obs, props):
    n, E = expected_of(obs, props)
    assert sum(E) == n
    return sum(F(o * o) / e for o, e in zip(obs, E)) - n


def g_stat(obs, props):
    n, E = expected_of(obs, props)
    return 2 * sum(dec(o) * ln(dec(F(o) / e)) for o, e in zip(obs, E) if o > 0), len(obs) - 1


def g_alt(obs, props):
    n = sum(obs)
    p = [frac(x) for x in props]
    S = sum(p)
    half = sum(dec(o) * ln(dec(o)) for o in obs if o > 0) - dec(n) * ln(dec(n)) \
        - sum(dec(o) * (ln(dec(pi)) - ln(dec(S))) for o, pi in zip(obs, p) if o > 0)
    return 2 * half


gof_cases = [
    ([18, 22, 20, 40], [0.25, 0.25, 0.25, 0.25]),
    ([10, 20, 30], [0.2, 0.3, 0.5]),
    ([26, 24], [0.5, 0.5]),
    ([0, 12, 8, 0, 5], [0.1, 0.4, 0.3, 0.1, 0.1]),
    ([47, 53], [0.4, 0.6]),
    ([5, 9, 14, 30, 22], [0.05, 0.1, 0.2, 0.4, 0.25]),
    ([1, 0], [0.75, 0.25]),
    ([30, 14, 6], [0.5, 0.3, 0.2]),
]
gof_values, g_values = [], []
for o, pr in gof_cases:
    s, df = chi_gof(o, pr)
    assert s == chi_gof_alt(o, pr)
    say("chiSquareGoodnessOfFitStatistic", (o, pr), s)
    gof_values.append(case([o, pr], {"statistic": s, "df": df}))
g_cases = [c for c in gof_cases if c[0] != [26, 24]] + [([13, 17, 20], [0.3, 0.3, 0.4])]
for o, pr in g_cases:
    g, df = g_stat(o, pr)
    close(g, g_alt(o, pr), rel=1e-25)
    say("gTestStatistic", (o, pr), g)
    g_values.append(case([o, pr], {"statistic": g, "df": df}))
common_bad = [[[5, 5], [0.5]], [[5, 5], [0.5, 0.0]], [[5, 5], [0.6, 0.6]], [[0, 0], [0.5, 0.5]], [[5], [1]],
              [[5, -1], [0.5, 0.5]], [[5, 2.5], [0.5, 0.5]], [[5, 5], [0.5, "NaN"]], [[5, 5], [0.5, 1.5]]]
functions.append(function("chiSquareGoodnessOfFitStatistic", "tables", doc("chiSquareGoodnessOfFitStatistic"), gof_values,
                          common_bad))
functions.append(function("gTestStatistic", "tables", doc("gTestStatistic"), g_values, common_bad))

write(GROUP, "Exact rational arithmetic (fractions) for every enumerated p-value and exact statistic; Decimal at 120 digits "
      "for exp, ln and lgamma. Each value is cross-checked by a second method inside make_newcaps_exacttests.py.", functions)
