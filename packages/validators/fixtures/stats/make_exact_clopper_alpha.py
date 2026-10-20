"""Independent Clopper-Pearson limits at alpha down to the smallest subnormal.

Run: python3 packages/validators/fixtures/stats/make_exact_clopper_alpha.py
Then: pnpm exec biome format --write packages/validators/fixtures/stats/exact-clopper-alpha.json
Standard library only (Decimal at 160 digits); no product code is imported or executed. The limits of the exact
interval for k successes in n trials solve P(X >= k | p) = alpha / 2 (lower) and P(X <= k | p) = alpha / 2
(upper). Both are sums of positive terms, so nothing cancels, and they are evaluated at the exact double alpha
(Number.MIN_VALUE is exactly 2**-1074), never at a rounded decimal and with no beta function. Each limit is
rounded once to a double.
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
    """The p in (0, 1) with f(p) = target, by bisection (a geometric first step when p is tiny)."""
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


COUNTS = [(0, 10), (1, 10), (5, 10), (9, 10), (10, 10), (50, 100), (1, 100), (99, 100), (30, 1000)]
GROUPS = {
    "alpha-min": [5e-324],
    "alpha-subnormal": [1e-320, 1e-310],
    "alpha-small-normal": [1e-300, 1e-250],
}
out = {
    "_provenance": {
        "precision": "160 decimal digits; bisection on the exact binomial tails at the exact double alpha / 2",
        "generator": "make_exact_clopper_alpha.py",
    }
}
for group, alphas in GROUPS.items():
    rows = []
    for alpha in alphas:
        for k, n in COUNTS:
            lower, upper = limits(k, n, alpha)
            rows.append({"k": k, "n": n, "alpha": alpha, "expected": {"lower": lower, "upper": upper}})
    out[f"clopperPearson.{group}"] = rows
path = Path(__file__).with_name("exact-clopper-alpha.json")
path.write_text(json.dumps(out, indent=2, allow_nan=False) + "\n")
print(f"wrote {path}")
