"""Tally a results file: accuracy with 95% Wilson intervals, and a paired exact McNemar test on the disagreeing cases.

Usage: python judge/tally.py MODEL RESULTS_FILE
  e.g. python judge/tally.py haiku results/haiku-100.json
The DAG and tool-call results are read from results/ (dag-MODEL.json, tools-ours.json, tools-deepeval.json).
"""
import json, math, os, sys
from math import comb
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, ".."))
MODEL = sys.argv[1]; RESFILE = sys.argv[2]
res = json.load(open(RESFILE))["rows"]
by = {}
for r in res: by.setdefault(r["set"], {})[r["id"]] = r
labels = {}
for s in ["relevancy", "relevancy-hard", "role", "completeness", "task", "hallucination", "knowledge", "knowledge2"]:
    for row in json.load(open(os.path.join(ROOT, "datasets", s + ".json"))): labels[row["id"]] = row["label"]
dag = {x["id"]: x for x in json.load(open(os.path.join(ROOT, "results", f"dag-{MODEL}.json")))["rows"]}
tools_o = json.load(open(os.path.join(ROOT, "results", "tools-ours.json")))
tools_d = json.load(open(os.path.join(ROOT, "results", "tools-deepeval.json")))
tool_cases = {r["id"]: r for r in json.load(open(os.path.join(ROOT, "datasets", "tools.json")))}
def wilson(k, n, z=1.96):
    if n == 0: return (0, 0)
    p = k / n; d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d; h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0, c - h), min(1, c + h))
def mcnemar(b, c):
    n = b + c
    if n == 0: return 1.0
    k = min(b, c)
    return min(1.0, sum(comb(n, i) for i in range(0, k + 1)) / 2 ** n * 2)
def compare(name, rows):
    n = len(rows)
    ours_ok = [1 if o is not None and o == t else 0 for (t, o, th) in rows]
    th_ok = [1 if th is not None and th == t else 0 for (t, o, th) in rows]
    ko, kt = sum(ours_ok), sum(th_ok)
    b = sum(1 for a, c in zip(ours_ok, th_ok) if a == 1 and c == 0)
    c = sum(1 for a, cc in zip(ours_ok, th_ok) if a == 0 and cc == 1)
    lo_o, hi_o = wilson(ko, n); lo_t, hi_t = wilson(kt, n)
    return {"row": name, "n": n, "ours": ko, "theirs": kt, "ours_ci": [round(100*lo_o), round(100*hi_o)], "theirs_ci": [round(100*lo_t), round(100*hi_t)], "ours_only_right": b, "theirs_only_right": c, "p": round(mcnemar(b, c), 4), "undecided_ours": sum(1 for (_, o, _) in rows if o is None), "undecided_theirs": sum(1 for (_, _, th) in rows if th is None)}
def ours_of(v, pos, neg):
    return {"pass": pos, "fail": neg}.get(v)
rowsets = {}
R = by.get("relevancy", {})
rowsets["turn relevancy"] = [(labels[i], ours_of(R[i]["ours"], "relevant", "irrelevant"), {"yes": "relevant", "no": "irrelevant"}.get(R[i]["deepeval_turnrel"])) for i in R]
rowsets["G-Eval strict"] = [(labels[i], ours_of(R[i]["ours"], "relevant", "irrelevant"), {"1": "relevant", "0": "irrelevant"}.get(R[i]["deepeval_geval"])) for i in R]
rowsets["DAG"] = [(labels[i], ours_of(R[i]["ours"], "relevant", "irrelevant"), {"pass": "relevant", "fail": "irrelevant"}.get(dag[i]["dag"])) for i in R]
for name, set_, pos, neg, theirs_key in [
    ("role adherence", "role", "in", "out", "deepeval_role"),
    ("conversation completeness", "completeness", "complete", "incomplete", "deepeval_cc"),
    ("task completion", "task", "complete", "incomplete", "deepeval_task"),
]:
    D = by.get(set_, {})
    rowsets[name] = [(labels[i], ours_of(D[i]["ours"], pos, neg), D[i].get(theirs_key)) for i in D]
HA = by.get("hallucination", {})
rowsets["hallucination"] = [(labels[i], ours_of(HA[i]["ours"], "grounded", "invented"), HA[i].get("deepeval_hal")) for i in HA]
rowsets["faithfulness"] = [(labels[i], ours_of(HA[i]["ours"], "grounded", "invented"), HA[i].get("deepeval_faith")) for i in HA]
for name, set_ in [("knowledge retention, judged", "knowledge"), ("knowledge retention, judged (hard set)", "knowledge2")]:
    K = by.get(set_, {})
    if K: rowsets[name] = [(labels[i], ours_of(K[i]["ours"], "keep", "forget"), K[i].get("deepeval_kr")) for i in K]
tl = {i: ("pass" if tool_cases[i]["kind"] == "swap" else tool_cases[i]["label"]) for i in tool_cases}
rowsets["tool calls, default (params)"] = [(tl[i], tools_o[i]["default"], tools_d[i]["params"]) for i in tools_d]
rowsets["tool calls, default (no params)"] = [(tl[i], tools_o[i]["default"], tools_d[i]["default"]) for i in tools_d]
rowsets["tool calls, exact order"] = [(tool_cases[i]["label"], ("fail" if (tools_o[i]["exact"] == "fail" or tools_o[i]["default"] == "fail") else "pass"), tools_d[i]["exact_params"]) for i in tools_d]
H = by.get("relevancy-hard", {})
if H:
    dag_h = {x["id"]: x for x in json.load(open(os.path.join(ROOT, "results", f"dag-{MODEL}-relevancy-hard.json")))["rows"]}
    rowsets["hard: turn relevancy"] = [(labels[i], ours_of(H[i]["ours"], "relevant", "irrelevant"), {"yes": "relevant", "no": "irrelevant"}.get(H[i]["deepeval_turnrel"])) for i in H]
    rowsets["hard: G-Eval strict"] = [(labels[i], ours_of(H[i]["ours"], "relevant", "irrelevant"), {"1": "relevant", "0": "irrelevant"}.get(H[i]["deepeval_geval"])) for i in H]
    rowsets["hard: DAG"] = [(labels[i], ours_of(H[i]["ours"], "relevant", "irrelevant"), {"pass": "relevant", "fail": "irrelevant"}.get(dag_h[i]["dag"])) for i in H]
out = [compare(name, rows) for name, rows in rowsets.items()]
print(f"model {MODEL}  source {os.path.relpath(RESFILE, ROOT)}")
print("| row | n | ours | theirs | ours-only right | theirs-only right | exact p | undecided ours/theirs |")
print("|---|---|---|---|---|---|---|---|")
for o in out:
    print(f"| {o['row']} | {o['n']} | {o['ours']}/{o['n']} (CI {o['ours_ci'][0]}-{o['ours_ci'][1]}) | {o['theirs']}/{o['n']} (CI {o['theirs_ci'][0]}-{o['theirs_ci'][1]}) | {o['ours_only_right']} | {o['theirs_only_right']} | {o['p']} | {o['undecided_ours']}/{o['undecided_theirs']} |")
json.dump(out, open(os.path.join(ROOT, "results", f"tally-{MODEL}.json"), "w"), indent=1)
