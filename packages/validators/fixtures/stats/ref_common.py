"""Shared exact arithmetic for the generators of the new-capability fixtures (make_newcaps_*.py).

Standard library only: fractions.Fraction for rational results, decimal.Decimal at 120 digits for everything
transcendental. Nothing here imports or runs driftbench code. Every value a fixture holds is rounded once, to a
binary64 double, by `num`.
"""

import json
from decimal import Decimal as D
from decimal import getcontext
from fractions import Fraction as F
from math import comb, factorial
from pathlib import Path

getcontext().prec = 120
getcontext().Emin = -10**9
getcontext().Emax = 10**9


def dec(x):
    """An exact Decimal of an int, a float (its exact binary value), a Fraction or a string."""
    if isinstance(x, D):
        return x
    if isinstance(x, F):
        return D(x.numerator) / D(x.denominator)
    if isinstance(x, float):
        return D(x)
    return D(x)


def frac(x):
    """An exact Fraction of an int, a float (its exact binary value) or a Fraction."""
    if isinstance(x, F):
        return x
    if isinstance(x, D):
        return F(x)
    return F(x)


def num(x):
    """The double nearest to an exact value (int, Fraction, Decimal or float); the one rounding of a fixture."""
    if isinstance(x, bool):
        return x
    if isinstance(x, int):
        return x if abs(x) < 2**53 else float(x)
    if isinstance(x, F):
        return float(x)
    if isinstance(x, D):
        return float(x)
    return x


def sqrt(x):
    return dec(x).sqrt()


def exp(x):
    return dec(x).exp()


def ln(x):
    return dec(x).ln()


def power(x, y):
    return (dec(y) * dec(x).ln()).exp()


def _atan_inv(n):
    x = D(1) / D(n)
    total, term, k = D(0), x, 0
    while abs(term) > D(10) ** -125:
        total += term / (2 * k + 1) * (-1 if k % 2 else 1)
        term *= x * x
        k += 1
    return total


PI = 16 * _atan_inv(5) - 4 * _atan_inv(239)
LN2 = D(2).ln()


def erf(x):
    """erf by its Taylor series (exact enough at 120 digits for |x| up to 10)."""
    x = dec(x)
    term, total, n = x, x, 0
    while abs(term) > D(10) ** -118:
        n += 1
        term = -term * x * x / n
        total += term / (2 * n + 1)
    return 2 / PI.sqrt() * total


def normal_cdf(x):
    x = dec(x)
    return (1 + erf(x / D(2).sqrt())) / 2


def normal_pdf(x):
    x = dec(x)
    return (-x * x / 2).exp() / (2 * PI).sqrt()


def normal_quantile(p):
    """The z with normal_cdf(z) = p, by Newton from a bisection start (p in (0, 1))."""
    p = dec(p)
    lo, hi = D(-12), D(12)
    for _ in range(60):
        mid = (lo + hi) / 2
        if normal_cdf(mid) < p:
            lo = mid
        else:
            hi = mid
    z = (lo + hi) / 2
    for _ in range(12):
        z -= (normal_cdf(z) - p) / normal_pdf(z)
    return z


_BERNOULLI = [F(1, 6), F(-1, 30), F(1, 42), F(-1, 30), F(5, 66), F(-691, 2730), F(7, 6), F(-3617, 510),
              F(43867, 798), F(-174611, 330), F(854513, 138), F(-236364091, 2730), F(8553103, 6),
              F(-23749461029, 870), F(8615841276005, 14322)]


def lgamma(x):
    """ln Gamma(x) for x > 0: shift to x + 60, then Stirling's series with 15 Bernoulli terms."""
    x = dec(x)
    shift = D(0)
    while x < 60:
        shift += x.ln()
        x += 1
    s = (x - D("0.5")) * x.ln() - x + (2 * PI).ln() / 2
    for k, b in enumerate(_BERNOULLI, start=1):
        s += dec(b) / (2 * k * (2 * k - 1) * x ** (2 * k - 1))
    return s - shift


def lbeta(a, b):
    return lgamma(a) + lgamma(b) - lgamma(dec(a) + dec(b))


def ranks(xs):
    """Mid-ranks (1-based, ties averaged) as Fractions."""
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    out = [F(0)] * len(xs)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and xs[order[j + 1]] == xs[order[i]]:
            j += 1
        for t in range(i, j + 1):
            out[order[t]] = F(i + j + 2, 2)
        i = j + 1
    return out


def close(a, b, rel=1e-30):
    """Assert two exact values agree: the cross-check inside a generator."""
    a, b = dec(a), dec(b)
    assert abs(a - b) <= D(rel) * max(abs(a), abs(b), D(1)), f"cross-check failed: {a} vs {b}"


def case(args, expected):
    return {"args": args, "expected": expected}


def function(fn, module, doc, values, domain, tol=None, note=None):
    """One capability: its name, the file of packages/stats/src it belongs in, the heading of its doc, the cases
    that must give `expected`, and the cases that must throw a RangeError."""
    assert len(values) >= 3, f"{fn}: at least three value cases"
    assert len(domain) >= 2, f"{fn}: at least two domain cases"
    entry = {"fn": fn, "module": module, "doc": doc, "values": values, "domain": [{"args": a} for a in domain]}
    if tol:
        entry["tol"] = tol
    if note:
        entry["note"] = note
    return entry


def _clean(v):
    if isinstance(v, bool):
        return v
    if isinstance(v, float):
        assert v == v and abs(v) != float("inf"), "a fixture holds finite numbers"
        return v
    if isinstance(v, (F, D)):
        return num(v)
    if isinstance(v, dict):
        return {k: _clean(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_clean(x) for x in v]
    return v


def write(group, provenance, functions):
    names = [f["fn"] for f in functions]
    assert len(set(names)) == len(names), "duplicate function in the group"
    out = {"_provenance": provenance, "group": group, "functions": _clean(functions)}
    path = Path(__file__).with_name(f"newcaps-{group}.json")
    path.write_text(json.dumps(out, indent=1, allow_nan=False) + "\n")
    print(f"wrote {path.name}: {len(functions)} functions")
