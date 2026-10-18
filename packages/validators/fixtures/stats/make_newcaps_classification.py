"""Exact reference values for the group "classification" (docs/statistics/classification.md).

Run:  PYTHONDONTWRITEBYTECODE=1 python3 packages/validators/fixtures/stats/make_newcaps_classification.py

Standard library only. Every value is computed with Fractions (rational results) or 120-digit Decimals
(logarithms, square roots) and rounded once to a double. Every case is computed a second, different way and the two
are compared before the case is kept.
"""

import math
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(__file__))
from ref_common import *  # noqa: E402,F401,F403

DOC = "docs/statistics/classification.md"
functions = []


def add(fn, module, values, domain, tol=None):
    functions.append(function(fn, module, f"{DOC}#{fn.lower()}", values, domain, tol))


NAN, INF = "NaN", "Infinity"

# ===================================================================================================
# calibration
# ===================================================================================================


def brier_exact(p, o):
    return sum((F(a) - b) ** 2 for a, b in zip(p, o)) / len(p)


def brier_alt(p, o):
    # mean(p^2) - 2 mean(p o) + mean(o), since o^2 = o for an outcome 0 or 1
    n = len(p)
    return (sum(F(a) ** 2 for a in p) - 2 * sum(F(a) * b for a, b in zip(p, o)) + sum(o)) / n


cases = []
for p, o in [
    ([0.5], [1]),
    ([0.9, 0.8, 0.3, 0.6, 0.1, 0.75, 0.4, 0.95], [1, 1, 0, 1, 0, 0, 1, 1]),
    ([1.0, 0.0, 1.0, 0.0], [0, 1, 1, 0]),
    ([0.5, 0.5, 0.5, 0.5], [1, 0, 0, 1]),
    ([0.2, 0.2, 0.2, 0.2, 0.2], [0, 0, 1, 0, 0]),
    ([0.65, 0.35, 0.8, 0.15, 0.55, 0.45, 0.7, 0.25, 0.9, 0.05], [1, 0, 1, 0, 0, 1, 1, 0, 1, 0]),
]:
    a = brier_exact(p, o)
    close(a, brier_alt(p, o))
    cases.append(case([p, o], a))
add(
    "brierScore",
    "calibration",
    cases,
    [
        [[], []],
        [[0.5, 0.5], [1]],
        [[1.2], [1]],
        [[-0.1, 0.5], [1, 0]],
        [[NAN], [1]],
        [[0.5, 0.5], [1, 2]],
        [[0.5, 0.5], [1, 0.5]],
        [[0.5], [NAN]],
    ],
)


def logloss_exact(p, o):
    t = D(0)
    for a, b in zip(p, o):
        q = F(a) if b == 1 else 1 - F(a)
        t += ln(q)
    return -t / len(p)


def logloss_alt(p, o):
    # minus the logarithm of the product of the probabilities given to the outcomes that happened, over n
    prod = F(1)
    for a, b in zip(p, o):
        prod *= F(a) if b == 1 else 1 - F(a)
    return -ln(prod) / len(p)


cases = []
for p, o in [
    ([0.5], [1]),
    ([0.9, 0.8, 0.3, 0.6, 0.1, 0.75, 0.4, 0.95], [1, 1, 0, 1, 0, 0, 1, 1]),
    ([0.01, 0.99], [0, 0]),
    ([0.5, 0.5, 0.5, 0.5], [1, 0, 0, 1]),
    ([0.25], [0]),
    ([0.65, 0.35, 0.8, 0.15, 0.55, 0.45, 0.7, 0.25, 0.9, 0.05], [1, 0, 1, 0, 0, 1, 1, 0, 1, 0]),
]:
    a = logloss_exact(p, o)
    close(a, logloss_alt(p, o))
    # direct form with both terms present, o ln p + (1 - o) ln(1 - p)
    b = -sum(b_ * ln(F(a_)) + (1 - b_) * ln(1 - F(a_)) for a_, b_ in zip(p, o)) / len(p)
    close(a, b)
    cases.append(case([p, o], a))
add(
    "logLoss",
    "calibration",
    cases,
    [
        [[], []],
        [[0.5], [1, 0]],
        [[0.0], [0]],
        [[1.0], [1]],
        [[0.5, 1.0], [1, 1]],
        [[1.5], [1]],
        [[NAN], [1]],
        [[0.5], [3]],
    ],
)


def bins_float(p, bins):
    g = {}
    for i, x in enumerate(p):
        g.setdefault(min(math.floor(float(x) * bins), bins - 1), []).append(i)
    return g


def bins_interval(p, bins):
    g = {}
    for b in range(bins):
        lo, hi = F(b, bins), F(b + 1, bins)
        idx = [i for i, x in enumerate(p) if lo <= F(x) < hi or (b == bins - 1 and F(x) == 1)]
        if idx:
            g[b] = idx
    return g


def groups(p, bins):
    g = bins_float(p, bins)
    assert g == bins_interval(p, bins), "double binning and exact binning disagree: choose another input"
    return g


def gaps(p, o, bins):
    """For each non-empty bin: (share of the samples, |mean outcome - mean probability|)."""
    n = len(p)
    out = []
    for idx in groups(p, bins).values():
        mo = F(sum(o[i] for i in idx), len(idx))
        mp = sum(F(p[i]) for i in idx) / len(idx)
        out.append((F(len(idx), n), abs(mo - mp)))
    return out


def ece_exact(p, o, bins):
    return sum(s * g for s, g in gaps(p, o, bins))


def ece_alt(p, o, bins):
    # (1 / n) times the sum over bins of |sum of outcomes - sum of probabilities|, bins found by interval
    tot = F(0)
    for idx in bins_interval(p, bins).values():
        tot += abs(sum(o[i] for i in idx) - sum(F(p[i]) for i in idx))
    return tot / len(p)


def mce_exact(p, o, bins):
    return max(g for _, g in gaps(p, o, bins))


def mce_alt(p, o, bins):
    best = F(0)
    for idx in bins_interval(p, bins).values():
        best = max(best, abs(F(sum(o[i] for i in idx), len(idx)) - sum(F(p[i]) for i in idx) / len(idx)))
    return best


CAL = [
    # realistic: twelve forecasts, five bins
    ([0.92, 0.85, 0.77, 0.64, 0.58, 0.42, 0.35, 0.28, 0.15, 0.08, 0.71, 0.55], [1, 1, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0], 5),
    # one bin: |mean outcome - mean probability|
    ([0.9, 0.8, 0.3, 0.6, 0.1, 0.75, 0.4, 0.95], [1, 1, 0, 1, 0, 0, 1, 1], 1),
    # the value 1 in the last bin, the value 0 in the first, boundaries 0.25 and 0.5 start the upper bin
    ([1.0, 0.0, 0.25, 0.5, 0.75, 0.125, 0.875, 1.0], [1, 0, 0, 1, 1, 0, 1, 0], 4),
    # empty bins skipped: all values fall in two of ten bins
    ([0.31, 0.38, 0.33, 0.82, 0.85, 0.89], [0, 1, 0, 1, 1, 1], 10),
    # more bins than samples
    ([0.12, 0.47, 0.51, 0.66, 0.93, 0.28], [0, 1, 0, 1, 1, 1], 20),
    # a single sample
    ([0.8], [0], 3),
    # every probability equal
    ([0.6, 0.6, 0.6, 0.6, 0.6], [1, 0, 0, 1, 0], 4),
]
cases = []
for p, o, bins in CAL:
    a = ece_exact(p, o, bins)
    close(a, ece_alt(p, o, bins))
    assert a != 0
    cases.append(case([p, o, bins], a))
CAL_DOMAIN = [
    [[], [], 5],
    [[0.5, 0.5], [1], 5],
    [[0.5], [1], 0],
    [[0.5], [1], 2.5],
    [[0.5], [1], -3],
    [[1.5], [1], 5],
    [[0.5], [2], 5],
    [[NAN], [1], 5],
    [[0.5], [1], NAN],
]
add("expectedCalibrationError", "calibration", cases, CAL_DOMAIN)

cases = []
for p, o, bins in CAL:
    a = mce_exact(p, o, bins)
    close(a, mce_alt(p, o, bins))
    assert a != 0
    cases.append(case([p, o, bins], a))
add("maximumCalibrationError", "calibration", cases, CAL_DOMAIN)

# ===================================================================================================
# ranking
# ===================================================================================================


def auc_pairs(s, l):
    pos = [F(x) for x, y in zip(s, l) if y == 1]
    neg = [F(x) for x, y in zip(s, l) if y == 0]
    u = F(0)
    for a in pos:
        for b in neg:
            u += 1 if a > b else (F(1, 2) if a == b else 0)
    return u / (len(pos) * len(neg))


def auc_rank(s, l):
    r = ranks([F(x) for x in s])
    P = sum(l)
    N = len(l) - P
    return (sum(rr for rr, y in zip(r, l) if y == 1) - F(P * (P + 1), 2)) / (P * N)


cases = []
for s, l in [
    ([0.1, 0.4, 0.35, 0.8], [0, 0, 1, 1]),
    ([0.2, 0.2, 0.2, 0.2], [1, 0, 1, 0]),
    ([0.9, 0.8, 0.2, 0.1], [0, 0, 1, 1]),
    ([0.3, 0.7], [0, 1]),
    ([0.95, 0.9, 0.9, 0.8, 0.8, 0.8, 0.6, 0.5, 0.5, 0.3, 0.2, 0.1], [1, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0]),
    ([-1.5, 2.25, 0.0, 2.25, -0.5, 1.0], [0, 1, 1, 0, 0, 1]),
    ([4, 1, 3, 2, 5], [1, 0, 0, 1, 1]),
]:
    a = auc_pairs(s, l)
    assert a == auc_rank(s, l)
    cases.append(case([s, l], a))
add(
    "aucRoc",
    "classification",
    cases,
    [
        [[], []],
        [[0.5, 0.6], [1]],
        [[0.5, 0.6, 0.7], [1, 1, 1]],
        [[0.5, 0.6, 0.7], [0, 0, 0]],
        [[0.5, 0.6], [1, 2]],
        [[0.5, 0.6], [1, 0.5]],
        [[NAN, 0.6], [1, 0]],
        [[INF, 0.6], [1, 0]],
    ],
)


def ap_blocks(s, l):
    tp = k = 0
    tot = F(0)
    for v in sorted(set(s), reverse=True):
        idx = [i for i, x in enumerate(s) if x == v]
        pb = sum(l[i] for i in idx)
        k += len(idx)
        tp += pb
        tot += pb * F(tp, k)
    return tot / sum(l)


def ap_alt(s, l):
    # for each positive: the share of positives among the items scoring at least as high
    tot = F(0)
    for x, y in zip(s, l):
        if y == 1:
            ge = [j for j in range(len(s)) if s[j] >= x]
            tot += F(sum(l[j] for j in ge), len(ge))
    return tot / sum(l)


cases = []
for s, l in [
    ([0.9, 0.8, 0.7, 0.6], [1, 0, 1, 0]),
    ([0.5, 0.5, 0.5, 0.2], [1, 0, 1, 0]),
    ([0.3, 0.9, 0.5], [1, 1, 1]),
    ([0.4, 0.4, 0.4, 0.4, 0.4], [1, 0, 0, 0, 0]),
    ([0.9, 0.8, 0.7, 0.6, 0.5], [0, 0, 0, 0, 1]),
    ([0.1, 0.95, 0.4, 0.8, 0.8, 0.35, 0.6, 0.6, 0.2, 0.75, 0.05, 0.5], [0, 1, 0, 1, 0, 1, 1, 0, 0, 1, 0, 0]),
    ([2, 7, 7, 3, 9, 1], [0, 1, 0, 1, 1, 0]),
]:
    a = ap_blocks(s, l)
    close(a, ap_alt(s, l))
    cases.append(case([s, l], a))
add(
    "averagePrecision",
    "classification",
    cases,
    [
        [[], []],
        [[0.5, 0.6], [0, 0]],
        [[0.5, 0.6], [1]],
        [[0.5, 0.6], [1, 2]],
        [[NAN, 0.6], [1, 0]],
        [["-Infinity", 0.6], [1, 0]],
    ],
)

# ===================================================================================================
# confusion table
# ===================================================================================================


def T(tp, fp, fn, tn):
    return {"tp": tp, "fp": fp, "fn": fn, "tn": tn}


def mcc_exact(t):
    tp, fp, fn, tn = t["tp"], t["fp"], t["fn"], t["tn"]
    den2 = (tp + fp) * (tp + fn) * (tn + fp) * (tn + fn)
    if den2 == 0:
        return F(0)
    return dec(tp * tn - fp * fn) / sqrt(den2)


def mcc_alt(t):
    # sign times the square root of informedness times markedness
    tp, fp, fn, tn = t["tp"], t["fp"], t["fn"], t["tn"]
    if min(tp + fp, tp + fn, tn + fp, tn + fn) == 0:
        return F(0)
    J = F(tp, tp + fn) + F(tn, tn + fp) - 1
    M = F(tp, tp + fp) + F(tn, tn + fn) - 1
    sign = (tp * tn - fp * fn > 0) - (tp * tn - fp * fn < 0)
    assert J * M >= 0
    return sign * sqrt(J * M)


MCC_TABLES = [
    T(40, 10, 5, 45),
    T(5, 0, 0, 5),
    T(0, 5, 5, 0),
    T(0, 0, 3, 7),
    T(0, 0, 0, 0),
    T(12, 7, 9, 4),
    T(1, 0, 9, 90),
    T(50, 20, 80, 150),
]
cases = []
for t in MCC_TABLES:
    a = mcc_exact(t)
    close(a, mcc_alt(t))
    cases.append(case([t], a))
TABLE_DOMAIN = [
    [T(-1, 2, 3, 4)],
    [T(1.5, 2, 3, 4)],
    [T(1, 2, 3, NAN)],
    [T(1, INF, 3, 4)],
    [{"tp": 1, "fp": 2, "fn": 3}],
]
add("matthewsCorrelation", "classification", cases, TABLE_DOMAIN)


def ba_exact(t):
    return (F(t["tp"], t["tp"] + t["fn"]) + F(t["tn"], t["tn"] + t["fp"])) / 2


def ba_alt(t):
    # 1/2 (1 + true positive rate - false positive rate)
    return (1 + F(t["tp"], t["tp"] + t["fn"]) - F(t["fp"], t["fp"] + t["tn"])) / 2


BA_TABLES = [T(40, 10, 5, 45), T(1, 0, 9, 90), T(5, 0, 0, 5), T(0, 5, 5, 0), T(3, 0, 0, 7), T(12, 7, 9, 4), T(8, 30, 2, 60)]
cases = []
for t in BA_TABLES:
    a = ba_exact(t)
    close(a, ba_alt(t))
    cases.append(case([t], a))
add(
    "balancedAccuracy",
    "classification",
    cases,
    TABLE_DOMAIN
    + [
        [T(0, 3, 0, 4)],
        [T(2, 0, 3, 0)],
        [T(0, 0, 0, 0)],
    ],
)


def youden_exact(t):
    return F(t["tp"], t["tp"] + t["fn"]) + F(t["tn"], t["tn"] + t["fp"]) - 1


def youden_alt(t):
    # the determinant of the table over the product of the two true-class totals
    tp, fp, fn, tn = t["tp"], t["fp"], t["fn"], t["tn"]
    return F(tp * tn - fp * fn, (tp + fn) * (tn + fp))


cases = []
for t in [T(40, 10, 5, 45), T(1, 0, 9, 90), T(5, 0, 0, 5), T(0, 5, 5, 0), T(3, 0, 0, 7), T(12, 7, 9, 4), T(8, 30, 2, 60)]:
    a = youden_exact(t)
    assert a == youden_alt(t)
    cases.append(case([t], a))
add(
    "youdenIndex",
    "classification",
    cases,
    TABLE_DOMAIN
    + [
        [T(0, 3, 0, 4)],
        [T(2, 0, 3, 0)],
        [T(0, 0, 0, 0)],
    ],
)


def markedness_exact(t):
    return F(t["tp"], t["tp"] + t["fp"]) + F(t["tn"], t["tn"] + t["fn"]) - 1


def markedness_alt(t):
    # the determinant of the table over the product of the two predicted-class totals
    tp, fp, fn, tn = t["tp"], t["fp"], t["fn"], t["tn"]
    return F(tp * tn - fp * fn, (tp + fp) * (fn + tn))


cases = []
for t in [T(40, 10, 5, 45), T(1, 0, 9, 90), T(5, 0, 0, 5), T(0, 5, 5, 0), T(12, 7, 9, 4), T(8, 30, 2, 60), T(0, 3, 0, 4)]:
    a = markedness_exact(t)
    assert a == markedness_alt(t)
    cases.append(case([t], a))
add(
    "markedness",
    "classification",
    cases,
    TABLE_DOMAIN
    + [
        [T(0, 0, 3, 7)],
        [T(3, 4, 0, 0)],
        [T(0, 0, 0, 0)],
    ],
)


def fb_exact(t, beta):
    b2 = F(beta) ** 2
    den = (1 + b2) * t["tp"] + b2 * t["fn"] + t["fp"]
    return F(0) if den == 0 else (1 + b2) * t["tp"] / den


def fb_alt(t, beta):
    # weighted harmonic mean of precision and recall
    b2 = F(beta) ** 2
    tp, fp, fn = t["tp"], t["fp"], t["fn"]
    if tp == 0:
        return F(0)
    P, R = F(tp, tp + fp), F(tp, tp + fn)
    return (1 + b2) * P * R / (b2 * P + R)


cases = []
for t, beta in [
    (T(40, 10, 5, 45), 1),
    (T(40, 10, 5, 45), 2),
    (T(40, 10, 5, 45), 0.5),
    (T(12, 7, 9, 4), 1.5),
    (T(0, 0, 0, 9), 1),
    (T(0, 4, 6, 3), 2),
    (T(5, 0, 0, 5), 0.25),
    (T(3, 8, 1, 20), 4),
]:
    a = fb_exact(t, beta)
    close(a, fb_alt(t, beta))
    cases.append(case([t, beta], a))
add(
    "fBeta",
    "classification",
    cases,
    [
        [T(1, 2, 3, 4), 0],
        [T(1, 2, 3, 4), -1],
        [T(1, 2, 3, 4), NAN],
        [T(1, 2, 3, 4), INF],
        [T(-1, 2, 3, 4), 1],
        [T(1, 2.5, 3, 4), 1],
        [{"tp": 1, "fp": 2, "tn": 4}, 1],
    ],
)


def pa_exact(a, b):
    return 100 * F(sum(1 for x, y in zip(a, b) if x == y), len(a))


def pa_alt(a, b):
    # the diagonal of the table of counts
    tab = Counter(zip(a, b))
    diag = sum(v for (x, y), v in tab.items() if x == y)
    return 100 - 100 * F(len(a) - diag, len(a))


cases = []
for a_, b_ in [
    ([1, 2, 3, 1], [1, 2, 2, 1]),
    ([1, 2, 3], [1, 2, 3]),
    ([1, 1, 2], [2, 2, 1]),
    ([4], [4]),
    ([0, 1, 2, 1, 0, 2, 1, 1, 0], [0, 1, 1, 1, 0, 2, 2, 1, 0]),
    ([0.5, 1.5, -2], [0.5, 2.5, -2]),
    ([1, 2, 3, 2, 1, 3, 3, 2, 1, 1, 2, 3, 3, 2, 1, 1, 2, 3, 2, 1], [1, 2, 3, 2, 2, 3, 1, 2, 1, 1, 2, 3, 3, 1, 1, 1, 2, 3, 2, 3]),
]:
    a = pa_exact(a_, b_)
    close(a, pa_alt(a_, b_))
    cases.append(case([a_, b_], a))
add(
    "percentAgreement",
    "classification",
    cases,
    [
        [[], []],
        [[1, 2], [1]],
        [[1, NAN], [1, 2]],
        [[1, 2], [1, INF]],
    ],
)

# ===================================================================================================
# agreement
# ===================================================================================================


def wk_exact(tab, kind):
    k = len(tab)
    n = sum(map(sum, tab))
    r = [sum(row) for row in tab]
    c = [sum(tab[i][j] for i in range(k)) for j in range(k)]
    w = (lambda i, j: abs(i - j)) if kind == "linear" else (lambda i, j: (i - j) ** 2)
    obs = sum(F(w(i, j) * tab[i][j]) for i in range(k) for j in range(k)) / n
    exp = sum(F(w(i, j) * r[i] * c[j]) for i in range(k) for j in range(k)) / n**2
    return F(1) if exp == 0 else 1 - obs / exp


def wk_alt(tab, kind):
    # expand the table to the two label lists; observed = mean weight over the n pairs, expected = mean weight over
    # all n x n pairs (item of rater A, item of rater B)
    k = len(tab)
    a, b = [], []
    for i in range(k):
        for j in range(k):
            a += [i] * tab[i][j]
            b += [j] * tab[i][j]
    n = len(a)
    w = (lambda i, j: abs(i - j)) if kind == "linear" else (lambda i, j: (i - j) ** 2)
    obs = F(sum(w(x, y) for x, y in zip(a, b)), n)
    exp = F(sum(w(x, y) for x in a for y in b), n * n)
    res = F(1) if exp == 0 else 1 - obs / exp
    if k >= 2:
        # agreement weights v = 1 - w / wmax: kappa = (sum v p - sum v e) / (1 - sum v e)
        wmax = (k - 1) if kind == "linear" else (k - 1) ** 2
        vp = 1 - obs / wmax
        ve = 1 - exp / wmax
        if ve != 1:
            assert res == (vp - ve) / (1 - ve)
    return res


WK = [
    ([[20, 5], [10, 15]], "linear"),
    ([[20, 5], [10, 15]], "quadratic"),
    ([[11, 3, 1], [2, 9, 4], [0, 3, 12]], "quadratic"),
    ([[11, 3, 1], [2, 9, 4], [0, 3, 12]], "linear"),
    ([[14, 4, 1, 0], [3, 12, 5, 1], [0, 4, 15, 6], [0, 1, 3, 9]], "linear"),
    ([[14, 4, 1, 0], [3, 12, 5, 1], [0, 4, 15, 6], [0, 1, 3, 9]], "quadratic"),
    ([[7]], "linear"),
    ([[0, 0, 0], [0, 9, 0], [0, 0, 0]], "quadratic"),
    ([[0, 5], [5, 0]], "linear"),
    ([[0, 0, 6], [0, 0, 0], [6, 0, 0]], "quadratic"),
]
cases = []
for tab, kind in WK:
    a = wk_exact(tab, kind)
    assert a == wk_alt(tab, kind)
    cases.append(case([tab, kind], a))
# the two weightings agree with Cohen's kappa on a 2 x 2 table
tab = [[20, 5], [10, 15]]
n = 50
po = F(35, n)
pe = F(25 * 30 + 25 * 20, n * n)
assert wk_exact(tab, "linear") == (po - pe) / (1 - pe)
add(
    "weightedKappa",
    "agreement",
    cases,
    [
        [[[1, 2], [3, 4]], "cubic"],
        [[[1, 2], [3, 4]], "Linear"],
        [[[1, 2], [3, 4]], 2],
        [[[1, 2, 3], [4, 5, 6]], "linear"],
        [[[1, 2], [3]], "linear"],
        [[], "linear"],
        [[[0, 0], [0, 0]], "quadratic"],
        [[[1, -2], [3, 4]], "linear"],
        [[[1, 2.5], [3, 4]], "linear"],
        [[[1, NAN], [3, 4]], "linear"],
    ],
)

LABELS = [
    ([1, 1, 2, 2, 3, 3, 1, 2], [1, 2, 2, 2, 3, 1, 1, 2]),
    ([1, 2, 3, 1], [1, 2, 3, 1]),
    ([5, 5, 5, 5], [5, 5, 5, 5]),
    ([0, 0, 1, 1], [1, 1, 0, 0]),
    ([0], [1]),
    ([-1, 0, 1, 1, 0, -1, 0, 1, 1, 0, 0, -1, 1, 0, 1], [-1, 0, 1, 0, 0, -1, 1, 1, 1, 0, -1, -1, 1, 0, 0]),
    ([1] * 18 + [2, 1], [1] * 18 + [1, 2]),
    ([1, 2, 1, 2], [1, 2, 1, 2]),
]


def scott_exact(a, b):
    n = len(a)
    po = F(sum(1 for x, y in zip(a, b) if x == y), n)
    pe = sum(F(v, 2 * n) ** 2 for v in (Counter(a) + Counter(b)).values())
    return F(1) if pe == 1 else (po - pe) / (1 - pe)


def scott_alt(a, b):
    # chance agreement = probability that two draws with replacement from the 2n pooled labels are equal
    pool = list(a) + list(b)
    m = len(pool)
    pe = F(sum(1 for x in pool for y in pool if x == y), m * m)
    po = 1 - F(sum(1 for x, y in zip(a, b) if x != y), len(a))
    return F(1) if pe == 1 else (po - pe) / (1 - pe)


cases = []
for a_, b_ in LABELS:
    a = scott_exact(a_, b_)
    assert a == scott_alt(a_, b_)
    cases.append(case([a_, b_], a))
LABEL_DOMAIN = [
    [[], []],
    [[1, 2], [1]],
    [[1, 1.5], [1, 2]],
    [[1, 2], [1, 2.5]],
    [[1, NAN], [1, 2]],
    [[1, 2], [INF, 2]],
]
add("scottPi", "agreement", cases, LABEL_DOMAIN)


def ac1_exact(a, b):
    n = len(a)
    cnt = Counter(a) + Counter(b)
    q = len(cnt)
    if q == 1:
        return F(1)
    po = F(sum(1 for x, y in zip(a, b) if x == y), n)
    pe = sum(F(v, 2 * n) * (1 - F(v, 2 * n)) for v in cnt.values()) / (q - 1)
    return (po - pe) / (1 - pe)


def ac1_alt(a, b):
    # pe = (1 - sum of squared shares) / (q - 1); for q = 2 it is 2 pi (1 - pi)
    n = len(a)
    cnt = Counter(a) + Counter(b)
    q = len(cnt)
    if q == 1:
        return F(1)
    shares = [F(v, 2 * n) for v in cnt.values()]
    pe = (1 - sum(s * s for s in shares)) / (q - 1)
    if q == 2:
        assert pe == 2 * shares[0] * (1 - shares[0])
    po = 1 - F(sum(1 for x, y in zip(a, b) if x != y), n)
    return (po - pe) / (1 - pe)


cases = []
for a_, b_ in LABELS:
    a = ac1_exact(a_, b_)
    assert a == ac1_alt(a_, b_)
    cases.append(case([a_, b_], a))
add("gwetAc1", "agreement", cases, LABEL_DOMAIN)


def fleiss_exact(m):
    N, k = len(m), len(m[0])
    n = sum(m[0])
    Pi = [F(sum(x * x for x in row) - n, n * (n - 1)) for row in m]
    Pbar = sum(Pi) / N
    pj = [F(sum(m[i][j] for i in range(N)), N * n) for j in range(k)]
    Pe = sum(p * p for p in pj)
    return F(1) if Pe == 1 else (Pbar - Pe) / (1 - Pe)


def fleiss_alt(m):
    # expand to the ratings of every subject; agreement = share of equal pairs of distinct raters, chance =
    # probability that two draws from the pooled ratings are equal
    N, k = len(m), len(m[0])
    n = sum(m[0])
    rows = [[j for j in range(k) for _ in range(m[i][j])] for i in range(N)]
    Pbar = sum(F(sum(1 for x in range(n) for y in range(n) if x != y and r[x] == r[y]), n * (n - 1)) for r in rows) / N
    pool = [x for r in rows for x in r]
    M = len(pool)
    Pe = F(sum(1 for x in pool for y in pool if x == y), M * M)
    # a second form of the per-subject agreement: pairs C(n_ij, 2) over C(n, 2)
    Pbar2 = sum(F(sum(comb(c, 2) for c in row), comb(n, 2)) for row in m) / N
    assert Pbar == Pbar2
    return F(1) if Pe == 1 else (Pbar - Pe) / (1 - Pe)


FL = [
    [[0, 0, 0, 0, 14], [0, 2, 6, 4, 2], [0, 0, 3, 5, 6], [0, 3, 9, 2, 0], [2, 2, 8, 1, 1], [7, 7, 0, 0, 0], [3, 2, 6, 3, 0], [2, 5, 3, 2, 2], [6, 5, 2, 1, 0], [0, 2, 2, 3, 7]],
    [[3, 0], [0, 3], [3, 0]],
    [[3], [3]],
    [[2, 0], [1, 1], [0, 2], [2, 0]],
    [[2, 2], [2, 2], [2, 2]],
    [[4, 0, 0], [1, 3, 0], [0, 2, 2], [0, 0, 4], [2, 1, 1], [1, 1, 2]],
    [[1, 1, 0], [0, 1, 1], [1, 0, 1]],
]
cases = []
for m in FL:
    a = fleiss_exact(m)
    assert a == fleiss_alt(m)
    cases.append(case([m], a))
add(
    "fleissKappa",
    "agreement",
    cases,
    [
        [[]],
        [[[]]],
        [[[], []]],
        [[[1, 0], [0, 1]]],
        [[[2, 1], [1, 1]]],
        [[[2, 1], [3]]],
        [[[2, -1], [1, 0]]],
        [[[2, 0.5], [1, 1.5]]],
        [[[2, NAN], [1, 1]]],
    ],
)


def lin_exact(x, y):
    n = len(x)
    mx, my = sum(F(v) for v in x) / n, sum(F(v) for v in y) / n
    vx = sum((F(v) - mx) ** 2 for v in x) / n
    vy = sum((F(v) - my) ** 2 for v in y) / n
    cxy = sum((F(a) - mx) * (F(b) - my) for a, b in zip(x, y)) / n
    return 2 * cxy / (vx + vy + (mx - my) ** 2)


def lin_alt(x, y):
    # pairwise forms: var = (1 / 2 n^2) sum_ij (x_i - x_j)^2 and cov = (1 / 2 n^2) sum_ij (x_i - x_j)(y_i - y_j)
    n = len(x)
    X, Y = [F(v) for v in x], [F(v) for v in y]
    vx = sum((a - b) ** 2 for a in X for b in X) / (2 * n * n)
    vy = sum((a - b) ** 2 for a in Y for b in Y) / (2 * n * n)
    cxy = sum((X[i] - X[j]) * (Y[i] - Y[j]) for i in range(n) for j in range(n)) / (2 * n * n)
    d = sum(X) / n - sum(Y) / n
    return 2 * cxy / (vx + vy + d * d)


cases = []
for x, y in [
    ([1, 2, 3, 4, 5], [1.1, 2.1, 2.9, 4.2, 4.8]),
    ([1, 2, 3, 4, 5], [1, 2, 3, 4, 5]),
    ([1, 2, 3, 4, 5], [2, 3, 4, 5, 6]),
    ([1, 2, 3, 4, 5], [5, 4, 3, 2, 1]),
    ([1], [2]),
    ([3, 3, 3, 3], [1, 2, 3, 4]),
    ([12.1, 15.4, 9.8, 20.3, 17.6, 11.2, 14.9, 18.5], [11.5, 16.2, 10.4, 19.1, 18.3, 10.6, 15.5, 17.2]),
    ([0.5, 1.5, 2.5, 4.5], [0.25, 2.25, 2.0, 5.5]),
]:
    a = lin_exact(x, y)
    close(a, lin_alt(x, y))
    cases.append(case([x, y], a))
add(
    "linsConcordance",
    "agreement",
    cases,
    [
        [[], []],
        [[1, 2], [1]],
        [[1, NAN], [1, 2]],
        [[1, 2], [1, INF]],
        [[2, 2], [2, 2]],
        [[3], [3]],
    ],
)


def ba_limits_exact(x, y, z):
    n = len(x)
    d = [F(a) - F(b) for a, b in zip(x, y)]
    bias = sum(d) / n
    s2 = sum((v - bias) ** 2 for v in d) / (n - 1)
    sd = sqrt(s2)
    zz = dec(z)
    return {"bias": bias, "lower": dec(bias) - zz * sd, "upper": dec(bias) + zz * sd}, sd


def ba_limits_alt(x, y, z):
    # bias = mean x - mean y; s^2 = (1 / (2 n (n - 1))) sum_ij (d_i - d_j)^2
    n = len(x)
    d = [F(a) - F(b) for a, b in zip(x, y)]
    bias = sum(F(a) for a in x) / n - sum(F(b) for b in y) / n
    s2 = sum((a - b) ** 2 for a in d for b in d) / (2 * n * (n - 1))
    sd = sqrt(s2)
    zz = dec(z)
    return {"bias": bias, "lower": dec(bias) - zz * sd, "upper": dec(bias) + zz * sd}, sd


cases = []
Z95 = 1.959963984540054
for x, y, z in [
    ([10.2, 11.5, 9.8, 12.1, 10.9], [10.0, 11.9, 9.5, 12.4, 10.2], Z95),
    ([10.2, 11.5, 9.8, 12.1, 10.9], [10.0, 11.9, 9.5, 12.4, 10.2], 2),
    ([3.5, 4.0], [3.0, 4.75], 1.5),
    ([1.5, 2.5, 3.5], [1.0, 2.0, 3.0], Z95),
    ([2.25, 4.5, 6.75], [2.25, 4.5, 6.75], Z95),
    ([78, 82, 91, 66, 74, 85, 70, 89, 77, 80], [75, 85, 88, 70, 71, 90, 68, 92, 73, 83], Z95),
    ([5.0, 7.5, 6.25, 9.0], [6.5, 9.0, 8.5, 10.25], 1),
]:
    a, sd = ba_limits_exact(x, y, z)
    b, sd2 = ba_limits_alt(x, y, z)
    for key in a:
        close(a[key], b[key])
    scale = max(abs(dec(a["bias"])), dec(z) * sd)
    for key in ("lower", "upper"):
        # no cancellation: the limit is not tiny next to the terms that make it
        assert scale == 0 or abs(dec(a[key])) > D("0.001") * scale or a[key] == 0
    cases.append(case([x, y, z], a))
add(
    "blandAltmanLimits",
    "agreement",
    cases,
    [
        [[1.0], [2.0], Z95],
        [[], [], Z95],
        [[1, 2, 3], [1, 2], Z95],
        [[1, 2, 3], [1, 2, 4], 0],
        [[1, 2, 3], [1, 2, 4], -1.96],
        [[1, 2, 3], [1, 2, 4], NAN],
        [[1, 2, 3], [1, 2, 4], INF],
        [[1, NAN, 3], [1, 2, 4], Z95],
    ],
)

write("classification", "make_newcaps_classification.py: exact Fractions and 120-digit Decimals, each case cross-checked a second way", functions)
