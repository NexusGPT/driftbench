"""Scores both exact-match verdicts against the truth labels. Makes no model call.

Run from the repository root, after ours.mts and theirs.py:
    python3 comparisons/langwatch/exact/score.py
"""

import collections
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
REC = os.path.join(HERE, "recorded")


def wilson(k, n, z=1.96):
    if n == 0:
        return (0.0, 1.0)
    p = k / n
    denom = 1 + z * z / n
    centre = p + z * z / (2 * n)
    margin = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return ((centre - margin) / denom, (centre + margin) / denom)


def cell(k, n):
    lo, hi = wilson(k, n)
    pct = lambda x: f"{round(x * 100)}%"
    return f"{k}/{n} ({pct(k / n)}; 95% {pct(lo)} to {pct(hi)})"


items = json.load(open(os.path.join(HERE, "heldout.json")))
ours = {r["id"]: r["passed"] for r in json.load(open(os.path.join(REC, "exact-ours.json")))}
theirs = {r["id"]: r["passed"] for r in json.load(open(os.path.join(REC, "exact-theirs.json")))}
n = len(items)
ours_ok = sum(1 for x in items if ours[x["id"]] == (x["truth"] == "same"))
theirs_ok = sum(1 for x in items if theirs[x["id"]] == (x["truth"] == "same"))
rows = ["| Measure | Result |", "|---|---|", f"| Cases | {n} |",
        f"| driftbench exact: agrees with truth | {cell(ours_ok, n)} |",
        f"| competitor exact_match: agrees with truth | {cell(theirs_ok, n)} |"]
by = collections.OrderedDict()
for x in items:
    key = x["kind"]
    by.setdefault(key, [0, 0, 0])
    by[key][0] += 1
    by[key][1] += ours[x["id"]] == (x["truth"] == "same")
    by[key][2] += theirs[x["id"]] == (x["truth"] == "same")
rows += ["", "| Transformation | Cases | driftbench agrees | competitor agrees |", "|---|---|---|---|"]
for kind, (c, o, t) in by.items():
    rows.append(f"| {kind} | {c} | {o} | {t} |")
out = "\n".join(rows)
print(out)
open(os.path.join(REC, "exact-results.md"), "w").write(out + "\n")
