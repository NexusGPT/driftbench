"""Writes roadmap.json: the expected values of the methods the statistics package does not have yet.

Each method names the signature the package must export, the definition with its source, and cases whose
expected values come from scipy and numpy (or the closed form written here when scipy has none). Run from the
repository root: python3 packages/validators/fixtures/stats/make_roadmap.py. Fictional data only.
"""
import json
import math
from pathlib import Path

import numpy as np
from scipy import optimize, stats

Z = stats.norm.ppf(0.975)
methods = []


def method(family, name, file, signature, definition, source, cases, tol=1e-9, tier=4):
    methods.append(dict(family=family, name=name, file=file, signature=signature, definition=definition,
                        source=source, tol=tol, tier=tier, cases=cases))


def clip(v):
    return min(1.0, max(0.0, v))


# --- intervals -------------------------------------------------------------------------------------------
def agresti(k, n, z=Z):
    nt = n + z * z
    pt = (k + z * z / 2) / nt
    h = z * math.sqrt(pt * (1 - pt) / nt)
    return dict(estimate=k / n, lower=clip(pt - h), upper=clip(pt + h))


KN = [(0, 10), (3, 20), (17, 40), (50, 50)]
method('roadmap-intervals', 'agrestiCoull', 'packages/stats/src/intervals.ts',
       'agrestiCoull(k: number, n: number, z = Z95): Interval',
       'Agresti-Coull: n~ = n + z^2, p~ = (k + z^2 / 2) / n~, p~ -/+ z sqrt(p~ (1 - p~) / n~), clipped to [0, 1]; estimate k / n',
       'Agresti and Coull 1998; Brown, Cai and DasGupta 2001 (binomial proportion confidence interval, dossier S8)',
       [dict(args=[k, n], expect=agresti(k, n)) for k, n in KN])


def jeffreys(k, n, a=0.05):
    lo = 0.0 if k == 0 else stats.beta.ppf(a / 2, k + 0.5, n - k + 0.5)
    hi = 1.0 if k == n else stats.beta.ppf(1 - a / 2, k + 0.5, n - k + 0.5)
    return dict(estimate=k / n, lower=float(lo), upper=float(hi))


method('roadmap-intervals', 'jeffreys', 'packages/stats/src/intervals.ts',
       'jeffreys(k: number, n: number, alpha = 0.05): Interval',
       'Jeffreys: Beta(k + 1/2, n - k + 1/2) quantiles at alpha / 2 and 1 - alpha / 2; lower 0 when k = 0, upper 1 when k = n',
       'Brown, Cai and DasGupta 2001 (dossier S8); scipy.stats.beta.ppf',
       [dict(args=[k, n], expect=jeffreys(k, n)) for k, n in KN], tol=1e-7)


def wilson_cc(k, n, z=Z):
    p = k / n
    d = 2 * (n + z * z)
    lo = 0.0 if k == 0 else (2 * n * p + z * z - 1 - z * math.sqrt(z * z - 2 - 1 / n + 4 * p * (n * (1 - p) + 1))) / d
    hi = 1.0 if k == n else (2 * n * p + z * z + 1 + z * math.sqrt(z * z + 2 - 1 / n + 4 * p * (n * (1 - p) - 1))) / d
    return dict(estimate=p, lower=clip(lo), upper=clip(hi))


method('roadmap-intervals', 'wilsonContinuity', 'packages/stats/src/intervals.ts',
       'wilsonContinuity(k: number, n: number, z = Z95): Interval',
       'Wilson score interval with continuity correction (Newcombe 1998, method 4): lower = (2np + z^2 - 1 - z sqrt(z^2 - 2 - 1/n + 4p(n(1-p) + 1))) / (2(n + z^2)), upper = (2np + z^2 + 1 + z sqrt(z^2 + 2 - 1/n + 4p(n(1-p) - 1))) / (2(n + z^2)); lower 0 when k = 0, upper 1 when k = n; clipped to [0, 1]',
       'Newcombe 1998, Two-sided confidence intervals for the single proportion (dossier S8)',
       [dict(args=[k, n], expect=wilson_cc(k, n)) for k, n in KN])


def wilson(k, n, z=Z):
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z / d * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return max(0, c - h), min(1, c + h)


def newcombe(k1, n1, k2, n2):
    p1, p2 = k1 / n1, k2 / n2
    l1, u1 = wilson(k1, n1)
    l2, u2 = wilson(k2, n2)
    d = p1 - p2
    lo = d - math.sqrt((p1 - l1) ** 2 + (u2 - p2) ** 2)
    hi = d + math.sqrt((u1 - p1) ** 2 + (p2 - l2) ** 2)
    return dict(estimate=d, lower=lo, upper=hi)


method('roadmap-intervals', 'newcombeDifference', 'packages/stats/src/intervals.ts',
       'newcombeDifference(k1: number, n1: number, k2: number, n2: number): Interval',
       'Newcombe hybrid score interval for p1 - p2 of two independent rates (method 10): with Wilson bounds (l1, u1) and (l2, u2), lower = d - sqrt((p1 - l1)^2 + (u2 - p2)^2), upper = d + sqrt((u1 - p1)^2 + (p2 - l2)^2), d = p1 - p2',
       'Newcombe 1998, Interval estimation for the difference between independent proportions',
       [dict(args=list(a), expect=newcombe(*a)) for a in [(56, 70, 48, 80), (9, 10, 3, 10), (0, 20, 2, 25), (30, 30, 25, 30)]])

T_SAMPLES = [[2.1, 3.4, 1.9, 5.6, 4.2], [0.5, 0.7, 0.2, 0.9, 0.4, 0.8, 0.1, 0.6], [10, 12, 9, 11, 13, 10, 12, 30],
             [1.0, 1.0, 1.1, 0.9]]


def tint(v, a=0.05):
    x = np.array(v, float)
    m = x.mean()
    se = x.std(ddof=1) / math.sqrt(len(x))
    t = stats.t.ppf(1 - a / 2, len(x) - 1)
    return dict(estimate=float(m), lower=float(m - t * se), upper=float(m + t * se))


method('roadmap-intervals', 'tInterval', 'packages/stats/src/intervals.ts',
       'tInterval(values: readonly number[], alpha = 0.05): Interval',
       "Student's t interval for a mean: mean -/+ t(1 - alpha/2, n - 1) s / sqrt(n), s the sample standard deviation",
       'scipy.stats.t; the interval the dossier S22 (Adding error bars to evals) reports for a mean score',
       [dict(args=[v], expect=tint(v)) for v in T_SAMPLES], tol=1e-8)


def garwood(c, e, a=0.05):
    lo = 0.0 if c == 0 else stats.chi2.ppf(a / 2, 2 * c) / 2 / e
    hi = stats.chi2.ppf(1 - a / 2, 2 * c + 2) / 2 / e
    return dict(estimate=c / e, lower=float(lo), upper=float(hi))


method('roadmap-intervals', 'poissonInterval', 'packages/stats/src/intervals.ts',
       'poissonInterval(count: number, exposure: number, alpha = 0.05): Interval',
       'Exact (Garwood) interval for a Poisson rate: chi2(alpha/2, 2c) / 2 and chi2(1 - alpha/2, 2c + 2) / 2, divided by the exposure; lower 0 when c = 0',
       'Garwood 1936; scipy.stats.chi2.ppf',
       [dict(args=[c, e], expect=garwood(c, e)) for c, e in [(0, 10), (3, 100), (17, 4.5), (250, 1000)]], tol=1e-7)

# --- tests -----------------------------------------------------------------------------------------------
TABLES = [(3, 1, 1, 3), (10, 2, 3, 15), (0, 5, 6, 1), (8, 7, 9, 6)]


def fisher(a, b, c, d):
    o, p = stats.fisher_exact([[a, b], [c, d]], alternative='two-sided')
    return dict(oddsRatio=float(o) if math.isfinite(o) else ('Infinity' if o > 0 else 0.0), pValue=float(p))


method('roadmap-tests', 'fisherExact', 'packages/stats/src/paired.ts',
       'fisherExact(a: number, b: number, c: number, d: number): { oddsRatio: number; pValue: number }',
       "Fisher's exact test on the 2x2 table [[a, b], [c, d]], two-sided p-value summing the tables no more likely than the observed one (relative tolerance 1e-7), sample odds ratio ad / bc",
       'scipy.stats.fisher_exact',
       [dict(args=list(t), expect=fisher(*t)) for t in TABLES], tol=1e-9)

WX = [([5.1, 4.9, 6.2, 5.8, 6.0, 5.5], [4.1, 4.5, 3.9, 5.0, 4.4]), ([1, 2, 3, 4, 5, 6, 7, 8], [2, 3, 2.5, 4, 3.5]),
      ([0.1, 0.4, 0.3], [0.9, 1.2, 0.8, 1.1, 1.0, 0.95])]


def welch(x, y):
    r = stats.ttest_ind(x, y, equal_var=False)
    vx, vy = np.var(x, ddof=1) / len(x), np.var(y, ddof=1) / len(y)
    df = (vx + vy) ** 2 / (vx ** 2 / (len(x) - 1) + vy ** 2 / (len(y) - 1))
    return dict(statistic=float(r.statistic), df=float(df), pValue=float(r.pvalue))


method('roadmap-tests', 'welchTTest', 'packages/stats/src/paired.ts',
       'welchTTest(x: readonly number[], y: readonly number[]): { statistic: number; df: number; pValue: number }',
       "Welch's two-sample t test, two-sided, Welch-Satterthwaite degrees of freedom",
       'scipy.stats.ttest_ind(equal_var=False)',
       [dict(args=[x, y], expect=welch(x, y)) for x, y in WX], tol=1e-8)


def mwu(x, y):
    r = stats.mannwhitneyu(x, y, method='asymptotic', use_continuity=True, alternative='two-sided')
    return dict(statistic=float(r.statistic), pValue=float(r.pvalue))


MW = [([1.1, 2.3, 3.0, 4.8, 5.2, 2.2], [3.3, 4.1, 6.0, 5.9, 7.2, 6.6, 4.4]), ([1, 2, 2, 3, 3, 3], [2, 3, 4, 4, 5]),
      ([10, 20, 30], [15, 25, 35, 45])]
method('roadmap-tests', 'mannWhitneyU', 'packages/stats/src/paired.ts',
       'mannWhitneyU(x: readonly number[], y: readonly number[]): { statistic: number; pValue: number }',
       'Mann-Whitney U test, two-sided, normal approximation with the tie correction and the continuity correction; statistic is U of x (the number of pairs with x > y, ties counting 1/2)',
       "scipy.stats.mannwhitneyu(method='asymptotic', use_continuity=True)",
       [dict(args=[x, y], expect=mwu(x, y)) for x, y in MW], tol=1e-8)

CT = [[[10, 20, 30], [20, 20, 10]], [[5, 5], [10, 2]], [[12, 7, 3], [8, 9, 4], [2, 6, 11]]]


def chi_ind(t):
    r = stats.chi2_contingency(np.array(t), correction=False)
    return dict(statistic=float(r[0]), df=int(r[2]), pValue=float(r[1]))


method('roadmap-tests', 'chiSquareIndependence', 'packages/stats/src/paired.ts',
       'chiSquareIndependence(table: readonly (readonly number[])[]): { statistic: number; df: number; pValue: number }',
       "Pearson's chi-square test of independence of an r x c table of counts, no continuity correction, df (r - 1)(c - 1)",
       'scipy.stats.chi2_contingency(correction=False)',
       [dict(args=[t], expect=chi_ind(t)) for t in CT], tol=1e-8)

PV = [[0.01, 0.04, 0.03, 0.005, 0.2], [0.001, 0.008, 0.039, 0.041, 0.042, 0.06, 0.074, 0.205], [0.5, 0.02, 0.9]]


def holm(p, a=0.05):
    p = np.array(p)
    m = len(p)
    order = np.argsort(p, kind='stable')
    adj = np.empty(m)
    run = 0
    for i, j in enumerate(order):
        run = max(run, min(1, (m - i) * p[j]))
        adj[j] = run
    return dict(adjusted=[float(x) for x in adj], rejected=[bool(x <= a) for x in adj])


def bonf(p, a=0.05):
    adj = [min(1, len(p) * x) for x in p]
    return dict(adjusted=adj, rejected=[x <= a for x in adj])


def by(p, q=0.05):
    p = np.array(p)
    m = len(p)
    cm = sum(1 / i for i in range(1, m + 1))
    order = np.argsort(p)[::-1]
    adj = np.empty(m)
    run = 1.0
    for i in order:
        rank = int(np.sum(p <= p[i]))
        run = min(run, min(1, p[i] * m * cm / rank))
        adj[i] = run
    return dict(adjusted=[float(x) for x in adj], rejected=[bool(x <= q) for x in adj])


method('roadmap-tests', 'holm', 'packages/stats/src/multiple.ts',
       'holm(pvalues: readonly number[], alpha = 0.05): { adjusted: number[]; rejected: boolean[] }',
       'Holm step-down: sort ascending, adjusted p(i) = max over j <= i of min(1, (m - j + 1) p(j)), in input order; rejected when adjusted <= alpha',
       'Holm 1979; statsmodels multipletests(method="holm")',
       [dict(args=[p], expect=holm(p)) for p in PV], tol=1e-12, tier=3)
method('roadmap-tests', 'bonferroni', 'packages/stats/src/multiple.ts',
       'bonferroni(pvalues: readonly number[], alpha = 0.05): { adjusted: number[]; rejected: boolean[] }',
       'Bonferroni: adjusted min(1, m p), rejected when adjusted <= alpha',
       'statsmodels multipletests(method="bonferroni")',
       [dict(args=[p], expect=bonf(p)) for p in PV], tol=1e-12, tier=3)
method('roadmap-tests', 'benjaminiYekutieli', 'packages/stats/src/multiple.ts',
       'benjaminiYekutieli(pvalues: readonly number[], q = 0.05): { adjusted: number[]; rejected: boolean[] }',
       'Benjamini-Yekutieli: the Benjamini-Hochberg step-up with m replaced by m c(m), c(m) = sum over i of 1 / i; valid under any dependence',
       'Benjamini and Yekutieli 2001; statsmodels multipletests(method="fdr_by")',
       [dict(args=[p], expect=by(p)) for p in PV], tol=1e-12)

# --- sequential and planning -----------------------------------------------------------------------------
def sprt(p0, p1, a, b, xs):
    lo, hi = math.log(b / (1 - a)), math.log((1 - b) / a)
    llr = 0.0
    for i, x in enumerate(xs):
        llr += math.log(p1 / p0) if x else math.log((1 - p1) / (1 - p0))
        if llr >= hi:
            return dict(decision='reject-null', index=i, llr=llr)
        if llr <= lo:
            return dict(decision='accept-null', index=i, llr=llr)
    return dict(decision='continue', index=-1, llr=llr)


SEQ = [(0.05, 0.2, 0.05, 0.1, [0] * 40), (0.05, 0.2, 0.05, 0.1, [0, 1, 0, 1, 1, 0, 1, 1]),
       (0.1, 0.3, 0.05, 0.2, [0, 0, 1, 0, 0, 0]), (0.5, 0.7, 0.01, 0.01, [1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1])]
method('roadmap-sequential', 'sprtBernoulli', 'packages/stats/src/drift.ts',
       "sprtBernoulli(input: { p0: number; p1: number; alpha: number; beta: number; outcomes: readonly (0 | 1)[] }): { decision: 'reject-null' | 'accept-null' | 'continue'; index: number; llr: number }",
       "Wald's SPRT for a failure rate: log likelihood ratio summed over outcomes (1 a failure), reject H0 (rate p0) at the first index with llr >= ln((1 - beta) / alpha), accept at llr <= ln(beta / (1 - alpha)); index -1 and the final llr when neither boundary is met",
       'Wald 1945; dossier S19',
       [dict(args=[dict(p0=a[0], p1=a[1], alpha=a[2], beta=a[3], outcomes=a[4])], expect=sprt(*a)) for a in SEQ], tol=1e-12)


def spend(t, a, kind):
    if kind == 'obrien-fleming':
        return float(2 - 2 * stats.norm.cdf(stats.norm.ppf(1 - a / 2) / math.sqrt(t)))
    return float(a * math.log(1 + (math.e - 1) * t))


SP = [(0.25, 0.05, 'obrien-fleming'), (0.5, 0.05, 'obrien-fleming'), (0.25, 0.05, 'pocock'), (0.75, 0.025, 'pocock')]
method('roadmap-sequential', 'alphaSpending', 'packages/stats/src/power.ts',
       "alphaSpending(t: number, alpha: number, kind: 'obrien-fleming' | 'pocock'): number",
       'Lan-DeMets spending functions, the cumulative alpha spent at information fraction t: O\'Brien-Fleming type 2 - 2 Phi(z(1 - alpha/2) / sqrt(t)); Pocock type alpha ln(1 + (e - 1) t)',
       'Lan and DeMets 1983; group sequential tests (dossier S32)',
       [dict(args=list(a), expect=spend(*a)) for a in SP], tol=1e-9)
method('roadmap-sequential', 'hoeffdingSampleSize', 'packages/stats/src/power.ts',
       'hoeffdingSampleSize(epsilon: number, delta: number): number',
       "The distribution-free sample size for a rate within +/- epsilon with probability 1 - delta: ceil(ln(2 / delta) / (2 epsilon^2))",
       "Hoeffding's inequality (dossier S35, section 3.1: 738 for +/- 0.05 at 95 percent)",
       [dict(args=[e, d], expect=math.ceil(math.log(2 / d) / (2 * e * e))) for e, d in [(0.05, 0.05), (0.1, 0.01), (0.02, 0.1)]], tol=0, tier=3)
method('roadmap-sequential', 'normalSampleSize', 'packages/stats/src/power.ts',
       'normalSampleSize(p: number, epsilon: number, alpha = 0.05): number',
       'The normal-approximation sample size for a rate p within +/- epsilon: ceil(z(1 - alpha/2)^2 p (1 - p) / epsilon^2)',
       'dossier section 3.1 (385 for p = 0.5, epsilon = 0.05)',
       [dict(args=[p, e], expect=math.ceil(Z * Z * p * (1 - p) / (e * e))) for p, e in [(0.5, 0.05), (0.5, 0.1), (0.1, 0.02)]], tol=0, tier=3)
method('roadmap-sequential', 'betaPosteriorBelow', 'packages/stats/src/power.ts',
       'betaPosteriorBelow(input: { failures: number; n: number; margin: number; priorA?: number; priorB?: number }): number',
       'Bayesian stopping: the posterior probability that the failure rate is below the margin, Beta(priorA + failures, priorB + n - failures) cdf at the margin; prior Beta(1, 1) by default',
       'dossier section 3.1 (S27, S17); scipy.stats.beta.cdf',
       [dict(args=[dict(failures=f, n=n, margin=m)], expect=float(stats.beta.cdf(m, 1 + f, 1 + n - f))) for f, n, m in [(0, 59, 0.05), (2, 100, 0.05), (1, 30, 0.1)]], tol=1e-9)


def two_prop(p1, p2, a=0.05, pw=0.8):
    za, zb = stats.norm.ppf(1 - a / 2), stats.norm.ppf(pw)
    pb = (p1 + p2) / 2
    n = (za * math.sqrt(2 * pb * (1 - pb)) + zb * math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2 / (p1 - p2) ** 2
    return math.ceil(n)


method('roadmap-sequential', 'twoProportionSampleSize', 'packages/stats/src/power.ts',
       'twoProportionSampleSize(input: { p1: number; p2: number; alpha?: number; power?: number }): number',
       'Units per group to detect p1 vs p2 with a two-sided two-proportion test (no continuity correction): ceil((z(1-alpha/2) sqrt(2 pbar (1 - pbar)) + z(power) sqrt(p1 q1 + p2 q2))^2 / (p1 - p2)^2); the inverse of mde',
       'Fleiss, Levin and Paik 2003, section 4.2',
       [dict(args=[dict(p1=a, p2=b)], expect=two_prop(a, b)) for a, b in [(0.8, 0.7), (0.9, 0.8), (0.5, 0.45)]], tol=0, tier=3)

# --- diversity and the unseen ----------------------------------------------------------------------------
CNT = [[10, 6, 4, 3, 2, 1, 1, 1], [5, 5, 5, 5], [40, 12, 7, 3, 3, 2, 2, 1, 1, 1, 1, 1]]


def shannon(c):
    c = np.array([x for x in c if x > 0], float)
    p = c / c.sum()
    return float(-(p * np.log(p)).sum())


method('roadmap-diversity', 'shannonEntropy', 'packages/stats/src/coverage.ts',
       'shannonEntropy(counts: readonly number[]): number',
       'Plug-in Shannon entropy in nats, -sum p ln p over the classes with a count',
       'Diversity index (dossier S31); scipy.stats.entropy',
       [dict(args=[c], expect=shannon(c)) for c in CNT], tol=1e-12, tier=3)
method('roadmap-diversity', 'simpsonIndex', 'packages/stats/src/coverage.ts',
       'simpsonIndex(counts: readonly number[]): number',
       'Simpson concentration, sum of p^2 (plug-in)',
       'Diversity index (dossier S31)',
       [dict(args=[c], expect=float(sum((x / sum(c)) ** 2 for x in c))) for c in CNT], tol=1e-12, tier=3)
method('roadmap-diversity', 'pielouEvenness', 'packages/stats/src/coverage.ts',
       'pielouEvenness(counts: readonly number[]): number',
       'Pielou evenness J = H / ln S, H the Shannon entropy in nats and S the classes with a count',
       'dossier S3 (evenness of verdicts)',
       [dict(args=[c], expect=shannon(c) / math.log(len([x for x in c if x > 0]))) for c in CNT], tol=1e-12, tier=3)


def rarefy(c, m):
    n = sum(c)
    from math import comb
    return float(sum(1 - comb(n - x, m) / comb(n, m) for x in c if x > 0))


method('roadmap-diversity', 'rarefiedRichness', 'packages/stats/src/coverage.ts',
       'rarefiedRichness(counts: readonly number[], m: number): number',
       'Expected classes in a random subsample of m units without replacement: sum over classes of 1 - C(n - x_i, m) / C(n, m)',
       'Colwell, Chao and co-authors 2012; Chao and co-authors 2014 (dossier S24, S25)',
       [dict(args=[c, m], expect=rarefy(c, m)) for c, m in [(CNT[0], 10), (CNT[2], 30), (CNT[1], 3)]], tol=1e-9)


def chao1_ci(c):
    c = np.array(c)
    n = c.sum()
    s = int((c > 0).sum())
    f1, f2 = int((c == 1).sum()), int((c == 2).sum())
    k = (n - 1) / n
    chao = s + k * f1 * f1 / (2 * f2)
    r = f1 / f2
    var = f2 * (k * r ** 2 / 2 + k * k * r ** 3 + k * k * r ** 4 / 4)
    t = chao - s
    K = math.exp(Z * math.sqrt(math.log(1 + var / t ** 2)))
    return dict(estimate=float(chao), lower=float(s + t / K), upper=float(s + t * K))


method('roadmap-diversity', 'chao1Interval', 'packages/stats/src/coverage.ts',
       'chao1Interval(counts: readonly number[], alpha = 0.05): Interval',
       'Chao1 with its log-normal interval (Chao 1987, with the bias factor k = (n - 1) / n as in EstimateS): var = f2 (k r^2 / 2 + k^2 r^3 + k^2 r^4 / 4), r = f1 / f2; T = Chao1 - S_obs; K = exp(z sqrt(ln(1 + var / T^2))); interval [S_obs + T / K, S_obs + T K]; estimate Chao1. Cases have f2 > 0',
       'Chao 1987, Estimating the population size for capture-recapture data with unequal catchability',
       [dict(args=[c], expect=chao1_ci(c)) for c in [CNT[0], CNT[2], [8, 4, 2, 2, 1, 1, 1, 1, 1]]], tol=1e-9, tier=5)


def ace(c, rare=10):
    c = np.array([x for x in c if x > 0])
    s_rare = int((c <= rare).sum())
    s_abund = int((c > rare).sum())
    n_rare = int(c[c <= rare].sum())
    f1 = int((c == 1).sum())
    cace = 1 - f1 / n_rare
    g = sum(i * (i - 1) * int((c == i).sum()) for i in range(1, rare + 1))
    gamma2 = max(s_rare / cace * g / (n_rare * (n_rare - 1)) - 1, 0)
    return float(s_abund + s_rare / cace + f1 / cace * gamma2)


method('roadmap-diversity', 'aceEstimator', 'packages/stats/src/coverage.ts',
       'aceEstimator(counts: readonly number[], rare = 10): number',
       'Abundance-based coverage estimator (Chao and Lee 1992): classes with count <= rare are rare; C = 1 - f1 / N_rare; gamma^2 = max(S_rare / C * sum i (i - 1) f_i / (N_rare (N_rare - 1)) - 1, 0); ACE = S_abund + S_rare / C + f1 / C gamma^2',
       'Chao and Lee 1992; EstimateS user guide',
       [dict(args=[c], expect=ace(c)) for c in [CNT[0], CNT[2], [30, 12, 4, 3, 2, 2, 1, 1, 1]]], tol=1e-9, tier=5)


def chao_shannon(c):
    c = np.array([x for x in c if x > 0])
    n = c.sum()
    f1, f2 = int((c == 1).sum()), int((c == 2).sum())
    a = 2 * f2 / ((n - 1) * f1 + 2 * f2) if f2 > 0 else (2 / ((n - 1) * (f1 - 1) + 2) if f1 > 0 else 1)
    part = sum(x / n * (sum(1 / k for k in range(x, n))) for x in c)
    if f1 > 0 and a != 1:
        part += f1 / n * (1 - a) ** (1 - n) * (-math.log(a) - sum((1 - a) ** r / r for r in range(1, n)))
    return float(part)


method('roadmap-diversity', 'chaoShannon', 'packages/stats/src/coverage.ts',
       'chaoShannon(counts: readonly number[]): number',
       'Chao, Wang and Jost 2013 entropy estimator: sum over classes of (x/n)(sum from k = x to n - 1 of 1/k), plus (f1/n)(1 - A)^(1 - n)(-ln A - sum from r = 1 to n - 1 of (1 - A)^r / r) with A = 2 f2 / ((n - 1) f1 + 2 f2) (when f2 = 0: A = 2 / ((n - 1)(f1 - 1) + 2); no second term when f1 = 0)',
       'Chao, Wang and Jost 2013, Entropy and the species accumulation curve (Methods in Ecology and Evolution)',
       [dict(args=[c], expect=chao_shannon(c)) for c in CNT[:1] + CNT[2:] + [[6, 3, 2, 2, 1, 1, 1]]], tol=1e-9, tier=5)


def extrap(c, mstar):
    c = np.array([x for x in c if x > 0])
    n = c.sum()
    s = len(c)
    f1, f2 = int((c == 1).sum()), int((c == 2).sum())
    f0 = (n - 1) / n * f1 * f1 / (2 * f2) if f2 > 0 else (n - 1) / n * f1 * (f1 - 1) / 2
    if f0 == 0:
        return float(s)
    return float(s + f0 * (1 - (1 - f1 / (n * f0 + f1)) ** mstar))


method('roadmap-diversity', 'extrapolatedRichness', 'packages/stats/src/coverage.ts',
       'extrapolatedRichness(counts: readonly number[], extra: number): number',
       'Expected classes after `extra` more units (Chao and co-authors 2014, equation 9): S_obs + f0 (1 - (1 - f1 / (n f0 + f1))^extra), f0 = ((n - 1)/n) f1^2 / (2 f2), or ((n - 1)/n) f1 (f1 - 1) / 2 when f2 = 0',
       'Chao, Gotelli and co-authors 2014 (dossier S24)',
       [dict(args=[c, m], expect=extrap(c, m)) for c, m in [(CNT[0], 28), (CNT[2], 10), (CNT[2], 146)]], tol=1e-9, tier=5)

KS = [np.eye(3), np.ones((3, 3)), np.array([[1, 0.5, 0.1], [0.5, 1, 0.2], [0.1, 0.2, 1]])]


def vendi(k):
    w = np.linalg.eigvalsh(k / k.shape[0])
    w = w[w > 1e-15]
    return float(math.exp(-(w * np.log(w)).sum()))


method('roadmap-diversity', 'vendiScore', 'packages/stats/src/coverage.ts',
       'vendiScore(similarity: readonly (readonly number[])[]): number',
       'Vendi score: exp(-sum lambda ln lambda) over the eigenvalues lambda of K / n, K a symmetric similarity matrix with ones on the diagonal (eigenvalues at or below 1e-15 left out)',
       'Friedman and Dieng, The Vendi Score (dossier S1)',
       [dict(args=[k.tolist()], expect=vendi(k)) for k in KS], tol=1e-9, tier=5)

# --- weighting, clustering, reliability growth ------------------------------------------------------------
W = [[1, 1, 1, 1], [1, 2, 3, 4], [10, 1, 1, 1, 1]]
method('roadmap-weighting', 'kishEffectiveSize', 'packages/stats/src/intervals.ts',
       'kishEffectiveSize(weights: readonly number[]): number',
       "Kish's effective sample size of weighted units, (sum w)^2 / sum w^2",
       'Owen, Monte Carlo theory, chapter 9, equation 9.13 (dossier S43)',
       [dict(args=[w], expect=sum(w) ** 2 / sum(x * x for x in w)) for w in W], tol=1e-12, tier=3)


def strat(means, sizes, sds, samples):
    N = sum(sizes)
    est = sum(s / N * m for s, m in zip(sizes, means))
    var = sum((s / N) ** 2 * (1 - n / s) * sd * sd / n for s, n, sd in zip(sizes, samples, sds))
    return dict(estimate=est, variance=var)


ST = [([0.8, 0.6, 0.9], [100, 50, 50], [0.4, 0.49, 0.3], [20, 10, 10]), ([10, 20], [1000, 3000], [2, 5], [50, 100]),
      ([0.5, 0.7, 0.2, 0.9], [30, 30, 30, 30], [0.5, 0.46, 0.4, 0.3], [5, 5, 5, 5])]
method('roadmap-weighting', 'stratifiedMean', 'packages/stats/src/variance.ts',
       'stratifiedMean(input: { means: readonly number[]; sizes: readonly number[]; sds: readonly number[]; samples: readonly number[] }): { estimate: number; variance: number }',
       'Stratified estimator of a mean: sum W_h ybar_h with W_h = N_h / N; variance sum W_h^2 (1 - n_h / N_h) s_h^2 / n_h (finite population correction)',
       'Stratified sampling (dossier S34); Cochran, Sampling Techniques, 5.4',
       [dict(args=[dict(means=a, sizes=b, sds=c, samples=d)], expect=strat(a, b, c, d)) for a, b, c, d in ST], tol=1e-12, tier=3)


def imp(u, g):
    return [a / b for a, b in zip(u, g)]


method('roadmap-weighting', 'importanceWeights', 'packages/stats/src/variance.ts',
       'importanceWeights(userShares: readonly number[], generatorShares: readonly number[]): number[]',
       'The weight of each stratum when the generator over- or under-samples it: user share divided by generator share (the shares need not sum to 1; a zero generator share with a positive user share is a RangeError)',
       'Importance sampling (dossier S33, S43, section 3.2)',
       [dict(args=[u, g], expect=imp(u, g)) for u, g in [([0.5, 0.3, 0.2], [0.2, 0.3, 0.5]), ([0.25] * 4, [0.4, 0.4, 0.1, 0.1]), ([0.9, 0.1], [0.5, 0.5])]], tol=1e-12, tier=3)


def cluster_se(v, cl):
    v = np.array(v, float)
    m = v.mean()
    n = len(v)
    tot = 0.0
    for c in sorted(set(cl)):
        tot += sum(v[i] - m for i in range(n) if cl[i] == c) ** 2
    return float(math.sqrt(tot) / n)


CV = [([1, 0, 1, 1, 0, 0, 1, 1, 1], [1, 1, 1, 2, 2, 2, 3, 3, 3]), ([0.2, 0.4, 0.9, 0.8, 0.1, 0.5], ['a', 'a', 'b', 'b', 'c', 'c']),
      ([1, 1, 1, 0, 0, 0, 1, 0], [1, 1, 2, 2, 3, 3, 4, 4])]
method('roadmap-weighting', 'clusteredStandardError', 'packages/stats/src/intervals.ts',
       'clusteredStandardError(values: readonly number[], clusters: readonly (string | number)[]): number',
       'Standard error of a mean when values cluster (dossier S22, Adding error bars to evals, equation for clustered questions): sqrt(sum over clusters c of (sum over i in c of (x_i - xbar))^2) / n, no small-sample correction',
       'Miller 2024, Adding Error Bars to Evals, arXiv 2411.00640 (dossier S22)',
       [dict(args=[v, c], expect=cluster_se(v, c)) for v, c in CV], tol=1e-12, tier=4)
PA = [([0.8, 0.7, 0.9, 0.6, 0.75], [0.7, 0.72, 0.8, 0.5, 0.7]), ([1, 1, 0, 1, 0, 1], [1, 0, 0, 1, 0, 0]), ([3, 5, 2, 8], [4, 4, 4, 4])]
method('roadmap-weighting', 'pairedStandardError', 'packages/stats/src/paired.ts',
       'pairedStandardError(a: readonly number[], b: readonly number[]): { difference: number; standardError: number }',
       'Paired difference of two models on the same questions (dossier S22): difference mean(a - b), standard error sd(a - b) / sqrt(n) with the n - 1 sample standard deviation',
       'Miller 2024, Adding Error Bars to Evals (dossier S22)',
       [dict(args=[a, b], expect=dict(difference=float(np.mean(np.array(a) - np.array(b))), standardError=float(np.std(np.array(a) - np.array(b), ddof=1) / math.sqrt(len(a))))) for a, b in PA], tol=1e-12, tier=3)
GO = [(10, 50, 0.1), (5, 20, 0.3), (100, 80, 0.01)]
method('roadmap-weighting', 'goelOkumoto', 'packages/stats/src/drift.ts',
       'goelOkumoto(t: number, total: number, rate: number): { expected: number; intensity: number }',
       'Goel-Okumoto reliability growth: expected failures by time t, m(t) = N (1 - e^(-phi t)), and the failure intensity N phi e^(-phi t)',
       'Pai 2002, A survey of software reliability models (dossier S26)',
       [dict(args=[t, n, p], expect=dict(expected=n * (1 - math.exp(-p * t)), intensity=n * p * math.exp(-p * t))) for t, n, p in GO], tol=1e-9, tier=3)


def go_fit(times, T):
    times = np.array(times, float)
    k = len(times)

    def g(phi):
        return k / phi - k * T * math.exp(-phi * T) / (1 - math.exp(-phi * T)) - times.sum()
    phi = optimize.brentq(g, 1e-9, 100)
    return dict(total=float(k / (1 - math.exp(-phi * T))), rate=float(phi))


GF = [([1, 2, 4, 5, 9, 13, 20, 28, 40], 50), ([0.5, 0.8, 1.2, 2.0, 3.1, 4.5, 6.0, 9.0, 13.0, 19.0, 30.0], 40), ([3, 7, 12, 20, 31], 60)]
method('roadmap-weighting', 'goelOkumotoFit', 'packages/stats/src/drift.ts',
       'goelOkumotoFit(failureTimes: readonly number[], observedUntil: number): { total: number; rate: number }',
       'Maximum likelihood fit of the Goel-Okumoto model to failure times observed on [0, T]: phi solves k / phi - k T e^(-phi T) / (1 - e^(-phi T)) = sum t_i, then N = k / (1 - e^(-phi T))',
       'Goel and Okumoto 1979; Pai 2002 (dossier S26)',
       [dict(args=[t, T], expect=go_fit(t, T)) for t, T in GF], tol=1e-6, tier=5)

Path(__file__).with_name('roadmap.json').write_text(json.dumps(dict(
    generatedBy='packages/validators/fixtures/stats/make_roadmap.py',
    scipy=__import__('scipy').__version__, numpy=np.__version__, methods=methods), indent=1) + '\n')
print(sum(len(m['cases']) for m in methods), 'cases in', len(methods), 'methods')
