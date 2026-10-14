"""Reference values for @agent-nexus/driftbench-stats.

Run from the repository root:  python3 packages/stats/test/reference/make_fixtures.py
Then format the output the way the repository does:  npx biome format --write packages/stats/test/reference/fixtures.json
Writes packages/stats/test/reference/fixtures.json, which the TypeScript tests read and match to 1e-6
(the bootstrap: exactly when it replays the same generator, within a stated tolerance against numpy).

Library references: scipy (binomtest intervals, wilcoxon, ks_2samp, false_discovery_control, chi2, norm,
special functions). Where no library holds the method (statsmodels is not installed), the reference is
computed directly with numpy from the textbook formula, written independently of the TypeScript:
Newcombe's paired interval, the CUSUM and Page-Hinkley recursions, Cohen's kappa, Krippendorff's alpha,
the nested ANOVA variance components, Neyman allocation, Good-Turing, Chao and Hill numbers.
"""

import json
import math
import os
from fractions import Fraction
from math import comb

import numpy as np
from scipy import optimize, special, stats

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures.json")
M32 = 0xFFFFFFFF


def f(x):
    return float(x)


# ---------------------------------------------------------------- special functions
def special_cases():
    return {
        "logGamma": [{"x": x, "expected": f(special.gammaln(x))} for x in [0.5, 1, 2.5, 7, 30.2, 171.5]],
        "incompleteBeta": [
            {"x": x, "a": a, "b": b, "expected": f(special.betainc(a, b, x))}
            for (x, a, b) in [(0.3, 2, 5), (0.9, 0.5, 0.5), (0.01, 3, 40), (0.7, 60, 25)]
        ],
        "betaQuantile": [
            {"p": p, "a": a, "b": b, "expected": f(special.betaincinv(a, b, p))}
            for (p, a, b) in [(0.025, 3, 8), (0.975, 4, 7), (0.5, 1, 1), (0.001, 10, 200)]
        ],
        "normalQuantile": [{"p": p, "expected": f(stats.norm.ppf(p))} for p in [1e-8, 0.001, 0.025, 0.5, 0.8, 0.975, 0.9999]],
        "normalCdf": [{"z": z, "expected": f(stats.norm.cdf(z))} for z in [-6, -1.96, 0, 0.5, 2.33, 5]],
        "chiSquareSf": [
            {"x": x, "df": df, "expected": f(stats.chi2.sf(x, df))} for (x, df) in [(3.84, 1), (0.1, 1), (10, 3), (25, 2)]
        ],
        "binomialCdf": [
            {"k": k, "n": n, "p": p, "expected": f(stats.binom.cdf(k, n, p))}
            for (k, n, p) in [(2, 9, 0.5), (0, 20, 0.5), (30, 100, 0.25), (99, 100, 0.99)]
        ],
    }


# ---------------------------------------------------------------- intervals
def interval_cases():
    wilson = []
    for k, n, conf in [(0, 10, 0.95), (3, 10, 0.95), (10, 10, 0.95), (47, 59, 0.95), (1, 400, 0.95), (12, 30, 0.9)]:
        ci = stats.binomtest(k, n).proportion_ci(confidence_level=conf, method="wilson")
        wilson.append({"k": k, "n": n, "z": f(stats.norm.ppf(1 - (1 - conf) / 2)), "lower": f(ci.low), "upper": f(ci.high)})
    cp = []
    for k, n, alpha in [(0, 10, 0.05), (3, 10, 0.05), (10, 10, 0.05), (0, 59, 0.05), (17, 120, 0.1)]:
        ci = stats.binomtest(k, n).proportion_ci(confidence_level=1 - alpha, method="exact")
        cp.append({"k": k, "n": n, "alpha": alpha, "lower": f(ci.low), "upper": f(ci.high)})
    zero = [
        {"p": p, "alpha": a, "expected": math.ceil(math.log(a) / math.log(1 - p) - 1e-12)}
        for (p, a) in [(0.05, 0.05), (0.01, 0.05), (0.001, 0.01), (0.1, 0.1), (0.2, 0.01)]
    ]
    design = [{"m": m, "rho": r, "expected": 1 + (m - 1) * r} for (m, r) in [(8, 0.3), (1, 0.9), (5, 0), (20, 0.05)]]
    return {"wilson": wilson, "clopperPearson": cp, "zeroFailureBound": zero, "designEffect": design}


def mulberry32(seed):
    state = seed & M32

    def imul(a, b):
        return (a * b) & M32

    def nxt():
        nonlocal state
        state = (state + 0x6D2B79F5) & M32
        t = state
        t = imul(t ^ (t >> 15), t | 1)
        t = (t ^ ((t + imul(t ^ (t >> 7), t | 61)) & M32)) & M32
        return ((t ^ (t >> 14)) & M32) / 4294967296

    return nxt


def cluster_groups(values, clusters):
    order, groups = [], {}
    for v, c in zip(values, clusters):
        if c not in groups:
            groups[c] = []
            order.append(c)
        groups[c].append(v)
    return [groups[c] for c in order]


def bootstrap_replay(values, clusters, iterations, seed, alpha, method):
    groups = cluster_groups(values, clusters) if clusters is not None else [[v] for v in values]
    sums = [sum(g) for g in groups]
    sizes = [len(g) for g in groups]
    g = len(groups)
    est = sum(sums) / sum(sizes)
    rng = mulberry32(seed)
    out = []
    for _ in range(iterations):
        drawn = [int(rng() * g) for _ in range(g)]
        out.append(sum(sums[d] for d in drawn) / sum(sizes[d] for d in drawn))
    lo, hi = np.percentile(np.array(out), [100 * alpha / 2, 100 * (1 - alpha / 2)])
    if method == "basic":
        lo, hi = 2 * est - hi, 2 * est - lo
    return f(est), f(lo), f(hi)


def bootstrap_numpy(values, clusters, iterations, seed, alpha):
    groups = cluster_groups(values, clusters)
    sums = np.array([sum(x) for x in groups], dtype=float)
    sizes = np.array([len(x) for x in groups], dtype=float)
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(groups), size=(iterations, len(groups)))
    boot = sums[idx].sum(axis=1) / sizes[idx].sum(axis=1)
    lo, hi = np.percentile(boot, [100 * alpha / 2, 100 * (1 - alpha / 2)])
    return f(lo), f(hi)


def bootstrap_cases():
    rng = np.random.default_rng(20261011)
    # 40 conversations of 3 to 8 blocks; each conversation has its own pass probability.
    values, clusters = [], []
    for conv in range(40):
        p = rng.beta(6, 2)
        for _ in range(int(rng.integers(3, 9))):
            values.append(int(rng.random() < p))
            clusters.append(f"conv-{conv}")
    scores = [f(round(x, 6)) for x in rng.normal(0.7, 0.15, size=30)]
    replay = []
    for name, vals, cl, it, seed, alpha, method in [
        ("clustered pass flags", values, clusters, 2000, 1, 0.05, "percentile"),
        ("clustered pass flags, basic", values, clusters, 1000, 42, 0.1, "basic"),
        ("unclustered scores", scores, None, 1500, 7, 0.05, "percentile"),
    ]:
        est, lo, hi = bootstrap_replay(vals, cl, it, seed, alpha, method)
        replay.append(
            {
                "name": name,
                "values": vals,
                "clusters": cl,
                "iterations": it,
                "seed": seed,
                "alpha": alpha,
                "method": method,
                "estimate": est,
                "lower": lo,
                "upper": hi,
            }
        )
    lo, hi = bootstrap_numpy(values, clusters, 200000, 5, 0.05)
    independent = {
        "values": values,
        "clusters": clusters,
        "iterations": 20000,
        "alpha": 0.05,
        "lower": lo,
        "upper": hi,
        "tolerance": 0.01,
        "naiveHalfWidth": f(1.959963984540054 * math.sqrt(np.mean(values) * (1 - np.mean(values)) / len(values))),
    }
    return {"replay": replay, "independent": independent}


# ---------------------------------------------------------------- reliability
def reliability_cases():
    pk, pak = [], []
    for c, n, k in [(10, 10, 5), (8, 10, 1), (8, 10, 3), (5, 10, 6), (0, 10, 1), (37, 40, 8), (190, 200, 20), (2, 10, 3), (5, 20, 4), (30, 200, 10), (1, 50, 7)]:
        pk.append({"c": c, "n": n, "k": k, "expected": f(Fraction(comb(c, k), comb(n, k)))})
        pak.append({"c": c, "n": n, "k": k, "expected": f(1 - Fraction(comb(n - c, k), comb(n, k)))})
    rng = np.random.default_rng(3)
    unrel = []
    for s in [[1, 1, 1, 1, 1], [0.2, 0.9, 0.5, 0.7, 0.4, 0.8, 0.95, 0.1], list(rng.random(17)), [3.0]]:
        s = [f(x) for x in s]
        unrel.append({"samples": s, "expected": f(np.percentile(s, 90) - np.percentile(s, 10))})
    return {"passK": pk, "passAtK": pak, "unreliability": unrel}


# ---------------------------------------------------------------- paired tests
def mcnemar_cases():
    out = []
    for b, c in [(0, 0), (1, 5), (2, 9), (12, 12), (5, 0), (20, 4), (30, 18), (60, 35)]:
        n = b + c
        if n < 25:
            p = 1.0 if n == 0 else f(stats.binomtest(min(b, c), n, 0.5).pvalue)
            out.append({"b": b, "c": c, "method": "exact", "statistic": min(b, c), "pValue": p})
        else:
            stat = max(0, abs(b - c) - 1) ** 2 / n
            out.append({"b": b, "c": c, "method": "chi-square", "statistic": f(stat), "pValue": f(stats.chi2.sf(stat, 1))})
    return out


def wilcoxon_cases():
    rng = np.random.default_rng(11)
    cases = [
        ("no ties, n = 9", [1.83, 0.50, 1.62, 2.48, 1.68, 1.88, 1.55, 3.06, 1.30],
         [0.878, 0.647, 0.598, 2.05, 1.06, 1.29, 1.06, 3.14, 1.29]),
        ("ties and a zero, n = 9", [1, 2, 2, 3, -1, 4, 5, -2, 0], [0] * 9),
        ("drift counts with ties, n = 12", [3, 1, 4, 1, 5, 0, 2, 6, 5, 3, 5, 0], [2, 1, 3, 3, 2, 1, 2, 4, 3, 3, 1, 2]),
        ("drift counts with ties, n = 20", list(rng.integers(0, 6, 20)), list(rng.integers(0, 5, 20))),
        ("continuous, n = 30", list(np.round(rng.normal(0.3, 1, 30), 6)), [0.0] * 30),
        ("continuous, n = 60", list(np.round(rng.normal(0.2, 1, 60), 6)), [0.0] * 60),
    ]
    out = []
    for name, x, y in cases:
        x = [f(v) for v in x]
        y = [f(v) for v in y]
        r = stats.wilcoxon(x, y)
        out.append({"name": name, "x": x, "y": y, "statistic": f(r.statistic), "pValue": f(r.pvalue)})
    return out


def wilson_ci(k, n, z):
    p = k / n
    denom = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denom
    half = z / denom * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return max(0.0, center - half), min(1.0, center + half)


def newcombe(a, b, c, d, alpha):
    n = a + b + c + d
    z = stats.norm.ppf(1 - alpha / 2)
    ci1 = stats.binomtest(a + b, n).proportion_ci(confidence_level=1 - alpha, method="wilson")
    ci2 = stats.binomtest(a + c, n).proportion_ci(confidence_level=1 - alpha, method="wilson")
    l1, u1 = ci1.low, ci1.high
    l2, u2 = ci2.low, ci2.high
    # Cross-check the scipy Wilson limits against the formula.
    assert abs(wilson_ci(a + b, n, z)[0] - l1) < 1e-12 and abs(wilson_ci(a + c, n, z)[1] - u2) < 1e-12
    p1, p2 = (a + b) / n, (a + c) / n
    prod = (a + b) * (c + d) * (a + c) * (b + d)
    # Newcombe's method 10 corrects positive covariance, not the Wilson limits.
    # Independent implementation and pinned values: make_newcombe_fixtures.py.
    cov = a * d - b * c
    if cov > 0:
        cov = max(0.0, cov - n / 2)
    phi = 0.0 if prod == 0 else cov / math.sqrt(prod)
    delta = math.sqrt(max(0.0, (p1 - l1) ** 2 - 2 * phi * (p1 - l1) * (u2 - p2) + (u2 - p2) ** 2))
    eps = math.sqrt(max(0.0, (u1 - p1) ** 2 - 2 * phi * (u1 - p1) * (p2 - l2) + (p2 - l2) ** 2))
    d_hat = p1 - p2
    return f(d_hat), f(max(-1.0, d_hat - delta)), f(min(1.0, d_hat + eps))


def paired_cases():
    diff = []
    for a, b, c, d, alpha in [(8, 5, 4, 27, 0.05), (50, 0, 0, 10, 0.05), (40, 3, 1, 6, 0.05), (12, 2, 9, 1, 0.1), (0, 3, 0, 0, 0.05)]:
        est, lo, hi = newcombe(a, b, c, d, alpha)
        diff.append({"bothPass": a, "regressed": b, "improved": c, "bothFail": d, "alpha": alpha, "estimate": est, "lower": lo, "upper": hi})
    # Parity verdicts built from explicit per-pair flags.
    verdicts = []
    rng = np.random.default_rng(5)
    for name, n, pb, pc, margin, flags in [
        ("candidate equal to baseline, 200 pairs", 200, 0.9, 0.9, 0.05, None),
        ("candidate clearly worse", 200, 0.9, 0.75, 0.05, None),
        ("small campaign, zero regressions is not parity", 10, 1.0, 1.0, 0.05, None),
        ("within margin but a new gating flag", 300, 0.95, 0.95, 0.08, "new"),
    ]:
        base = [bool(v) for v in rng.random(n) < pb]
        cand = [bool(bv if rng.random() < 0.9 else rng.random() < pc) for bv in base]
        if name.startswith("candidate clearly"):
            cand = [bool(bv and rng.random() < pc / pb) for bv in base]
        a = sum(1 for x, y in zip(base, cand) if x and y)
        b = sum(1 for x, y in zip(base, cand) if x and not y)
        c = sum(1 for x, y in zip(base, cand) if not x and y)
        d = n - a - b - c
        est, lo, hi = newcombe(a, b, c, d, 0.05)
        flag_base = [False] * n
        flag_cand = [False] * n
        if flags == "new":
            flag_cand[7] = True
        verdict = hi < margin and not any(fc and not fb for fb, fc in zip(flag_base, flag_cand))
        verdicts.append(
            {
                "name": name,
                "baseline": base,
                "candidate": cand,
                "margin": margin,
                "gatingFlags": {"baseline": flag_base, "candidate": flag_cand} if flags else None,
                "regressed": b,
                "improved": c,
                "estimate": est,
                "lower": lo,
                "upper": hi,
                "nonInferior": verdict,
            }
        )
    return {"pairedRateDifference": diff, "nonInferiority": verdicts}


def bh_cases():
    out = []
    rng = np.random.default_rng(8)
    for ps, q in [
        ([0.01, 0.04, 0.03, 0.2], 0.05),
        ([0.001, 0.008, 0.039, 0.041, 0.042, 0.06, 0.074, 0.205, 0.212, 0.216], 0.05),
        (list(rng.random(25) ** 3), 0.1),
        ([0.5, 0.6, 0.9], 0.05),
    ]:
        ps = [f(p) for p in ps]
        adj = stats.false_discovery_control(ps, method="bh")
        out.append({"pvalues": ps, "q": q, "adjusted": [f(a) for a in adj], "rejected": [bool(a <= q) for a in adj]})
    return out


def mde_cases():
    out = []
    for n, repeats, p1, power, alpha, rho in [
        (100, 1, 0.9, 0.8, 0.05, 0.0),
        (50, 5, 0.85, 0.8, 0.05, 0.3),
        (200, 3, 0.7, 0.9, 0.05, 0.1),
        (30, 10, 0.95, 0.8, 0.1, 0.5),
    ]:
        de = 1 + (repeats - 1) * rho
        neff = n * repeats / de
        za = stats.norm.ppf(1 - alpha / 2)
        zb = stats.norm.ppf(power)

        def gap(delta):
            p2 = p1 - delta
            pbar = (p1 + p2) / 2
            return za * math.sqrt(2 * pbar * (1 - pbar)) + zb * math.sqrt(p1 * (1 - p1) + p2 * (1 - p2)) - delta * math.sqrt(neff)

        effect = None if gap(p1) > 0 else f(optimize.brentq(gap, 0, p1, xtol=1e-14))
        out.append({"n": n, "repeats": repeats, "baselineRate": p1, "power": power, "alpha": alpha, "rho": rho, "effect": effect, "effectiveN": f(neff)})
    return out


# ---------------------------------------------------------------- drift
def cusum_ref(series, target, sd, k, h):
    su = sl = 0.0
    up, lo, alarms = [], [], []
    for i, x in enumerate(series):
        z = (x - target) / sd
        su = max(0.0, su + z - k)
        sl = max(0.0, sl - z - k)
        up.append(su)
        lo.append(sl)
        if su > h:
            alarms.append({"index": i, "direction": "up"})
            su = 0.0
        if sl > h:
            alarms.append({"index": i, "direction": "down"})
            sl = 0.0
    return up, lo, alarms


def page_hinkley_ref(series, delta, threshold, min_instances):
    count, mean, m_up, min_up, m_dn, max_dn = 0, 0.0, 0.0, 0.0, 0.0, 0.0
    up, dn, alarms = [], [], []
    for i, x in enumerate(series):
        count += 1
        mean += (x - mean) / count
        m_up += x - mean - delta
        min_up = min(min_up, m_up)
        m_dn += x - mean + delta
        max_dn = max(max_dn, m_dn)
        u, d = m_up - min_up, max_dn - m_dn
        up.append(u)
        dn.append(d)
        if count >= min_instances and (u > threshold or d > threshold):
            alarms.append({"index": i, "direction": "up" if u > threshold else "down"})
            count, mean, m_up, min_up, m_dn, max_dn = 0, 0.0, 0.0, 0.0, 0.0, 0.0
    return up, dn, alarms


def drift_cases():
    rng = np.random.default_rng(21)
    shift = [f(round(v, 6)) for v in np.concatenate([rng.normal(0.9, 0.03, 40), rng.normal(0.8, 0.03, 30)])]
    rise = [f(round(v, 6)) for v in np.concatenate([rng.normal(2.0, 0.5, 50), rng.normal(3.0, 0.5, 50)])]
    cusum = []
    head = np.array(shift[:20])
    t, s = f(head.mean()), f(head.std(ddof=1))
    u, l, a = cusum_ref(shift, t, s, 0.5, 5)
    cusum.append({"name": "pass rate drops, estimated target", "series": shift, "options": {}, "target": t, "sd": s, "upper": u, "lower": l, "alarms": a})
    u, l, a = cusum_ref(rise, 2.0, 0.5, 0.25, 4)
    cusum.append({"name": "latency rises, given target", "series": rise, "options": {"target": 2.0, "sd": 0.5, "k": 0.25, "h": 4}, "target": 2.0, "sd": 0.5, "upper": u, "lower": l, "alarms": a})
    ph = []
    u, d, a = page_hinkley_ref(rise, 0.05, 10, 30)
    ph.append({"name": "latency rises", "series": rise, "options": {"delta": 0.05, "threshold": 10, "minInstances": 30}, "up": u, "down": d, "alarms": a})
    u, d, a = page_hinkley_ref(shift, 0.001, 0.3, 20)
    ph.append({"name": "pass rate drops", "series": shift, "options": {"delta": 0.001, "threshold": 0.3, "minInstances": 20}, "up": u, "down": d, "alarms": a})
    ks = []
    for name, a_, b_ in [
        ("small, distinct", [1, 2, 3, 4, 5], [2.5, 6, 7, 8]),
        ("same shape, n = 40 and 35", rng.normal(0, 1, 40), rng.normal(0, 1, 35)),
        ("shifted, n = 60 and 80", rng.normal(0, 1, 60), rng.normal(0.6, 1, 80)),
        ("unequal sizes, n = 7 and 300", rng.normal(0, 1, 7), rng.normal(1, 1, 300)),
    ]:
        a_ = [f(round(v, 6)) for v in a_]
        b_ = [f(round(v, 6)) for v in b_]
        r = stats.ks_2samp(a_, b_, method="exact")
        en = math.sqrt(len(a_) * len(b_) / (len(a_) + len(b_)))
        ks.append(
            {
                "name": name,
                "a": a_,
                "b": b_,
                "statistic": f(r.statistic),
                "pValue": f(r.pvalue),
                "asymptoticPValue": f(stats.kstwobign.sf(r.statistic * en)),
            }
        )
    return {"cusum": cusum, "pageHinkley": ph, "ksTest": ks}


# ---------------------------------------------------------------- agreement
def kappa_ref(a, b, cats, weights):
    idx = {c: i for i, c in enumerate(cats)}
    k = len(cats)
    tab = np.zeros((k, k))
    for x, y in zip(a, b):
        tab[idx[x], idx[y]] += 1
    tab /= tab.sum()
    exp = np.outer(tab.sum(axis=1), tab.sum(axis=0))
    i, j = np.meshgrid(range(k), range(k), indexing="ij")
    if weights == "none":
        w = (i != j).astype(float)
    elif weights == "linear":
        w = np.abs(i - j).astype(float)
    else:
        w = ((i - j) ** 2).astype(float)
    return f(1 - (w * tab).sum() / (w * exp).sum())


def kappa_cases():
    rng = np.random.default_rng(13)
    truth = rng.integers(0, 3, 80)
    judge = np.where(rng.random(80) < 0.75, truth, rng.integers(0, 3, 80))
    out = []
    for name, a, b, cats, w in [
        ("pass/fail labels", ["pass", "pass", "fail", "pass", "fail", "fail", "pass", "pass", "pass", "fail"],
         ["pass", "fail", "fail", "pass", "fail", "pass", "pass", "pass", "pass", "fail"], ["fail", "pass"], "none"),
        ("three grades, unweighted", list(map(int, truth)), list(map(int, judge)), [0, 1, 2], "none"),
        ("three grades, linear", list(map(int, truth)), list(map(int, judge)), [0, 1, 2], "linear"),
        ("three grades, quadratic", list(map(int, truth)), list(map(int, judge)), [0, 1, 2], "quadratic"),
    ]:
        out.append({"name": name, "a": a, "b": b, "weights": w, "kappa": kappa_ref(a, b, cats, w)})
    return out


def alpha_ref(matrix, level):
    units = list(zip(*matrix))
    pairable = [[v for v in u if v is not None] for u in units]
    pairable = [u for u in pairable if len(u) >= 2]
    values = sorted({v for u in pairable for v in u})
    idx = {v: i for i, v in enumerate(values)}
    k = len(values)
    o = np.zeros((k, k))
    for u in pairable:
        m = len(u)
        for i in range(m):
            for j in range(m):
                if i != j:
                    o[idx[u[i]], idx[u[j]]] += 1 / (m - 1)
    nc = o.sum(axis=1)
    n = nc.sum()
    d = np.zeros((k, k))
    for c in range(k):
        for e in range(k):
            if c == e:
                continue
            vc, ve = values[c], values[e]
            if level == "nominal":
                d[c, e] = 1
            elif level == "interval":
                d[c, e] = (vc - ve) ** 2
            elif level == "ratio":
                d[c, e] = ((vc - ve) / (vc + ve)) ** 2
            else:
                lo, hi = min(c, e), max(c, e)
                d[c, e] = (nc[lo : hi + 1].sum() - (nc[c] + nc[e]) / 2) ** 2
    do = (o * d).sum() / n
    de = (np.outer(nc, nc) * d).sum() / (n * (n - 1))
    return f(1 - do / de)


def alpha_cases():
    # Krippendorff (2011), Computing Krippendorff's alpha-reliability, the 4 coders x 12 units example.
    N = None
    reliability = [
        [1, 2, 3, 3, 2, 1, 4, 1, 2, N, N, N],
        [1, 2, 3, 3, 2, 2, 4, 1, 2, 5, N, 3],
        [N, 3, 3, 3, 2, 3, 4, 2, 2, 5, 1, N],
        [1, 2, 3, 3, 2, 4, 4, 1, 2, 5, 1, N],
    ]
    published = {"nominal": 0.743, "ordinal": 0.815, "interval": 0.849, "ratio": 0.797}
    rng = np.random.default_rng(17)
    truth = rng.integers(1, 6, 40)
    raters = [[int(t) if rng.random() < 0.8 else int(rng.integers(1, 6)) for t in truth] for _ in range(3)]
    for r in raters:
        for u in rng.choice(40, 5, replace=False):
            r[int(u)] = None
    out = []
    for level in ["nominal", "ordinal", "interval", "ratio"]:
        ref = alpha_ref(reliability, level)
        assert abs(ref - published[level]) < 5e-4, (level, ref)
        out.append({"name": "Krippendorff 2011 example", "matrix": reliability, "level": level, "alpha": ref, "published": published[level]})
        out.append({"name": "three judges, 40 units, missing values", "matrix": raters, "level": level, "alpha": alpha_ref(raters, level)})
    return out


# ---------------------------------------------------------------- variance components (P4.8)
def balanced_anova(y):
    """y has shape (cells, conversations, wordings, repeats). Classic nested ANOVA."""
    a, b, c, r = y.shape
    g = y.mean()
    m_a = y.mean(axis=(1, 2, 3))
    m_ab = y.mean(axis=(2, 3))
    m_abc = y.mean(axis=3)
    ss_a = b * c * r * ((m_a - g) ** 2).sum()
    ss_b = c * r * ((m_ab - m_a[:, None]) ** 2).sum()
    ss_c = r * ((m_abc - m_ab[:, :, None]) ** 2).sum()
    ss_e = ((y - m_abc[..., None]) ** 2).sum()
    df = [a - 1, a * (b - 1), a * b * (c - 1), a * b * c * (r - 1)]
    ms = [ss_a / df[0], ss_b / df[1], ss_c / df[2], ss_e / df[3]]
    s_e = ms[3]
    s_c = (ms[2] - ms[3]) / r
    s_b = (ms[1] - ms[2]) / (c * r)
    s_a = (ms[0] - ms[1]) / (b * c * r)
    return {"ss": [ss_a, ss_b, ss_c, ss_e], "df": df, "ms": ms, "estimates": [s_a, s_b, s_c, s_e]}


def henderson(rows, levels):
    """Henderson method I for a fully nested model, written from the expected mean squares."""
    y = np.array([v for v, _ in rows], dtype=float)
    paths = [tuple(p) for _, p in rows]
    n_total = len(y)

    def groups(level):
        out = {}
        for v, p in zip(y, paths):
            key = p[:level]
            s, n = out.get(key, (0.0, 0))
            out[key] = (s + v, n + 1)
        return out

    G = [groups(level) for level in range(levels + 1)]
    between = [sum(s * s / n for s, n in g.values()) for g in G]
    count = [len(g) for g in G]

    def T(l, j):
        if j < l:
            return float(n_total)
        acc = {}
        for key, (_, nh) in G[j].items():
            acc[key[:l]] = acc.get(key[:l], 0) + nh * nh
        return sum(sq / G[l][anc][1] for anc, sq in acc.items())

    df = [count[l] - count[l - 1] for l in range(1, levels + 1)]
    ss = [between[l] - between[l - 1] for l in range(1, levels + 1)]
    df_e = n_total - count[levels]
    ss_e = float((y**2).sum() - between[levels])
    ms_e = ss_e / df_e
    # Build the expected-mean-square system and solve it with numpy (not by back substitution).
    K = np.zeros((levels + 1, levels + 1))
    rhs = np.zeros(levels + 1)
    for l in range(1, levels + 1):
        for j in range(l, levels + 1):
            K[l - 1, j - 1] = (T(l, j) - T(l - 1, j)) / df[l - 1]
        K[l - 1, levels] = 1.0
        rhs[l - 1] = ss[l - 1] / df[l - 1]
    K[levels, levels] = 1.0
    rhs[levels] = ms_e
    sol = np.linalg.solve(K, rhs)
    return {"ss": ss + [ss_e], "df": df + [df_e], "ms": list(rhs[:levels]) + [ms_e], "estimates": list(sol)}


def variance_cases():
    rng = np.random.default_rng(2026)
    out = []

    def simulate(a, b, c, r, sd, binary):
        y = np.zeros((a, b, c, r))
        for i in range(a):
            ua = rng.normal(0, sd[0])
            for j in range(b):
                ub = rng.normal(0, sd[1])
                for k in range(c):
                    uc = rng.normal(0, sd[2])
                    lin = 0.5 + ua + ub + uc + rng.normal(0, sd[3], r)
                    y[i, j, k] = (rng.random(r) < np.clip(lin, 0.02, 0.98)).astype(float) if binary else lin
        return y

    def rows_of(y):
        rows = []
        a, b, c, r = y.shape
        for i in range(a):
            for j in range(b):
                for k in range(c):
                    for t in range(r):
                        rows.append((f(round(y[i, j, k, t], 6)), [f"cell-{i}", f"conv-{j}", f"w-{k}"]))
        return rows

    for name, shape, sd, binary in [
        ("balanced continuous, 4 cells x 10 conversations x 3 wordings x 5 repeats", (4, 10, 3, 5), (0.3, 0.2, 0.1, 0.25), False),
        ("balanced binary, the pilot shape on 3 cells", (3, 10, 3, 5), (0.15, 0.15, 0.05, 0.0), True),
    ]:
        y = simulate(*shape, sd, binary)
        y = np.round(y, 6)
        rows = rows_of(y)
        ref = balanced_anova(y)
        chk = henderson(rows, 3)
        assert np.allclose(ref["estimates"], chk["estimates"], atol=1e-9), (ref["estimates"], chk["estimates"])
        out.append({"name": name, "balanced": True, "observations": [{"value": v, "path": p} for v, p in rows], **{k: [f(x) for x in v] for k, v in ref.items()}})

    # Unbalanced: drop observations, a wording and a conversation from a balanced draw.
    y = np.round(simulate(3, 6, 3, 4, (0.3, 0.2, 0.1, 0.25), False), 6)
    rows = rows_of(y)
    keep = []
    for idx, (v, p) in enumerate(rows):
        if p[0] == "cell-1" and p[1] == "conv-2" and p[2] == "w-1":
            continue
        if p[0] == "cell-2" and p[1] == "conv-5":
            continue
        if rng.random() < 0.15 and idx % 4 != 0:
            continue
        keep.append((v, p))
    ref = henderson(keep, 3)
    out.append({"name": "unbalanced continuous (Henderson method I)", "balanced": False, "observations": [{"value": v, "path": p} for v, p in keep], **{k: [f(x) for x in v] for k, v in ref.items()}})

    # Two levels only (per-cell pilot): conversation > wording > repeat.
    y = np.round(simulate(1, 10, 3, 5, (0.0, 0.25, 0.1, 0.2), False), 6)[0]
    rows = []
    for j in range(10):
        for k in range(3):
            for t in range(5):
                rows.append((f(y[j, k, t]), [f"conv-{j}", f"w-{k}"]))
    ref = henderson(rows, 2)
    out.append({"name": "one cell, conversation > wording > repeat", "balanced": True, "levels": ["conversation", "wording"], "observations": [{"value": v, "path": p} for v, p in rows], **{k: [f(x) for x in v] for k, v in ref.items()}})
    return out


def allocation_cases():
    out = []
    for sizes, sds, total in [
        ([100, 100, 100], [0.1, 0.3, 0.5], 90),
        ([500, 200, 50, 250], [0.45, 0.5, 0.2, 0.3], 200),
        ([10, 20], [0.0, 0.0], 9),
        ([3, 3, 3], [0.2, 0.2, 0.2], 10),
    ]:
        w = np.array(sizes, dtype=float) * np.array(sds, dtype=float)
        if (w == 0).all():
            w = np.array(sizes, dtype=float)
        exact = total * w / w.sum()
        alloc = np.zeros(len(sizes), dtype=int)
        positive = sorted([i for i in range(len(sizes)) if w[i] > 0], key=lambda i: (-w[i], i))
        for i in positive[:total]:
            alloc[i] = 1
        left = total - min(total, len(positive))
        # integer optimum of sum w^2 / n: one at a time where the marginal gain w^2 / (n (n + 1)) is largest
        for _ in range(left):
            i = max(positive, key=lambda i: (Fraction(w[i] * w[i]) / (int(alloc[i]) * (int(alloc[i]) + 1)), -i))
            alloc[i] += 1
        out.append({"sizes": sizes, "sds": sds, "total": total, "exact": [f(x) for x in exact], "allocated": [int(x) for x in alloc]})
    return out


def floor_cases():
    out = []
    for inp in [
        {"flipRate": 0.1, "floor": 0.1},
        {"flipRate": 0.3, "floor": 0.05, "blocks": 40},
        {"variance": 0.04, "floor": 0.02, "blocks": 10, "difference": False},
        {"flipRate": 0.0, "floor": 0.05},
        {"variance": 0.25, "floor": 0.1, "z": 2.5758293035489004},
    ]:
        var = inp["variance"] if "variance" in inp else inp["flipRate"] * (1 - inp["flipRate"])
        z = inp.get("z", 1.959963984540054)
        fac = 2 if inp.get("difference", True) else 1
        blocks = inp.get("blocks", 1)
        exact = fac * z * z * var / (blocks * inp["floor"] ** 2)
        r = max(1, math.ceil(exact - 1e-9))
        out.append({"input": inp, "repeats": r, "floor": f(z * math.sqrt(fac * var / (r * blocks)))})
    return out


def coverage_cases():
    rng = np.random.default_rng(99)
    samples = [
        ("f2 > 0", [5, 3, 1, 1, 2, 1, 2, 4, 1, 7]),
        ("f2 = 0 fallback", [1, 1, 1, 3, 4, 5]),
        ("no singletons", [2, 3, 4]),
        ("skewed draw over 50 cells", list(np.bincount(rng.zipf(1.6, 120) % 50, minlength=50))),
    ]
    out = []
    for name, counts in samples:
        counts = [int(c) for c in counts]
        n = sum(counts)
        s_obs = sum(1 for c in counts if c > 0)
        f1 = sum(1 for c in counts if c == 1)
        f2 = sum(1 for c in counts if c == 2)
        if f1 == 0:
            cov = 1.0
        elif f2 > 0:
            cov = 1 - f1 / n * ((n - 1) * f1 / ((n - 1) * f1 + 2 * f2))
        else:
            cov = 1 - f1 / n * ((n - 1) * (f1 - 1) / ((n - 1) * (f1 - 1) + 2))
        chao1 = s_obs + (n - 1) / n * (f1 * f1 / (2 * f2) if f2 > 0 else f1 * (f1 - 1) / 2)
        p = np.array([c for c in counts if c > 0], dtype=float) / n
        out.append(
            {
                "name": name,
                "counts": counts,
                "n": n,
                "observed": s_obs,
                "f1": f1,
                "f2": f2,
                "discoveryProbability": f(f1 / n),
                "turingCoverage": f(1 - f1 / n),
                "coverage": f(cov),
                "chao1": f(chao1),
                "q0": s_obs,
                "q1": f(math.exp(stats.entropy(p))),
                "q2": f(1 / (p**2).sum()),
                "q3": f(((p**3).sum()) ** (1 / (1 - 3))),
            }
        )
    return out


def main():
    fixtures = {
        "generatedBy": "packages/stats/test/reference/make_fixtures.py",
        "scipy": stats.__name__ and __import__("scipy").__version__,
        "numpy": np.__version__,
        "special": special_cases(),
        "intervals": interval_cases(),
        "bootstrap": bootstrap_cases(),
        "reliability": reliability_cases(),
        "mcnemar": mcnemar_cases(),
        "wilcoxon": wilcoxon_cases(),
        "paired": paired_cases(),
        "benjaminiHochberg": bh_cases(),
        "mde": mde_cases(),
        "drift": drift_cases(),
        "kappa": kappa_cases(),
        "krippendorff": alpha_cases(),
        "varianceComponents": variance_cases(),
        "neyman": allocation_cases(),
        "repeatsForFloor": floor_cases(),
        "coverage": coverage_cases(),
    }
    with open(OUT, "w") as fh:
        json.dump(fixtures, fh, indent=1, allow_nan=False)
        fh.write("\n")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
