"""One prospectively powered retention confirmation; original frozen code stays unchanged.

prepare -> commit power-freeze.json and its inputs -> run -> replay.
No prompt tuning, failed-call retries, pilot pooling, or early significance stopping.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import threading

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
sys.path.insert(0, str(ROOT))
import run as lead
from freeze_fresh import package_hashes, prompts_sha

OUT = ROOT / "power"
MANIFEST = OUT / "power-freeze.json"
SEED = 20261214
PAIRS = 53
CAP = 10.0


def digest(data):
    return hashlib.sha256(data).hexdigest()


def dump(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def git(*args):
    return subprocess.check_output(["git", *args], cwd=REPO)


def exact_power(n, q=3 / 480):
    return 1 - sum(math.comb(n, k) * q**k * (1-q)**(n-k) for k in range(6))


def calculation():
    n = next(n for n in range(6, 10000) if exact_power(n) >= .8)
    return {"pilot_n": 480, "pilot_discordance": [3, 0], "alpha": .05,
            "test": "two-sided exact McNemar", "target_power": .8,
            "minimum_n": n, "previous_n_power": exact_power(n-1),
            "minimum_n_power": exact_power(n), "balanced_n": 24 * PAIRS,
            "balanced_power": exact_power(24 * PAIRS),
            "estimated_usd": round(24 * PAIRS / 480 * 1.4, 2),
            "assumption": "iid pairs; plug-in favorable discordance 3/480; reverse discordance zero"}


def input_hash(case):
    return digest(json.dumps(case["turns"], ensure_ascii=False, sort_keys=True).encode())


def baseline():
    original = ROOT / "fresh-freeze.json"
    if original.read_bytes() != git("show", "d44740112:comparisons/deepeval/lead/fresh-freeze.json"):
        raise ValueError("Original freeze changed")
    frozen = json.loads(original.read_text())
    for name, expected in frozen["state"]["sources"].items():
        if digest((REPO / name).read_bytes()) != expected:
            raise ValueError(f"Frozen source changed: {name}")
    if package_hashes() != frozen["state"]["package"]:
        raise ValueError("Frozen judge package changed")
    if importlib.metadata.version("deepeval") != frozen["state"]["deepeval"]:
        raise ValueError("DeepEval version changed")
    return frozen


def prepare():
    if MANIFEST.exists():
        raise ValueError("Already frozen")
    original = baseline()
    from generate import build
    cases = [dict(c, set="knowledge") for c in build(SEED, PAIRS)["knowledge"]]
    hashes = {input_hash(c) for c in cases}
    if len(hashes) != len(cases):
        raise ValueError("Duplicate input within fresh set")
    objects = git("rev-list", "--all", "--objects", "--", "comparisons/deepeval",
                  "comparisons/geval-strict", "comparisons/knowledge-retention").decode().splitlines()
    prior_inputs, prior_requests, corpus_blobs, call_blobs = set(), set(), [], []
    for line in objects:
        if " " not in line:
            continue
        oid, name = line.split(" ", 1)
        if Path(name).name.startswith("sets") and name.endswith(".json"):
            data = json.loads(git("cat-file", "blob", oid))
            corpus_blobs.append({"blob": oid, "path": name})
            for rows in data.values():
                if isinstance(rows, list):
                    prior_inputs.update(input_hash(c) for c in rows if isinstance(c, dict) and "turns" in c)
        if name.endswith(".jsonl") and "calls" in Path(name).name:
            call_blobs.append({"blob": oid, "path": name})
            for raw in git("cat-file", "blob", oid).splitlines():
                if not raw.strip():
                    continue
                r = json.loads(raw)
                if "request_sha256" in r:
                    prior_requests.add(r["request_sha256"])
                if "system" in r and "user" in r:
                    prior_requests.add(lead.call_key("haiku", r["system"], r["user"]))
    if hashes & prior_inputs:
        raise ValueError("Fresh case overlaps historical corpus")
    prompts = lead.render(cases, original["state"]["settings"])
    keys = {lead.call_key("haiku", p["system"], p["user"]) for p in prompts.values()}
    if len(keys) != len(cases) or keys & prior_requests:
        raise ValueError("Fresh driftbench request duplicated or previously recorded")
    OUT.mkdir(exist_ok=True)
    dump(OUT / "sets-power.json", {"knowledge": cases})
    dump(OUT / "prior-request-hashes.json", sorted(prior_requests))
    dump(OUT / "power-calculation.json", calculation())
    files = [OUT / "sets-power.json", OUT / "prior-request-hashes.json",
             OUT / "power-calculation.json", Path(__file__)]
    dump(MANIFEST, {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "seed": SEED, "pairs_per_family": PAIRS, "n": len(cases),
        "settings_freeze_commit": "d44740112", "settings": original["state"]["settings"],
        "original_freeze_sha256": digest((ROOT / "fresh-freeze.json").read_bytes()),
        "files": {str(p.relative_to(REPO)): digest(p.read_bytes()) for p in files},
        "prompts_sha256": prompts_sha(prompts), "concurrency": 3, "cap_usd": CAP,
        "overlap": {"prior_corpus_blobs": corpus_blobs, "prior_call_blobs": call_blobs,
                    "prior_distinct_inputs": len(prior_inputs), "prior_request_hashes": len(prior_requests),
                    "fresh_distinct_inputs": len(hashes), "case_overlap": 0, "ours_request_overlap": 0},
        "protocol": {"retries": 0, "pilot_pooling": False, "optional_stopping": False,
                     "failures": "count incorrect; retain response or full error",
                     "duplicate_requests": "reject historical; current-run shared DeepEval stages execute once and memoize",
                     "test": "two-sided exact McNemar; Holm over this row and frozen G-Eval row",
                     "claim": "level unless Holm-adjusted p<=0.05; no equivalence claim",
                     "limitation": "case-level test assumes independence; generated cases share templates and paired facts"}})
    print(json.dumps({"power": calculation(), "n": len(cases), "overlap": 0,
                      "historical_corpus_blobs": len(corpus_blobs), "historical_requests": len(prior_requests)}, indent=2))


def verify():
    original = baseline()
    frozen = json.loads(MANIFEST.read_text())
    if frozen["settings"] != original["state"]["settings"]:
        raise ValueError("Changed settings")
    for name, expected in frozen["files"].items():
        if digest((REPO / name).read_bytes()) != expected:
            raise ValueError(f"Changed frozen input: {name}")
    for path in [MANIFEST, *(REPO / name for name in frozen["files"])]:
        if path.read_bytes() != git("show", f"HEAD:{path.relative_to(REPO)}"):
            raise ValueError("Manifest and inputs must be committed before calls")
    cases = json.loads((OUT / "sets-power.json").read_text())["knowledge"]
    prompts = lead.render(cases, frozen["settings"])
    if prompts_sha(prompts) != frozen["prompts_sha256"]:
        raise ValueError("Rendered requests changed")
    return frozen, cases, prompts


class OnceRecorder(lead.Recorder):
    """Refuse rebilling including crashes; coalesce shared current-run metric stages."""

    def __init__(self, replay=False):
        self.replay = replay
        self.historical = set(json.loads((OUT / "prior-request-hashes.json").read_text()))
        self.key_locks, self.current = {}, {}
        super().__init__(not replay, CAP)
        if not replay and self.records:
            raise lead.StopRun("Refusing already-recorded run")

    def call(self, system, user):
        key = lead.call_key("haiku", system, user)
        with self.lock:
            if key in self.historical:
                raise lead.StopRun(f"Refusing historical request: {key}")
            key_lock = self.key_locks.setdefault(key, threading.Lock())
        with key_lock:
            if key in self.records:
                self.keys().append(key)
                row = self.records[key]
                with self.lock:
                    self.replays += 1
                if row.get("error"):
                    raise ValueError(row["error"])
                return row["result"]
            if self.replay:
                raise lead.StopRun(f"Replay missing request: {key}")
            # Reservation is durable BEFORE the subprocess. Reopening the run is forbidden.
            with self.lock:
                with (OUT / "reservations.jsonl").open("a") as stream:
                    stream.write(json.dumps({"request_sha256": key, **self.local.context}) + "\n")
                    stream.flush()
                    os.fsync(stream.fileno())
            return super().call(system, user)


def run(replay=False):
    frozen, cases, prompts = verify()
    lead.CALLS = OUT / "calls.jsonl"
    if not replay:
        # Exclusive create makes crash/restart and concurrent launch fail closed.
        with (OUT / "launch.json").open("x") as stream:
            json.dump({"commit": git("rev-parse", "HEAD").decode().strip(),
                       "timestamp": datetime.now(timezone.utc).isoformat(),
                       "manifest_sha256": digest(MANIFEST.read_bytes())}, stream)
    rec = OnceRecorder(replay)
    metric = lead.metrics(rec)
    results, lock = [], threading.Lock()
    result_path = OUT / ("replay.json" if replay else "results.json")

    def save():
        out = {"settings": frozen["settings"], "corpus_sha256": digest((OUT / "sets-power.json").read_bytes()),
               "rows": sorted(results, key=lambda r: r["id"]), "fresh_calls": len(rec.fresh),
               "fresh_usd": rec.spent, "replays": rec.replays}
        tmp = result_path.with_suffix(".tmp")
        dump(tmp, out)
        tmp.replace(result_path)

    def one(case):
        rec.local.context = {"run": "power", "set": "knowledge", "case": case["id"]}
        result = {"row": "knowledge retention", "set": "knowledge", "id": case["id"], "truth": case["truth"]}
        for side in ["ours", "theirs"]:
            rec.local.context["side"] = side
            rec.local.keys = []
            try:
                if side == "ours":
                    p = prompts[case["id"]]
                    result[side] = {"raw": rec.call(p["system"], p["user"])}
                else:
                    result[side] = metric("knowledge retention", case)
            except ValueError as exc:
                result[side] = {"prediction": None, "error": str(exc)}
            result[side]["request_sha256s"] = list(rec.local.keys)
        with lock:
            results.append(result)
            save()
            print(f"power: {len(results)}/{len(cases)}; fresh ${rec.spent:.4f}", flush=True)

    with ThreadPoolExecutor(max_workers=3) as pool:
        for f in [pool.submit(one, c) for c in cases]:
            f.result()
    parsed = lead.bridge({"action": "parse", "rows": [
        {"request": prompts[r["id"]]["request"], "raw": r["ours"].get("raw", "")} for r in results]})
    for r, answer in zip(results, parsed):
        bad = r["ours"].get("error") or answer.get("unparsed") or answer["answer"]["outcome"] == "inconclusive"
        r["ours"]["prediction"] = None if bad else answer["answer"]["outcome"] == "pass"
        r["ours"]["result"] = answer
    save()
    out = json.loads(result_path.read_text())
    out["summary"] = lead.summary(out["rows"])
    dump(result_path, out)
    print(json.dumps(out["summary"], indent=2))


if __name__ == "__main__":
    os.environ.setdefault("DEEPEVAL_TELEMETRY_OPT_OUT", "YES")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["prepare", "verify", "run", "replay"])
    action = parser.parse_args().action
    if action == "prepare":
        prepare()
    elif action == "verify":
        frozen, cases, prompts = verify()
        print(f"Verified {len(cases)} committed cases and original settings")
    else:
        run(replay=action == "replay")
