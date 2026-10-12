"""Scores every pairwise record against the truth of set.json. Makes no model call.
Accuracy: the choice names the better candidate. A tie is wrong (the cases are decisive by construction).

Run from the repository root:
    python3 comparisons/langwatch/pairwise/score.py
"""

import glob
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


items = {x["id"]: x for x in json.load(open(os.path.join(HERE, "set.json")))}
rows = ["| System | Model | Accuracy | Ties | Position-inconsistent | Unanswered | Spend |", "|---|---|---|---|---|---|---|"]
for path in sorted(glob.glob(os.path.join(HERE, "recorded", "*.json"))):
    rec = json.load(open(path))
    answers = rec["answers"]
    n = len(answers)
    truth = {i: ("first" if items[i]["better"] == "A" else "second") for i in items}
    correct = sum(1 for a in answers if a["choice"] == truth[a["id"]])
    ties = sum(1 for a in answers if a["choice"] == "tie")
    inconsistent = sum(1 for a in answers if not a["consistent"])
    rows.append(
        f"| {rec['system']} | {rec['model']} | {cell(correct, n)} | {ties}/{n} | {inconsistent}/{n} | "
        f"{rec.get('unanswered', 0)} | {rec['spentUsd']:.4f} USD |"
    )
out = "\n".join(rows)
print(out)
open(os.path.join(HERE, "recorded", "results.md"), "w").write(out + "\n")
