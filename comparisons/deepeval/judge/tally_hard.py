"""Tally the two-part relevancy sets (relevancy-hard, relevancy-hard2) and the held-out rubric variant.

Usage: python judge/tally_hard.py MODEL
Reads results/MODEL-hard.json, results/MODEL-hard2.json, results/MODEL-hard2vague.json, and the DAG files
results/dag-MODEL-relevancy-hard.json and results/dag-MODEL-relevancy-hard2.json.
Prints accuracy with 95% Wilson intervals and a paired exact McNemar p-value per row.
"""
import json, math, os, sys
from math import comb
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, ".."))
MODEL = sys.argv[1]
def rows_of(tag): return json.load(open(os.path.join(ROOT, "results", f"{MODEL}-{tag}.json")))["rows"]
def labels_of(name): return {r["id"]: r["label"] for r in json.load(open(os.path.join(ROOT, "datasets", name + ".json")))}
def dag_of(name): return {x["id"]: x["dag"] for x in json.load(open(os.path.join(ROOT, "results", f"dag-{MODEL}-{name}.json")))["rows"]}
def wilson(k, n, z=1.96):
    p = k / n; d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d; h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return max(0, c - h), min(1, c + h)
def mcnemar(b, c):
    n = b + c
    if n == 0: return 1.0
    k = min(b, c)
    return min(1.0, sum(comb(n, i) for i in range(0, k + 1)) / 2 ** n * 2)
def compare(name, rows):
    n = len(rows)
    ours = [1 if o == t else 0 for (t, o, th) in rows]
    th = [1 if x == t else 0 for (t, o, x) in rows]
    ko, kt = sum(ours), sum(th)
    b = sum(1 for a, c in zip(ours, th) if a == 1 and c == 0); c = sum(1 for a, cc in zip(ours, th) if a == 0 and cc == 1)
    lo_o, hi_o = wilson(ko, n); lo_t, hi_t = wilson(kt, n)
    return f"| {name} | {n} | {ko}/{n} (CI {round(100*lo_o)}-{round(100*hi_o)}) | {kt}/{n} (CI {round(100*lo_t)}-{round(100*hi_t)}) | {b} | {c} | {round(mcnemar(b, c), 4)} | {sum(1 for (_, o, _) in rows if o is None)}/{sum(1 for (_, _, x) in rows if x is None)} |"
def rel(v): return {"pass": "relevant", "fail": "irrelevant"}.get(v)
print(f"model {MODEL}")
print("| row | n | ours (CI) | theirs (CI) | ours-only right | theirs-only right | exact p | undecided ours/theirs |")
print("|---|---|---|---|---|---|---|---|")
for tag, dname, prefix in [("hard", "relevancy-hard", "hard"), ("hard2", "relevancy-hard2", "held-out"), ("hard2vague", "relevancy-hard2", "held-out, variant rubric")]:
    labs = labels_of(dname)
    R = {r["id"]: r for r in rows_of(tag)}
    ids = [i for i in R]
    if prefix.startswith("held-out, variant"):
        rows_ours = [(labs[i], rel(R[i]["ours"]), None) for i in ids]
    else:
        rows_ours = [(labs[i], rel(R[i]["ours"]), None) for i in ids]
    print(compare(f"{prefix}: ours (judge)", [(labs[i], rel(R[i]["ours"]), rel(R[i]["ours"]) if False else None) for i in ids]) if False else "", end="")
    turn = [(labs[i], rel(R[i]["ours"]), {"yes": "relevant", "no": "irrelevant"}.get(R[i].get("deepeval_turnrel"))) for i in ids]
    geval = [(labs[i], rel(R[i]["ours"]), {"1": "relevant", "0": "irrelevant"}.get(R[i].get("deepeval_geval"))) for i in ids]
    if not prefix.startswith("held-out, variant"):
        dag = dag_of(dname)
        dagrows = [(labs[i], rel(R[i]["ours"]), {"pass": "relevant", "fail": "irrelevant"}.get(dag.get(i))) for i in ids]
        print(compare(f"{prefix}: turn relevancy", turn))
        print(compare(f"{prefix}: G-Eval strict", geval))
        print(compare(f"{prefix}: DAG", dagrows))
    else:
        print(compare(f"{prefix}: vs G-Eval strict", geval))
        dag = dag_of(dname)
        print(compare(f"{prefix}: vs DAG", [(labs[i], rel(R[i]["ours"]), {"pass": "relevant", "fail": "irrelevant"}.get(dag.get(i))) for i in ids]))
