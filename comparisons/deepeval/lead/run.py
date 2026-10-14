"""Two DeepEval rows, driftbench against the pinned DeepEval metrics, same Haiku path for both.

Rows: G-Eval strict (relevancy set) and knowledge retention (knowledge set).
The DeepEval side is the unchanged `metrics` function of ../hard/run.py.
The driftbench side renders and parses with the package code through bridge.mts.

Corpora:
  dev    the hard v3 set and the old held-out set; both are seen, so they are for design only
  fresh  sets-fresh.json, frozen by freeze.py before its first call; measured once

Defaults to free replay. Fresh calls require --record and --cap-usd.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import hashlib
import importlib.metadata
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading

ROOT = Path(__file__).resolve().parent
HARD = ROOT.parent / "hard"
REPO = ROOT.parents[2]
sys.path.insert(0, str(HARD))
_spec = importlib.util.spec_from_file_location("hard_run", HARD / "run.py")
hard_run = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(hard_run)  # the pinned DeepEval side, unchanged
call_key, metrics, paired_p, wilson = hard_run.call_key, hard_run.metrics, hard_run.paired_p, hard_run.wilson
from recordings import append, records, sanitize  # noqa: E402

CALLS = ROOT / "calls.jsonl"
TOTAL_CAP = 20.0
RESERVE = 0.05
ROWS = {"relevancy": "G-Eval strict", "knowledge": "knowledge retention"}
SETTINGS = {"relevancy": "response-relevance", "knowledge": "default"}


class StopRun(Exception):
    pass


def bridge(payload):
    proc = subprocess.run(["pnpm", "exec", "tsx", str(ROOT / "bridge.mts")], input=json.dumps(payload),
                          text=True, capture_output=True, cwd=REPO)
    if proc.returncode:
        raise RuntimeError(f"bridge failed: {proc.stderr[-2000:]}")
    return json.loads(proc.stdout)


def prior_cache():
    """Earlier recordings of byte-identical requests, read only: replay, never re-billed."""
    cache = {}
    for r in records(HARD / "calls.jsonl"):
        if not r.get("error"):
            cache[r["request_sha256"]] = r["result"]
    geval = REPO / "comparisons" / "geval-strict" / "calls.jsonl"
    if geval.exists():
        for line in geval.read_text().splitlines():
            c = json.loads(line)
            if not c.get("error") and not c.get("reservation"):
                cache[call_key("haiku", c["system"], c["user"])] = c["result"]
    return cache


class Recorder:
    """Thread-safe recorder with the hard folder's CLI flags, reservation rule and redaction."""

    def __init__(self, record, cap, prior=None):
        self.record, self.cap = record, cap
        self.lock = threading.Lock()
        self.local = threading.local()
        self.fresh, self.replays, self.inflight = [], 0, 0.0
        self.cache, self.records = {}, {}
        self.prior = prior or {}
        self.prior_hits = set()
        self.prior_spend = 0.0
        self.cwd = Path(tempfile.mkdtemp(prefix="deepeval-lead-"))
        if CALLS.exists():
            for r in records(CALLS):
                self.prior_spend += r["charged_usd"]
                self.records[r["request_sha256"]] = r
                if not r.get("error"):
                    self.cache[r["request_sha256"]] = r["result"]

    @property
    def spent(self):
        return sum(r["charged_usd"] for r in self.fresh)

    def keys(self):
        if not hasattr(self.local, "keys"):
            self.local.keys = []
        return self.local.keys

    def call(self, system, user):
        key = call_key("haiku", system, user)
        self.keys().append(key)
        with self.lock:
            if key in self.cache:
                self.replays += 1
                return self.cache[key]
            if key in self.prior:
                self.replays += 1
                self.prior_hits.add(key)
                return self.prior[key]
            if not self.record:
                raise StopRun(f"Replay miss: {key}")
            if (self.spent + self.inflight + RESERVE > self.cap
                    or self.prior_spend + self.spent + self.inflight + RESERVE > TOTAL_CAP):
                raise StopRun("Spend cap reached")
            self.inflight += RESERVE
        args = ["claude", "-p", "--output-format", "json", "--model", "haiku", "--system-prompt", system,
                "--tools", "", "--setting-sources", "", "--strict-mcp-config", "--no-session-persistence",
                "--max-turns", "1", "--max-budget-usd", str(RESERVE)]
        row = {"request_sha256": key, "system": system, "user": user, "requested_model": "haiku",
               "timestamp": datetime.now().astimezone().isoformat(), **getattr(self.local, "context", {})}
        try:
            proc = subprocess.run(args, input=user, text=True, capture_output=True, cwd=self.cwd, timeout=180)
            env = json.loads(proc.stdout)
            row.update(result=str(env.get("result", "")), envelope=env, charged_usd=float(env["total_cost_usd"]))
            if proc.returncode or env.get("is_error"):
                row["error"] = f"Claude invocation failed: {env.get('subtype', proc.returncode)}"
        except Exception as exc:
            row.update(error=str(exc), result="", charged_usd=RESERVE, cost_is_reservation=True)
        row = sanitize(row)
        with self.lock:
            self.inflight -= RESERVE
            append(CALLS, row)
            self.fresh.append(row)
            self.records[key] = row
            if not row.get("error"):
                self.cache[key] = row["result"]
        if row.get("error"):
            raise ValueError(row["error"])
        return row["result"]


def load(corpus, sets):
    if corpus == "dev":
        out = []
        for tag, name in [("v3", "sets.json"), ("heldout", "sets-heldout.json")]:
            data = json.loads((HARD / name).read_text())
            out += [dict(c, id=f"{tag}/{c['id']}", set=s) for s in sets for c in data[s]]
        return out, None
    path = ROOT / "sets-fresh.json"
    data = json.loads(path.read_text())
    return [dict(c, set=s) for s in sets for c in data[s]], path


def render(cases, settings):
    """Driftbench requests per case, keyed by id, from the package renderer."""
    out = {}
    for s in sorted({c["set"] for c in cases}):
        rows = [c for c in cases if c["set"] == s]
        rendered = bridge({"action": "render", "set": s, "setting": settings[s],
                           "cases": [{"id": c["id"], "turns": c["turns"]} for c in rows]})
        out.update({r["id"]: r for r in rendered})
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--corpus", choices=["dev", "fresh"], default="dev")
    ap.add_argument("--sets", default="relevancy,knowledge")
    ap.add_argument("--side", choices=["ours", "theirs", "both"], default="both")
    ap.add_argument("--setting", action="append", default=[], help="set=setting, e.g. knowledge=default")
    ap.add_argument("--tag", required=True)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--record", action="store_true")
    ap.add_argument("--cap-usd", type=float, default=0)
    ap.add_argument("--limit", type=int)
    args = ap.parse_args()
    if importlib.metadata.version("deepeval") != "4.2.8":
        raise RuntimeError("Requires deepeval==4.2.8")
    sets = args.sets.split(",")
    settings = dict(SETTINGS)
    settings.update(dict(s.split("=", 1) for s in args.setting))
    cases, corpus_path = load(args.corpus, sets)
    if args.limit:
        cases = [c for s in sets for c in [x for x in cases if x["set"] == s][:args.limit]]
    prompts = render(cases, settings)
    if args.corpus == "fresh":
        from freeze_fresh import verify
        verify(prompts, settings)
    # A fresh corpus must not meet any earlier recording; the dev corpus may replay them free.
    prior = {} if args.corpus == "fresh" else prior_cache()
    if args.corpus == "fresh":
        old = prior_cache()
        seen = [p["id"] for p in prompts.values() if call_key("haiku", p["system"], p["user"]) in old]
        if seen:
            raise ValueError(f"Fresh driftbench request already recorded: {seen[:3]}")
    rec = Recorder(args.record, args.cap_usd, prior)
    competitor = metrics(rec)
    target = ROOT / f"{args.tag}.json"
    lock = threading.Lock()
    output = {"tag": args.tag, "corpus": args.corpus, "side": args.side, "settings": settings,
              "model": "haiku", "package": "deepeval==4.2.8",
              "corpus_sha256": hashlib.sha256(corpus_path.read_bytes()).hexdigest() if corpus_path else None,
              "rows": []}

    def save():
        output.update(fresh_calls=len(rec.fresh), fresh_usd=rec.spent, replays=rec.replays,
                      prior_replays=len(rec.prior_hits))
        tmp = target.with_suffix(".tmp")
        tmp.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
        tmp.replace(target)

    def one(case):
        result = {"row": ROWS[case["set"]], "set": case["set"], "id": case["id"], "truth": case["truth"]}
        rec.local.context = {"run": args.tag, "set": case["set"], "case": case["id"]}
        if args.side in ("ours", "both"):
            p = prompts[case["id"]]
            rec.local.context["side"] = "driftbench"
            rec.local.keys = []
            try:
                result["ours"] = {"raw": rec.call(p["system"], p["user"])}
            except ValueError as exc:
                result["ours"] = {"raw": None, "error": str(exc)}
            result["ours"]["request_sha256"] = rec.local.keys[0]
        if args.side in ("theirs", "both"):
            rec.local.context["side"] = ROWS[case["set"]]
            rec.local.keys = []
            try:
                result["theirs"] = competitor(ROWS[case["set"]], case)
            except ValueError as exc:
                result["theirs"] = {"prediction": None, "error": str(exc)}
            result["theirs"]["request_sha256s"] = list(rec.local.keys)
        with lock:
            output["rows"].append(result)
            save()
            print(f"{args.tag}: {len(output['rows'])}/{len(cases)}; fresh ${rec.spent:.4f}", flush=True)

    try:
        with ThreadPoolExecutor(args.workers) as pool:
            for future in [pool.submit(one, c) for c in cases]:
                future.result()
    except StopRun as exc:
        output["stopped"] = str(exc)
        print(str(exc), flush=True)
    # Parse every driftbench answer with the package parser, after the calls.
    mine = [r for r in output["rows"] if "ours" in r]
    if mine:
        parsed = bridge({"action": "parse", "rows": [
            {"request": prompts[r["id"]]["request"], "raw": r["ours"]["raw"] or ""} for r in mine]})
        for r, res in zip(mine, parsed):
            bad = r["ours"].get("error") or res.get("unparsed") or res["answer"]["outcome"] == "inconclusive"
            r["ours"]["prediction"] = None if bad else res["answer"]["outcome"] == "pass"
            r["ours"]["result"] = res
    output["rows"].sort(key=lambda r: (r["set"], r["id"]))
    output["summary"] = summary(output["rows"])
    save()
    print(json.dumps(output["summary"], indent=1))
    if output.get("stopped"):
        raise SystemExit(2)


def summary(rows):
    out = []
    for name in sorted({r["row"] for r in rows}):
        rs = [r for r in rows if r["row"] == name]
        entry = {"row": name, "n": len(rs)}
        right = {}
        for side in ("ours", "theirs"):
            if all(side in r for r in rs):
                right[side] = [r[side].get("prediction") == r["truth"] for r in rs]
                entry[side] = sum(right[side])
                entry[f"{side}_ci"] = wilson(entry[side], len(rs))
                entry[f"{side}_unparsed"] = sum(r[side].get("prediction") is None for r in rs)
                entry[f"{side}_wrong"] = [r["id"] for r, ok in zip(rs, right[side]) if not ok]
        if len(right) == 2:
            b = sum(o and not t for o, t in zip(right["ours"], right["theirs"]))
            c = sum(t and not o for o, t in zip(right["ours"], right["theirs"]))
            entry.update(ours_only_right=b, theirs_only_right=c, paired_p=paired_p(b, c))
        out.append(entry)
    return out


if __name__ == "__main__":
    os.environ.setdefault("DEEPEVAL_TELEMETRY_OPT_OUT", "YES")
    main()
