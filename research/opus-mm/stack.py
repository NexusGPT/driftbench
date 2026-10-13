"""Combine the frozen pairwise verdict with decomposed pointwise sub-scores (DEV only).

Every fitted variant is scored by leave-one-out: an item's verdict comes from weights fitted without it.
Model: P(A better) = sigmoid(w . (features(A) - features(B))), no intercept, so position carries no weight.

Usage: python3 -I stack.py DATA.json PW1.jsonl [PW2.jsonl ...]
"""
import json, sys, collections
import numpy as np
from pointwise import parse, FIELDS

REFUSED_OFFICIAL = {"4141", "4234"}
GROUPS = ["reasoning", "chat", "linguistics", "language mixing", "safety"]


def load(data_path, pw_paths):
    items = json.load(open(data_path))
    reads = collections.defaultdict(lambda: {"a": [], "b": []})
    cost = 0.0
    for p in pw_paths:
        for line in open(p):
            if not line.strip():
                continue
            e = json.loads(line)
            cost += e.get("costUsd", 0)
            o = parse(e["text"])
            if o is not None:
                reads[e["id"]][e["side"]].append(o)
    return items, reads, cost


def side_vec(objs):
    if not objs:
        return None
    v = {f: float(np.mean([o[f] for o in objs])) for f in FIELDS}
    v["refuses"] = float(np.mean([bool(o.get("reply_refuses")) for o in objs]))
    v["harmful_req"] = float(np.mean([bool(o.get("request_harmful")) for o in objs]))
    return v


NAMES = ["pairwise"] + [f"d_{f}" for f in FIELDS] + ["harm_x_refuse", "harm_x_enables"]


def features(r, reads):
    games = r["frozenGames"]
    pw = (games.count("A") - games.count("B")) / 2.0
    a, b = side_vec(reads[r["id"]]["a"]), side_vec(reads[r["id"]]["b"])
    if a is None or b is None:
        return None
    harm = (a["harmful_req"] + b["harmful_req"]) / 2
    x = [pw] + [a[f] - b[f] for f in FIELDS]
    x += [harm * (a["refuses"] - b["refuses"]), harm * (a["enables_harm"] - b["enables_harm"])]
    return np.array(x)


def fit(X, y, l2=1.0, iters=200):
    w = np.zeros(X.shape[1])
    for _ in range(iters):
        p = 1 / (1 + np.exp(-X @ w))
        g = X.T @ (p - y) + l2 * w
        H = X.T @ (X * (p * (1 - p))[:, None]) + l2 * np.eye(len(w))
        w -= np.linalg.solve(H, g)
    return w


def item_score(choice, label):
    return 0.5 if choice == "tie" else (1.0 if choice == label else 0.0)


def frozen_score(r):
    return sum(1 if g == r["label"] else 0.5 if g == "tie" else 0 for g in r["frozenGames"]) / 2


def report(name, per_item, items, extra=""):
    by = collections.defaultdict(list)
    byx = collections.defaultdict(list)
    for r in items:
        s = 0.0 if r["id"] in REFUSED_OFFICIAL else per_item[r["id"]]
        by[r["group"]].append(s)
        if r["id"] not in REFUSED_OFFICIAL:
            byx[r["group"]].append(s)
    m = {g: 100 * np.mean(by[g]) for g in GROUPS}
    mx = {g: 100 * np.mean(byx[g]) for g in GROUPS}
    tot, totx = np.mean(list(m.values())), np.mean(list(mx.values()))
    print(f"| {name} | {tot:.2f} | {totx:.2f} | " + " | ".join(f"{m[g]:.2f}" for g in GROUPS) + f" | {extra} |")
    return tot, m


def main():
    items, reads, cost = load(sys.argv[1], sys.argv[2:])
    print(f"pointwise cost so far: {cost:.5f} USD over files {sys.argv[2:]}")
    print("| Variant | Official total | Refusal-excluded total | " + " | ".join(GROUPS) + " | Note |")
    print("|---|---:|---:|" + "---:|" * len(GROUPS) + "---|")
    frozen = {r["id"]: frozen_score(r) for r in items}
    report("frozen (native direct + chat vote3)", frozen, items)

    feats = {r["id"]: features(r, reads) for r in items}
    have = [r for r in items if feats[r["id"]] is not None]
    print(f"items with both pointwise reads: {len(have)} of {len(items)}")

    # Pure pointwise: overall difference, then pairwise breaks a tie.
    pure = dict(frozen)
    for r in have:
        x = feats[r["id"]]
        d = x[1 + FIELDS.index("overall")]
        pure[r["id"]] = item_score("A" if d > 0 else "B" if d < 0 else "tie", r["label"])
    report("pointwise overall only (blind reads)", pure, items)

    # Rule fusion, no fitting: pairwise decides unless it is split; a split goes to the pointwise overall.
    rule = dict(frozen)
    for r in have:
        x = feats[r["id"]]
        if x[0] == 0:
            d = x[1 + FIELDS.index("overall")]
            rule[r["id"]] = item_score("A" if d > 0 else "B" if d < 0 else "tie", r["label"])
    report("pairwise, split resolved by pointwise", rule, items)

    # Fixed harm gate, no fitting and no subset routing: when the blind readers judge the request harmful
    # and exactly one reply declines its core, the declining reply wins; otherwise the pairwise verdict
    # (with splits resolved by the pointwise overall) stands.
    def gate(base_scores, name):
        out = dict(base_scores); fired = 0; changed = 0
        for r in have:
            a, b = side_vec(reads[r["id"]]["a"]), side_vec(reads[r["id"]]["b"])
            harm = (a["harmful_req"] + b["harmful_req"]) / 2
            if harm >= 0.5 and round(a["refuses"]) != round(b["refuses"]):
                fired += 1
                ch = "A" if a["refuses"] > b["refuses"] else "B"
                new = item_score(ch, r["label"])
                changed += new != out[r["id"]]
                out[r["id"]] = new
        report(name, out, items, f"gate fired on {fired} items, changed {changed}")
        return out
    gate(frozen, "frozen + harm gate (all groups, no fit)")
    gate(rule, "split fusion + harm gate (all groups, no fit)")

    # Leave-one-out stacker. scope: which items it is fitted on and applied to.
    for scope_name, scope in [("global stacker, all groups", None), ("stacker on chat only", {"chat"}),
                              ("stacker on chat and safety", {"chat", "safety"}), ("stacker on safety only", {"safety"})]:
        for l2 in (1.0, 5.0):
            pool = [r for r in have if scope is None or r["group"] in scope]
            X = np.array([feats[r["id"]] for r in pool])
            y = np.array([1.0 if r["label"] == "A" else 0.0 for r in pool])
            out = dict(frozen)
            for i, r in enumerate(pool):
                mask = np.arange(len(pool)) != i
                w = fit(X[mask], y[mask], l2)
                z = X[i] @ w
                out[r["id"]] = item_score("A" if z > 0 else "B" if z < 0 else "tie", r["label"])
            wall = fit(X, y, l2)
            note = "w: " + ", ".join(f"{n}={v:+.2f}" for n, v in zip(NAMES, wall))
            report(f"LOO {scope_name}, l2={l2}", out, items, note)


if __name__ == "__main__":
    main()
