"""Scores the block-native dev runs beside tonight's best frozen designs. Reads result files only; calls no model."""
import json
import sys
from collections import Counter

VERIFY_DIR = sys.argv[1]  # codex-verify results/verify-dev
WP_HOLISTIC = sys.argv[2]
OURS = sys.argv[3]  # this worktree's results folder


def verify():
    try:
        mine = json.load(open(f"{OURS}/blocks-verify-dev.json"))
    except FileNotFoundError:
        return
    audit = {x["id"]: x["audited"] for x in json.load(open(f"{VERIFY_DIR}/label-audit.json"))}
    rows = {r["id"]: r for r in mine["results"]}
    blocks_cost = sum(r.get("costUsd", 0) for r in rows.values())
    n = len(rows)
    print(f"verify: {n} items, block calls cost {blocks_cost:.4f} USD, per 100 {100*blocks_cost/n:.4f}")
    print("decided by:", Counter(r["decidedBy"].split(":")[0] + (":" + r["decidedBy"].split(":")[-1] if r["decidedBy"].startswith("judge") else "") for r in rows.values()))
    for name in ["driftbench-verify-uncertainty-cascade", "driftbench-verify-program-backward-step-context"]:
        best = json.load(open(f"{VERIFY_DIR}/{name}.json"))["contestants"][0]
        bdec = {d["id"]: d["pass"] for d in best["decisions"]}
        bcost = best["costUsd"] if isinstance(best.get("costUsd"), (int, float)) else None
        variants = {
            name: lambda i: bdec[i],
            "blocks alone": lambda i: rows[i]["pass"],
            f"{name[18:]} + any block fail vetoes": lambda i: bdec[i] and rows[i]["pass"] is not False,
            f"{name[18:]} + machine fail vetoes": lambda i: bdec[i] and not rows[i].get("machineFail", False),
            f"{name[18:]} + conclusion-block fail vetoes": lambda i: bdec[i] and not rows[i]["decidedBy"].endswith("conclusion"),
        }
        for vname, f in variants.items():
            off = aud = 0
            for i in rows:
                p = f(i)
                off += p == rows[i]["label"]
                aud += p == audit.get(i, rows[i]["label"])
            print(f"  {vname:70s} official {100*off/n:5.1f}  audited {100*aud/n:5.1f}")
        print(f"  ({name} recorded cost field: {bcost})")


def wp():
    try:
        mine = json.load(open(f"{OURS}/blocks-wp-dev.json"))
    except FileNotFoundError:
        return
    rows = [r for r in mine["results"] if len(r.get("games", [])) == 2]
    hol = {r["rowKey"]: r for r in json.load(open(WP_HOLISTIC))["results"]}
    cost = sum(r["costUsd"] for r in rows)
    n = len(rows)
    print(f"wp: {n} pairs complete, block calls cost {cost:.4f} USD, per 100 {100*cost/n:.4f}")

    def acc(key, sub=None):
        c = t = 0
        for r in rows:
            if sub and r["group"] != sub:
                continue
            games = r[key] if key != "holistic" else hol[r["rowKey"]]["games"]
            c += sum(g == r["label"] for g in games)
            t += 2
        return f"{100*c/t:5.2f} ({c}/{t})" if t else "n/a"

    for key, label in [("holistic", "frozen holistic"), ("games", "blocks + holistic tie fallback"), ("machineOnly", "holistic + machine checks first")]:
        print(f"  {label:40s} all {acc(key)}  en {acc(key,'en')}  zh {acc(key,'zh')}")
    print("  machine-decisive blocks:", sum(r["machineDecisive"] for r in rows), "pairs touched:", sum(1 for r in rows if r["machineDecisive"]))
    try:
        meta = json.load(open(f"{OURS}/blocks-wp-metamorphic-dev.json"))
    except FileNotFoundError:
        return
    m = [r for r in meta["results"] if "guarded" in r]
    mc = sum(r["costUsd"] for r in m)
    flips = sum(f == "flip" for r in m for f in r["flipped"])
    c0 = sum(g == r["label"] for r in m for g in r["games"])
    c1 = sum(g == r["label"] for r in m for g in r["guarded"])
    ch = sum(g == r["label"] for r in m for g in hol[r["rowKey"]]["games"])
    print(f"metamorphic: {len(m)} pairs, flips {flips}/{2*len(m)}, blocks {c0}, guarded {c1}, holistic {ch} of {2*len(m)}; extra cost per 100 {100*mc/max(1,len(m)):.4f}")


verify()
wp()


import math

SOLVER = "/private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad/opus/verify-boardgame-result.json"


def wilson(k, n, z=1.96):
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return f"[{100*(c-h):.1f}, {100*(c+h):.1f}]"


def recovery():
    try:
        rec = {r["id"]: r for r in json.load(open(f"{OURS}/blocks-verify-recovery-dev.json"))["results"]}
    except FileNotFoundError:
        return
    audit = {x["id"]: x["audited"] for x in json.load(open(f"{VERIFY_DIR}/label-audit.json"))}
    best = json.load(open(f"{VERIFY_DIR}/driftbench-verify-uncertainty-cascade.json"))["contestants"][0]
    bdec = {d["id"]: d["pass"] for d in best["decisions"]}
    solver = {}
    for r in json.load(open(SOLVER))["rows"]:
        if r["solver"][0] == r["solver"][1] and r["solver"][0] != "unknown":
            solver[r["id"]] = r["solver"][0] == r["response"]
    sol = lambda i: next((v for k, v in solver.items() if i.startswith(k)), None)
    n = len(rec)
    rc = sum(r.get("recoveryCostUsd", 0) for r in rec.values())
    bc = sum(r.get("costUsd", 0) for r in rec.values())
    print(f"recovery: {n} items, recovery calls {sum(1 for r in rec.values() if r.get('recoveryCostUsd'))}, cost {rc:.4f}; blocks+recovery per 100 {100*bc/n:.4f}")
    variants = {
        "cascade (frozen best)": lambda i: bdec[i],
        "blocks + recovery alone": lambda i: rec[i]["pass"],
        "cascade + M4 solver": lambda i: sol(i) if sol(i) is not None else bdec[i],
        "cascade + recovered block fail vetoes": lambda i: bdec[i] and rec[i]["pass"] is not False,
        "cascade + M4 + recovered block fail vetoes": lambda i: (sol(i) if sol(i) is not None else (bdec[i] and rec[i]["pass"] is not False)),
    }
    base_ok = {i: bdec[i] == audit.get(i, rec[i]["label"]) for i in rec}
    for vname, f in variants.items():
        off = aud = 0
        gain = loss = 0
        newfn = 0
        for i in rec:
            p = f(i)
            t = audit.get(i, rec[i]["label"])
            off += p == rec[i]["label"]
            ok = p == t
            aud += ok
            gain += ok and not base_ok[i]
            loss += (not ok) and base_ok[i]
            newfn += (not ok) and base_ok[i] and t is True
        print(f"  {vname:45s} official {100*off/n:5.1f} {wilson(off,n)}  audited {100*aud/n:5.1f} {wilson(aud,n)}  vs cascade +{gain}/-{loss} (new false negatives {newfn})")


recovery()
