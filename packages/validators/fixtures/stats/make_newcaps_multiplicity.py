"""Reference values for the multiplicity group: the Bonferroni threshold. Every value is computed with exact
rational arithmetic (Fraction) where the function is rational, and with 120-digit Decimal where it needs ln, exp
or sqrt, then cross-checked a second way.
Run: PYTHONDONTWRITEBYTECODE=1 python3 make_newcaps_multiplicity.py
"""

import os
import sys

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

PI_DOMAIN = [
    [[], 0.5],
    [[0.1, 0.2], 1],
    [[0.1, 0.2], -0.1],
    [[0.1, 0.2], "NaN"],
    [[0.1, 1.2], 0.5],
    [[0.1, 0.2], 1.5],
]
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


def bonf_thr(m, a):
    return F(a) / m


def bonf_thr_alt(m, a):
    t = dec(F(a)) / dec(m)
    assert m * bonf_thr(m, a) == F(a)
    return t


RATE_INPUTS = [[10, 0.05], [1, 0.05], [3, 0.1], [7, 0.0], [4, 1.0], [50, 0.05], [2, 0.01], [1000, 0.05]]
BT_DOMAIN = [[0, 0.05], [-2, 0.05], [2.5, 0.05], [3, 1.5], [3, "NaN"]]
build("bonferroniThreshold", "rates", bonf_thr, bonf_thr_alt, RATE_INPUTS, BT_DOMAIN, list_result=False)

write(
    GROUP,
    "Exact reference values for the multiplicity functions, computed with Fraction and 120-digit Decimal by "
    "make_newcaps_multiplicity.py and cross-checked a second way.",
    functions,
)
