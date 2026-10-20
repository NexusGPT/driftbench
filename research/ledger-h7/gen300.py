"""H7 second sample: 300 new single-section mutants (negate, rephrase) per research/ledger-h7/PREREG.md."""
from __future__ import annotations
import json, sys, threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from mutants import GEN_MODEL, GEN_PRICE, gate, llm, variant_text
from registry import load_src

HERE = Path(__file__).parent
OUT = HERE / "m300"
BASE = 20261020
N_PER = 5
MAX_RETRY = 5

def main():
    import openai
    client = openai.OpenAI(api_key=(Path.home() / ".nexus-secrets" / "openai.key").read_text().strip(), max_retries=5)
    src = load_src()
    old = json.loads((HERE / "mutants" / "manifest.json").read_text()) if (HERE / "mutants" / "manifest.json").exists() else None
    prior = set()
    for p in (HERE / "mutants-bodies.json",):
        if p.exists():
            prior = set(json.loads(p.read_text()))
    jobs = [(s, op, j) for s in src["sections"] for op in ("negate", "rephrase") for j in range(N_PER)]
    taken: dict[tuple, set] = {}
    ulock = threading.Lock()
    lock_usage = {"in": 0, "out": 0, "calls": 0}
    results = {}
    # sequential per (section, op) so the duplicate rule is deterministic; parallel across (section, op)
    groups: dict[tuple, list] = {}
    for s, op, j in jobs:
        groups.setdefault((s["id"], op), []).append((s, op, j))
    def run_group(item):
        (sid, op), lst = item
        seen = set(prior)
        out = []
        for s, op, j in lst:
            body = s["body"].strip()
            tries, new = [], None
            for t in range(MAX_RETRY + 1):
                seed = BASE + 100 * j + t
                cand, u = llm(client, op, s["title"], body, seed)
                with ulock:
                    lock_usage["in"] += u["in"]; lock_usage["out"] += u["out"]; lock_usage["calls"] += 1
                why = gate(op, body, cand)
                if why is None and cand.strip() in seen:
                    why = "duplicate body"
                tries.append({"seed": seed, "gate": why, "usage": u})
                if why is None:
                    new = cand.strip(); seen.add(new); break
            vid = f"{sid}__{op}__n{j}"
            if new is None:
                out.append({"id": vid, "section": sid, "op": op, "j": j, "status": "gate_failed", "tries": tries})
                continue
            (OUT / f"{vid}.md").write_text(variant_text(src, {sid: new}))
            out.append({"id": vid, "section": sid, "op": op, "j": j, "status": "ok", "tries": tries, "body": new})
        return out
    with ThreadPoolExecutor(max_workers=8) as ex:
        allv = [v for grp in ex.map(run_group, sorted(groups.items())) for v in grp]
    usd = (lock_usage["in"] * GEN_PRICE["in"] + lock_usage["out"] * GEN_PRICE["out"]) / 1e6
    (OUT / "manifest.json").write_text(json.dumps({"generator": GEN_MODEL, "base_seed": BASE, "usage": {**lock_usage, "usd": usd}, "variants": [{k: v for k, v in x.items() if k != "body"} for x in allv]}, indent=1))
    print(sum(v["status"] == "ok" for v in allv), "ok of", len(allv), lock_usage, f"${usd:.4f}")

main()
