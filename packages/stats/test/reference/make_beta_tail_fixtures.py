"""Beta quantiles and Clopper-Pearson intervals in the tails, at 60 digits.

Run with Python plus mpmath (1.4.1 when generated). Each quantile is found by bisection on log x with mpmath's
regularized incomplete beta at 60 digits (the lower tail I_x(a, b) = p; an upper quantile is 1 minus the lower quantile of
the mirrored Beta(b, a), so a tiny q keeps its digits), stopped at a relative width of 1e-45, then rounded once to a
double. A quantile below the smallest double is not in the table. The Clopper-Pearson limits are the beta quantiles
at alpha / 2 of Beta(k, n - k + 1) and the upper quantile of Beta(k + 1, n - k) at alpha / 2.
"""

import json
from pathlib import Path

import mpmath
from mpmath import betainc, exp, mp, mpf

mp.dps = 60


def solve(is_below):
    lo, hi = mpf(-3000), mpf(0)  # log x
    for _ in range(400):
        mid = (lo + hi) / 2
        if is_below(exp(mid)):
            lo = mid
        else:
            hi = mid
        if hi - lo < mpf(10) ** -45:
            break
    return exp((lo + hi) / 2)


def lower_quantile(p, a, b):
    p, a, b = mpf(p), mpf(a), mpf(b)
    return solve(lambda x: betainc(a, b, 0, x, regularized=True) < p)


def upper_quantile(q, a, b):
    """x with P(X > x) = q for X ~ Beta(a, b): 1 - y, y the lower quantile of Beta(b, a). mpmath's upper-tail betainc is
    one minus the lower tail and cannot resolve q below 1e-60 at 60 digits; the symmetry has no such cancellation."""
    return 1 - lower_quantile(q, b, a)


LOWER = [
    (1e-5, 0.0195, 0.324), (1e-3, 0.0195, 0.324), (1e-12, 0.5, 0.5), (1e-8, 1, 1), (1e-30, 3, 17),
    (1e-100, 2, 5), (1e-300, 10, 10), (0.025, 3, 17), (0.5, 2, 3), (0.975, 1, 1e6), (0.4, 1000, 1000),
    (1e-20, 100, 0.5),
    # p above one half: 1 - p is exact, and the quantile of a p near 1 is only as good as the upper tail it solves
    (0.9999999999, 3, 17), (0.999999999999, 2, 5), (0.99999999, 0.5, 0.5), (0.999, 100, 3), (0.9999999999999, 1, 1e4),
]
UPPER = [
    (1e-10, 6, 16), (1e-20, 6, 16), (1e-17, 4, 7), (1e-12, 101, 9901), (0.025, 3, 17), (0.025, 1, 1e6),
    (0.975, 2, 5), (1e-300, 8, 24), (0.5, 2, 3),
]
CP = [
    (5, 20, 1e-20), (5, 20, 1e-10), (0, 10, 1e-20), (3, 10, 1e-17), (5, 20, 0.05), (0, 1000000, 0.05),
    (100, 10000, 1e-12), (20, 20, 1e-20), (7, 30, 1e-300), (1, 50, 1e-100),
]


def keep(x):
    """The double nearest x, or None when x underflows to zero."""
    value = float(x)
    return value if value > 0 else None


lower = [dict(p=p, a=a, b=b, expected=keep(lower_quantile(p, a, b))) for p, a, b in LOWER]
upper = [dict(q=q, a=a, b=b, expected=keep(upper_quantile(q, a, b))) for q, a, b in UPPER]
clopper = []
for k, n, alpha in CP:
    low = 0.0 if k == 0 else float(lower_quantile(mpf(alpha) / 2, k, n - k + 1))
    high = 1.0 if k == n else float(upper_quantile(mpf(alpha) / 2, k + 1, n - k))
    clopper.append(dict(k=k, n=n, alpha=alpha, lower=low, upper=high))

assert all(c["expected"] is not None for c in lower + upper)
artifact = dict(
    method="bisection on log x at 60 digits with mpmath's regularized incomplete beta, lower tail, upper tail by the mirror Beta(b, a)",
    dependencies=dict(mpmath=mpmath.__version__),
    betaQuantile=lower,
    betaQuantileUpper=upper,
    clopperPearson=clopper,
)
out = Path(__file__).with_name("beta-tail.json")
out.write_text(json.dumps(artifact, indent=2, allow_nan=False) + "\n")
print(f"wrote {out}")
