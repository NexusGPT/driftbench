"""Scores every recorded answer against its set's truth labels and prints the table. Makes no model call.
The sets are rebuilt in memory from their seeds (set.mjs); the records are keyed by message hash.

Run from the repository root:
    python3 comparisons/langwatch/pii/score.py
"""

import hashlib
import json
import math
import os
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
REC = os.path.join(HERE, "recorded")
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))


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
    rate = pct(k / n) if n else "n/a"
    return f"{k}/{n} ({rate}; 95% {pct(lo)} to {pct(hi)})"


def confusion(pairs):
    tp = sum(1 for e, f in pairs if e and f)
    fn = sum(1 for e, f in pairs if e and not f)
    fp = sum(1 for e, f in pairs if not e and f)
    tn = sum(1 for e, f in pairs if not e and not f)
    return tp, fn, fp, tn


def sha(text):
    return hashlib.sha256(text.encode()).hexdigest()


def set_of(name):
    """The truth of each item, keyed as the records are: the message hash, with an occurrence number on repeats."""
    raw = subprocess.run(
        ["node", os.path.join(HERE, "set.mjs"), "--set", name], check=True, capture_output=True, text=True, cwd=ROOT
    ).stdout
    items = json.loads(raw)
    occurrence = {}
    out = {}
    for x in items:
        digest = sha(x["text"])
        count = occurrence.get(digest, 0)
        occurrence[digest] = count + 1
        out[digest if count == 0 else f"{digest}-{count}"] = x["truth"]
    return out


def load(name):
    return json.load(open(os.path.join(REC, name)))


rows = ["| Measure | Set | Result |", "|---|---|---|"]
for setname in ["dev", "check"]:
    truth = set_of(setname)
    n = len(truth)
    rows.append(f"| Messages | {setname} | {n} |")
    try:
        pats = {r["hash"]: r for r in load(f"patterns-{setname}.json")["answers"]}
    except FileNotFoundError:
        pats = None
    if pats is not None:
        for label, tkey, pkey, field in [
            ("phone", "phone", "phone", "included"),
            ("IBAN", "iban", "iban", "included"),
            ("national number", "national", "national_number", "included"),
            ("email on reserved domains, default exclude", "email", "email", "excluded"),
            ("email on reserved domains, include", "email", "email", "included"),
        ]:
            pairs = [(truth[h][tkey], pkey in pats[h][field]) for h in truth]
            tp, fn, fp, tn = confusion(pairs)
            rows.append(f"| Patterns, {label}: recall | {setname} | {cell(tp, tp + fn)} |")
            rows.append(f"| Patterns, {label}: false positives | {setname} | {cell(fp, fp + tn)} |")
    try:
        pres = {r["hash"]: r for r in load(f"presidio-{setname}.json")["answers"]}
    except FileNotFoundError:
        pres = None
    if pres is not None:
        pp = [(truth[h]["person"], "person" in pres[h]["found"]) for h in truth]
        tp, fn, fp, tn = confusion(pp)
        rows.append(f"| Presidio, person name: recall | {setname} | {cell(tp, tp + fn)} |")
        rows.append(f"| Presidio, person name: false positives | {setname} | {cell(fp, fp + tn)} |")
    for name in sorted(f for f in os.listdir(REC) if f.startswith("judge-")):
        rec = load(name)
        if rec["set"] != setname:
            continue
        ans = {a["hash"]: a["personal"] for a in rec["answers"]}
        unanswered = sum(1 for a in rec["answers"] if a["personal"] is None)
        pairs = [(truth[h]["person"] or truth[h]["address"], ans[h] is True) for h in truth]
        tp, fn, fp, tn = confusion(pairs)
        label = f"judge {rec['model']}, rubric {rec['rubric']}"
        rows.append(f"| {label}, personal data: recall | {setname} | {cell(tp, tp + fn)} |")
        rows.append(f"| {label}, personal data: false positives | {setname} | {cell(fp, fp + tn)} |")
        rows.append(f"| {label}, unanswered | {setname} | {unanswered} |")
        rows.append(f"| {label}, spend | {setname} | {rec['spentUsd']:.4f} USD |")

out = "\n".join(rows)
print(out)
open(os.path.join(REC, "results.md"), "w").write(out + "\n")
