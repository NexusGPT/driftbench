"""Cases for the group `distance` (docs/statistics/distance.md): the total variation distance between
probability vectors. Run:  PYTHONDONTWRITEBYTECODE=1 python3 packages/validators/fixtures/stats/make_newcaps_distance.py

Every value is computed from the definition in the page with exact arithmetic (Fraction for rationals, Decimal at
120 digits for ln and sqrt) and cross-checked by a second, different derivation; the doubles are rounded once.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ref_common import *  # noqa: E402,F403

functions = []
INF = "Infinity"


def pf(xs):
    return [F(x) for x in xs]


def chk_prob(p):
    assert abs(sum(pf(p)) - 1) <= F(1, 10**9) and all(F(x) >= 0 for x in p), p


# ---------------------------------------------------------------------------------------------- divergence
PV_DOMAIN = [
    [[0.5, 0.5], [0.5, 0.25, 0.25]],  # lengths differ
    [[], []],  # empty
    [[0.5, 0.6], [0.5, 0.5]],  # p sums to 1.1
    [[0.5, 0.5], [0.4, 0.4]],  # q sums to 0.8
    [[0.5, 0.500001], [0.5, 0.5]],  # sum off by 1e-6, above the 1e-9 slack
    [[1.5, -0.5], [0.5, 0.5]],  # sums to 1 but holds a negative entry
    [[0.5, "NaN"], [0.5, 0.5]],
    [[0.5, 0.5], [0.5, INF]],
]


def tv_exact(p, q):
    return sum(abs(a - b) for a, b in zip(pf(p), pf(q))) / 2


def tv_alt(p, q):  # 1/2 (sum p + sum q) - sum min(p, q)
    return (sum(pf(p)) + sum(pf(q))) / 2 - sum(min(a, b) for a, b in zip(pf(p), pf(q)))


cases = []
for p, q in [
    ([0.5, 0.5], [0.25, 0.75]),
    ([0.5, 0.25, 0.25], [0.5, 0.25, 0.25]),
    ([1, 0], [0, 1]),
    ([0.05, 0.15, 0.4, 0.3, 0.1], [0.1, 0.2, 0.3, 0.25, 0.15]),
    ([0.7, 0.2, 0.1], [0.2, 0.3, 0.5]),
    ([0.3, 0.7, 0], [0.3, 0.3, 0.4]),
]:
    chk_prob(p), chk_prob(q)
    a = tv_exact(p, q)
    assert abs(a - tv_alt(p, q)) < F(1, 10**15)
    close(a, tv_alt(p, q), rel=1e-15)
    cases.append(case([p, q], a))
functions.append(function("totalVariationDistance", "divergence",
                          "docs/statistics/distance.md#totalvariationdistance", cases, PV_DOMAIN))

write("distance", "Exact Fraction and 120 digit Decimal arithmetic from the definitions in docs/statistics/distance.md; each value is cross-checked by a second derivation inside make_newcaps_distance.py", functions)
