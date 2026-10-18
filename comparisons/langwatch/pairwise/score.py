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


sets = {}


def truth_of(set_name):
    if set_name not in sets:
        sets[set_name] = {x["id"]: x["better"] for x in json.load(open(os.path.join(HERE, set_name)))}
    return sets[set_name]

rows = ["| System | Model | Accuracy | Coverage | Ties | Position-inconsistent | Unanswered | Cost / 100 scored pairs | Spend |", "|---|---|---|---|---|---|---|---|---|"]
for path in sorted(glob.glob(os.path.join(HERE, "recorded", "*.json"))):
    rec = json.load(open(path))
    answers = rec["answers"]
    better = truth_of(rec.get("set", "set.json"))
    n = len(better)
    ids = [a["id"] for a in answers]
    if len(set(ids)) != len(ids) or any(i not in better for i in ids):
        raise ValueError(f"Duplicate or unknown answer IDs in {path}")
    cost_per_100 = rec["spentUsd"] / len(answers) * 100 if answers else 0
    truth = {i: ("first" if b == "A" else "second") for i, b in better.items()}
    correct = sum(1 for a in answers if a["choice"] == truth[a["id"]])
    ties = sum(1 for a in answers if a["choice"] == "tie")
    inconsistent = sum(1 for a in answers if not a["consistent"])
    rows.append(
        f"| {rec['system']} | {rec['model']} ({rec.get('set', 'set.json')}) | {cell(correct, n)} | {len(answers)}/{n} | {ties}/{n} | {inconsistent}/{n} | "
        f"{rec.get('unanswered', 0)} | {cost_per_100:.6f} USD | {rec['spentUsd']:.6f} USD |"
    )
out = "\n".join(rows)
print(out)
open(os.path.join(HERE, "recorded", "results.md"), "w").write(out + "\n")
