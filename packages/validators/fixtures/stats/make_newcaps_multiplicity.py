"""Reference values for the multiplicity group: adjustments of p-values, Storey's estimates, error-rate formulas
and the combination of p-values. Every value is computed with exact rational arithmetic (Fraction) where the
function is rational, and with 120-digit Decimal where it needs ln, exp or sqrt, then cross-checked a second way.
Run: PYTHONDONTWRITEBYTECODE=1 python3 make_newcaps_multiplicity.py
"""

import os
import random
import sys
from itertools import combinations

sys.path.insert(0, os.path.dirname(__file__))
from ref_common import *  # noqa: E402,F401,F403

GROUP = "multiplicity"
DOC = "docs/statistics/multiplicity.md#"
functions = []
SHOW = "--show" in sys.argv


def order_of(ps):
    return sorted(range(len(ps)), key=lambda i: ps[i])


def unsort(sorted_vals, order):
    out = [None] * len(order)
    for pos, i in enumerate(order):
        out[i] = sorted_vals[pos]
    return out


def sorted_fracs(ps):
    o = order_of(ps)
    return o, [F(ps[i]) for i in o]


def check_lists(a, b):
    assert len(a) == len(b)
    for x, y in zip(a, b):
        close(x, y)


def build(fn, module, impl, alt, inputs, domain, tol=None, list_result=True):
    """inputs: lists of positional args. Each is computed by impl and cross-checked by alt."""
    cases = []
    for args in inputs:
        a = impl(*args)
        b = alt(*args)
        if list_result:
            check_lists(a, b)
        elif isinstance(a, dict):
            for k in a:
                close(a[k], b[k])
        else:
            close(a, b)
        cases.append(case(list(args), a))
        if SHOW:
            print(fn, args, "->", [num(x) for x in a] if list_result else num(a))
    functions.append(function(fn, module, DOC + fn.lower(), cases, domain, tol))
    return cases


P_DOMAIN = [[[]], [[0.1, "NaN"]], [[0.5, 1.5]], [[-0.1, 0.2]], [[0.5, "Infinity"]]]

# A realistic family: ten criteria of a regression comparison, unsorted, with a tie.
REAL10 = [0.039, 0.001, 0.205, 0.042, 0.008, 0.212, 0.041, 0.074, 0.06, 0.216]
REAL6 = [0.012, 0.3, 0.049, 0.0004, 0.049, 0.51]
TIES = [0.04, 0.01, 0.04, 0.04, 0.2]
ADJ_INPUTS = [
    [[0.03]],
    [[0.3, 0.3, 0.3]],
    [[0.01, 0.04]],
    [[0.04, 0.01]],
    [[0.0, 0.5, 1.0]],
    [[1.0, 1.0]],
    [TIES],
    [REAL6],
    [REAL10],
    [[0.00000003, 0.2, 0.0004]],
]

# ---------------------------------------------------------------- adjust


def bonf(ps):
    m = len(ps)
    return [min(F(1), m * F(x)) for x in ps]


def bonf_alt(ps):
    m = len(ps)
    return [min(F(1), sum(F(x) for _ in range(m))) for x in ps]


def sidak(ps):
    m = len(ps)
    return [1 - (1 - F(x)) ** m for x in ps]


def sidak_alt(ps):
    m = len(ps)
    out = []
    for x in ps:
        x = F(x)
        out.append(D(1) if x == 1 else 1 - (dec(m) * dec(1 - x).ln()).exp())
    return out


def holm_sidak(ps):
    m = len(ps)
    o, s = sorted_fracs(ps)
    cur, out = F(0), []
    for j in range(m):
        cur = max(cur, 1 - (1 - s[j]) ** (m - j))
        out.append(cur)
    return unsort(out, o)


def holm_sidak_alt(ps):
    m = len(ps)
    o, s = sorted_fracs(ps)
    cands = sorted({F(1)} | {1 - (1 - s[j]) ** (m - j) for j in range(m)})
    out = []
    for i in range(m):
        out.append(min(a for a in cands if all((1 - s[j]) ** (m - j) >= 1 - a for j in range(i + 1))))
    return unsort(out, o)


def holm_bonf(ps):
    m = len(ps)
    o, s = sorted_fracs(ps)
    cur, out = F(0), []
    for j in range(m):
        cur = max(cur, min(F(1), (m - j) * s[j]))
        out.append(cur)
    return unsort(out, o)


def hochberg(ps):
    m = len(ps)
    o, s = sorted_fracs(ps)
    cur, out = F(1), [None] * m
    for j in range(m - 1, -1, -1):
        cur = min(cur, (m - j) * s[j])
        out[j] = cur
    return unsort(out, o)


def hochberg_alt(ps):
    m = len(ps)
    o, s = sorted_fracs(ps)
    out = []
    for i in range(m):
        cands = [F(1)] + [min(F(1), (m - j) * s[j]) for j in range(i, m)]
        out.append(min(a for a in cands if any((m - j) * s[j] <= a for j in range(i, m)) or a == 1))
    return unsort(out, o)


def hommel(ps):
    n = len(ps)
    o, s = sorted_fracs(ps)
    p = [None] + s
    c0 = min(n * p[i] / i for i in range(1, n + 1))
    q = [None] + [c0] * n
    pa = [None] + [c0] * n
    for k in range(n - 1, 1, -1):
        t = n - k + 1
        u = min(k * p[j] / (j - t + 1) for j in range(t + 1, n + 1))
        for i in range(1, t + 1):
            q[i] = min(k * p[i], u)
        for i in range(t + 1, n + 1):
            q[i] = q[t]
        for i in range(1, n + 1):
            pa[i] = max(pa[i], q[i])
    return unsort([max(pa[i], p[i]) for i in range(1, n + 1)], o)


def simes_set(vals):
    s = sorted(vals)
    return min(len(s) * s[i] / (i + 1) for i in range(len(s)))


def hommel_brute(ps):
    m = len(ps)
    f = [F(x) for x in ps]
    out = []
    for i in range(m):
        others = [j for j in range(m) if j != i]
        best = F(0)
        for r in range(m):
            for sub in combinations(others, r):
                best = max(best, simes_set([f[i]] + [f[j] for j in sub]))
        out.append(best)
    return out


def by(ps):
    m = len(ps)
    c = sum(F(1, k) for k in range(1, m + 1))
    o, s = sorted_fracs(ps)
    cur, out = F(1), [None] * m
    for j in range(m - 1, -1, -1):
        cur = min(cur, m * c * s[j] / (j + 1))
        out[j] = cur
    return unsort(out, o)


def by_alt(ps):
    m = len(ps)
    c = sum(F(1, k) for k in range(1, m + 1))
    out = []
    for x in ps:
        x = F(x)
        out.append(
            min(
                [F(1)]
                + [m * c * F(y) / sum(1 for z in ps if F(z) <= F(y)) for y in ps if F(y) >= x]
            )
        )
    return out


# Fuzz: the step algorithm of hommelAdjust equals closed testing with Simes' test, ties included.
rng = random.Random(20260101)
for _ in range(400):
    n = rng.randint(1, 7)
    pool = [0.0, 0.001, 0.01, 0.02, 0.02, 0.05, 0.05, 0.2, 0.5, 0.9, 1.0]
    ps = [rng.choice(pool) if rng.random() < 0.5 else round(rng.random(), 3) for _ in range(n)]
    assert hommel(ps) == hommel_brute(ps), ps
    h, hb, hs = hommel(ps), hochberg(ps), holm_bonf(ps)
    assert all(a <= b <= c for a, b, c in zip(h, hb, hs)), ps
    # tied inputs get equal outputs for every ordered procedure
    for fnc in (hommel, hochberg, holm_sidak, by, holm_bonf):
        r = fnc(ps)
        for i in range(n):
            for j in range(n):
                if ps[i] == ps[j]:
                    assert r[i] == r[j]

build("bonferroniAdjust", "adjust", bonf, bonf_alt, ADJ_INPUTS, P_DOMAIN)
build("sidakAdjust", "adjust", sidak, sidak_alt, ADJ_INPUTS, P_DOMAIN)
build("holmSidakAdjust", "adjust", holm_sidak, holm_sidak_alt, ADJ_INPUTS, P_DOMAIN)
build("hochbergAdjust", "adjust", hochberg, hochberg_alt, ADJ_INPUTS, P_DOMAIN)
build("hommelAdjust", "adjust", hommel, hommel_brute,
      [i for i in ADJ_INPUTS if len(i[0]) <= 10] + [[[0.9, 0.04, 0.5, 0.012, 0.012, 0.3]]],
      P_DOMAIN)
build("benjaminiYekutieliAdjust", "adjust", by, by_alt, ADJ_INPUTS, P_DOMAIN)

# Ordering facts that the page states, asserted on the cases.
for inp in ADJ_INPUTS:
    ps = inp[0]
    h, hb, hs, hsd, bo = hommel(ps), hochberg(ps), holm_bonf(ps), holm_sidak(ps), bonf(ps)
    assert all(a <= b <= c <= d for a, b, c, d in zip(h, hb, hs, bo))
    assert all(a <= b for a, b in zip(hsd, hs))

# ---------------------------------------------------------------- storey


def pi0(ps, lam):
    lam = F(lam)
    cnt = sum(1 for x in ps if F(x) > lam)
    return min(F(1), F(cnt) / (len(ps) * (1 - lam)))


def pi0_alt(ps, lam):
    lam = F(lam)
    cnt = len(ps) - sum(1 for x in ps if F(x) <= lam)
    return min(F(1), F(cnt, len(ps)) / (1 - lam))


def qvals(ps, lam):
    m = len(ps)
    pi = pi0(ps, lam)
    o, s = sorted_fracs(ps)
    out, cur = [None] * m, None
    for j in range(m - 1, -1, -1):
        v = pi * m * s[j] / (j + 1)
        cur = v if cur is None else min(cur, v)
        out[j] = cur
    return unsort(out, o)


def qvals_alt(ps, lam):
    m = len(ps)
    pi = pi0_alt(ps, lam)
    out = []
    for x in ps:
        x = F(x)
        out.append(min(pi * m * F(y) / sum(1 for z in ps if F(z) <= F(y)) for y in ps if F(y) >= x))
    return out


REAL20 = [0.0002, 0.0011, 0.003, 0.012, 0.021, 0.034, 0.049, 0.083, 0.14, 0.22,
          0.31, 0.37, 0.46, 0.52, 0.61, 0.68, 0.74, 0.83, 0.91, 0.97]
SHUF20 = [REAL20[i] for i in (7, 0, 13, 3, 19, 5, 11, 1, 16, 9, 2, 18, 14, 6, 10, 4, 17, 8, 15, 12)]

PI_INPUTS = [
    [REAL20, 0.5],
    [SHUF20, 0.2],
    [[0.2, 0.5, 0.5, 0.7, 0.9], 0.5],
    [[0.01, 0.02, 0.03, 0.04], 0.5],
    [[0.6, 0.7, 0.8, 0.9, 0.95], 0.0],
    [[0.6, 0.7, 0.8, 0.9, 0.95], 0.1],
    [[0.5], 0.25],
    [[0.0, 0.3, 1.0, 0.6], 0.3],
]
PI_DOMAIN = [
    [[], 0.5],
    [[0.1, 0.2], 1],
    [[0.1, 0.2], -0.1],
    [[0.1, 0.2], "NaN"],
    [[0.1, 1.2], 0.5],
    [[0.1, 0.2], 1.5],
]
cases = []
for args in PI_INPUTS:
    a, b = pi0(*args), pi0_alt(*args)
    assert a == b
    cases.append(case(args, a))
    if SHOW:
        print("storeyPiZero", args, "->", num(a))
functions.append(function("storeyPiZero", "storey", DOC + "storeypizero", cases, PI_DOMAIN))

Q_INPUTS = [
    [REAL20, 0.5],
    [SHUF20, 0.2],
    [[0.2, 0.5, 0.5, 0.7, 0.9], 0.5],
    [[0.01, 0.02, 0.03, 0.04], 0.5],
    [[0.6, 0.7, 0.8, 0.9, 0.95], 0.0],
    [[0.04, 0.04, 0.3, 0.8, 0.9, 0.04], 0.5],
    [[0.5], 0.25],
    [[0.0, 0.3, 1.0, 0.6], 0.3],
]
build("storeyQValues", "storey", qvals, qvals_alt, Q_INPUTS, PI_DOMAIN)
for args in Q_INPUTS:
    assert all(0 <= x <= 1 for x in qvals(*args))

# ---------------------------------------------------------------- rates


def fwer(m, a):
    return 1 - (1 - F(a)) ** m


def fwer_alt(m, a):
    a = F(a)
    return sum(comb(m, k) * a**k * (1 - a) ** (m - k) for k in range(1, m + 1))


RATE_DOMAIN_ALPHA = [[3, 1.5], [3, "NaN"], [3, -0.01]]
build("familywiseErrorRate", "rates", fwer, fwer_alt,
      [[1, 0.05], [10, 0.05], [0, 0.05], [20, 0.01], [5, 0.0], [5, 1.0], [100, 0.001], [3, 0.5], [2, 1e-9]],
      [[-1, 0.05], [2.5, 0.05], ["Infinity", 0.05]] + RATE_DOMAIN_ALPHA, list_result=False)


def bonf_thr(m, a):
    return F(a) / m


def bonf_thr_alt(m, a):
    t = dec(F(a)) / dec(m)
    assert m * bonf_thr(m, a) == F(a)
    return t


def sidak_thr(m, a):
    a = F(a)
    return D(1) if a == 1 else 1 - (dec(1 - a).ln() / m).exp()


def sidak_thr_alt(m, a):
    t = sidak_thr(m, a)
    back = 1 - (1 - dec(t)) ** m
    close(back, dec(F(a)))
    assert t <= 1
    return sidak_thr(m, a)


RATE_INPUTS = [[10, 0.05], [1, 0.05], [3, 0.1], [7, 0.0], [4, 1.0], [50, 0.05], [2, 0.01], [1000, 0.05]]
BT_DOMAIN = [[0, 0.05], [-2, 0.05], [2.5, 0.05], [3, 1.5], [3, "NaN"]]
build("bonferroniThreshold", "rates", bonf_thr, bonf_thr_alt, RATE_INPUTS, BT_DOMAIN, list_result=False)
build("sidakThreshold", "rates", sidak_thr, sidak_thr_alt, RATE_INPUTS, BT_DOMAIN, list_result=False)
for m, a in RATE_INPUTS:
    assert dec(bonf_thr(m, a)) <= sidak_thr(m, a)

# ---------------------------------------------------------------- combine


def pz(x):
    return D(0) if x == 0 else x


def fisher(ps):
    return {"statistic": pz(-2 * sum(ln(dec(F(x))) for x in ps)), "df": 2 * len(ps)}


def fisher_alt(ps):
    prod = F(1)
    for x in ps:
        prod *= F(x)
    return {"statistic": pz(-2 * ln(dec(prod))), "df": 2 * len(ps)}


def build_obj(fn, module, impl, alt, inputs, domain):
    cases = []
    for args in inputs:
        a, b = impl(*args), alt(*args)
        assert a["df"] == b["df"] if "df" in a else True
        for k in a:
            close(a[k], b[k]) if k != "df" else None
        cases.append(case(list(args), a))
        if SHOW:
            print(fn, args, "->", {k: num(v) for k, v in a.items()})
    functions.append(function(fn, module, DOC + fn.lower(), cases, domain))


build_obj("fisherCombinedStatistic", "combine", fisher, fisher_alt,
          [[[0.05]], [[0.05, 0.01, 0.2]], [[1.0, 1.0, 1.0]], [[0.03, 0.2, 0.07, 0.45, 0.011]],
           [[1e-10, 0.5]], [[0.5, 0.5]], [[1.0, 0.25, 1.0]]],
          [[[]], [[0.5, 0.0]], [[0.5, 1.2]], [[0.5, "NaN"]], [[-0.1]]])


def tippett(ps):
    return 1 - (1 - F(min(ps))) ** len(ps)


def tippett_alt(ps):
    m, p = len(ps), F(min(ps))
    return sum(comb(m, k) * p**k * (1 - p) ** (m - k) for k in range(1, m + 1))


PV_DOMAIN = [[[]], [[0.5, -0.1]], [[0.5, 1.5]], [[0.5, "NaN"]], [[0.5, "Infinity"]]]
build("tippettMinPCombination", "combine", tippett, tippett_alt,
      [[[0.2, 0.5, 0.01]], [[0.04]], [[1.0, 1.0]], [[0.0, 0.3]], [[0.001, 0.5, 0.7, 0.9]],
       [[1e-9, 0.4, 0.4]], [[0.3, 0.3, 0.3, 0.3]]],
      PV_DOMAIN, list_result=False)


def simes(ps):
    m = len(ps)
    _, s = sorted_fracs(ps)
    return min(m * s[i] / (i + 1) for i in range(m))


def simes_alt(ps):
    m = len(ps)
    f = [F(x) for x in ps]
    cands = [m * f[j] / i for j in range(m) for i in range(1, m + 1)]
    ok = [a for a in cands if any(sum(1 for x in f if x <= i * a / m) >= i for i in range(1, m + 1))]
    return min(ok)


build("simesPValue", "combine", simes, simes_alt,
      [[[0.01, 0.04, 0.03, 0.2]], [[0.3, 0.3, 0.3]], [[0.5]], [[0.0, 0.5]], [[0.5, 0.9]],
       [[0.04, 0.04, 0.04, 0.9]], [[0.021, 0.3, 0.012, 0.6, 0.049, 0.45]], [[1.0, 1.0]]],
      PV_DOMAIN, list_result=False)


def harm(ps, ws=None):
    ws = [F(1)] * len(ps) if ws is None else [F(w) for w in ws]
    return sum(ws) / sum(w / F(p) for w, p in zip(ws, ps))


def harm_alt(ps, ws=None):
    ws = [F(1)] * len(ps) if ws is None else [F(w) for w in ws]
    tot = sum(ws)
    norm = [w / tot for w in ws]
    r = 1 / sum(w / F(p) for w, p in zip(norm, ps))
    assert r == harm(ps, ws)
    return 1 / (sum(dec(w) / dec(F(p)) for w, p in zip(norm, ps)))


HM_DOMAIN = [
    [[]],
    [[0.5, 0.0]],
    [[0.5, 0.0], [1, 1]],
    [[0.5, 1.2], [1, 1]],
    [[0.5, 0.2], [1]],
    [[0.5, 0.2], [1, 0]],
    [[0.5, 0.2], [1, -1]],
    [[0.5, 0.2], [1, "NaN"]],
]
build("harmonicMeanPValue", "combine", harm, harm_alt,
      [[[0.01, 0.04, 0.2]], [[0.01, 0.04, 0.2], [1, 1, 1]], [[0.01, 0.04, 0.2], [3, 2, 1]],
       [[0.03], [5]], [[1.0, 1.0], [2, 7]], [[0.2, 0.002], [10, 20]], [[0.2, 0.002], [0.1, 0.2]],
       [[0.02, 0.15, 0.4, 0.06, 0.8], [0.4, 0.1, 0.1, 0.3, 0.1]]],
      HM_DOMAIN, list_result=False)


def stouffer(zs, ws=None):
    ws = [F(1)] * len(zs) if ws is None else [F(w) for w in ws]
    num_ = sum(w * F(z) for w, z in zip(ws, zs))
    den2 = sum(w * w for w in ws)
    return dec(num_) / dec(den2).sqrt()


def stouffer_alt(zs, ws=None):
    ws = [F(1)] * len(zs) if ws is None else [F(w) for w in ws]
    num_ = sum(w * F(z) for w, z in zip(ws, zs))
    den2 = sum(w * w for w in ws)
    r = stouffer(zs, ws)
    close(r * r * dec(den2), dec(num_) ** 2)
    assert (r > 0) == (num_ > 0) and (r < 0) == (num_ < 0)
    return r


ST_DOMAIN = [
    [[]],
    [[1, "NaN"]],
    [["Infinity", 1]],
    [[1, 2], [1]],
    [[1, 2], [1, 0]],
    [[1, 2], [1, -1]],
    [[1, 2], [1, "Infinity"]],
]
build("stoufferCombinedZ", "combine", stouffer, stouffer_alt,
      [[[1.64, 2.1, -0.3]], [[1.64, 2.1, -0.3], [12, 30, 8]], [[2.5], [7]], [[1.5, -1.5]],
       [[0.5, 1.0], [3, 4]], [[-1.2, -0.8, -2.2, -0.1]], [[1.96, 1.96, 1.96], [1, 1, 1]],
       [[1.1, 2.3, 0.7, 1.9], [20, 35, 10, 50]]],
      ST_DOMAIN, list_result=False)

write(
    GROUP,
    "Exact reference values for the multiplicity functions, computed with Fraction and 120-digit Decimal by "
    "make_newcaps_multiplicity.py and cross-checked a second way.",
    functions,
)
