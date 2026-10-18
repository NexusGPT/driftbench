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


# --- calibration and classification (parity: promptfoo, deepeval, langwatch, inspect list ECE, ROC, F1) ----
PROBS = [([0.9, 0.8, 0.3, 0.6, 0.2, 0.7, 0.4, 0.95, 0.1, 0.55], [1, 1, 0, 1, 0, 0, 1, 1, 0, 1]),
         ([0.1, 0.4, 0.35, 0.8], [0, 0, 1, 1]),
         ([0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95, 0.5, 0.5], [0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 1, 0]),
         ([0.99, 0.01, 0.6, 0.6, 0.3], [1, 0, 1, 0, 0])]


def ece(p, y, bins=10):
    p, y = np.array(p, float), np.array(y, float)
    idx = np.minimum((p * bins).astype(int), bins - 1)
    tot = 0.0
    for b in range(bins):
        m = idx == b
        if m.any():
            tot += m.sum() / len(p) * abs(y[m].mean() - p[m].mean())
    return float(tot)


method('roadmap-calibration', 'expectedCalibrationError', 'packages/stats/src/agreement.ts',
       'expectedCalibrationError(probabilities: readonly number[], labels: readonly (0 | 1)[], bins = 10): number',
       'ECE with equal-width bins on [0, 1] (bin index min(floor(p bins), bins - 1)): sum over non-empty bins of (bin size / n) |mean label - mean probability|',
       'Guo and co-authors 2017; listed by the parity notes (promptfoo, langwatch, deepeval: calibration, ECE)',
       [dict(args=[p, y], expect=ece(p, y)) for p, y in PROBS], tol=1e-12, tier=3)
method('roadmap-calibration', 'brierScore', 'packages/stats/src/agreement.ts',
       'brierScore(probabilities: readonly number[], labels: readonly (0 | 1)[]): number',
       'Brier score, the mean of (p - y)^2',
       'Brier 1950; sklearn.metrics.brier_score_loss',
       [dict(args=[p, y], expect=float(np.mean((np.array(p) - np.array(y)) ** 2))) for p, y in PROBS], tol=1e-12, tier=3)


def auc(p, y):
    pos = [a for a, b in zip(p, y) if b == 1]
    neg = [a for a, b in zip(p, y) if b == 0]
    tot = sum((1 if a > b else 0.5 if a == b else 0) for a in pos for b in neg)
    return tot / (len(pos) * len(neg))


method('roadmap-calibration', 'aucRoc', 'packages/stats/src/agreement.ts',
       'aucRoc(scores: readonly number[], labels: readonly (0 | 1)[]): number',
       'Area under the ROC curve: the share of (positive, negative) pairs where the positive scores higher, ties counting 1/2 (the Mann-Whitney form)',
       'Hanley and McNeil 1982; sklearn.metrics.roc_auc_score; parity notes (ROC)',
       [dict(args=[p, y], expect=auc(p, y)) for p, y in PROBS], tol=1e-12, tier=3)


def logloss(p, y):
    p = np.clip(np.array(p, float), 1e-15, 1 - 1e-15)
    y = np.array(y, float)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


method('roadmap-calibration', 'logLoss', 'packages/stats/src/agreement.ts',
       'logLoss(probabilities: readonly number[], labels: readonly (0 | 1)[]): number',
       'Mean negative log likelihood -mean(y ln p + (1 - y) ln(1 - p)), with p clipped to [1e-15, 1 - 1e-15]',
       'sklearn.metrics.log_loss',
       [dict(args=[p, y], expect=logloss(p, y)) for p, y in PROBS], tol=1e-12, tier=3)

CLS = [(['a', 'b', 'a', 'c', 'b', 'a', 'c', 'c'], ['a', 'b', 'b', 'c', 'b', 'a', 'a', 'c']),
       (['x', 'x', 'y', 'y', 'y', 'x'], ['x', 'y', 'y', 'y', 'x', 'x']),
       (['p', 'p', 'p', 'n', 'n', 'n', 'n', 'p', 'n', 'p'], ['p', 'n', 'p', 'n', 'n', 'p', 'n', 'p', 'n', 'n']),
       (['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'a'])]


def prf(t, p):
    labels = sorted(set(t) | set(p))
    out = {}
    f1s = []
    for c in labels:
        tp = sum(1 for a, b in zip(t, p) if a == c and b == c)
        fp = sum(1 for a, b in zip(t, p) if a != c and b == c)
        fn = sum(1 for a, b in zip(t, p) if a == c and b != c)
        pr = tp / (tp + fp) if tp + fp else 0.0
        rc = tp / (tp + fn) if tp + fn else 0.0
        f = 2 * pr * rc / (pr + rc) if pr + rc else 0.0
        out[c] = dict(precision=pr, recall=rc, f1=f, support=tp + fn)
        f1s.append(f)
    return dict(perClass=out, macroF1=float(np.mean(f1s)), accuracy=sum(a == b for a, b in zip(t, p)) / len(t))


method('roadmap-calibration', 'classificationReport', 'packages/stats/src/agreement.ts',
       'classificationReport(truth: readonly string[], predicted: readonly string[]): { perClass: Record<string, { precision: number; recall: number; f1: number; support: number }>; macroF1: number; accuracy: number }',
       'Per class precision tp / (tp + fp), recall tp / (tp + fn), F1 their harmonic mean (0 when undefined), support the true count; macro F1 the unweighted mean over the classes in truth or predicted; accuracy the share equal',
       'sklearn.metrics.classification_report (zero_division=0); parity notes (F1, precision, recall)',
       [dict(args=[t, p], expect=prf(t, p)) for t, p in CLS], tol=1e-12, tier=3)

# --- ratings (parity: Elo and Bradley-Terry are named across the parity notes) ---------------------------
MATCHES = [[['a', 'b', 1], ['a', 'c', 1], ['b', 'c', 0.5], ['c', 'a', 1], ['b', 'a', 0]],
           [['x', 'y', 1], ['y', 'z', 1], ['z', 'x', 0], ['x', 'z', 1], ['y', 'x', 0.5], ['z', 'y', 0]],
           [['p', 'q', 0], ['p', 'q', 0], ['q', 'p', 0], ['p', 'q', 1]],
           [['m', 'n', 1], ['n', 'o', 1], ['o', 'm', 1], ['m', 'o', 0.5], ['n', 'm', 0], ['o', 'n', 0]],
           [['u', 'v', 1], ['v', 'w', 0], ['w', 'u', 0.5], ['u', 'w', 1], ['v', 'u', 1]]]


def elo_update(ra, rb, score, k=32):
    ea = 1 / (1 + 10 ** ((rb - ra) / 400))
    return [ra + k * (score - ea), rb - k * (score - ea)]


method('roadmap-ratings', 'eloUpdate', 'packages/stats/src/agreement.ts',
       'eloUpdate(ratingA: number, ratingB: number, scoreA: number, k = 32): [number, number]',
       'One Elo update: expected E_A = 1 / (1 + 10^((R_B - R_A) / 400)); R_A + k (S_A - E_A) and R_B - k (S_A - E_A)',
       'Elo 1978; parity notes (Elo leaderboards)',
       [dict(args=list(a), expect=elo_update(*a)) for a in [(1500, 1500, 1), (1600, 1400, 0), (1500, 1700, 0.5), (1200, 1250, 1), (2000, 1000, 1)]], tol=1e-9, tier=3)


def elo_seq(ms, k=32, init=1500):
    r = {}
    for a, b, sc in ms:
        ra, rb = r.get(a, init), r.get(b, init)
        r[a], r[b] = elo_update(ra, rb, sc, k)
    return dict(sorted(r.items()))


method('roadmap-ratings', 'eloRatings', 'packages/stats/src/agreement.ts',
       'eloRatings(matches: readonly [string, string, number][], k = 32, initial = 1500): Record<string, number>',
       'Elo ratings after applying eloUpdate to the matches in order ([player A, player B, score of A]), every player starting at the initial rating',
       'Elo 1978; parity notes',
       [dict(args=[m], expect=elo_seq(m)) for m in MATCHES], tol=1e-9, tier=3)


def bt(ms, iters=10000):
    players = sorted({p for a, b, _ in ms for p in (a, b)})
    w = {p: 0.0 for p in players}
    n = {}
    for a, b, sc in ms:
        w[a] += sc
        w[b] += 1 - sc
        n[(a, b)] = n.get((a, b), 0) + 1
        n[(b, a)] = n.get((b, a), 0) + 1
    s = {p: 1.0 for p in players}
    for _ in range(iters):
        new = {}
        for i in players:
            den = sum(n.get((i, j), 0) / (s[i] + s[j]) for j in players if j != i)
            new[i] = w[i] / den if den > 0 else s[i]
        g = math.exp(np.mean([math.log(v) for v in new.values()]))
        s = {p: v / g for p, v in new.items()}
    return {p: float(s[p]) for p in players}


BTM = [MATCHES[0], MATCHES[3], MATCHES[4], [['x', 'y', 1], ['y', 'z', 1], ['z', 'x', 1], ['y', 'x', 0.5], ['x', 'z', 0]], [['a', 'b', 1], ['b', 'a', 1], ['a', 'b', 0.5], ['b', 'c', 1], ['c', 'b', 0.5], ['a', 'c', 1], ['c', 'a', 0.5]]]
method('roadmap-ratings', 'bradleyTerry', 'packages/stats/src/agreement.ts',
       'bradleyTerry(matches: readonly [string, string, number][]): Record<string, number>',
       'Bradley-Terry strengths by the minorization-maximization iteration (Hunter 2004): s_i <- W_i / sum_j n_ij / (s_i + s_j), W_i the score of i (a draw counts 1/2 to each), n_ij the games between i and j; normalized so the geometric mean of the strengths is 1; iterate to convergence (1e-12)',
       'Bradley and Terry 1952; Hunter 2004; parity notes',
       [dict(args=[m], expect=bt(m)) for m in BTM], tol=1e-6, tier=5)


def winrate(ms, player):
    games = [(sc if a == player else 1 - sc) for a, b, sc in ms if player in (a, b)]
    k = sum(games)
    n = len(games)
    return dict(rate=k / n, games=n)


method('roadmap-ratings', 'winRate', 'packages/stats/src/agreement.ts',
       'winRate(matches: readonly [string, string, number][], player: string): { rate: number; games: number }',
       "A player's score share over its games (a draw counts 1/2) and its number of games",
       'parity notes (win rate)',
       [dict(args=[m, m[0][0]], expect=winrate(m, m[0][0])) for m in MATCHES], tol=1e-12, tier=2)

# --- correlation and effect sizes --------------------------------------------------------------------------
XY = [([1, 2, 3, 4, 5, 6, 7, 8], [2.1, 3.9, 6.2, 7.8, 9.9, 12.2, 13.8, 16.1]),
      ([3.2, 1.5, 4.8, 2.2, 5.1, 3.3, 0.9], [2.0, 1.1, 3.9, 2.5, 3.0, 2.8, 1.5]),
      ([1, 2, 2, 3, 4, 4, 5, 6], [3, 1, 2, 2, 5, 4, 6, 5]),
      ([10, 9, 8, 7, 6, 5], [1, 3, 2, 5, 4, 6])]


def pearson(x, y):
    r, p = stats.pearsonr(x, y)
    n = len(x)
    z = math.atanh(r)
    h = Z / math.sqrt(n - 3)
    return dict(r=float(r), pValue=float(p), lower=math.tanh(z - h), upper=math.tanh(z + h))


method('roadmap-correlation', 'pearson', 'packages/stats/src/agreement.ts',
       'pearson(x: readonly number[], y: readonly number[]): { r: number; pValue: number; lower: number; upper: number }',
       "Pearson's r, the two-sided t-test p-value, and the Fisher z interval tanh(atanh(r) -/+ z / sqrt(n - 3))",
       'scipy.stats.pearsonr',
       [dict(args=[x, y], expect=pearson(x, y)) for x, y in XY], tol=1e-9, tier=3)


def spear(x, y):
    r = stats.spearmanr(x, y)
    return dict(rho=float(r.statistic), pValue=float(r.pvalue))


method('roadmap-correlation', 'spearman', 'packages/stats/src/agreement.ts',
       'spearman(x: readonly number[], y: readonly number[]): { rho: number; pValue: number }',
       "Spearman's rho, the Pearson r of the average ranks, with the t-distribution p-value (n - 2 df)",
       'scipy.stats.spearmanr',
       [dict(args=[x, y], expect=spear(x, y)) for x, y in XY], tol=1e-9, tier=3)


def kendall(x, y):
    r = stats.kendalltau(x, y, method='asymptotic')
    return dict(tau=float(r.statistic), pValue=float(r.pvalue))


method('roadmap-correlation', 'kendallTau', 'packages/stats/src/agreement.ts',
       'kendallTau(x: readonly number[], y: readonly number[]): { tau: number; pValue: number }',
       "Kendall's tau-b with the asymptotic two-sided p-value (tie-corrected variance)",
       "scipy.stats.kendalltau(method='asymptotic')",
       [dict(args=[x, y], expect=kendall(x, y)) for x, y in XY], tol=1e-9, tier=4)


def cohens_d(x, y):
    x, y = np.array(x, float), np.array(y, float)
    nx, ny = len(x), len(y)
    sp = math.sqrt(((nx - 1) * x.var(ddof=1) + (ny - 1) * y.var(ddof=1)) / (nx + ny - 2))
    d = (x.mean() - y.mean()) / sp
    j = 1 - 3 / (4 * (nx + ny) - 9)
    return dict(d=float(d), g=float(d * j))


method('roadmap-correlation', 'cohensD', 'packages/stats/src/paired.ts',
       'cohensD(x: readonly number[], y: readonly number[]): { d: number; g: number }',
       "Cohen's d with the pooled standard deviation, and Hedges' g = d (1 - 3 / (4 (nx + ny) - 9))",
       'Hedges and Olkin 1985',
       [dict(args=[x, y], expect=cohens_d(x, y)) for x, y in XY], tol=1e-12, tier=3)


def cliff(x, y):
    gt = sum(1 for a in x for b in y if a > b)
    lt = sum(1 for a in x for b in y if a < b)
    return (gt - lt) / (len(x) * len(y))


method('roadmap-correlation', 'cliffsDelta', 'packages/stats/src/paired.ts',
       "cliffsDelta(x: readonly number[], y: readonly number[]): number",
       "Cliff's delta: (#(x > y) - #(x < y)) / (nx ny) over all pairs",
       'Cliff 1993',
       [dict(args=[x, y], expect=cliff(x, y)) for x, y in XY], tol=1e-12, tier=3)

# --- more tests -------------------------------------------------------------------------------------------
ONE = [[5.1, 4.9, 5.6, 5.8, 6.0, 5.5, 5.3], [0.2, -0.1, 0.4, 0.3, 0.1], [12, 15, 11, 14, 13, 16, 10, 12]]
method('roadmap-tests', 'oneSampleT', 'packages/stats/src/paired.ts',
       'oneSampleT(values: readonly number[], mu = 0): { statistic: number; df: number; pValue: number }',
       "One-sample Student's t test of the mean against mu, two-sided",
       'scipy.stats.ttest_1samp',
       [dict(args=[v, m], expect=dict(statistic=float(stats.ttest_1samp(v, m).statistic), df=len(v) - 1, pValue=float(stats.ttest_1samp(v, m).pvalue))) for v, m in zip(ONE, [5, 0, 12])], tol=1e-9, tier=3)
PT = [([0.8, 0.7, 0.9, 0.6, 0.75], [0.7, 0.72, 0.8, 0.5, 0.7]), ([10, 12, 9, 14], [11, 12, 10, 12]), ([3, 5, 2, 8, 6, 7], [4, 4, 4, 4, 5, 5])]
method('roadmap-tests', 'pairedT', 'packages/stats/src/paired.ts',
       'pairedT(x: readonly number[], y: readonly number[]): { statistic: number; df: number; pValue: number }',
       "Paired Student's t test on x - y, two-sided",
       'scipy.stats.ttest_rel',
       [dict(args=[x, y], expect=dict(statistic=float(stats.ttest_rel(x, y).statistic), df=len(x) - 1, pValue=float(stats.ttest_rel(x, y).pvalue))) for x, y in PT], tol=1e-9, tier=3)
method('roadmap-tests', 'binomialTest', 'packages/stats/src/paired.ts',
       'binomialTest(k: number, n: number, p = 0.5): number',
       'Exact two-sided binomial test p-value: the sum of the probabilities of the outcomes no more likely than k (relative tolerance 1e-7)',
       'scipy.stats.binomtest',
       [dict(args=[k, n, p], expect=float(stats.binomtest(k, n, p).pvalue)) for k, n, p in [(7, 10, 0.5), (2, 20, 0.3), (45, 60, 0.6)]], tol=1e-9, tier=3)


def kw(*g):
    r = stats.kruskal(*g)
    return dict(statistic=float(r.statistic), df=len(g) - 1, pValue=float(r.pvalue))


KW = [([2.9, 3.0, 2.5, 2.6, 3.2], [3.8, 2.7, 4.0, 2.4], [2.8, 3.4, 3.7, 2.2, 2.0]), ([1, 2, 2, 3], [3, 4, 4, 5], [5, 6, 6, 7]), ([10, 20], [15, 25, 35], [5, 8, 12, 30])]
method('roadmap-tests', 'kruskalWallis', 'packages/stats/src/paired.ts',
       'kruskalWallis(groups: readonly (readonly number[])[]): { statistic: number; df: number; pValue: number }',
       'Kruskal-Wallis H test with the tie correction, chi-square p-value with k - 1 df',
       'scipy.stats.kruskal',
       [dict(args=[list(map(list, g))], expect=kw(*g)) for g in KW], tol=1e-9, tier=4)
FR = [([7, 9, 8, 6, 7], [5, 6, 7, 5, 6], [8, 9, 9, 7, 8]), ([1, 2, 3, 4], [2, 3, 4, 1], [3, 4, 1, 2]), ([10, 12, 11, 14, 13, 12], [9, 11, 12, 10, 11, 11], [12, 14, 13, 15, 14, 13])]


def fried(*g):
    r = stats.friedmanchisquare(*g)
    return dict(statistic=float(r.statistic), df=len(g) - 1, pValue=float(r.pvalue))


method('roadmap-tests', 'friedman', 'packages/stats/src/paired.ts',
       'friedman(treatments: readonly (readonly number[])[]): { statistic: number; df: number; pValue: number }',
       'Friedman test for k treatments measured on the same blocks (each array one treatment, aligned by block), with the tie correction, chi-square p-value with k - 1 df',
       'scipy.stats.friedmanchisquare',
       [dict(args=[list(map(list, g))], expect=fried(*g)) for g in FR], tol=1e-9, tier=4)


def cochran(m):
    x = np.array(m)
    k = x.shape[1]
    c = x.sum(0)
    r = x.sum(1)
    n = x.sum()
    q = (k - 1) * (k * (c ** 2).sum() - n ** 2) / (k * n - (r ** 2).sum())
    return dict(statistic=float(q), df=k - 1, pValue=float(stats.chi2.sf(q, k - 1)))


CQ = [[[1, 1, 0], [1, 0, 0], [1, 1, 1], [0, 0, 0], [1, 0, 1], [1, 1, 0]], [[1, 0], [1, 0], [0, 1], [1, 0], [1, 1]], [[1, 1, 1, 0], [0, 1, 0, 0], [1, 1, 0, 1], [1, 0, 0, 0], [1, 1, 1, 1], [0, 1, 0, 0]]]
method('roadmap-tests', 'cochranQ', 'packages/stats/src/paired.ts',
       'cochranQ(outcomes: readonly (readonly (0 | 1)[])[]): { statistic: number; df: number; pValue: number }',
       "Cochran's Q test for k binary treatments on the same subjects (rows subjects, columns treatments): Q = (k - 1)(k sum C_j^2 - N^2) / (k N - sum R_i^2), chi-square with k - 1 df (the multi-model McNemar)",
       'Cochran 1950; statsmodels cochrans_q',
       [dict(args=[m], expect=cochran(m)) for m in CQ], tol=1e-9, tier=4)


def midp(b, c):
    n = b + c
    k = min(b, c)
    return float(min(1, 2 * (stats.binom.cdf(k, n, 0.5) - 0.5 * stats.binom.pmf(k, n, 0.5))))


method('roadmap-tests', 'mcnemarMidP', 'packages/stats/src/paired.ts',
       'mcnemarMidP(b: number, c: number): number',
       'The mid-p McNemar test: 2 (P(X <= min(b, c)) - P(X = min(b, c)) / 2), X ~ Binomial(b + c, 1/2), capped at 1 (Fagerland, Lydersen and Laake 2013 recommend it)',
       'Fagerland, Lydersen and Laake 2013',
       [dict(args=[b, c], expect=midp(b, c)) for b, c in [(3, 9), (10, 4), (1, 7)]], tol=1e-12, tier=3)

# --- robust and descriptive -------------------------------------------------------------------------------
RB = [[2.1, 3.4, 1.9, 5.6, 4.2, 30.0, 2.8, 3.3, 4.1, 2.6], [10, 12, 9, 11, 13, 10, 12, 30, -5, 11, 10], [0.5, 0.7, 0.2, 0.9, 0.4, 0.8, 0.1, 0.6]]
method('roadmap-robust', 'trimmedMean', 'packages/stats/src/basics.ts',
       'trimmedMean(values: readonly number[], proportion = 0.1): number',
       'Mean after removing floor(proportion n) values from each end of the sorted sample',
       'scipy.stats.trim_mean',
       [dict(args=[v, 0.1], expect=float(stats.trim_mean(v, 0.1))) for v in RB], tol=1e-12, tier=3)


def wins(v, p):
    x = np.sort(np.array(v, float))
    g = int(math.floor(p * len(x)))
    x[:g] = x[g]
    x[len(x) - g:] = x[len(x) - g - 1]
    return float(x.mean())


method('roadmap-robust', 'winsorizedMean', 'packages/stats/src/basics.ts',
       'winsorizedMean(values: readonly number[], proportion = 0.1): number',
       'Mean after replacing the floor(proportion n) smallest values by the next one and the same number of largest by the previous one',
       'scipy.stats.mstats.winsorize, then the mean',
       [dict(args=[v, 0.1], expect=wins(v, 0.1)) for v in RB], tol=1e-12, tier=3)
method('roadmap-robust', 'medianAbsoluteDeviation', 'packages/stats/src/basics.ts',
       'medianAbsoluteDeviation(values: readonly number[]): number',
       'The median of |x - median(x)| (no scale factor)',
       'scipy.stats.median_abs_deviation(scale=1)',
       [dict(args=[v], expect=float(stats.median_abs_deviation(v))) for v in RB], tol=1e-12, tier=2)
method('roadmap-robust', 'interquartileRange', 'packages/stats/src/basics.ts',
       'interquartileRange(values: readonly number[]): number',
       'The 75th minus the 25th percentile, type 7 quantiles',
       'scipy.stats.iqr',
       [dict(args=[v], expect=float(stats.iqr(v))) for v in RB], tol=1e-12, tier=2)
method('roadmap-robust', 'skewness', 'packages/stats/src/basics.ts',
       'skewness(values: readonly number[]): number',
       'The adjusted Fisher-Pearson sample skewness G1 = sqrt(n (n - 1)) / (n - 2) m3 / m2^(3/2)',
       'scipy.stats.skew(bias=False)',
       [dict(args=[v], expect=float(stats.skew(v, bias=False))) for v in RB], tol=1e-9, tier=3)
method('roadmap-robust', 'excessKurtosis', 'packages/stats/src/basics.ts',
       'excessKurtosis(values: readonly number[]): number',
       'The bias-corrected sample excess kurtosis G2 = ((n + 1) g2 + 6) (n - 1) / ((n - 2)(n - 3)), g2 = m4 / m2^2 - 3',
       'scipy.stats.kurtosis(fisher=True, bias=False)',
       [dict(args=[v], expect=float(stats.kurtosis(v, fisher=True, bias=False))) for v in RB], tol=1e-9, tier=3)


def hl(v):
    v = list(v)
    w = [(v[i] + v[j]) / 2 for i in range(len(v)) for j in range(i, len(v))]
    return float(np.median(w))


method('roadmap-robust', 'hodgesLehmann', 'packages/stats/src/basics.ts',
       'hodgesLehmann(values: readonly number[]): number',
       'The Hodges-Lehmann location estimate: the median of the Walsh averages (x_i + x_j) / 2 over i <= j',
       'Hodges and Lehmann 1963',
       [dict(args=[v], expect=hl(v)) for v in RB], tol=1e-12, tier=3)
WV = [([1, 2, 3, 4], [1, 1, 1, 1]), ([10, 20, 30], [3, 1, 1]), ([0.2, 0.8, 0.5, 0.9, 0.1], [5, 1, 2, 2, 4])]
method('roadmap-robust', 'weightedMean', 'packages/stats/src/basics.ts',
       'weightedMean(values: readonly number[], weights: readonly number[]): number',
       'sum w x / sum w',
       'numpy.average',
       [dict(args=[v, w], expect=float(np.average(v, weights=w))) for v, w in WV], tol=1e-12, tier=2)


def wvar(v, w):
    v, w = np.array(v, float), np.array(w, float)
    m = np.average(v, weights=w)
    v1, v2 = w.sum(), (w ** 2).sum()
    return float((w * (v - m) ** 2).sum() / (v1 - v2 / v1))


method('roadmap-robust', 'weightedVariance', 'packages/stats/src/basics.ts',
       'weightedVariance(values: readonly number[], weights: readonly number[]): number',
       'Unbiased weighted variance with reliability weights: sum w (x - m)^2 / (V1 - V2 / V1), V1 = sum w, V2 = sum w^2',
       'GNU Scientific Library gsl_stats_wvariance',
       [dict(args=[v, w], expect=wvar(v, w)) for v, w in WV], tol=1e-12, tier=3)


# --- agreement beyond two raters (parity: kappa, Krippendorff and inter-annotator agreement) ----------------
RATINGS = [[[0, 0, 0], [1, 1, 0], [1, 1, 1], [2, 2, 2], [0, 1, 0], [2, 1, 2], [1, 1, 1], [0, 0, 1]],
           [['a', 'a', 'b', 'a'], ['b', 'b', 'b', 'b'], ['a', 'b', 'a', 'a'], ['c', 'c', 'c', 'b'], ['a', 'a', 'a', 'a']],
           [[1, 1], [0, 0], [1, 0], [1, 1], [0, 0], [0, 1], [1, 1]],
           [[3, 3, 2], [1, 1, 1], [2, 3, 2], [3, 3, 3], [1, 2, 1], [2, 2, 2]]]


def fleiss(rows):
    cats = sorted({str(x) for r in rows for x in r})
    n = len(rows[0])
    N = len(rows)
    counts = np.array([[sum(1 for x in r if str(x) == c) for c in cats] for r in rows], float)
    p = counts.sum(0) / (N * n)
    P = ((counts ** 2).sum(1) - n) / (n * (n - 1))
    Pb, Pe = P.mean(), (p ** 2).sum()
    return float((Pb - Pe) / (1 - Pe))


method('roadmap-agreement', 'fleissKappa', 'packages/stats/src/agreement.ts',
       'fleissKappa(ratings: readonly (readonly Label[])[]): number',
       "Fleiss' kappa for a fixed number of raters per item (rows items, columns raters): (Pbar - Pe) / (1 - Pe), P_i = (sum_j n_ij^2 - n) / (n (n - 1)), Pe = sum_j p_j^2",
       'Fleiss 1971; statsmodels fleiss_kappa',
       [dict(args=[r], expect=fleiss(r)) for r in RATINGS], tol=1e-12, tier=3)


def gwet(rows):
    cats = sorted({str(x) for r in rows for x in r})
    q = len(cats)
    n = len(rows[0])
    N = len(rows)
    counts = np.array([[sum(1 for x in r if str(x) == c) for c in cats] for r in rows], float)
    pa = (((counts * (counts - 1)).sum(1)) / (n * (n - 1))).mean()
    pi = counts.sum(0) / (N * n)
    pe = (pi * (1 - pi)).sum() / (q - 1)
    return float((pa - pe) / (1 - pe))


method('roadmap-agreement', 'gwetAC1', 'packages/stats/src/agreement.ts',
       'gwetAC1(ratings: readonly (readonly Label[])[]): number',
       "Gwet's AC1 for a fixed number of raters per item: (pa - pe) / (1 - pe), pa the mean pairwise agreement per item, pe = sum_k pi_k (1 - pi_k) / (q - 1), pi_k the overall share of category k, q the categories",
       'Gwet 2008, Computing inter-rater reliability and its variance in the presence of high agreement',
       [dict(args=[r], expect=gwet(r)) for r in RATINGS], tol=1e-12, tier=4)


def scott(rows):
    a = [str(r[0]) for r in rows]
    b = [str(r[1]) for r in rows]
    cats = sorted(set(a) | set(b))
    po = np.mean([x == y for x, y in zip(a, b)])
    pe = sum(((a.count(c) + b.count(c)) / (2 * len(a))) ** 2 for c in cats)
    return float((po - pe) / (1 - pe))


method('roadmap-agreement', 'scottPi', 'packages/stats/src/agreement.ts',
       'scottPi(a: readonly Label[], b: readonly Label[]): number',
       "Scott's pi for two raters: (po - pe) / (1 - pe), pe = sum_k ((n_ak + n_bk) / 2n)^2 from the pooled shares",
       'Scott 1955',
       [dict(args=[[r[0] for r in rows], [r[1] for r in rows]], expect=scott(rows)) for rows in RATINGS], tol=1e-12, tier=3)


def icc21(rows):
    x = np.array(rows, float)
    n, k = x.shape
    g = x.mean()
    msr = k * ((x.mean(1) - g) ** 2).sum() / (n - 1)
    msc = n * ((x.mean(0) - g) ** 2).sum() / (k - 1)
    sse = ((x - x.mean(1, keepdims=True) - x.mean(0, keepdims=True) + g) ** 2).sum()
    mse = sse / ((n - 1) * (k - 1))
    return float((msr - mse) / (msr + (k - 1) * mse + k * (msc - mse) / n))


NUM = [r for r in RATINGS if not isinstance(r[0][0], str)] + [[[9, 8, 9], [6, 6, 7], [8, 8, 8], [7, 6, 6], [10, 9, 9], [5, 6, 5]]]
method('roadmap-agreement', 'icc21', 'packages/stats/src/variance.ts',
       'icc21(scores: readonly (readonly number[])[]): number',
       'ICC(2,1), two-way random effects, absolute agreement, single rater (Shrout and Fleiss 1979): (MSR - MSE) / (MSR + (k - 1) MSE + k (MSC - MSE) / n), rows targets, columns raters',
       'Shrout and Fleiss 1979; pingouin intraclass_corr ICC2',
       [dict(args=[r], expect=icc21(r)) for r in NUM], tol=1e-12, tier=4)


def pct(rows):
    n = len(rows[0])
    return float(np.mean([sum(1 for i in range(n) for j in range(i + 1, n) if str(r[i]) == str(r[j])) / (n * (n - 1) / 2) for r in rows]))


method('roadmap-agreement', 'percentAgreement', 'packages/stats/src/agreement.ts',
       'percentAgreement(ratings: readonly (readonly Label[])[]): number',
       'The mean over items of the share of rater pairs that agree',
       'inter-annotator agreement, raw form',
       [dict(args=[r], expect=pct(r)) for r in RATINGS], tol=1e-12, tier=2)

# --- trend and drift over time ------------------------------------------------------------------------------
SER = [[0.71, 0.74, 0.69, 0.73, 0.76, 0.75, 0.79, 0.78, 0.81, 0.8],
       [5, 4, 6, 3, 5, 4, 2, 3, 2, 1, 2],
       [1.0, 1.2, 0.9, 1.1, 1.0, 0.95, 1.05, 1.0],
       [3, 3, 4, 4, 4, 5, 5, 6, 6, 6, 7, 8]]


def mk(x):
    x = list(x)
    n = len(x)
    s = sum(np.sign(x[j] - x[i]) for i in range(n) for j in range(i + 1, n))
    _, counts = np.unique(x, return_counts=True)
    var = (n * (n - 1) * (2 * n + 5) - sum(t * (t - 1) * (2 * t + 5) for t in counts)) / 18
    z = (s - 1) / math.sqrt(var) if s > 0 else ((s + 1) / math.sqrt(var) if s < 0 else 0.0)
    return dict(s=float(s), z=float(z), pValue=float(2 * stats.norm.sf(abs(z))))


method('roadmap-trend', 'mannKendall', 'packages/stats/src/drift.ts',
       'mannKendall(series: readonly number[]): { s: number; z: number; pValue: number }',
       'Mann-Kendall trend test: S = sum over i < j of sign(x_j - x_i), variance (n(n - 1)(2n + 5) - sum over tie groups t(t - 1)(2t + 5)) / 18, z with the continuity correction (S - 1 or S + 1), two-sided normal p-value',
       'Mann 1945; Kendall 1975',
       [dict(args=[x], expect=mk(x)) for x in SER], tol=1e-9, tier=4)


def sen(x):
    sl = [(x[j] - x[i]) / (j - i) for i in range(len(x)) for j in range(i + 1, len(x))]
    return float(np.median(sl))


method('roadmap-trend', 'senSlope', 'packages/stats/src/drift.ts',
       'senSlope(series: readonly number[]): number',
       "Sen's slope (Theil-Sen): the median over i < j of (x_j - x_i) / (j - i), the index as time",
       'Sen 1968',
       [dict(args=[x], expect=sen(x)) for x in SER], tol=1e-12, tier=3)


def acf(x, lag):
    x = np.array(x, float)
    m = x.mean()
    return float(((x[:-lag] - m) * (x[lag:] - m)).sum() / ((x - m) ** 2).sum())


method('roadmap-trend', 'autocorrelation', 'packages/stats/src/drift.ts',
       'autocorrelation(series: readonly number[], lag: number): number',
       'The sample autocorrelation at a lag: sum (x_t - m)(x_t+lag - m) / sum (x_t - m)^2 (the statsmodels acf estimator)',
       'statsmodels.tsa.stattools.acf',
       [dict(args=[x, 1], expect=acf(x, 1)) for x in SER], tol=1e-12, tier=3)


def ljung(x, h):
    n = len(x)
    q = n * (n + 2) * sum(acf(x, k) ** 2 / (n - k) for k in range(1, h + 1))
    return dict(statistic=float(q), pValue=float(stats.chi2.sf(q, h)))


method('roadmap-trend', 'ljungBox', 'packages/stats/src/drift.ts',
       'ljungBox(series: readonly number[], lags: number): { statistic: number; pValue: number }',
       'Ljung-Box test: Q = n (n + 2) sum from k = 1 to h of r_k^2 / (n - k), chi-square p-value with h df',
       'Ljung and Box 1978; statsmodels acorr_ljungbox',
       [dict(args=[x, 2], expect=ljung(x, 2)) for x in SER], tol=1e-9, tier=4)


def ewma(x, lam):
    z = x[0]
    out = []
    for v in x:
        z = lam * v + (1 - lam) * z
        out.append(z)
    return out


method('roadmap-trend', 'ewma', 'packages/stats/src/drift.ts',
       'ewma(series: readonly number[], lambda: number): number[]',
       'Exponentially weighted moving average z_t = lambda x_t + (1 - lambda) z_(t-1), started at z_0 = x_0 (so the first value is x_0)',
       'Roberts 1959, the EWMA control chart',
       [dict(args=[x, 0.3], expect=ewma(x, 0.3)) for x in SER], tol=1e-12, tier=2)


def ess_ac(x):
    n = len(x)
    r1 = acf(x, 1)
    return float(n * (1 - r1) / (1 + r1))


method('roadmap-trend', 'effectiveSizeAutocorrelated', 'packages/stats/src/drift.ts',
       'effectiveSizeAutocorrelated(series: readonly number[]): number',
       'Effective sample size of an AR(1)-like series: n (1 - r1) / (1 + r1), r1 the lag-1 autocorrelation',
       'the AR(1) variance inflation of the mean (dossier S22, clustered and correlated units)',
       [dict(args=[x], expect=ess_ac(x)) for x in SER], tol=1e-12, tier=3)

# --- power and sample size -----------------------------------------------------------------------------------
def connor(p10, p01, a=0.05, pw=0.8):
    pd = p10 + p01
    d = p10 - p01
    za, zb = stats.norm.ppf(1 - a / 2), stats.norm.ppf(pw)
    return math.ceil((za * math.sqrt(pd) + zb * math.sqrt(pd - d * d)) ** 2 / (d * d))


method('roadmap-power', 'mcnemarSampleSize', 'packages/stats/src/power.ts',
       'mcnemarSampleSize(input: { regressed: number; improved: number; alpha?: number; power?: number }): number',
       'Pairs needed to detect a paired change with McNemar (Connor 1987): ceil((z(1-alpha/2) sqrt(pd) + z(power) sqrt(pd - d^2))^2 / d^2), pd = regressed + improved, d = regressed - improved (shares of pairs)',
       'Connor 1987, Sample size for testing differences in proportions for the paired-sample design',
       [dict(args=[dict(regressed=a, improved=b)], expect=connor(a, b)) for a, b in [(0.1, 0.05), (0.2, 0.1), (0.08, 0.02), (0.15, 0.12)]], tol=0, tier=4)


def power2(n, p1, p2, a=0.05):
    za = stats.norm.ppf(1 - a / 2)
    pb = (p1 + p2) / 2
    num = abs(p1 - p2) * math.sqrt(n) - za * math.sqrt(2 * pb * (1 - pb))
    return float(stats.norm.cdf(num / math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))))


method('roadmap-power', 'powerTwoProportions', 'packages/stats/src/power.ts',
       'powerTwoProportions(input: { n: number; p1: number; p2: number; alpha?: number }): number',
       'Power of the two-sided two-proportion test with n per group (the inverse of mde, normal approximation, no continuity correction, the far tail ignored): Phi((|p1 - p2| sqrt(n) - z(1-alpha/2) sqrt(2 pbar (1 - pbar))) / sqrt(p1 q1 + p2 q2))',
       'Fleiss, Levin and Paik 2003',
       [dict(args=[dict(n=n, p1=a, p2=b)], expect=power2(n, a, b)) for n, a, b in [(100, 0.8, 0.7), (300, 0.9, 0.85), (50, 0.5, 0.3), (1000, 0.6, 0.57)]], tol=1e-9, tier=3)


def ni_n(p, margin, a=0.05, pw=0.8):
    za, zb = stats.norm.ppf(1 - a), stats.norm.ppf(pw)
    return math.ceil((za + zb) ** 2 * 2 * p * (1 - p) / margin ** 2)


method('roadmap-power', 'nonInferioritySampleSize', 'packages/stats/src/power.ts',
       'nonInferioritySampleSize(input: { rate: number; margin: number; alpha?: number; power?: number }): number',
       'Units per version to show non-inferiority within a margin when both versions truly pass at the same rate (one-sided alpha): ceil((z(1-alpha) + z(power))^2 2 p (1 - p) / margin^2)',
       'Chow, Shao and Wang 2008, section 4.2',
       [dict(args=[dict(rate=p, margin=m)], expect=ni_n(p, m)) for p, m in [(0.8, 0.05), (0.9, 0.03), (0.6, 0.1), (0.95, 0.02)]], tol=0, tier=3)


def cl_n(p, eps, m, rho, a=0.05):
    za = stats.norm.ppf(1 - a / 2)
    n0 = za * za * p * (1 - p) / (eps * eps)
    return math.ceil(n0 * (1 + (m - 1) * rho) / m)


method('roadmap-power', 'clusterSampleSize', 'packages/stats/src/power.ts',
       'clusterSampleSize(input: { rate: number; epsilon: number; clusterSize: number; rho: number; alpha?: number }): number',
       'Conversations needed for a rate within +/- epsilon when each conversation holds clusterSize correlated blocks: ceil(z^2 p (1 - p) / epsilon^2 x (1 + (m - 1) rho) / m)',
       'dossier section 3.1 (the design effect correction of the planning size)',
       [dict(args=[dict(rate=p, epsilon=e, clusterSize=m, rho=r)], expect=cl_n(p, e, m, r)) for p, e, m, r in [(0.5, 0.05, 8, 0.3), (0.8, 0.05, 4, 0.1), (0.9, 0.02, 10, 0.5), (0.7, 0.1, 6, 0.2)]], tol=0, tier=3)


def tost(k1, n1, k2, n2, margin, a=0.05):
    p1, p2 = k1 / n1, k2 / n2
    se = math.sqrt(p1 * (1 - p1) / n1 + p2 * (1 - p2) / n2)
    d = p1 - p2
    pl = stats.norm.sf((d + margin) / se)
    pu = stats.norm.cdf((d - margin) / se)
    p = max(pl, pu)
    return dict(pValue=float(p), equivalent=bool(p < a))


method('roadmap-power', 'tostEquivalence', 'packages/stats/src/paired.ts',
       'tostEquivalence(input: { k1: number; n1: number; k2: number; n2: number; margin: number; alpha?: number }): { pValue: number; equivalent: boolean }',
       'Two one-sided tests for the equivalence of two rates within +/- margin (Wald standard error sqrt(p1 q1 / n1 + p2 q2 / n2)): p = max(P(Z > (d + margin) / se), P(Z < (d - margin) / se)); equivalent when p < alpha',
       'Schuirmann 1987',
       [dict(args=[dict(k1=a, n1=b, k2=c, n2=d, margin=m)], expect=tost(a, b, c, d, m)) for a, b, c, d, m in [(80, 100, 78, 100, 0.1), (160, 200, 150, 200, 0.05), (45, 50, 40, 50, 0.1), (300, 400, 290, 400, 0.05)]], tol=1e-9, tier=4)

# --- more intervals ------------------------------------------------------------------------------------------
TB = [(20, 10, 15, 25), (5, 45, 2, 48), (30, 20, 30, 20), (12, 8, 4, 16)]


def woolf(a, b, c, d):
    o = a * d / (b * c)
    se = math.sqrt(1 / a + 1 / b + 1 / c + 1 / d)
    return dict(estimate=o, lower=math.exp(math.log(o) - Z * se), upper=math.exp(math.log(o) + Z * se))


method('roadmap-intervals', 'oddsRatioInterval', 'packages/stats/src/intervals.ts',
       'oddsRatioInterval(a: number, b: number, c: number, d: number): Interval',
       'Woolf (logit) interval for the odds ratio ad / bc of [[a, b], [c, d]]: exp(ln OR -/+ z sqrt(1/a + 1/b + 1/c + 1/d)); cases have no zero cell',
       'Woolf 1955',
       [dict(args=list(t), expect=woolf(*t)) for t in TB], tol=1e-9, tier=3)


def katz(a, b, c, d):
    r = (a / (a + b)) / (c / (c + d))
    se = math.sqrt(1 / a - 1 / (a + b) + 1 / c - 1 / (c + d))
    return dict(estimate=r, lower=math.exp(math.log(r) - Z * se), upper=math.exp(math.log(r) + Z * se))


method('roadmap-intervals', 'relativeRiskInterval', 'packages/stats/src/intervals.ts',
       'relativeRiskInterval(a: number, b: number, c: number, d: number): Interval',
       'Katz log interval for the risk ratio (a / (a + b)) / (c / (c + d)): exp(ln RR -/+ z sqrt(1/a - 1/(a + b) + 1/c - 1/(c + d)))',
       'Katz and co-authors 1978',
       [dict(args=list(t), expect=katz(*t)) for t in TB], tol=1e-9, tier=3)


def hoeff_iv(k, n, d=0.05):
    h = math.sqrt(math.log(2 / d) / (2 * n))
    return dict(estimate=k / n, lower=max(0.0, k / n - h), upper=min(1.0, k / n + h))


method('roadmap-intervals', 'hoeffdingInterval', 'packages/stats/src/intervals.ts',
       'hoeffdingInterval(k: number, n: number, delta = 0.05): Interval',
       "Distribution-free interval from Hoeffding's inequality: k / n -/+ sqrt(ln(2 / delta) / (2n)), clipped to [0, 1]",
       'Hoeffding 1963 (dossier S35)',
       [dict(args=[k, n], expect=hoeff_iv(k, n)) for k, n in KN], tol=1e-12, tier=3)


def beta_post(k, n, a0=1, b0=1, a=0.05):
    return dict(estimate=(a0 + k) / (a0 + b0 + n), lower=float(stats.beta.ppf(a / 2, a0 + k, b0 + n - k)), upper=float(stats.beta.ppf(1 - a / 2, a0 + k, b0 + n - k)))


method('roadmap-intervals', 'betaPosteriorInterval', 'packages/stats/src/intervals.ts',
       'betaPosteriorInterval(k: number, n: number, priorA = 1, priorB = 1, alpha = 0.05): Interval',
       'Equal-tailed Bayesian credible interval of a rate under a Beta(priorA, priorB) prior: Beta(priorA + k, priorB + n - k) quantiles at alpha/2 and 1 - alpha/2; estimate the posterior mean',
       'dossier section 3.1 (Bayesian stopping, S17, S27)',
       [dict(args=[k, n], expect=beta_post(k, n)) for k, n in KN], tol=1e-7, tier=3)


def cs_normal_mixture(k, n, rho=0.5, a=0.05):
    # Howard et al. normal mixture boundary for a [0, 1] bounded mean (sub-Gaussian with sigma 1/2).
    v = n / 4
    w = math.sqrt(2 * (v + rho) * math.log(math.sqrt((v + rho) / rho) / a))
    m = k / n
    return dict(estimate=m, lower=max(0.0, m - w / n), upper=min(1.0, m + w / n))


method('roadmap-sequential', 'confidenceSequence', 'packages/stats/src/intervals.ts',
       'confidenceSequence(k: number, n: number, alpha = 0.05, rho = 0.5): Interval',
       'A time-uniform confidence sequence for a pass rate (Howard, Ramdas, McAuliffe and Sekhon, the two-sided normal-mixture boundary with sub-Gaussian variance proxy 1/4 per unit): half-width sqrt(2 (V + rho) ln(sqrt((V + rho) / rho) / alpha)) / n, V = n / 4; clipped to [0, 1]; valid at every n, so it can be watched continuously (dossier S6, S7)',
       'Howard, Ramdas, McAuliffe and Sekhon 2021 (dossier S7)',
       [dict(args=[k, n], expect=cs_normal_mixture(k, n)) for k, n in [(3, 20), (17, 40), (80, 100), (450, 500)]], tol=1e-12, tier=5)


# --- extension after the pilot (section 12.4.4): more of what the dossiers and parity notes name ------------
def gt_smoothed(c):
    c = [x for x in c if x > 0]
    from collections import Counter
    N = Counter(c)
    out = {}
    for r in sorted(N):
        out[str(r)] = (r + 1) * N.get(r + 1, 0) / N[r]
    return out


GTC = [[1, 1, 1, 2, 2, 3, 1, 4, 2, 1], [5, 1, 1, 2, 3, 1, 2, 1, 1, 1, 2], [1, 2, 3, 4, 1, 1, 2]]
method('roadmap-diversity', 'turingAdjustedCounts', 'packages/stats/src/coverage.ts',
       'turingAdjustedCounts(counts: readonly number[]): Record<string, number>',
       'The Turing estimator of the adjusted count of a class seen r times: r* = (r + 1) N(r + 1) / N(r), N(r) the number of classes seen exactly r times, for each r observed (key the count r as a string); 0 when no class was seen r + 1 times',
       'Good 1953; Good-Turing frequency estimation (dossier S9)',
       [dict(args=[c], expect=gt_smoothed(c)) for c in GTC], tol=1e-12, tier=3)


def ichao1(c):
    c = np.array([x for x in c if x > 0])
    n = c.sum()
    s = len(c)
    f = lambda k: int((c == k).sum())
    f1, f2, f3, f4 = f(1), f(2), f(3), f(4)
    chao = s + (n - 1) / n * (f1 * f1 / (2 * f2) if f2 > 0 else f1 * (f1 - 1) / 2)
    f4c = max(f4, 1)
    return float(chao + (n - 3) / (4 * n) * f3 / f4c * max(f1 - (n - 3) / (2 * (n - 1)) * f2 * f3 / f4c, 0))


IC = [[1, 1, 1, 2, 2, 3, 3, 4, 5, 8, 1, 1, 2, 6], [10, 4, 3, 3, 2, 2, 1, 1, 1, 1, 4, 3], [1, 2, 3, 4, 4, 1, 1, 2, 7, 9, 1]]
method('roadmap-diversity', 'iChao1', 'packages/stats/src/coverage.ts',
       'iChao1(counts: readonly number[]): number',
       'The improved Chao1 lower bound (Chiu, Wang, Walther and Chao 2014): Chao1 + ((n - 3) / (4n)) (f3 / f4) max(f1 - ((n - 3) / (2(n - 1))) f2 f3 / f4, 0), f4 replaced by 1 when 0; Chao1 with the bias-corrected form when f2 = 0',
       'Chiu, Wang, Walther and Chao 2014, Biometrics',
       [dict(args=[c], expect=ichao1(c)) for c in IC], tol=1e-9, tier=5)


def jack(c, order):
    c = np.array([x for x in c if x > 0])
    n = c.sum()
    s = len(c)
    f1, f2 = int((c == 1).sum()), int((c == 2).sum())
    if order == 1:
        return float(s + f1 * (n - 1) / n)
    return float(s + f1 * (2 * n - 3) / n - f2 * (n - 2) ** 2 / (n * (n - 1)))


method('roadmap-diversity', 'jackknifeRichness', 'packages/stats/src/coverage.ts',
       'jackknifeRichness(counts: readonly number[], order: 1 | 2): number',
       'Jackknife richness estimators for abundance data (Burnham and Overton): first order S + f1 (n - 1)/n; second order S + f1 (2n - 3)/n - f2 (n - 2)^2 / (n (n - 1))',
       'Burnham and Overton 1979; EstimateS',
       [dict(args=[c, o], expect=jack(c, o)) for c, o in [(IC[0], 1), (IC[1], 1), (IC[0], 2), (IC[2], 2)]], tol=1e-12, tier=4)


def simpson_unbiased(c):
    c = np.array([x for x in c if x > 0], float)
    n = c.sum()
    return float(n * (n - 1) / (c * (c - 1)).sum())


method('roadmap-diversity', 'hillQ2Estimator', 'packages/stats/src/coverage.ts',
       'hillQ2Estimator(counts: readonly number[]): number',
       'The nearly unbiased inverse Simpson (Hill number of order 2) estimator: n (n - 1) / sum x (x - 1)',
       'Chao, Gotelli and co-authors 2014 (dossier S24)',
       [dict(args=[c], expect=simpson_unbiased(c)) for c in IC], tol=1e-12, tier=3)


def chao2(m):
    x = np.array(m)
    T = x.shape[0]
    q = x.sum(0)
    q = q[q > 0]
    s = len(q)
    q1, q2 = int((q == 1).sum()), int((q == 2).sum())
    return float(s + (T - 1) / T * (q1 * q1 / (2 * q2) if q2 > 0 else q1 * (q1 - 1) / 2))


INC = [[[1, 0, 1, 0, 0, 1], [1, 1, 0, 0, 0, 0], [1, 0, 0, 1, 0, 0], [0, 0, 1, 0, 1, 0]],
       [[1, 1, 0, 0, 1, 0, 0], [1, 0, 1, 0, 0, 0, 1], [1, 1, 0, 1, 0, 0, 0], [0, 1, 0, 0, 0, 1, 0], [1, 0, 0, 0, 0, 0, 0]],
       [[1, 0, 0, 1], [0, 1, 0, 1], [1, 1, 1, 0]]]
method('roadmap-diversity', 'chao2', 'packages/stats/src/coverage.ts',
       'chao2(incidence: readonly (readonly (0 | 1)[])[]): number',
       'Chao2 for incidence data (rows sampling units such as conversations, columns classes such as cells; a 1 when the unit shows the class): S + ((T - 1)/T) Q1^2 / (2 Q2), Q1 and Q2 the classes seen in exactly one and two units; ((T - 1)/T) Q1 (Q1 - 1) / 2 when Q2 = 0 (one conversation can show several cells: dossier S2, section 7)',
       'Chao 1987; Colwell and co-authors 2012 (dossier S25)',
       [dict(args=[m], expect=chao2(m)) for m in INC], tol=1e-12, tier=4)

# tests
GOF = [([18, 22, 20, 40], [0.25, 0.25, 0.25, 0.25]), ([5, 15, 30], [0.2, 0.3, 0.5]), ([12, 8, 10, 10, 10], [0.2] * 5)]


def gof(obs, p):
    e = np.array(p) * sum(obs)
    r = stats.chisquare(obs, e)
    return dict(statistic=float(r.statistic), df=len(obs) - 1, pValue=float(r.pvalue))


method('roadmap-tests', 'chiSquareGoodnessOfFit', 'packages/stats/src/paired.ts',
       'chiSquareGoodnessOfFit(observed: readonly number[], expectedShares: readonly number[]): { statistic: number; df: number; pValue: number }',
       "Pearson's goodness-of-fit test of counts against expected shares (scaled to the total): sum (O - E)^2 / E, chi-square with k - 1 df",
       'scipy.stats.chisquare',
       [dict(args=[o, p], expect=gof(o, p)) for o, p in GOF], tol=1e-9, tier=3)


def gtest(obs, p):
    e = np.array(p) * sum(obs)
    r = stats.power_divergence(obs, e, lambda_='log-likelihood')
    return dict(statistic=float(r.statistic), df=len(obs) - 1, pValue=float(r.pvalue))


method('roadmap-tests', 'gTest', 'packages/stats/src/paired.ts',
       'gTest(observed: readonly number[], expectedShares: readonly number[]): { statistic: number; df: number; pValue: number }',
       'The G-test (log-likelihood ratio) of counts against expected shares: 2 sum O ln(O / E) (terms with O = 0 are 0), chi-square with k - 1 df',
       "scipy.stats.power_divergence(lambda_='log-likelihood')",
       [dict(args=[o, p], expect=gtest(o, p)) for o, p in GOF], tol=1e-9, tier=3)


def levene(*g):
    r = stats.levene(*g, center='median')
    return dict(statistic=float(r.statistic), pValue=float(r.pvalue))


LV = [([8.9, 9.1, 9.0, 9.3, 8.8], [7.0, 11.2, 9.5, 8.1, 10.4, 12.0], [9.0, 9.2, 8.7, 9.4]), ([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]), ([0.5, 0.6, 0.55, 0.52], [0.1, 0.9, 0.4, 0.7, 0.2])]
method('roadmap-tests', 'leveneTest', 'packages/stats/src/paired.ts',
       'leveneTest(groups: readonly (readonly number[])[]): { statistic: number; pValue: number }',
       "Levene's test of equal variances with the median center (Brown-Forsythe): one-way ANOVA F on |x - median of its group|, F(k - 1, N - k) p-value",
       "scipy.stats.levene(center='median')",
       [dict(args=[list(map(list, g))], expect=levene(*g)) for g in LV], tol=1e-9, tier=4)


def perm_test(x, y):
    import itertools
    pooled = list(x) + list(y)
    n = len(x)
    obs = abs(np.mean(x) - np.mean(y))
    count = 0
    total = 0
    for idx in itertools.combinations(range(len(pooled)), n):
        a = [pooled[i] for i in idx]
        b = [pooled[i] for i in range(len(pooled)) if i not in idx]
        total += 1
        if abs(np.mean(a) - np.mean(b)) >= obs - 1e-12:
            count += 1
    return dict(statistic=float(np.mean(x) - np.mean(y)), pValue=count / total)


PM = [([3.1, 4.2, 2.8, 5.0], [1.2, 2.0, 1.8, 2.4, 1.1]), ([10, 12, 11], [9, 13, 10, 8]), ([0.7, 0.9, 0.8, 0.95, 0.85], [0.6, 0.75, 0.65, 0.7])]
method('roadmap-tests', 'permutationTest', 'packages/stats/src/paired.ts',
       'permutationTest(x: readonly number[], y: readonly number[]): { statistic: number; pValue: number }',
       'The exact two-sample permutation test of the difference in means: every split of the pooled values into groups of the original sizes, p the share with |difference| at least the observed one (1e-12 slack); statistic mean(x) - mean(y). Exact enumeration up to C(N, n) = 1e6 splits',
       'Fisher 1935; dossier section 3.4 (a test counts only if it can fail)',
       [dict(args=[x, y], expect=perm_test(x, y)) for x, y in PM], tol=1e-12, tier=4)
method('roadmap-tests', 'signTest', 'packages/stats/src/paired.ts',
       'signTest(x: readonly number[], y: readonly number[]): { positive: number; negative: number; pValue: number }',
       'The sign test on paired values: zero differences dropped, the exact two-sided binomial test of the positive count at 1/2',
       'scipy.stats.binomtest on the signs',
       [dict(args=[x, y], expect=dict(positive=int(sum(1 for a, b in zip(x, y) if a > b)), negative=int(sum(1 for a, b in zip(x, y) if a < b)), pValue=float(stats.binomtest(sum(1 for a, b in zip(x, y) if a > b), sum(1 for a, b in zip(x, y) if a != b)).pvalue))) for x, y in PT], tol=1e-12, tier=3)

# intervals
MED = [[2.1, 3.4, 1.9, 5.6, 4.2, 3.0, 2.8, 3.3, 4.1, 2.6, 3.9, 2.2], list(range(1, 21)), [10, 12, 9, 11, 13, 10, 12, 30, 5, 11, 10, 14, 9, 8, 15]]


def median_ci(v, a=0.05):
    x = sorted(v)
    n = len(x)
    # largest j (1-based) with P(B <= j - 1) <= alpha / 2, B ~ Binomial(n, 1/2); interval [x_(j), x_(n + 1 - j)]
    j = max(k for k in range(1, n // 2 + 1) if stats.binom.cdf(k - 1, n, 0.5) <= a / 2)
    return dict(estimate=float(np.median(x)), lower=float(x[j - 1]), upper=float(x[n - j]))


method('roadmap-intervals', 'medianInterval', 'packages/stats/src/intervals.ts',
       'medianInterval(values: readonly number[], alpha = 0.05): Interval',
       'Distribution-free interval for the median from order statistics: with B ~ Binomial(n, 1/2), j the largest index with P(B <= j - 1) <= alpha / 2, the interval [x_(j), x_(n + 1 - j)] of the sorted values; estimate the median',
       'Hollander, Wolfe and Chicken, Nonparametric Statistical Methods, 3.6',
       [dict(args=[v], expect=median_ci(v)) for v in MED], tol=1e-12, tier=3)


def wald(k, n):
    p = k / n
    h = Z * math.sqrt(p * (1 - p) / n)
    return dict(estimate=p, lower=max(0.0, p - h), upper=min(1.0, p + h))


method('roadmap-intervals', 'waldInterval', 'packages/stats/src/intervals.ts',
       'waldInterval(k: number, n: number, z = Z95): Interval',
       'The Wald interval p -/+ z sqrt(p (1 - p) / n), clipped to [0, 1]; kept to show why the report prints Wilson (dossier S8: the one to avoid)',
       'Brown, Cai and DasGupta 2001 (dossier S8)',
       [dict(args=[k, n], expect=wald(k, n)) for k, n in KN], tol=1e-12, tier=2)


def arcsine(k, n):
    p = k / n
    a = math.asin(math.sqrt(p))
    h = Z / (2 * math.sqrt(n))
    lo = math.sin(max(0.0, a - h)) ** 2
    hi = math.sin(min(math.pi / 2, a + h)) ** 2
    return dict(estimate=p, lower=lo, upper=hi)


method('roadmap-intervals', 'arcsineInterval', 'packages/stats/src/intervals.ts',
       'arcsineInterval(k: number, n: number, z = Z95): Interval',
       'The arcsine (variance-stabilised) interval: sin^2(asin(sqrt(p)) -/+ z / (2 sqrt(n))), the angle clipped to [0, pi/2]',
       'Brown, Cai and DasGupta 2001 (dossier S8)',
       [dict(args=[k, n], expect=arcsine(k, n)) for k, n in KN], tol=1e-12, tier=3)


def rate_ratio(c1, t1, c2, t2, a=0.05):
    # Conditional on the total, c1 ~ Binomial(c1 + c2, t1 r / (t1 r + t2)): Clopper-Pearson on the share, mapped to the ratio.
    n = c1 + c2
    lo = 0.0 if c1 == 0 else stats.beta.ppf(a / 2, c1, n - c1 + 1)
    hi = 1.0 if c1 == n else stats.beta.ppf(1 - a / 2, c1 + 1, n - c1)
    f = lambda s: (s / (1 - s)) * (t2 / t1) if s < 1 else float('inf')
    return dict(estimate=(c1 / t1) / (c2 / t2), lower=float(f(lo)), upper=float(f(hi)))


method('roadmap-intervals', 'poissonRateRatioInterval', 'packages/stats/src/intervals.ts',
       'poissonRateRatioInterval(count1: number, exposure1: number, count2: number, exposure2: number, alpha = 0.05): Interval',
       'Exact conditional interval for the ratio of two Poisson rates: Clopper-Pearson on count1 out of count1 + count2, the share s mapped to (s / (1 - s)) (exposure2 / exposure1); cases have both counts above 0',
       'Ederer and Mantel 1974',
       [dict(args=list(a), expect=rate_ratio(*a)) for a in [(12, 100, 5, 100), (30, 250, 40, 300), (3, 10, 9, 12), (50, 1000, 45, 900)]], tol=1e-7, tier=4)

# agreement
def pabak(rows):
    a = [str(r[0]) for r in rows]
    b = [str(r[1]) for r in rows]
    k = len(set(a) | set(b))
    po = np.mean([x == y for x, y in zip(a, b)])
    return float((k * po - 1) / (k - 1))


method('roadmap-agreement', 'brennanPrediger', 'packages/stats/src/agreement.ts',
       'brennanPrediger(a: readonly Label[], b: readonly Label[]): number',
       'Brennan-Prediger kappa (PABAK for two categories): (k po - 1) / (k - 1), k the categories used by either rater, po the observed agreement',
       'Brennan and Prediger 1981; Byrt, Bishop and Carlin 1993',
       [dict(args=[[r[0] for r in rows], [r[1] for r in rows]], expect=pabak(rows)) for rows in RATINGS], tol=1e-12, tier=3)


# --- batch 3 (2026-10-12): the design section 7 simulation areas, one cause per method -----------------------
MC = [[0.01, 0.04, 0.03, 0.005, 0.2], [0.001, 0.008, 0.039, 0.041, 0.042, 0.06, 0.074, 0.205], [0.5, 0.02, 0.9, 0.012]]


def sidak(p, a=0.05):
    adj = [1 - (1 - x) ** len(p) for x in p]
    return dict(adjusted=adj, rejected=[x <= a for x in adj])


def holm_sidak(p, a=0.05):
    m = len(p)
    order = sorted(range(m), key=lambda i: p[i])
    adj = [0.0] * m
    run = 0.0
    for r, i in enumerate(order):
        run = max(run, 1 - (1 - p[i]) ** (m - r))
        adj[i] = min(1.0, run)
    return dict(adjusted=adj, rejected=[x <= a for x in adj])


def hochberg(p, a=0.05):
    m = len(p)
    order = sorted(range(m), key=lambda i: p[i], reverse=True)
    adj = [0.0] * m
    run = 1.0
    for r, i in enumerate(order):
        run = min(run, (r + 1) * p[i])
        adj[i] = min(1.0, run)
    return dict(adjusted=adj, rejected=[x <= a for x in adj])


def hommel(p):
    # Hommel adjusted p-values (Wright 1992 algorithm, as statsmodels).
    m = len(p)
    order = np.argsort(p)
    ps = np.array(p)[order]
    adj = ps.copy()
    for k in range(m, 1, -1):
        q = min(k * ps[m - k + j] / (j + 1) for j in range(k))
        for i in range(m - k + 1):
            adj[i] = max(adj[i], min(k * ps[i], q))
        for i in range(m - k + 1, m):
            adj[i] = max(adj[i], q)
    out = np.empty(m)
    out[order] = np.minimum(adj, 1)
    return [float(x) for x in out]


method('roadmap-multiplicity', 'sidak', 'packages/stats/src/multiple.ts',
       'sidak(pvalues: readonly number[], alpha = 0.05): { adjusted: number[]; rejected: boolean[] }',
       'Sidak single-step: adjusted 1 - (1 - p)^m; rejected when adjusted <= alpha',
       'Sidak 1967', [dict(args=[p], expect=sidak(p)) for p in MC], tol=1e-12, tier=3)
method('roadmap-multiplicity', 'holmSidak', 'packages/stats/src/multiple.ts',
       'holmSidak(pvalues: readonly number[], alpha = 0.05): { adjusted: number[]; rejected: boolean[] }',
       'Holm-Sidak step-down: sort ascending, adjusted p(i) = max over j <= i of 1 - (1 - p(j))^(m - j + 1), capped at 1, in input order',
       'Holm 1979 with the Sidak step', [dict(args=[p], expect=holm_sidak(p)) for p in MC], tol=1e-12, tier=3)
method('roadmap-multiplicity', 'hochberg', 'packages/stats/src/multiple.ts',
       'hochberg(pvalues: readonly number[], alpha = 0.05): { adjusted: number[]; rejected: boolean[] }',
       'Hochberg step-up: sort descending, adjusted p(i) = min over j >= i of (m - j + 1) p(j), capped at 1, in input order',
       'Hochberg 1988', [dict(args=[p], expect=hochberg(p)) for p in MC], tol=1e-12, tier=3)
method('roadmap-multiplicity', 'hommel', 'packages/stats/src/multiple.ts',
       'hommel(pvalues: readonly number[]): number[]',
       'Hommel adjusted p-values (the closed Simes procedure): for k from m down to 2, q_k = min over j of k p(m-k+j) / j; p(i) <- max(p(i), min(k p(i), q_k)) for i <= m - k + 1, and max(p(i), q_k) above; capped at 1, in input order',
       'Hommel 1988; Wright 1992 (the statsmodels algorithm)', [dict(args=[p], expect=hommel(p)) for p in MC], tol=1e-12, tier=4)


def storey(p, lam=0.5):
    m = len(p)
    pi0 = min(1.0, sum(1 for x in p if x > lam) / (m * (1 - lam)))
    order = sorted(range(m), key=lambda i: p[i], reverse=True)
    q = [0.0] * m
    run = 1.0
    for r, i in enumerate(order):
        rank = m - r
        run = min(run, pi0 * m * p[i] / rank)
        q[i] = run
    return dict(pi0=pi0, qvalues=q)


ST3 = [[0.01, 0.04, 0.03, 0.005, 0.2, 0.7, 0.9, 0.55], [0.001, 0.008, 0.039, 0.041, 0.042, 0.06, 0.074, 0.205, 0.6, 0.8], [0.5, 0.02, 0.9, 0.012, 0.66, 0.3]]
method('roadmap-multiplicity', 'storeyQValues', 'packages/stats/src/multiple.ts',
       'storeyQValues(pvalues: readonly number[], lambda = 0.5): { pi0: number; qvalues: number[] }',
       'Storey q-values with a fixed lambda: pi0 = min(1, #(p > lambda) / (m (1 - lambda))); q(i) = min over j with p(j) >= p(i) of pi0 m p(j) / rank(j)',
       'Storey 2002; Storey and Tibshirani 2003', [dict(args=[p], expect=storey(p)) for p in ST3], tol=1e-12, tier=4)
method('roadmap-multiplicity', 'simesTest', 'packages/stats/src/multiple.ts',
       'simesTest(pvalues: readonly number[]): number',
       'The Simes global p-value: min over i of m p(i) / i, sorted ascending, capped at 1',
       'Simes 1986', [dict(args=[p], expect=float(min(1, min(len(p) * x / (i + 1) for i, x in enumerate(sorted(p)))))) for p in MC], tol=1e-12, tier=3)
method('roadmap-multiplicity', 'fisherCombination', 'packages/stats/src/multiple.ts',
       "fisherCombination(pvalues: readonly number[]): { statistic: number; pValue: number }",
       "Fisher's method: X = -2 sum ln p, chi-square with 2m df",
       'scipy.stats.combine_pvalues(method="fisher")', [dict(args=[p], expect=dict(statistic=float(stats.combine_pvalues(p, method='fisher')[0]), pValue=float(stats.combine_pvalues(p, method='fisher')[1]))) for p in MC], tol=1e-9, tier=3)
method('roadmap-multiplicity', 'stoufferCombination', 'packages/stats/src/multiple.ts',
       "stoufferCombination(pvalues: readonly number[]): { statistic: number; pValue: number }",
       "Stouffer's method, unweighted: Z = sum Phi^-1(1 - p) / sqrt(m), one-sided p = 1 - Phi(Z)",
       'scipy.stats.combine_pvalues(method="stouffer")', [dict(args=[p], expect=dict(statistic=float(stats.combine_pvalues(p, method='stouffer')[0]), pValue=float(stats.combine_pvalues(p, method='stouffer')[1]))) for p in MC], tol=1e-9, tier=3)
method('roadmap-multiplicity', 'harmonicMeanP', 'packages/stats/src/multiple.ts',
       'harmonicMeanP(pvalues: readonly number[]): number',
       'The harmonic mean p-value, unweighted and without the Landau correction: m / sum (1 / p)',
       'Wilson 2019, PNAS', [dict(args=[p], expect=len(p) / sum(1 / x for x in p)) for p in MC], tol=1e-12, tier=3)
method('roadmap-multiplicity', 'cauchyCombination', 'packages/stats/src/multiple.ts',
       'cauchyCombination(pvalues: readonly number[]): number',
       'The Cauchy combination test (ACAT), equal weights: T = mean tan((0.5 - p) pi), p = 0.5 - atan(T) / pi',
       'Liu and Xie 2020, JASA', [dict(args=[p], expect=float(0.5 - math.atan(np.mean([math.tan((0.5 - x) * math.pi) for x in p])) / math.pi)) for p in MC], tol=1e-12, tier=4)

# shrinkage
JS = [([2.1, 3.4, 1.9, 5.6, 4.2, 3.0], 1.0), ([0.3, 0.5, 0.45, 0.7, 0.2, 0.55, 0.4, 0.6], 0.04), ([10, 12, 9, 11, 13, 10, 30], 4.0)]


def james_stein(x, s2):
    x = np.array(x, float)
    m = x.mean()
    k = len(x)
    ss = ((x - m) ** 2).sum()
    c = max(0.0, 1 - (k - 3) * s2 / ss)
    return [float(v) for v in m + c * (x - m)]


method('roadmap-shrinkage-clustering', 'jamesStein', 'packages/stats/src/variance.ts',
       'jamesStein(estimates: readonly number[], variance: number): number[]',
       'Positive-part James-Stein shrinkage toward the grand mean with a known common sampling variance: m + max(0, 1 - (k - 3) variance / sum (x - m)^2) (x - m)',
       'Efron and Morris 1973', [dict(args=[x, v], expect=james_stein(x, v)) for x, v in JS], tol=1e-12, tier=4)
KNR = [([3, 7, 1, 12, 5, 0, 9], [20, 25, 15, 30, 22, 18, 26]), ([45, 50, 38, 60], [100, 100, 100, 100]), ([2, 4, 3, 8, 6, 1, 5, 7], [10, 12, 9, 20, 15, 8, 14, 16])]


def bb_mom(k, n):
    k, n = np.array(k, float), np.array(n, float)
    p = k / n
    m = p.mean()
    v = p.var(ddof=1)
    common = m * (1 - m) / v - 1
    return dict(alpha=float(m * common), beta=float((1 - m) * common))


method('roadmap-shrinkage-clustering', 'betaBinomialMoments', 'packages/stats/src/variance.ts',
       'betaBinomialMoments(successes: readonly number[], trials: readonly number[]): { alpha: number; beta: number }',
       'Method-of-moments Beta prior from per-unit rates p_i = k_i / n_i: m the mean of the rates, v their n - 1 variance, c = m (1 - m) / v - 1, alpha = m c, beta = (1 - m) c',
       'empirical Bayes rate shrinkage (Robbins; Efron 2010, chapter 1)', [dict(args=[k, n], expect=bb_mom(k, n)) for k, n in KNR], tol=1e-9, tier=4)
method('roadmap-shrinkage-clustering', 'shrinkRates', 'packages/stats/src/variance.ts',
       'shrinkRates(successes: readonly number[], trials: readonly number[], alpha: number, beta: number): number[]',
       'Posterior mean rate of each unit under a Beta(alpha, beta) prior: (k + alpha) / (n + alpha + beta)',
       'Beta-binomial conjugacy', [dict(args=[k, n, 2, 5], expect=[(a + 2) / (b + 7) for a, b in zip(k, n)]) for k, n in KNR], tol=1e-12, tier=3)
method('roadmap-shrinkage-clustering', 'normalPosterior', 'packages/stats/src/variance.ts',
       'normalPosterior(input: { priorMean: number; priorVariance: number; mean: number; variance: number; n: number }): { mean: number; variance: number }',
       'Normal-normal posterior of a mean: precision 1 / priorVariance + n / variance; posterior mean (priorMean / priorVariance + n mean / variance) / precision; posterior variance 1 / precision',
       'conjugate normal model', [dict(args=[dict(priorMean=a, priorVariance=b, mean=c, variance=d, n=e)], expect=dict(mean=(a / b + e * c / d) / (1 / b + e / d), variance=1 / (1 / b + e / d))) for a, b, c, d, e in [(0.5, 0.04, 0.7, 0.21, 30), (10, 4, 12, 9, 5), (0, 1, 1.5, 2, 100)]], tol=1e-12, tier=3)
method('roadmap-shrinkage-clustering', 'moderatedVariance', 'packages/stats/src/variance.ts',
       'moderatedVariance(input: { variance: number; df: number; priorVariance: number; priorDf: number }): number',
       'Moderated variance: (priorDf priorVariance + df variance) / (priorDf + df)',
       'Smyth 2004, limma', [dict(args=[dict(variance=a, df=b, priorVariance=c, priorDf=d)], expect=(d * c + b * a) / (d + b)) for a, b, c, d in [(0.3, 4, 0.1, 6), (2.5, 10, 1.0, 3), (0.01, 2, 0.05, 20)]], tol=1e-12, tier=3)


def pooled_var(groups):
    num = sum((len(g) - 1) * np.var(g, ddof=1) for g in groups)
    den = sum(len(g) - 1 for g in groups)
    return float(num / den)


PG = [([1, 2, 3, 4], [2, 4, 6], [5, 5, 6, 7, 8]), ([0.2, 0.4, 0.3], [0.5, 0.9, 0.7, 0.6]), ([10, 12], [9, 11, 13], [8, 8, 9, 15])]
method('roadmap-shrinkage-clustering', 'pooledVariance', 'packages/stats/src/variance.ts',
       'pooledVariance(groups: readonly (readonly number[])[]): number',
       'Pooled within-group variance: sum (n_g - 1) s_g^2 / sum (n_g - 1)',
       'one-way ANOVA mean square within', [dict(args=[list(map(list, g))], expect=pooled_var(g)) for g in PG], tol=1e-12, tier=2)

# clustering
CLV = [([1, 0, 1, 1, 0, 0, 1, 1, 1, 0, 1], [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4]), ([0.2, 0.4, 0.9, 0.8, 0.1, 0.5, 0.7, 0.6], ['a', 'a', 'b', 'b', 'c', 'c', 'd', 'd']), ([3, 4, 5, 9, 8, 10, 2, 3, 1, 4], [1, 1, 1, 2, 2, 2, 3, 3, 4, 4])]


def icc1(v, cl):
    v = np.array(v, float)
    groups = {}
    for x, c in zip(v, cl):
        groups.setdefault(c, []).append(x)
    g = list(groups.values())
    k = len(g)
    N = len(v)
    m = v.mean()
    msb = sum(len(x) * (np.mean(x) - m) ** 2 for x in g) / (k - 1)
    msw = sum(((np.array(x) - np.mean(x)) ** 2).sum() for x in g) / (N - k)
    n0 = (N - sum(len(x) ** 2 for x in g) / N) / (k - 1)
    return float((msb - msw) / (msb + (n0 - 1) * msw)), n0, k


method('roadmap-weighting', 'iccOneWay', 'packages/stats/src/variance.ts',
       'iccOneWay(values: readonly number[], clusters: readonly (string | number)[]): number',
       'ICC(1) from the one-way ANOVA, unbalanced: (MSB - MSW) / (MSB + (n0 - 1) MSW), n0 = (N - sum n_g^2 / N) / (k - 1); not truncated',
       'Shrout and Fleiss 1979; Donner 1986 (n0)', [dict(args=[v, c], expect=icc1(v, c)[0]) for v, c in CLV], tol=1e-12, tier=3)


def deff_data(v, cl):
    r, n0, k = icc1(v, cl)
    mbar = len(v) / k
    return float(1 + (mbar - 1) * r)


method('roadmap-weighting', 'designEffectFromData', 'packages/stats/src/intervals.ts',
       'designEffectFromData(values: readonly number[], clusters: readonly (string | number)[]): number',
       'The design effect measured from the data: 1 + (mbar - 1) ICC(1), mbar the mean cluster size and ICC(1) as iccOneWay',
       'Kish 1965; dossier section 3.1', [dict(args=[v, c], expect=deff_data(v, c)) for v, c in CLV], tol=1e-12, tier=3)
method('roadmap-weighting', 'kishWeightDesignEffect', 'packages/stats/src/intervals.ts',
       'kishWeightDesignEffect(weights: readonly number[]): number',
       "Kish's design effect of unequal weights: n sum w^2 / (sum w)^2 (that is 1 + the squared coefficient of variation)",
       'Kish 1992', [dict(args=[w], expect=len(w) * sum(x * x for x in w) / sum(w) ** 2) for w in W], tol=1e-12, tier=2)


def cl_rate_iv(v, cl, a=0.05):
    v = np.array(v, float)
    m = v.mean()
    n = len(v)
    cs = sorted(set(cl), key=str)
    se = math.sqrt(sum(sum(v[i] - m for i in range(n) if cl[i] == c) ** 2 for c in cs)) / n
    t = stats.t.ppf(1 - a / 2, len(cs) - 1)
    return dict(estimate=float(m), lower=float(m - t * se), upper=float(m + t * se))


method('roadmap-weighting', 'clusteredMeanInterval', 'packages/stats/src/intervals.ts',
       'clusteredMeanInterval(values: readonly number[], clusters: readonly (string | number)[], alpha = 0.05): Interval',
       'Interval for a mean of clustered values: mean -/+ t(1 - alpha/2, G - 1) SE, SE = sqrt(sum over clusters of (sum of x - mean)^2) / n (the clusteredStandardError), G the clusters',
       'dossier S22 (clustered standard errors with G - 1 degrees of freedom)', [dict(args=[v, c], expect=cl_rate_iv(v, c)) for v, c in CLV], tol=1e-9, tier=4)


def cluster_means_iv(v, cl, a=0.05):
    groups = {}
    for x, c in zip(v, cl):
        groups.setdefault(c, []).append(x)
    means = [float(np.mean(g)) for g in groups.values()]
    return tint(means, a)


method('roadmap-shrinkage-clustering', 'clusterMeansInterval', 'packages/stats/src/intervals.ts',
       'clusterMeansInterval(values: readonly number[], clusters: readonly (string | number)[], alpha = 0.05): Interval',
       "The unweighted mean of the cluster means with Student's t interval over the cluster means (each conversation counts once)",
       'cluster-level analysis (Donner and Klar 2000)', [dict(args=[v, c], expect=cluster_means_iv(v, c)) for v, c in CLV], tol=1e-9, tier=3)


def ratio_est(y, x):
    y, x = np.array(y, float), np.array(x, float)
    r = y.sum() / x.sum()
    n = len(y)
    se = math.sqrt(((y - r * x) ** 2).sum() / (n - 1) / n) / x.mean()
    return dict(estimate=float(r), standardError=float(se))


RX = [([3, 5, 2, 8, 6], [10, 12, 8, 20, 15]), ([1, 0, 2, 3, 1, 1], [4, 3, 5, 6, 4, 4]), ([30, 25, 40, 35], [100, 90, 120, 110])]
method('roadmap-shrinkage-clustering', 'ratioEstimate', 'packages/stats/src/intervals.ts',
       'ratioEstimate(numerators: readonly number[], denominators: readonly number[]): { estimate: number; standardError: number }',
       'Ratio estimator of a rate over clusters of unequal size (passes over blocks per conversation): r = sum y / sum x, linearised standard error sqrt(sum (y - r x)^2 / (n - 1) / n) / mean x',
       'Cochran, Sampling Techniques, 6.4', [dict(args=[y, x], expect=ratio_est(y, x)) for y, x in RX], tol=1e-12, tier=4)

# sequential and decision
def prob_b_better(aa, ba, ab, bb):
    # P(pB > pA), pA ~ Beta(aa, ba), pB ~ Beta(ab, bb); the exact sum for integer B parameters (Evan Miller).
    from scipy.special import betaln
    tot = 0.0
    for i in range(int(ab)):
        tot += math.exp(betaln(aa + i, ba + bb) - math.log(bb + i) - betaln(1 + i, bb) - betaln(aa, ba))
    return float(tot)


AB = [(41, 60, 52, 50), (5, 15, 9, 11), (100, 900, 120, 880)]
method('roadmap-sequential', 'probabilityBetter', 'packages/stats/src/power.ts',
       'probabilityBetter(input: { successesA: number; failuresA: number; successesB: number; failuresB: number }): number',
       'The posterior probability that version B passes more often than A under Beta(1, 1) priors: P(pB > pA) with pA ~ Beta(1 + sA, 1 + fA), pB ~ Beta(1 + sB, 1 + fB), by the exact sum over i < 1 + sB of B(aA + i, bA + bB) / ((bB + i) B(1 + i, bB) B(aA, bA))',
       'Evan Miller, Formulas for Bayesian A/B testing', [dict(args=[dict(successesA=a, failuresA=b, successesB=c, failuresB=d)], expect=prob_b_better(1 + a, 1 + b, 1 + c, 1 + d)) for a, b, c, d in AB], tol=1e-9, tier=4)


def bf10(k, n, p0):
    from scipy.special import betaln
    return float(math.exp(betaln(k + 1, n - k + 1) - (k * math.log(p0) + (n - k) * math.log(1 - p0))))


method('roadmap-sequential', 'bayesFactorRate', 'packages/stats/src/power.ts',
       'bayesFactorRate(k: number, n: number, p0: number): number',
       'Bayes factor BF10 of a uniform prior on the rate against the point null p0: B(k + 1, n - k + 1) / (p0^k (1 - p0)^(n - k))',
       'Kass and Raftery 1995', [dict(args=[k, n, p], expect=bf10(k, n, p)) for k, n, p in [(7, 10, 0.5), (2, 50, 0.1), (60, 100, 0.5)]], tol=1e-9, tier=4)


def asn(p0, p1, a, b):
    A, B = math.log((1 - b) / a), math.log(b / (1 - a))
    z1, z0 = math.log(p1 / p0), math.log((1 - p1) / (1 - p0))
    e0 = p0 * z1 + (1 - p0) * z0
    e1 = p1 * z1 + (1 - p1) * z0
    return dict(underNull=float(((1 - a) * B + a * A) / e0), underAlternative=float((b * B + (1 - b) * A) / e1))


method('roadmap-sequential', 'sprtExpectedSampleSize', 'packages/stats/src/drift.ts',
       'sprtExpectedSampleSize(input: { p0: number; p1: number; alpha: number; beta: number }): { underNull: number; underAlternative: number }',
       "Wald's approximations of the expected sample size of the Bernoulli SPRT (boundaries ln((1 - beta)/alpha) and ln(beta/(1 - alpha))): under H0 ((1 - alpha) lnB + alpha lnA) / E0[z], under H1 (beta lnB + (1 - beta) lnA) / E1[z], z the per-outcome log likelihood ratio",
       'Wald 1947 (dossier S19)', [dict(args=[dict(p0=a, p1=b, alpha=c, beta=d)], expect=asn(a, b, c, d)) for a, b, c, d in [(0.05, 0.2, 0.05, 0.1), (0.1, 0.3, 0.05, 0.2), (0.5, 0.7, 0.01, 0.01)]], tol=1e-9, tier=4)


def msprt(xbar, n, s2, tau2, th0=0.0):
    lam = math.sqrt(s2 / (s2 + n * tau2)) * math.exp(n * n * tau2 * (xbar - th0) ** 2 / (2 * s2 * (s2 + n * tau2)))
    return float(min(1.0, 1 / lam))


method('roadmap-sequential', 'msprtPValue', 'packages/stats/src/drift.ts',
       'msprtPValue(input: { mean: number; n: number; variance: number; mixingVariance: number; null?: number }): number',
       'The always-valid p-value of the normal mixture SPRT: Lambda = sqrt(V / (V + n tau^2)) exp(n^2 tau^2 (xbar - theta0)^2 / (2 V (V + n tau^2))), p = min(1, 1 / Lambda) (the running minimum is the caller\'s)',
       'Johari, Pekelis and Walsh, Always valid inference (dossier S6)', [dict(args=[dict(mean=a, n=b, variance=c, mixingVariance=d)], expect=msprt(a, b, c, d)) for a, b, c, d in [(0.1, 100, 1.0, 0.01), (0.02, 500, 0.25, 0.001), (0.5, 20, 2.0, 0.1)]], tol=1e-12, tier=5)


# --- batch 4 (2026-10-12): small-n intervals, sequential stopping, tests, variance components, effect sizes -----
def midp_iv(k, n, a=0.05):
    f = lambda p: stats.binom.cdf(k, n, p) - 0.5 * stats.binom.pmf(k, n, p)
    g = lambda p: stats.binom.sf(k, n, p) + 0.5 * stats.binom.pmf(k, n, p)
    lo = 0.0 if k == 0 else optimize.brentq(lambda p: g(p) - a / 2, 1e-12, 1 - 1e-12, xtol=1e-14)
    hi = 1.0 if k == n else optimize.brentq(lambda p: f(p) - a / 2, 1e-12, 1 - 1e-12, xtol=1e-14)
    return dict(estimate=k / n, lower=float(lo), upper=float(hi))


KN4 = [(0, 10), (3, 20), (17, 40), (9, 9)]
method('roadmap-small-n', 'midPInterval', 'packages/stats/src/intervals.ts',
       'midPInterval(k: number, n: number, alpha = 0.05): Interval',
       'The mid-p exact interval: lower solves P(X > k) + P(X = k)/2 = alpha/2, upper solves P(X < k) + P(X = k)/2 = alpha/2 for X ~ Binomial(n, p); lower 0 when k = 0, upper 1 when k = n',
       'Lancaster 1961; Berry and Armitage 1995', [dict(args=[k, n], expect=midp_iv(k, n)) for k, n in KN4], tol=1e-8, tier=4)


def logit_iv(k, n):
    p = k / n
    l = math.log(p / (1 - p))
    h = Z / math.sqrt(n * p * (1 - p))
    f = lambda x: 1 / (1 + math.exp(-x))
    return dict(estimate=p, lower=f(l - h), upper=f(l + h))


method('roadmap-small-n', 'logitInterval', 'packages/stats/src/intervals.ts',
       'logitInterval(k: number, n: number, z = Z95): Interval',
       'The logit (Wald on the log odds) interval: expit(logit(p) -/+ z / sqrt(n p (1 - p))); cases have 0 < k < n',
       'Brown, Cai and DasGupta 2001 (dossier S8)', [dict(args=[k, n], expect=logit_iv(k, n)) for k, n in [(3, 20), (17, 40), (1, 9)]], tol=1e-12, tier=3)


def lr_iv(k, n, a=0.05):
    p = k / n
    c = stats.chi2.ppf(1 - a, 1)
    def ll(q):
        return (k * math.log(q) if k else 0) + ((n - k) * math.log(1 - q) if n - k else 0)
    top = ll(p) if 0 < k < n else 0.0
    g = lambda q: 2 * (top - ll(q)) - c
    lo = 0.0 if k == 0 else optimize.brentq(g, 1e-12, p, xtol=1e-14)
    hi = 1.0 if k == n else optimize.brentq(g, p, 1 - 1e-12, xtol=1e-14)
    return dict(estimate=p, lower=float(lo), upper=float(hi))


method('roadmap-small-n', 'likelihoodRatioInterval', 'packages/stats/src/intervals.ts',
       'likelihoodRatioInterval(k: number, n: number, alpha = 0.05): Interval',
       'The likelihood-ratio interval for a rate: the p with 2 (l(phat) - l(p)) <= chi2(1 - alpha, 1), l the binomial log likelihood; lower 0 when k = 0, upper 1 when k = n',
       'Brown, Cai and DasGupta 2001', [dict(args=[k, n], expect=lr_iv(k, n)) for k, n in KN4], tol=1e-8, tier=4)


def agresti_caffo(k1, n1, k2, n2):
    p1, p2 = (k1 + 1) / (n1 + 2), (k2 + 1) / (n2 + 2)
    se = math.sqrt(p1 * (1 - p1) / (n1 + 2) + p2 * (1 - p2) / (n2 + 2))
    return dict(estimate=k1 / n1 - k2 / n2, lower=p1 - p2 - Z * se, upper=p1 - p2 + Z * se)


D4 = [(56, 70, 48, 80), (9, 10, 3, 10), (0, 20, 2, 25)]
method('roadmap-small-n', 'agrestiCaffoDifference', 'packages/stats/src/intervals.ts',
       'agrestiCaffoDifference(k1: number, n1: number, k2: number, n2: number): Interval',
       'Agresti-Caffo interval for p1 - p2: add one success and one failure to each group, then Wald: (p1~ - p2~) -/+ z sqrt(p1~ q1~ / (n1 + 2) + p2~ q2~ / (n2 + 2)); estimate the raw difference k1/n1 - k2/n2',
       'Agresti and Caffo 2000', [dict(args=list(a), expect=agresti_caffo(*a)) for a in D4], tol=1e-12, tier=3)


def wald_diff(k1, n1, k2, n2):
    p1, p2 = k1 / n1, k2 / n2
    se = math.sqrt(p1 * (1 - p1) / n1 + p2 * (1 - p2) / n2)
    return dict(estimate=p1 - p2, lower=p1 - p2 - Z * se, upper=p1 - p2 + Z * se)


method('roadmap-small-n', 'waldDifference', 'packages/stats/src/intervals.ts',
       'waldDifference(k1: number, n1: number, k2: number, n2: number): Interval',
       'The Wald interval for p1 - p2: d -/+ z sqrt(p1 q1 / n1 + p2 q2 / n2), not clipped (the one that undercovers at small n)',
       'Newcombe 1998', [dict(args=list(a), expect=wald_diff(*a)) for a in D4], tol=1e-12, tier=2)


def exh_boot(v, a=0.1):
    import itertools
    n = len(v)
    means = sorted(float(np.mean(c)) for c in itertools.product(v, repeat=n))
    return dict(estimate=float(np.mean(v)), lower=float(np.quantile(means, a / 2)), upper=float(np.quantile(means, 1 - a / 2)))


EB = [[2.1, 3.4, 1.9, 5.6], [0.0, 1.0, 1.0, 0.0, 1.0], [10, 12, 9, 30, 11, 10]]
method('roadmap-small-n', 'exhaustiveBootstrapInterval', 'packages/stats/src/intervals.ts',
       'exhaustiveBootstrapInterval(values: readonly number[], alpha = 0.1): Interval',
       'The exact bootstrap percentile interval of the mean for n <= 7: every one of the n^n ordered resamples, equally weighted, the type 7 quantiles of their means at alpha/2 and 1 - alpha/2 (no Monte Carlo error)',
       'Efron and Tibshirani 1993, the ideal bootstrap', [dict(args=[v], expect=exh_boot(v)) for v in EB], tol=1e-12, tier=4)


def jack_var(v):
    v = np.array(v, float)
    n = len(v)
    reps = [np.var(np.delete(v, i), ddof=1) for i in range(n)]
    return float((n - 1) / n * sum((r - np.mean(reps)) ** 2 for r in reps))


method('roadmap-small-n', 'jackknifeVarianceOfVariance', 'packages/stats/src/intervals.ts',
       'jackknifeVarianceOfVariance(values: readonly number[]): number',
       'The jackknife estimate of the variance of the sample variance: ((n - 1) / n) sum (s2_(-i) - mean s2_(-.))^2, s2_(-i) the n - 1 sample variance without value i',
       'Efron and Stein 1981', [dict(args=[v], expect=jack_var(v)) for v in T_SAMPLES], tol=1e-12, tier=3)


def q_iv(v, q, a=0.05):
    x = sorted(v)
    n = len(x)
    lo_i = max(k for k in range(0, n + 1) if stats.binom.cdf(k - 1, n, q) <= a / 2) if any(stats.binom.cdf(k - 1, n, q) <= a / 2 for k in range(0, n + 1)) else 0
    hi_i = min(k for k in range(1, n + 1) if stats.binom.cdf(k - 1, n, q) >= 1 - a / 2)
    return dict(estimate=float(np.quantile(x, q)), lower=float(x[max(lo_i, 1) - 1]), upper=float(x[hi_i - 1]))


QV = [(list(range(1, 41)), 0.9), ([3.1, 2.2, 5.5, 4.4, 1.9, 2.8, 3.7, 4.9, 6.1, 2.5, 3.3, 4.0, 5.2, 2.9, 3.6, 4.7, 5.8, 1.5, 2.1, 3.9], 0.25), (list(range(100, 150)), 0.5)]
method('roadmap-small-n', 'quantileInterval', 'packages/stats/src/intervals.ts',
       'quantileInterval(values: readonly number[], q: number, alpha = 0.05): Interval',
       'Distribution-free interval for the q quantile from order statistics: with B ~ Binomial(n, q), lower x_(l), l the largest index (at least 1) with P(B <= l - 1) <= alpha/2; upper x_(u), u the smallest index with P(B <= u - 1) >= 1 - alpha/2; estimate the type 7 quantile',
       'Hahn and Meeker 1991, Statistical Intervals', [dict(args=[v, q], expect=q_iv(v, q)) for v, q in QV], tol=1e-12, tier=4)


def welch_iv(x, y, a=0.05):
    w = welch(x, y)
    d = float(np.mean(x) - np.mean(y))
    se = math.sqrt(np.var(x, ddof=1) / len(x) + np.var(y, ddof=1) / len(y))
    t = stats.t.ppf(1 - a / 2, w['df'])
    return dict(estimate=d, lower=d - t * se, upper=d + t * se)


method('roadmap-small-n', 'welchDifferenceInterval', 'packages/stats/src/intervals.ts',
       'welchDifferenceInterval(x: readonly number[], y: readonly number[], alpha = 0.05): Interval',
       'Interval for mean(x) - mean(y) with unequal variances: d -/+ t(1 - alpha/2, Welch-Satterthwaite df) sqrt(sx^2/nx + sy^2/ny)',
       'Welch 1947', [dict(args=[x, y], expect=welch_iv(x, y)) for x, y in WX], tol=1e-8, tier=3)


def pooled_iv(x, y, a=0.05):
    nx, ny = len(x), len(y)
    sp = ((nx - 1) * np.var(x, ddof=1) + (ny - 1) * np.var(y, ddof=1)) / (nx + ny - 2)
    se = math.sqrt(sp * (1 / nx + 1 / ny))
    d = float(np.mean(x) - np.mean(y))
    t = stats.t.ppf(1 - a / 2, nx + ny - 2)
    return dict(estimate=d, lower=d - t * se, upper=d + t * se)


method('roadmap-small-n', 'pooledDifferenceInterval', 'packages/stats/src/intervals.ts',
       'pooledDifferenceInterval(x: readonly number[], y: readonly number[], alpha = 0.05): Interval',
       "Student's equal-variance interval for mean(x) - mean(y): d -/+ t(1 - alpha/2, nx + ny - 2) sqrt(sp^2 (1/nx + 1/ny))",
       'Student 1908', [dict(args=[x, y], expect=pooled_iv(x, y)) for x, y in WX], tol=1e-8, tier=3)


def var_iv(v, a=0.05):
    n = len(v)
    s2 = float(np.var(v, ddof=1))
    return dict(estimate=s2, lower=(n - 1) * s2 / stats.chi2.ppf(1 - a / 2, n - 1), upper=(n - 1) * s2 / stats.chi2.ppf(a / 2, n - 1))


method('roadmap-small-n', 'varianceInterval', 'packages/stats/src/intervals.ts',
       'varianceInterval(values: readonly number[], alpha = 0.05): Interval',
       'The chi-square interval for a normal variance: ((n - 1) s^2 / chi2(1 - alpha/2, n - 1), (n - 1) s^2 / chi2(alpha/2, n - 1))',
       'scipy.stats.chi2', [dict(args=[v], expect=var_iv(v)) for v in T_SAMPLES], tol=1e-8, tier=3)


def vr_iv(x, y, a=0.05):
    r = float(np.var(x, ddof=1) / np.var(y, ddof=1))
    d1, d2 = len(x) - 1, len(y) - 1
    return dict(estimate=r, lower=r / stats.f.ppf(1 - a / 2, d1, d2), upper=r / stats.f.ppf(a / 2, d1, d2))


method('roadmap-small-n', 'varianceRatioInterval', 'packages/stats/src/intervals.ts',
       'varianceRatioInterval(x: readonly number[], y: readonly number[], alpha = 0.05): Interval',
       'The F interval for the ratio of two normal variances: (r / F(1 - alpha/2, nx - 1, ny - 1), r / F(alpha/2, nx - 1, ny - 1)), r = sx^2 / sy^2',
       'scipy.stats.f', [dict(args=[x, y], expect=vr_iv(x, y)) for x, y in WX], tol=1e-8, tier=3)

# sequential stopping
def oc(p0, p1, a, b, p):
    A, B = math.log((1 - b) / a), math.log(b / (1 - a))
    f = lambda h: p * (p1 / p0) ** h + (1 - p) * ((1 - p1) / (1 - p0)) ** h - 1
    h = optimize.brentq(f, 1e-6, 50) if f(1e-6) * f(50) < 0 else optimize.brentq(f, -50, -1e-6)
    return float((math.exp(A * h) - 1) / (math.exp(A * h) - math.exp(B * h)))


OCC = [(0.05, 0.2, 0.05, 0.1, 0.1), (0.1, 0.3, 0.05, 0.2, 0.2), (0.5, 0.7, 0.01, 0.01, 0.6)]
method('roadmap-sequential', 'sprtOperatingCharacteristic', 'packages/stats/src/drift.ts',
       'sprtOperatingCharacteristic(input: { p0: number; p1: number; alpha: number; beta: number; p: number }): number',
       "Wald's operating characteristic of the Bernoulli SPRT, the probability of accepting H0 when the true rate is p: (e^(hA) - 1) / (e^(hA) - e^(hB)), A = ln((1 - beta)/alpha), B = ln(beta/(1 - alpha)), h != 0 solving p (p1/p0)^h + (1 - p)((1 - p1)/(1 - p0))^h = 1 (cases avoid p where h = 0)",
       'Wald 1947 (dossier S19)', [dict(args=[dict(p0=a, p1=b, alpha=c, beta=d, p=e)], expect=oc(a, b, c, d, e)) for a, b, c, d, e in OCC], tol=1e-8, tier=5)


def bayes_stop(margin, conf, a0=1, b0=1):
    n = 0
    while stats.beta.cdf(margin, a0, b0 + n) < conf:
        n += 1
    return n


method('roadmap-sequential', 'zeroFailureBayesN', 'packages/stats/src/power.ts',
       'zeroFailureBayesN(input: { margin: number; confidence: number; priorA?: number; priorB?: number }): number',
       'The fewest failure-free units for which the Beta(priorA, priorB + n) posterior puts at least the confidence below the margin (Bayesian stopping with zero failures; prior Beta(1, 1))',
       'dossier section 3.1 (S27, S17)', [dict(args=[dict(margin=m, confidence=c)], expect=bayes_stop(m, c)) for m, c in [(0.05, 0.95), (0.01, 0.95), (0.1, 0.99)]], tol=0, tier=3)


def hoeff_cs(k, n, a=0.05):
    h = math.sqrt(math.log(2 * n * (n + 1) / a) / (2 * n))
    return dict(estimate=k / n, lower=max(0.0, k / n - h), upper=min(1.0, k / n + h))


method('roadmap-sequential', 'hoeffdingConfidenceSequence', 'packages/stats/src/intervals.ts',
       'hoeffdingConfidenceSequence(k: number, n: number, alpha = 0.05): Interval',
       'A time-uniform interval by a union bound over n (alpha_n = alpha / (n (n + 1))): k/n -/+ sqrt(ln(2 n (n + 1) / alpha) / (2n)), clipped to [0, 1]',
       'Hoeffding 1963 with a union bound over time (dossier S7, S35)', [dict(args=[k, n], expect=hoeff_cs(k, n)) for k, n in [(3, 20), (17, 40), (80, 100)]], tol=1e-12, tier=3)


def cond_power(z, t, a=0.05):
    za = stats.norm.ppf(1 - a / 2)
    theta = z / math.sqrt(t)
    return float(1 - stats.norm.cdf((za - z * math.sqrt(t) - theta * (1 - t)) / math.sqrt(1 - t)))


method('roadmap-sequential', 'conditionalPower', 'packages/stats/src/power.ts',
       'conditionalPower(input: { z: number; informationFraction: number; alpha?: number }): number',
       'Conditional power under the current trend (B-value form): theta = z / sqrt(t), CP = 1 - Phi((z(1 - alpha/2) - z sqrt(t) - theta (1 - t)) / sqrt(1 - t)), z the interim statistic at information fraction t',
       'Lan and Wittes 1988', [dict(args=[dict(z=z, informationFraction=t)], expect=cond_power(z, t)) for z, t in [(1.2, 0.5), (2.0, 0.3), (0.5, 0.8)]], tol=1e-9, tier=4)

# tests
AN = [([2.9, 3.0, 2.5, 2.6, 3.2], [3.8, 2.7, 4.0, 2.4], [2.8, 3.4, 3.7, 2.2, 2.0]), ([1.0, 2.0, 3.0, 4.5], [3.0, 4.0, 5.5, 6.0], [5.0, 6.5, 7.0, 8.0]), ([10.0, 20.0, 15.0], [15.0, 25.0, 35.0, 30.0], [5.0, 8.0, 12.0, 30.0, 9.0])]
method('roadmap-tests', 'oneWayAnova', 'packages/stats/src/paired.ts',
       'oneWayAnova(groups: readonly (readonly number[])[]): { statistic: number; df1: number; df2: number; pValue: number }',
       'One-way ANOVA F test of equal means: F = MSB / MSW with k - 1 and N - k df',
       'scipy.stats.f_oneway', [dict(args=[list(map(list, g))], expect=dict(statistic=float(stats.f_oneway(*g).statistic), df1=len(g) - 1, df2=sum(map(len, g)) - len(g), pValue=float(stats.f_oneway(*g).pvalue))) for g in AN], tol=1e-9, tier=3)


def welch_anova(*g):
    k = len(g)
    n = np.array([len(x) for x in g], float)
    m = np.array([np.mean(x) for x in g])
    v = np.array([np.var(x, ddof=1) for x in g])
    w = n / v
    mw = (w * m).sum() / w.sum()
    a = (w * (m - mw) ** 2).sum() / (k - 1)
    tmp = ((1 - w / w.sum()) ** 2 / (n - 1)).sum()
    b = 1 + 2 * (k - 2) / (k * k - 1) * tmp
    F = a / b
    df2 = (k * k - 1) / (3 * tmp)
    return dict(statistic=float(F), df1=k - 1, df2=float(df2), pValue=float(stats.f.sf(F, k - 1, df2)))


method('roadmap-tests', 'welchAnova', 'packages/stats/src/paired.ts',
       'welchAnova(groups: readonly (readonly number[])[]): { statistic: number; df1: number; df2: number; pValue: number }',
       "Welch's one-way ANOVA for unequal variances: weights n/s^2, F = (sum w (m - mw)^2 / (k - 1)) / (1 + 2(k - 2)/(k^2 - 1) T), T = sum (1 - w/W)^2 / (n - 1), df2 = (k^2 - 1) / (3T)",
       'Welch 1951', [dict(args=[list(map(list, g))], expect=welch_anova(*g)) for g in AN], tol=1e-9, tier=4)
method('roadmap-tests', 'bartlettTest', 'packages/stats/src/paired.ts',
       'bartlettTest(groups: readonly (readonly number[])[]): { statistic: number; pValue: number }',
       "Bartlett's test of equal variances, chi-square with k - 1 df",
       'scipy.stats.bartlett', [dict(args=[list(map(list, g))], expect=dict(statistic=float(stats.bartlett(*g).statistic), pValue=float(stats.bartlett(*g).pvalue))) for g in AN], tol=1e-9, tier=3)


def mood(*g):
    r = stats.median_test(*g, ties='below', correction=True)
    return dict(statistic=float(r.statistic), pValue=float(r.pvalue))


method('roadmap-tests', 'moodMedianTest', 'packages/stats/src/paired.ts',
       "moodMedianTest(groups: readonly (readonly number[])[]): { statistic: number; pValue: number }",
       "Mood's median test: the 2 x k table of counts above and at-or-below the grand median, Pearson chi-square with Yates' correction when it is 2 x 2",
       "scipy.stats.median_test(ties='below', correction=True)", [dict(args=[list(map(list, g))], expect=mood(*g)) for g in AN], tol=1e-9, tier=4)
method('roadmap-tests', 'brunnerMunzel', 'packages/stats/src/paired.ts',
       'brunnerMunzel(x: readonly number[], y: readonly number[]): { statistic: number; pValue: number }',
       'The Brunner-Munzel test of stochastic equality (two-sided, t distribution with the Satterthwaite df)',
       'scipy.stats.brunnermunzel', [dict(args=[x, y], expect=dict(statistic=float(stats.brunnermunzel(x, y).statistic), pValue=float(stats.brunnermunzel(x, y).pvalue))) for x, y in MW], tol=1e-9, tier=4)


def bowker(t):
    t = np.array(t, float)
    k = t.shape[0]
    stat = 0.0
    df = 0
    for i in range(k):
        for j in range(i + 1, k):
            if t[i, j] + t[j, i] > 0:
                stat += (t[i, j] - t[j, i]) ** 2 / (t[i, j] + t[j, i])
                df += 1
    return dict(statistic=float(stat), df=df, pValue=float(stats.chi2.sf(stat, df)))


BW = [[[20, 5, 3], [10, 30, 4], [2, 8, 25]], [[15, 2], [8, 20]], [[10, 3, 1, 0], [2, 12, 4, 1], [3, 1, 9, 2], [0, 2, 5, 11]]]
method('roadmap-tests', 'bowkerSymmetry', 'packages/stats/src/paired.ts',
       'bowkerSymmetry(table: readonly (readonly number[])[]): { statistic: number; df: number; pValue: number }',
       "Bowker's test of symmetry of a k x k paired table (the multi-category McNemar): sum over i < j with n_ij + n_ji > 0 of (n_ij - n_ji)^2 / (n_ij + n_ji), chi-square with that many df",
       'Bowker 1948', [dict(args=[t], expect=bowker(t)) for t in BW], tol=1e-9, tier=3)

# variance components
def reml_oneway(v, cl):
    groups = {}
    for x, c in zip(v, cl):
        groups.setdefault(c, []).append(x)
    g = [np.array(x, float) for x in groups.values()]
    N = sum(len(x) for x in g)

    def nll(theta):
        sb, se = math.exp(theta[0]), math.exp(theta[1])
        # Restricted likelihood of y = mu + a_g + e, by the per-group covariance and the GLS mean.
        Vi = [np.linalg.inv(sb * np.ones((len(x), len(x))) + se * np.eye(len(x))) for x in g]
        xtvx = sum(V.sum() for V in Vi)
        mu = sum((V @ x).sum() for V, x in zip(Vi, g)) / xtvx
        ll = 0.0
        for V, x in zip(Vi, g):
            r = x - mu
            ll += -0.5 * (-np.linalg.slogdet(V)[1]) - 0.5 * r @ V @ r
        ll += -0.5 * math.log(xtvx)
        return -ll
    best = optimize.minimize(nll, [0.0, 0.0], method='Nelder-Mead', options=dict(xatol=1e-12, fatol=1e-14, maxiter=20000))
    return dict(between=float(math.exp(best.x[0])), within=float(math.exp(best.x[1])))


RV = [([3, 4, 5, 9, 8, 10, 2, 3, 1, 4, 6, 7], [1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 5, 5]), ([0.2, 0.4, 0.3, 0.9, 0.8, 0.85, 0.1, 0.5, 0.45, 0.6], ['a', 'a', 'a', 'b', 'b', 'b', 'c', 'c', 'd', 'd']), ([10, 12, 11, 15, 14, 9, 8, 13, 16, 12, 11], [1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4])]
method('roadmap-shrinkage-clustering', 'remlOneWay', 'packages/stats/src/variance.ts',
       'remlOneWay(values: readonly number[], groups: readonly (string | number)[]): { between: number; within: number }',
       'REML estimates of the between-group and within-group variances of the one-way random model y = mu + a_g + e, unbalanced groups; cases have a positive between variance (relative tolerance 1e-5)',
       'Patterson and Thompson 1971; scipy.optimize on the restricted likelihood', [dict(args=[v, c], expect=reml_oneway(v, c)) for v, c in RV], tol=1e-5, tier=5)


def icc_ci(rows, a=0.05):
    x = np.array(rows, float)
    n, k = x.shape
    gm = x.mean()
    msb = k * ((x.mean(1) - gm) ** 2).sum() / (n - 1)
    msw = ((x - x.mean(1, keepdims=True)) ** 2).sum() / (n * (k - 1))
    F = msb / msw
    fl = F / stats.f.ppf(1 - a / 2, n - 1, n * (k - 1))
    fu = F * stats.f.ppf(1 - a / 2, n * (k - 1), n - 1)
    return dict(estimate=float((msb - msw) / (msb + (k - 1) * msw)), lower=float((fl - 1) / (fl + k - 1)), upper=float((fu - 1) / (fu + k - 1)))


method('roadmap-shrinkage-clustering', 'iccInterval', 'packages/stats/src/variance.ts',
       'iccInterval(scores: readonly (readonly number[])[], alpha = 0.05): Interval',
       'ICC(1) of a balanced table (rows targets, columns repeats) with its F interval: F = MSB / MSW, FL = F / F(1 - alpha/2, n - 1, n(k - 1)), FU = F F(1 - alpha/2, n(k - 1), n - 1), bounds (FL - 1)/(FL + k - 1) and (FU - 1)/(FU + k - 1)',
       'Shrout and Fleiss 1979', [dict(args=[r], expect=icc_ci(r)) for r in NUM], tol=1e-9, tier=4)

# effect sizes and association
STRATA = [[[10, 5], [6, 12]], [[8, 7], [4, 11]], [[15, 3], [9, 9]]]


def mh_or(st):
    num = sum(t[0][0] * t[1][1] / (sum(map(sum, t))) for t in st)
    den = sum(t[0][1] * t[1][0] / (sum(map(sum, t))) for t in st)
    return num / den


def cmh(st):
    a = sum(t[0][0] for t in st)
    ea = sum((t[0][0] + t[0][1]) * (t[0][0] + t[1][0]) / sum(map(sum, t)) for t in st)
    var = sum((t[0][0] + t[0][1]) * (t[1][0] + t[1][1]) * (t[0][0] + t[1][0]) * (t[0][1] + t[1][1]) / (sum(map(sum, t)) ** 2 * (sum(map(sum, t)) - 1)) for t in st)
    stat = (abs(a - ea) - 0.5) ** 2 / var
    return dict(statistic=float(stat), pValue=float(stats.chi2.sf(stat, 1)))


SETS = [STRATA, STRATA[:2], [STRATA[2], [[20, 10], [10, 20]]]]
method('roadmap-association', 'mantelHaenszelOddsRatio', 'packages/stats/src/agreement.ts',
       'mantelHaenszelOddsRatio(strata: readonly (readonly (readonly number[])[])[]): number',
       'The Mantel-Haenszel pooled odds ratio over 2x2 strata [[a, b], [c, d]]: sum (a d / n) / sum (b c / n)',
       'Mantel and Haenszel 1959', [dict(args=[st], expect=mh_or(st)) for st in SETS], tol=1e-12, tier=3)
method('roadmap-association', 'cochranMantelHaenszel', 'packages/stats/src/agreement.ts',
       'cochranMantelHaenszel(strata: readonly (readonly (readonly number[])[])[]): { statistic: number; pValue: number }',
       'The Cochran-Mantel-Haenszel test of conditional independence with the continuity correction: (|sum a - sum E[a]| - 1/2)^2 / sum Var(a), chi-square with 1 df',
       'Cochran 1954; Mantel and Haenszel 1959', [dict(args=[st], expect=cmh(st)) for st in SETS], tol=1e-9, tier=4)
method('roadmap-association', 'glassDelta', 'packages/stats/src/paired.ts',
       'glassDelta(treatment: readonly number[], control: readonly number[]): number',
       "Glass's delta: (mean treatment - mean control) / sd control (n - 1 standard deviation)",
       'Glass 1976', [dict(args=[x, y], expect=float((np.mean(x) - np.mean(y)) / np.std(y, ddof=1))) for x, y in XY], tol=1e-12, tier=2)
method('roadmap-association', 'cohenH', 'packages/stats/src/paired.ts',
       'cohenH(p1: number, p2: number): number',
       "Cohen's h, the arcsine difference of two rates: 2 asin(sqrt(p1)) - 2 asin(sqrt(p2))",
       'Cohen 1988', [dict(args=[a, b], expect=2 * math.asin(math.sqrt(a)) - 2 * math.asin(math.sqrt(b))) for a, b in [(0.8, 0.7), (0.5, 0.3), (0.95, 0.99)]], tol=1e-12, tier=2)


def cramers_v(t):
    t = np.array(t, float)
    chi = stats.chi2_contingency(t, correction=False)[0]
    return float(math.sqrt(chi / (t.sum() * (min(t.shape) - 1))))


method('roadmap-association', 'cramersV', 'packages/stats/src/agreement.ts',
       "cramersV(table: readonly (readonly number[])[]): number",
       "Cramer's V: sqrt(chi2 / (n (min(r, c) - 1))), chi2 Pearson's without correction",
       'Cramer 1946', [dict(args=[t], expect=cramers_v(t)) for t in CT], tol=1e-12, tier=3)


def phi(a, b, c, d):
    return (a * d - b * c) / math.sqrt((a + b) * (c + d) * (a + c) * (b + d))


method('roadmap-association', 'phiCoefficient', 'packages/stats/src/agreement.ts',
       'phiCoefficient(a: number, b: number, c: number, d: number): number',
       'The phi coefficient of a 2x2 table: (ad - bc) / sqrt((a + b)(c + d)(a + c)(b + d))',
       'Yule 1912', [dict(args=list(t), expect=phi(*t)) for t in TB], tol=1e-12, tier=2)


def gk_gamma(x, y):
    c = d = 0
    for i in range(len(x)):
        for j in range(i + 1, len(x)):
            s_ = (x[i] - x[j]) * (y[i] - y[j])
            if s_ > 0: c += 1
            elif s_ < 0: d += 1
    return (c - d) / (c + d)


method('roadmap-association', 'goodmanKruskalGamma', 'packages/stats/src/agreement.ts',
       'goodmanKruskalGamma(x: readonly number[], y: readonly number[]): number',
       'Goodman and Kruskal gamma over all pairs: (concordant - discordant) / (concordant + discordant), tied pairs left out',
       'Goodman and Kruskal 1954', [dict(args=[x, y], expect=gk_gamma(x, y)) for x, y in XY], tol=1e-12, tier=3)


def kendall_w(m):
    x = np.array(m, float)  # rows raters, columns items
    r = np.array([stats.rankdata(row) for row in x])
    m_, n = r.shape
    R = r.sum(0)
    S = ((R - R.mean()) ** 2).sum()
    T = sum(sum(t ** 3 - t for t in np.unique(row, return_counts=True)[1]) for row in x)
    return float(12 * S / (m_ * m_ * (n ** 3 - n) - m_ * T))


KW3 = [[[1, 2, 3, 4, 5], [2, 1, 3, 5, 4], [1, 3, 2, 4, 5]], [[3, 1, 2, 4], [3, 2, 1, 4]], [[7, 5, 9, 2, 6, 6], [8, 4, 9, 1, 5, 7], [6, 5, 8, 3, 7, 6], [7, 6, 9, 2, 5, 8]]]
method('roadmap-association', 'kendallW', 'packages/stats/src/agreement.ts',
       "kendallW(scores: readonly (readonly number[])[]): number",
       "Kendall's W, the coefficient of concordance of m raters (rows) over n items (columns), average ranks within each rater, tie-corrected: 12 S / (m^2 (n^3 - n) - m T), T = sum over tie groups (t^3 - t)",
       'Kendall and Babington Smith 1939', [dict(args=[m], expect=kendall_w(m)) for m in KW3], tol=1e-12, tier=4)


def mcc(t, p):
    labels = sorted(set(t) | set(p))
    C = np.array([[sum(1 for a, b in zip(t, p) if a == i and b == j) for j in labels] for i in labels], float)
    tk, pk = C.sum(1), C.sum(0)
    c, s_ = np.trace(C), C.sum()
    return float((c * s_ - (tk * pk).sum()) / math.sqrt((s_ ** 2 - (pk ** 2).sum()) * (s_ ** 2 - (tk ** 2).sum())))


method('roadmap-association', 'matthewsCorrelation', 'packages/stats/src/agreement.ts',
       'matthewsCorrelation(truth: readonly string[], predicted: readonly string[]): number',
       'The Matthews correlation coefficient, multiclass (Gorodkin): (c s - sum t_k p_k) / sqrt((s^2 - sum p_k^2)(s^2 - sum t_k^2)), c the correct count, s the total, t_k and p_k the true and predicted counts per class',
       'sklearn.metrics.matthews_corrcoef', [dict(args=[t, p], expect=mcc(t, p)) for t, p in CLS[:3]], tol=1e-12, tier=3)


def huber(v, k=1.345):
    x = np.array(v, float)
    med = np.median(x)
    sc = np.median(np.abs(x - med)) / 0.6744897501960817
    mu = med
    for _ in range(1000):
        r = (x - mu) / sc
        w = np.where(np.abs(r) <= k, 1.0, k / np.abs(r))
        new = (w * x).sum() / w.sum()
        if abs(new - mu) < 1e-14:
            break
        mu = new
    return float(mu)


method('roadmap-robust', 'huberLocation', 'packages/stats/src/basics.ts',
       'huberLocation(values: readonly number[], k = 1.345): number',
       "Huber's M-estimate of location with the scale fixed at MAD / 0.6744897501960817: iterate mu <- sum w x / sum w, w = 1 for |x - mu| / scale <= k else k / |(x - mu) / scale|, from the median, to 1e-14",
       'Huber 1964', [dict(args=[v], expect=huber(v)) for v in RB], tol=1e-9, tier=4)


def geo_iv(v, a=0.05):
    lv = np.log(v)
    t = tint(list(lv), a)
    return dict(estimate=math.exp(t['estimate']), lower=math.exp(t['lower']), upper=math.exp(t['upper']))


method('roadmap-robust', 'geometricMeanInterval', 'packages/stats/src/basics.ts',
       'geometricMeanInterval(values: readonly number[], alpha = 0.05): Interval',
       "The geometric mean with the t interval on the log scale, back-transformed: exp(mean ln x -/+ t(1 - alpha/2, n - 1) s_ln / sqrt(n)); values must be positive",
       'lognormal mean of logs', [dict(args=[v], expect=geo_iv(v)) for v in T_SAMPLES], tol=1e-9, tier=3)

Path(__file__).with_name('roadmap.json').write_text(json.dumps(dict(
    generatedBy='packages/validators/fixtures/stats/make_roadmap.py',
    scipy=__import__('scipy').__version__, numpy=np.__version__, methods=methods), indent=1) + '\n')
print(sum(len(m['cases']) for m in methods), 'cases in', len(methods), 'methods')
