"""Paired comparison of the frozen design and the frozen fusion (frozen-fusion.json) on a fresh cohort.

Usage: python3 replicate.py SAMPLE.json FROZEN_DECISIONS.jsonl POINTWISE.jsonl
Only items with a frozen decision and both pointwise reads enter the cohort (both arms, same items).
Provider-refused items count wrong in the official view and are dropped in the excluded view.
"""
import json, sys, collections, math
import numpy as np
from pointwise import parse, FIELDS

GROUPS = ["reasoning", "chat", "linguistics", "language mixing", "safety"]


def sc(choice, label):
    return 0.5 if choice == "tie" else (1.0 if choice == label else 0.0)


def main():
    sample = {r["id"]: r for r in json.load(open(sys.argv[1]))}
    frozen = {}
    for l in open(sys.argv[2]):
        if l.strip():
            e = json.loads(l); frozen[e["id"]] = e
    reads = collections.defaultdict(lambda: {"a": [], "b": []})
    pw_refused = set(); cost = 0.0
    for l in open(sys.argv[3]):
        if not l.strip():
            continue
        e = json.loads(l); cost += e.get("costUsd", 0)
        if e["text"] == "__REFUSED__":
            pw_refused.add(e["id"])
        o = parse(e["text"])
        if o is not None:
            reads[e["id"]][e["side"]].append(o)
    rows = []
    for rid, f in frozen.items():
        r = sample[rid]; ra, rb = reads[rid]["a"], reads[rid]["b"]
        refused = f["providerRefused"]
        if not refused and not (ra and rb) and rid not in pw_refused:
            continue  # pointwise not done yet: outside the cohort
        g = f["games"]
        base = sum(sc(x, r["label"]) for x in g) / 2
        new = base
        if ra and rb and not refused:
            a, b = ra[0], rb[0]
            if g.count("A") == g.count("B"):
                d = a["overall"] - b["overall"]
                new = sc("A" if d > 0 else "B" if d < 0 else "tie", r["label"])
            harm = (bool(a.get("request_harmful")) + bool(b.get("request_harmful"))) / 2
            if harm >= 0.5 and bool(a.get("reply_refuses")) != bool(b.get("reply_refuses")):
                new = sc("A" if a.get("reply_refuses") else "B", r["label"])
        if refused:
            base = new = 0.0
        rows.append({"id": rid, "group": r["group"], "base": base, "new": new, "refused": refused})
    n = collections.Counter(x["group"] for x in rows)
    print(f"cohort {len(rows)} items; per class {dict(n)}; pointwise spend {cost:.5f} USD")

    def macro(rs, key):
        by = collections.defaultdict(list)
        for x in rs:
            by[x["group"]].append(x[key])
        return {g: 100 * np.mean(by[g]) for g in GROUPS if by[g]}

    for view, rs in [("official", rows), ("refusal-excluded", [x for x in rows if not x["refused"]])]:
        mb, mn = macro(rs, "base"), macro(rs, "new")
        tb, tn = np.mean(list(mb.values())), np.mean(list(mn.values()))
        print(f"\n{view}: frozen {tb:.2f}, fusion {tn:.2f}, difference {tn - tb:+.2f}")
        print("| Class | n | Frozen % | Fusion % |")
        print("|---|---:|---:|---:|")
        for g in GROUPS:
            if g in mb:
                print(f"| {g} | {sum(1 for x in rs if x['group'] == g)} | {mb[g]:.2f} | {mn[g]:.2f} |")
        rng = np.random.default_rng(20261013)
        by = {g: np.array([(x["base"], x["new"]) for x in rs if x["group"] == g]) for g in GROUPS}
        by = {g: v for g, v in by.items() if len(v)}
        ds = []
        for _ in range(20000):
            t = []
            for g, arr in by.items():
                s = arr[rng.integers(0, len(arr), len(arr))]
                t.append(100 * (s[:, 1].mean() - s[:, 0].mean()))
            ds.append(np.mean(t))
        lo, hi = np.percentile(ds, [2.5, 97.5])
        wins = sum(1 for x in rs if x["new"] > x["base"]); losses = sum(1 for x in rs if x["new"] < x["base"])
        m = wins + losses; k = min(wins, losses)
        p = min(1.0, 2 * sum(math.comb(m, i) for i in range(k + 1)) / 2 ** m) if m else 1.0
        print(f"paired 95% interval (bootstrap within class, macro mean): {lo:+.2f} to {hi:+.2f}")
        print(f"item wins / losses / unchanged: {wins} / {losses} / {len(rs) - m}; exact two-sided sign test p = {p:.4g}")


if __name__ == "__main__":
    main()
