"""H7 second sample runs and analysis (research/ledger-h7/PREREG.md).

python run300.py tiny            one mutant, 3 suite runs: time and price
python run300.py stage1          every ok variant of m300/manifest.json, full suite x 3 (resumable)
python run300.py confirm         confirmation runs for the candidates
python run300.py export <out>    the per-mutant confirmed flips (E) as JSON
"""
from __future__ import annotations
import json, sys, time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from acme_live.runner import check_block, load_suite, run_variant

HERE = Path(__file__).parent
RUNS = HERE / "data" / "runs300"
STOP_USD = 22.0
SUITE = load_suite()
BLOCKS = {b["id"]: b for c in SUITE["conversations"] for b in c["blocks"]}
ORDER = [b["id"] for c in SUITE["conversations"] for b in c["blocks"]]
FLAKY = {"af1", "d1"}

def manifest(): return json.loads((HERE / "m300" / "manifest.json").read_text())

def spent():
    t = manifest().get("usage", {}).get("usd", 0.0)
    for p in RUNS.glob("*.jsonl"):
        for line in p.open():
            t += json.loads(line).get("usd", 0.0)
    return t

def done_jobs(variant, tag):
    c = Counter(); p = RUNS / f"{variant}.jsonl"
    if p.exists():
        for line in p.open():
            r = json.loads(line)
            if "error" not in r and r.get("tag") == tag: c[(r["rep"], r["conv"])] += 1
    return c

def v0():
    """Baseline verdicts: majority over the registered baseline runs (research/block-links, data/runs/baseline.jsonl)."""
    runs = defaultdict(dict)
    for line in (HERE / "data" / "runs" / "baseline.jsonl").open():
        r = json.loads(line)
        if "error" in r or r.get("tag") != "baseline": continue
        for blk in r["blocks"]:
            runs[r["rep"]].setdefault(blk["block"], bool(check_block(BLOCKS[blk["block"]]["checks"], blk["calls"], blk["text"])))
    out = {}
    for b in ORDER:
        xs = [run[b] for run in runs.values() if b in run]
        fails = sum(xs)
        out[b] = None if (not xs or fails * 2 == len(xs)) else fails * 2 > len(xs)
    return out

def load(variant, tag):
    out = defaultdict(dict); p = RUNS / f"{variant}.jsonl"
    if not p.exists(): return out
    for line in p.open():
        r = json.loads(line)
        if "error" in r or r.get("tag") != tag: continue
        for blk in r["blocks"]:
            out[r["rep"]][blk["block"]] = bool(check_block(BLOCKS[blk["block"]]["checks"], blk["calls"], blk["text"]))
    return out

def flips(runs, b, v):
    xs = [run[b] for run in runs.values() if b in run]
    return sum(x != v for x in xs), len(xs)

def stage1_one(v, convs, workers=16):
    if spent() >= STOP_USD: return f"{v['id']} skipped: budget"
    have = done_jobs(v["id"], "stage1")
    text = (HERE / "m300" / f"{v['id']}.md").read_text()
    for rep in range(3):
        missing = [c for c in convs if (rep, c) not in have]
        if missing: run_variant(v["id"], text, 1, missing, workers, out_dir=RUNS, rep_offset=rep, tag="stage1")
    return f"{v['id']} cum ${spent():.3f}"

def ok_variants(): return [v for v in manifest()["variants"] if v["status"] == "ok"]

def candidates():
    base = v0(); out = []
    for v in ok_variants():
        runs = load(v["id"], "stage1")
        for b in ORDER:
            if base[b] is None or b in FLAKY: continue
            f, n = flips(runs, b, base[b])
            if f >= 2: out.append((v["id"], b, next(c["id"] for c in SUITE["conversations"] if any(x["id"] == b for x in c["blocks"]))))
    return out

def main():
    cmd = sys.argv[1]
    convs = [c["id"] for c in SUITE["conversations"]]
    if cmd == "tiny":
        t0 = time.time(); v = ok_variants()[0]; print(stage1_one(v, convs), f"{time.time()-t0:.0f}s")
    elif cmd == "stage1":
        todo = ok_variants()
        with ThreadPoolExecutor(max_workers=int(sys.argv[2]) if len(sys.argv) > 2 else 4) as ex:
            for msg in ex.map(lambda v: stage1_one(v, convs, 12), todo): print(msg, flush=True)
    elif cmd == "confirm":
        pairs = sorted({(m, conv) for m, _b, conv in candidates()})
        print(len(pairs), "confirmation jobs")
        def one(mc):
            m, conv = mc
            if spent() >= STOP_USD: return
            have = done_jobs(m, "confirm"); text = (HERE / "m300" / f"{m}.md").read_text()
            for rep in range(100, 103):
                if (rep, conv) not in have: run_variant(m, text, 1, [conv], 1, out_dir=RUNS, rep_offset=rep, tag="confirm")
        with ThreadPoolExecutor(max_workers=8) as ex: list(ex.map(one, pairs))
        print(f"cum ${spent():.3f}")
    elif cmd == "export":
        base = v0(); rows = []
        for v in ok_variants():
            s1 = load(v["id"], "stage1"); cf = load(v["id"], "confirm"); E = []
            for b in ORDER:
                if base[b] is None or b in FLAKY: continue
                f, n = flips(s1, b, base[b])
                if f >= 2:
                    c, cn = flips(cf, b, base[b])
                    if cn and c >= 2: E.append(b)
            rows.append({"variant": v["id"], "sections": [v["section"]], "reps": len(s1), "E": E})
        Path(sys.argv[2]).write_text(json.dumps({"v0_fail": sorted(b for b in base if base[b]), "unstable": sorted(b for b in base if base[b] is None), "mutants": rows}, indent=1))
        print(len(rows), "mutants,", sum(bool(r["E"]) for r in rows), "with E,", f"spend ${spent():.3f}")

main()
