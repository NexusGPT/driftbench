"""Compares driftbench's ROUGE-L and BLEU with the reference library on every pair. Makes no model call.

Run from the repository root, after ours.mts and theirs.py:
    python3 comparisons/langwatch/overlap/score.py
"""

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
REC = os.path.join(HERE, "recorded")
ours = {r["id"]: r for r in json.load(open(os.path.join(REC, "overlap-ours.json")))}
theirs = {r["id"]: r for r in json.load(open(os.path.join(REC, "overlap-theirs.json")))}
ids = list(ours)
n = len(ids)
rows = ["| Measure | Result |", "|---|---|", f"| Pairs | {n} |"]
for metric in ["rougeL", "bleu"]:
    diffs = [abs(ours[i][metric]["ragas"] - theirs[i][metric]) for i in ids]
    within = sum(1 for d in diffs if d <= 1e-9)
    rows.append(f"| {metric}, ragas profile: pairs within 1e-9 of the reference | {within}/{n} |")
    rows.append(f"| {metric}, ragas profile: largest difference | {max(diffs):.2e} |")
    other = [abs(ours[i][metric]["driftbench"] - theirs[i][metric]) for i in ids]
    rows.append(f"| {metric}, driftbench profile: pairs that differ from the reference by more than 1e-9 | {sum(1 for d in other if d > 1e-9)}/{n} |")
out = "\n".join(rows)
print(out)
open(os.path.join(REC, "overlap-results.md"), "w").write(out + "\n")
