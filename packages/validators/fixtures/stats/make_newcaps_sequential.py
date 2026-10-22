"""Generator of newcaps-sequential.json: exact reference values for the sequential-evidence functions.

Every value is computed with Fractions or 120-digit Decimals and cross-checked a second, different way.
Run: PYTHONDONTWRITEBYTECODE=1 python3 make_newcaps_sequential.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ref_common import *  # noqa: E402,F403

DOC = "docs/statistics/sequential.md"
E = exp(1)
functions = []
SHOW = os.environ.get("SHOW")


def show(name, args, expected):
    if SHOW:
        print(name, args, "->", expected if isinstance(expected, (str, int, list, dict)) else repr(num(expected)))


# ---------------------------------------------------------------- sprt


def bounds(alpha, beta):
    a, b = F(alpha), F(beta)
    lower, upper = ln(b / (1 - a)), ln((1 - b) / a)
    # a different way: separate logarithms, and the exponentials give back the two ratios
    close(lower, ln(dec(b)) - ln(1 - dec(a)))
    close(upper, ln(1 - dec(b)) - ln(dec(a)))
    close(exp(lower), dec(b / (1 - a)))
    close(exp(upper), dec((1 - b) / a))
    return lower, upper


cases = []
for alpha, beta in [(0.05, 0.2), (0.05, 0.05), (0.01, 0.01), (0.4, 0.5), (0.05, 0.1), (0.1, 0.3), (0.001, 0.2)]:
    lo, up = bounds(alpha, beta)
    exp_ = {"lower": lo, "upper": up}
    cases.append(case([alpha, beta], exp_))
    show("sprtBoundaries", [alpha, beta], {"lower": num(lo), "upper": num(up)})
    if alpha == beta:
        close(lo, -up)
functions.append(function("sprtBoundaries", "sprt", DOC + "#sprtboundaries", cases,
                          [[0, 0.2], [0.05, 1], [0.05, 0], [0.5, 0.5], [0.6, 0.5], ["NaN", 0.1], [0.05, "Infinity"]]))


def lr_frac(k, n, p0, p1):
    p0, p1 = F(p0), F(p1)
    return p1**k * (1 - p1) ** (n - k) / (p0**k * (1 - p0) ** (n - k))


def llr(k, n, p0, p1):
    p0, p1 = dec(p0), dec(p1)
    return k * ln(p1 / p0) + (n - k) * ln((1 - p1) / (1 - p0))


cases = []
for k, n, p0, p1 in [(0, 0, 0.5, 0.7), (10, 10, 0.5, 0.9), (0, 10, 0.5, 0.9), (14, 20, 0.5, 0.7), (38, 50, 0.7, 0.8),
                     (12, 30, 0.5, 0.3), (1, 1, 0.25, 0.5), (45, 60, 0.9, 0.75), (7, 7, 0.1, 0.2)]:
    a = llr(k, n, p0, p1)
    close(a, ln(lr_frac(k, n, p0, p1)))  # the log of the exact rational likelihood ratio
    cases.append(case([k, n, p0, p1], a))
    show("sprtLogLikelihoodRatioBernoulli", [k, n, p0, p1], a)
functions.append(function("sprtLogLikelihoodRatioBernoulli", "sprt", DOC + "#sprtloglikelihoodratiobernoulli", cases,
                          [[5, 3, 0.5, 0.7], [-1, 3, 0.5, 0.7], [2.5, 4, 0.5, 0.7], [1, 3, 0.5, 0.5], [1, 3, 0, 0.5],
                           [1, 3, 0.5, 1], [1, "NaN", 0.5, 0.7], [1, 3, 0.5, "Infinity"]]))

# decision: pick inputs close to each boundary on both sides, plus plain ones
def decide(k, n, p0, p1, alpha, beta):
    lo, up = bounds(alpha, beta)
    a = llr(k, n, p0, p1)
    out = "reject-null" if a >= up else "accept-null" if a <= lo else "continue"
    # a different way: compare the exact rational likelihood ratio with the exact rational thresholds
    lr = lr_frac(k, n, p0, p1)
    hi_t, lo_t = (1 - F(beta)) / F(alpha), F(beta) / (1 - F(alpha))
    out2 = "reject-null" if lr >= hi_t else "accept-null" if lr <= lo_t else "continue"
    assert out == out2
    margin = min(abs(a - lo), abs(a - up))
    assert margin > D("0.0005"), (k, n, margin)
    return out, a, lo, up


def nearest(p0, p1, alpha, beta, boundary, above):
    lo, up = bounds(alpha, beta)
    target = up if boundary == "upper" else lo
    best = None
    for n in range(1, 61):
        for k in range(0, n + 1):
            gap = llr(k, n, p0, p1) - target
            if (gap > 0) != above or abs(gap) < D("0.001"):
                continue
            if best is None or abs(gap) < best[0]:
                best = (abs(gap), k, n)
    return best[1], best[2]


cases = []
spec = [(10, 10), (10, 0)]
inputs = [(10, 10, 0.5, 0.9, 0.05, 0.2), (0, 10, 0.5, 0.9, 0.05, 0.2), (0, 0, 0.5, 0.7, 0.05, 0.2),
          (6, 10, 0.5, 0.7, 0.05, 0.2), (3, 20, 0.6, 0.4, 0.05, 0.1), (20, 20, 0.6, 0.4, 0.05, 0.1)]
for above in (False, True):
    k, n = nearest(0.5, 0.7, 0.05, 0.2, "upper", above)
    inputs.append((k, n, 0.5, 0.7, 0.05, 0.2))
    k, n = nearest(0.5, 0.7, 0.05, 0.2, "lower", above)
    inputs.append((k, n, 0.5, 0.7, 0.05, 0.2))
seen = set()
for inp in inputs:
    if inp in seen:
        continue
    seen.add(inp)
    out, a, lo, up = decide(*inp)
    cases.append(case(list(inp), out))
    show("sprtDecisionBernoulli", list(inp), (out, num(a), num(lo), num(up)))
assert {c["expected"] for c in cases} == {"accept-null", "reject-null", "continue"}
functions.append(function("sprtDecisionBernoulli", "sprt", DOC + "#sprtdecisionbernoulli", cases,
                          [[5, 3, 0.5, 0.7, 0.05, 0.2], [1, 3, 0.5, 0.5, 0.05, 0.2], [1, 3, 0.5, 0.7, 0.5, 0.5],
                           [1, 3, 0.5, 0.7, 0, 0.2], [1, 3, 0.5, 0.7, 0.05, 1], [1, 3, 0, 0.7, 0.05, 0.2],
                           [-1, 3, 0.5, 0.7, 0.05, 0.2]]))


def ess(p0, p1, alpha, beta, truth):
    lo, up = bounds(alpha, beta)
    a_, b_ = F(alpha), F(beta)
    p0d, p1d = dec(p0), dec(p1)
    if truth == p0:
        drift = p0d * ln(p1d / p0d) + (1 - p0d) * ln((1 - p1d) / (1 - p0d))
        value = ((1 - dec(a_)) * lo + dec(a_) * up) / drift
    else:
        drift = p1d * ln(p1d / p0d) + (1 - p1d) * ln((1 - p1d) / (1 - p0d))
        value = (dec(b_) * lo + (1 - dec(b_)) * up) / drift
    # a different way: stopping probabilities from the thresholds A and B, the drift as a divergence from outcome probabilities
    A, B = (1 - b_) / a_, b_ / (1 - a_)
    acc0 = (A - 1) / (A - B)
    acc1 = B * (A - 1) / (A - B)
    assert acc0 == 1 - a_ and acc1 == b_
    t = F(truth)
    px = {1: t, 0: 1 - t}
    ratio = {1: F(p1) / F(p0), 0: (1 - F(p1)) / (1 - F(p0))}
    drift2 = sum(dec(px[x]) * ln(ratio[x]) for x in (0, 1))
    acc = acc0 if truth == p0 else acc1
    value2 = (dec(acc) * lo + (1 - dec(acc)) * up) / drift2
    close(value, value2)
    assert value > 0
    return value


cases = []
for args in [(0.5, 0.7, 0.05, 0.2, 0.5), (0.5, 0.7, 0.05, 0.2, 0.7), (0.7, 0.5, 0.05, 0.2, 0.7), (0.7, 0.5, 0.05, 0.2, 0.5),
             (0.8, 0.9, 0.05, 0.1, 0.8), (0.8, 0.9, 0.05, 0.1, 0.9), (0.1, 0.2, 0.01, 0.01, 0.1), (0.25, 0.5, 0.1, 0.1, 0.5),
             (0.5, 0.75, 0.025, 0.3, 0.75)]:
    v = ess(*args)
    cases.append(case(list(args), v))
    show("sprtExpectedSampleSizeBernoulli", list(args), v)
functions.append(function("sprtExpectedSampleSizeBernoulli", "sprt", DOC + "#sprtexpectedsamplesizebernoulli", cases,
                          [[0.5, 0.7, 0.05, 0.2, 0.6], [0.5, 0.7, 0.05, 0.2, 0.3], [0.5, 0.7, 0.05, 0.2, "NaN"],
                           [0.5, 0.5, 0.05, 0.2, 0.5], [0.5, 0.7, 0.5, 0.5, 0.5], [0, 0.7, 0.05, 0.2, 0],
                           [0.5, 0.7, 0.05, 1, 0.5]]))

# ---------------------------------------------------------------- mixture


def mixlog(n, mean, sigma, tau):
    n, m, s2, t2 = dec(n), dec(mean), dec(sigma) ** 2, dec(tau) ** 2
    return ln(s2 / (s2 + n * t2)) / 2 + n * n * m * m * t2 / (2 * s2 * (s2 + n * t2))


def mixlog_alt(n, mean, sigma, tau):
    # the ratio of two normal densities of the sample mean: N(0, sigma^2/n + tau^2) over N(0, sigma^2/n)
    n, m, s2, t2 = dec(n), dec(mean), dec(sigma) ** 2, dec(tau) ** 2
    v0 = s2 / n
    v1 = v0 + t2
    pdf = lambda x, v: (-x * x / (2 * v)).exp() / (2 * PI * v).sqrt()  # noqa: E731
    return ln(pdf(m, v1) / pdf(m, v0))


cases = []
for args in [(0, 0.3, 1, 0.5), (1, 0, 1, 1), (100, 0.3, 1, 0.5), (25, -0.2, 0.5, 0.25), (25, 0.2, 0.5, 0.25),
             (400, 0.05, 0.3, 0.1), (16, 1.5, 2, 3), (1000, 0.02, 0.5, 0.05)]:
    a = mixlog(*args)
    if args[0] >= 1:
        close(a, mixlog_alt(*args), 1e-60)
    else:
        assert a == 0
    cases.append(case(list(args), a))
    show("mixtureLogEValueNormal", list(args), a)
assert mixlog(25, -0.2, 0.5, 0.25) == mixlog(25, 0.2, 0.5, 0.25)
functions.append(function("mixtureLogEValueNormal", "mixture", DOC + "#mixturelogevaluenormal", cases,
                          [[-1, 0.3, 1, 0.5], [2.5, 0.3, 1, 0.5], [10, 0.3, 0, 0.5], [10, 0.3, 1, 0], [10, 0.3, 1, -0.5],
                           [10, 0.3, -1, 0.5], [10, "NaN", 1, 0.5], [10, "Infinity", 1, 0.5]]))


def radius(n, sigma, rho, alpha):
    n, s, r, a = dec(n), dec(sigma), dec(rho), dec(alpha)
    return s * (2 * (n * r * r + 1) / (n * n * r * r) * ln((n * r * r + 1).sqrt() / a)).sqrt()


cases = []
for args in [(1, 1, 1, 0.05), (100, 1, 0.1, 0.05), (10000, 0.3, 0.05, 0.05), (50, 2, 1, 0.01), (30, 0.5, 2, 0.5),
             (400, 0.3, 0.33, 0.1), (5, 1, 0.5, 0.001)]:
    n, sigma, rho, alpha = args
    r = radius(*args)
    # a different derivation: the radius is where the mixture log e-value (tau = rho sigma) reaches ln(1 / alpha)
    close(mixlog(n, r, sigma, dec(rho) * dec(sigma)), -ln(dec(alpha)), 1e-60)
    # and the form with ln(1 + n rho^2) / 2 - ln(alpha)
    alt = dec(sigma) * (2 * (n * dec(rho) ** 2 + 1) / (n * n * dec(rho) ** 2) * (ln(n * dec(rho) ** 2 + 1) / 2 - ln(dec(alpha)))).sqrt()
    close(r, alt, 1e-60)
    cases.append(case(list(args), r))
    show("confidenceSequenceRadiusNormal", list(args), r)
functions.append(function("confidenceSequenceRadiusNormal", "mixture", DOC + "#confidencesequenceradiusnormal", cases,
                          [[0, 1, 1, 0.05], [2.5, 1, 1, 0.05], [10, 0, 1, 0.05], [10, 1, 0, 0.05], [10, 1, 1, 0],
                           [10, 1, 1, 1], [10, 1, -1, 0.05], ["NaN", 1, 1, 0.05]]))

# ---------------------------------------------------------------- evalues

cases = []
for k, n, p0, p1 in [(7, 10, 0.5, 0.7), (0, 0, 0.5, 0.7), (10, 10, 0.5, 0.9), (3, 10, 0.5, 0.5), (2, 30, 0.3, 0.1),
                     (14, 20, 0.5, 0.7), (1, 6, 0.25, 0.75)]:
    a = lr_frac(k, n, p0, p1)
    close(exp(llr(k, n, p0, p1)), dec(a), 1e-60)
    cases.append(case([k, n, p0, p1], a))
    show("eValueSimpleVsSimpleBernoulli", [k, n, p0, p1], a)
functions.append(function("eValueSimpleVsSimpleBernoulli", "evalues", DOC + "#evaluesimplevssimplebernoulli", cases,
                          [[5, 3, 0.5, 0.7], [-1, 3, 0.5, 0.7], [1, 2.5, 0.5, 0.7], [1, 3, 0, 0.7], [1, 3, 0.5, 1],
                           [1, 3, "NaN", 0.7]]))


def beta_mix(k, n, p0, a, b):
    marg = F(factorial(a + k - 1) * factorial(b + n - k - 1) * factorial(a + b - 1),
             factorial(a - 1) * factorial(b - 1) * factorial(a + b + n - 1))
    p0 = F(p0)
    value = marg / (p0**k * (1 - p0) ** (n - k))
    # a different way: expand the Beta density as a polynomial and integrate it term by term
    def integral(power_p, power_q):  # integral of p^power_p (1-p)^power_q on [0,1]
        return sum(F((-1) ** j * comb(power_q, j), power_p + 1 + j) for j in range(power_q + 1))
    norm = integral(a - 1, b - 1)  # B(a, b)
    marg2 = integral(a - 1 + k, b - 1 + n - k) / norm
    assert marg == marg2
    return value


cases = []
for args in [(0, 0, 0.5, 1, 1), (7, 10, 0.5, 1, 1), (10, 10, 0.5, 1, 1), (3, 10, 0.3, 2, 3), (30, 40, 0.5, 2, 2),
             (0, 5, 0.1, 1, 4), (12, 12, 0.5, 3, 1), (18, 25, 0.6, 4, 2)]:
    v = beta_mix(*args)
    cases.append(case(list(args), v))
    show("eValueBetaMixtureBernoulli", list(args), v)
assert beta_mix(7, 10, 0.5, 1, 1) == F(2**10, 11 * comb(10, 7))
functions.append(function("eValueBetaMixtureBernoulli", "evalues", DOC + "#evaluebetamixturebernoulli", cases,
                          [[5, 3, 0.5, 1, 1], [-1, 3, 0.5, 1, 1], [1, 3, 0, 1, 1], [1, 3, 1, 1, 1], [1, 3, 0.5, 0, 1],
                           [1, 3, 0.5, 1, 0], [1, 3, 0.5, 1.5, 1], [1, 3, 0.5, 1, 2.5], [1, 3, "NaN", 1, 1]]))

# e-value products and averages
prod_sets = [[2, 3, 0.5], [7], [0.5, 0.5, 0.5, 0.5], [1.5, 2.5, 0, 4], [1.3, 0.9, 2.1, 1.7, 0.8], [1, 1, 1], [0.25, 8, 0.125, 6]]
cases = []
for xs in prod_sets:
    pr = F(1)
    for x in xs:
        pr *= F(x)
    if all(x > 0 for x in xs):
        close(exp(sum(ln(dec(x)) for x in xs)), dec(pr), 1e-60)
    else:
        assert pr == 0
    cases.append(case([xs], pr))
    show("eValueProduct", [xs], pr)
bad_e = [[[]], [[1, -0.5]], [[1, "NaN"]], [[0.5, "Infinity"]], [[-1]]]
functions.append(function("eValueProduct", "evalues", DOC + "#evalueproduct", cases, bad_e))

cases = []
for xs in [[2, 4], [1], [0, 0, 3], [0.5, 1.5, 2, 10], [1.3, 0.9, 2.1, 1.7, 0.8], [5, 5, 5], [0.1, 0.2, 0.3, 40]]:
    s = sum(F(x) for x in xs)
    mean_ = s / len(xs)
    close(sum(dec(F(x) / len(xs)) for x in xs), dec(mean_), 1e-60)  # a different way: sum of the scaled terms
    cases.append(case([xs], mean_))
    show("eValueAverage", [xs], mean_)
functions.append(function("eValueAverage", "evalues", DOC + "#evalueaverage", cases, bad_e))

cases = []
for e in [0, 0.5, 1, 3, 20, 1e6, 1.25, 0.999]:
    p = min(F(1), 1 / F(e)) if e > 0 else F(1)
    if e > 1:
        close(dec(p), 1 / dec(e), 1e-60)
    else:
        assert p == 1
    cases.append(case([e], p))
    show("eValueToPValue", [e], p)
functions.append(function("eValueToPValue", "evalues", DOC + "#evaluetopvalue", cases,
                          [[-1], [-0.001], ["NaN"], ["Infinity"], ["-Infinity"]]))


def ebh(es, alpha):
    m = len(es)
    s = sorted((F(e) for e in es), reverse=True)
    a = F(alpha)
    best = 0
    for k in range(1, m + 1):
        if s[k - 1] >= F(m) / (k * a):
            best = k
    # a different way: the largest k whose threshold m / (k alpha) is reached by at least k of the e-values
    alt = 0
    for k in range(1, m + 1):
        thr = F(m) / (k * a)
        if sum(1 for e in es if F(e) >= thr) >= k:
            alt = k
    assert best == alt
    return best


cases = []
ebh_inputs = [([5, 4.5, 3, 0.1], 0.5), ([1, 1, 1], 0.05), ([40, 16, 11, 8, 3, 2, 1, 0], 0.25),
              ([1000, 1000, 1000, 1000, 1000], 0.05), ([25], 0.05), ([10], 0.05),
              ([0.3, 45, 2.5, 120, 1.1, 60, 0.8, 9, 33, 0.2, 14, 7], 0.1), ([8, 0, 32, 16, 0, 11, 3, 8], 0.25),
              ([100, 2, 50, 1], 0.1)]
for es, alpha in ebh_inputs:
    r = ebh(es, alpha)
    cases.append(case([es, alpha], r))
    show("eBenjaminiHochbergRejections", [es, alpha], r)
assert {c["expected"] for c in cases} >= {0, 1, 3, 4, 5}
functions.append(function("eBenjaminiHochbergRejections", "evalues", DOC + "#ebenjaminihochbergrejections", cases,
                          [[[], 0.05], [[1, 2], 0], [[1, 2], 1], [[1, 2], 1.5], [[1, -2], 0.05], [[1, "NaN"], 0.05],
                           [[1, "Infinity"], 0.05], [[1, 2], "NaN"]]))


def kelly(p, odds):
    p, o = F(p), F(odds)
    f = (p * (o + 1) - 1) / o
    f = max(F(0), f)
    if f > 0 and p < 1:
        # a different way: the stake where the derivative of the expected log wealth vanishes
        d = p * o / (1 + o * f) - (1 - p) / (1 - f)
        assert d == 0
        g = lambda x: dec(p) * ln(1 + dec(o) * dec(x)) + (1 - dec(p)) * ln(1 - dec(x))  # noqa: E731
        eps = F(1, 1000)
        assert g(f) > g(f - eps) and g(f) > g(min(f + eps, F(999, 1000)))
    if f == 0:
        # at zero stake the derivative is not positive: p * odds - (1 - p) <= 0
        assert p * o - (1 - p) <= 0
    return f


cases = []
for args in [(0.6, 1), (0.5, 1), (0.25, 3), (0.3, 1), (0.4, 2), (0.55, 1), (1, 2), (0, 1.5), (0.62, 1.5), (0.8, 0.5)]:
    v = kelly(*args)
    cases.append(case(list(args), v))
    show("kellyFractionBernoulli", list(args), v)
functions.append(function("kellyFractionBernoulli", "evalues", DOC + "#kellyfractionbernoulli", cases,
                          [[1.2, 1], [-0.1, 1], [0.5, 0], [0.5, -1], ["NaN", 1], [0.5, "Infinity"], [0.5, "NaN"]]))

# the running product of a stream of e-values (an e-process)
cases = []
for xs in [[2, 3, 0.5], [7], [1.3, 0.9, 2.1, 1.7, 0.8], [0.5, 0.5, 0.5, 0.5], [1.5, 0, 4, 2], [1, 1, 1], [0.25, 8, 0.125, 6]]:
    acc, out = F(1), []
    for x in xs:
        acc *= F(x)
        out.append(acc)
    # a different way: the exponential of the running sum of logarithms (while positive)
    run = D(0)
    for x, v in zip(xs, out):
        if x > 0 and run is not None:
            run += ln(dec(x))
            close(exp(run), dec(v), 1e-60)
        else:
            run = None
            assert v == 0
    cases.append(case([xs], out))
    show("eValueRunningProduct", [xs], [num(v) for v in out])
functions.append(function("eValueRunningProduct", "evalues", DOC + "#evaluerunningproduct", cases, bad_e))

# ---------------------------------------------------------------- spending


def pocock(t, alpha):
    t, a = dec(t), dec(alpha)
    spent = a * ln(1 + (E - 1) * t)
    # a different way: invert the spending function, t = (exp(spent / alpha) - 1) / (e - 1)
    close((exp(spent / a) - 1) / (E - 1), t, 1e-60)
    return spent


cases = []
for args in [(0.5, 0.05), (1, 0.05), (0, 0.05), (0.25, 0.025), (1e-9, 0.05), (0.9, 0.1), (0.1, 0.05)]:
    v = pocock(*args)
    cases.append(case(list(args), v))
    show("pocockAlphaSpending", list(args), v)
assert pocock(1, 0.05) == dec(0.05) or abs(pocock(1, 0.05) - dec(0.05)) < D(10) ** -100
functions.append(function("pocockAlphaSpending", "spending", DOC + "#pocockalphaspending", cases,
                          [[1.1, 0.05], [-0.1, 0.05], [0.5, 0], [0.5, 1], [0.5, -0.05], ["NaN", 0.05], [0.5, "Infinity"]]))


def obf(looks, c):
    c = dec(c)
    out = [c / dec(F(k, looks)).sqrt() for k in range(1, looks + 1)]
    # a different way: c * sqrt(looks / k), and the square root of c^2 looks / k
    out2 = [(c * c * looks / k).sqrt() for k in range(1, looks + 1)]
    for a, b in zip(out, out2):
        close(a, b, 1e-60)
    assert abs(out[-1] - c) < D(10) ** -100
    return out


cases = []
for args in [(1, 1.96), (4, 2), (5, 2.04), (3, 2.004), (2, 2.8), (10, 1.99), (6, 2.5)]:
    v = obf(*args)
    cases.append(case(list(args), v))
    show("groupSequentialBoundariesObrienFleming", list(args), [num(x) for x in v])
functions.append(function("groupSequentialBoundariesObrienFleming", "spending", DOC + "#groupsequentialboundariesobrienfleming", cases,
                          [[0, 2], [-1, 2], [2.5, 2], [3, 0], [3, -1.96], [3, "NaN"], [3, "Infinity"], ["NaN", 2]]))

assert len(functions) == 16, len(functions)
# Only the functions driftbench uses are in the bank (docs/validators.md 12.2: no padding).
KEEP = ['eValueAverage']
functions = [f for f in functions if f["fn"] in KEEP]
write("sequential", "Exact values from Fractions and 120-digit Decimals (make_newcaps_sequential.py); each value cross-checked a second way.", functions)
