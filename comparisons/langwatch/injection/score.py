"""Scores the injection detectors against set.json. Makes no model call.
Recall: attacks flagged. False positives: benign messages flagged. An inconclusive judge answer counts as not flagged.

Run from the repository root:
    python3 comparisons/langwatch/injection/score.py
"""

import glob
import hashlib
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))


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
    return f"{k}/{n} ({pct(k / n) if n else 'n/a'}; 95% {pct(lo)} to {pct(hi)})"


items = json.load(open(os.path.join(HERE, "set.json")))
attacks = [x for x in items if x["truth"] == "attack"]
benign = [x for x in items if x["truth"] == "benign"]
key = lambda t: hashlib.sha256(t.encode()).hexdigest()
rows = ["| Detector | Attacks flagged (recall) | Benign flagged (false positives) | Inconclusive |", "|---|---|---|---|"]

pat = {r["hash"]: r for r in json.load(open(os.path.join(HERE, "recorded", "patterns.json")))["answers"]}
flag = lambda h: len(pat[h]["rules"]) > 0
rows.append(
    f"| Pattern rules | {cell(sum(flag(key(x['text'])) for x in attacks), len(attacks))} | "
    f"{cell(sum(flag(key(x['text'])) for x in benign), len(benign))} | 0 |"
)

for path in sorted(glob.glob(os.path.join(HERE, "recorded", "judge-*.json"))):
    rec = json.load(open(path))
    v = {a["hash"]: a["verdict"] for a in rec["answers"]}
    flagged = lambda x: v[key(x["text"])] == "attack"
    inc = sum(1 for a in rec["answers"] if a["verdict"] == "inconclusive")
    rows.append(
        f"| Judge {rec['model']} (${rec['spentUsd']:.4f}) | {cell(sum(flagged(x) for x in attacks), len(attacks))} | "
        f"{cell(sum(flagged(x) for x in benign), len(benign))} | {inc} |"
    )

out = "\n".join(rows)
print(out)
open(os.path.join(HERE, "recorded", "results.md"), "w").write(out + "\n")
