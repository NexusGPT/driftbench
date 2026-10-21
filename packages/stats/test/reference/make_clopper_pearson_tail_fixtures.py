"""Clopper-Pearson limits at alpha down to the smallest subnormal, from the exact binomial tails.

Standard library only (Decimal at 160 digits). The limits of the exact interval for k successes in n trials solve
P(X >= k | p) = alpha / 2 for the lower limit and P(X <= k | p) = alpha / 2 for the upper one. Both are sums of
positive terms, so nothing cancels, and the sums are evaluated at the exact double alpha (a float literal), never
at a rounded decimal. No beta function and no driftbench code is used. The limits are rounded once to doubles.
"""

import json
from decimal import Decimal as D
from decimal import getcontext
from math import comb
from pathlib import Path

getcontext().prec = 160
getcontext().Emin = -10**9
getcontext().Emax = 10**9


def tail_ge(k, n, p):
    q = 1 - p
    return sum((D(comb(n, j)) * p**j * q ** (n - j) for j in range(k, n + 1)), D(0))


def tail_le(k, n, p):
    q = 1 - p
    return sum((D(comb(n, j)) * p**j * q ** (n - j) for j in range(0, k + 1)), D(0))


def solve(f, target, increasing):
    """The p in (0, 1) with f(p) = target, by geometric then arithmetic bisection."""
    lo, hi = D(0), D(1)
    for _ in range(2200):
        mid = (lo + hi) / 2 if lo > 0 or hi > D("1e-3") else hi / D(2) ** 40
        if (f(mid) < target) == increasing:
            lo = mid
        else:
            hi = mid
        if lo > 0 and hi - lo < lo * D(10) ** -40:
            break
    return (lo + hi) / 2


def limits(k, n, alpha):
    half = D(alpha) / 2
    lower = D(0) if k == 0 else solve(lambda p: tail_ge(k, n, p), half, True)
    upper = D(1) if k == n else solve(lambda p: tail_le(k, n, p), half, False)
    return float(lower), float(upper)


ALPHAS = [5e-324, 1e-320, 1e-300, 1e-5]
COUNTS = [(0, 10), (1, 10), (5, 10), (9, 10), (10, 10), (50, 100), (1, 100), (99, 100), (30, 1000)]
cases = []
for alpha in ALPHAS:
    for k, n in COUNTS:
        lower, upper = limits(k, n, alpha)
        cases.append(dict(alpha=alpha, k=k, n=n, lower=lower, upper=upper))
artifact = dict(
    method="bisection on the exact binomial tails P(X >= k) and P(X <= k) at the exact double alpha / 2, 160 digits",
    dependencies=dict(python="standard library, decimal"),
    cases=cases,
)
out = Path(__file__).with_name("clopper-pearson-tail.json")
out.write_text(json.dumps(artifact, indent=2, allow_nan=False) + "\n")
print(f"wrote {out}")
