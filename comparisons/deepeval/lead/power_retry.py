"""Owner-authorized single retry of timed-out requests after the complete main pass.

Successes replay unchanged; other errors never retry. Missing answers are not verdicts.
The original manifest and judge settings remain immutable.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import threading

import power_run as power

lead = power.lead
ROOT = power.OUT
RETRY = ROOT / "retry"
POLICY = ROOT / "timeout-policy.json"


def timeout(row):
    return "timed out after" in row.get("error", "")


def available_summary(rows):
    out = {"row": "knowledge retention", "total_cases": len(rows)}
    for side in ["ours", "theirs"]:
        observed = [r for r in rows if isinstance(r[side].get("prediction"), bool)]
        correct = sum(r[side]["prediction"] == r["truth"] for r in observed)
        out[side] = {"correct": correct, "incorrect": len(observed)-correct,
                     "missing": len(rows)-len(observed),
                     "timeouts": sum(timeout(r[side]) for r in rows),
                     "observed": len(observed)}
    pairs = [r for r in rows if all(isinstance(r[s].get("prediction"), bool) for s in ["ours", "theirs"])]
    b = sum(r["ours"]["prediction"] == r["truth"] and r["theirs"]["prediction"] != r["truth"] for r in pairs)
    c = sum(r["theirs"]["prediction"] == r["truth"] and r["ours"]["prediction"] != r["truth"] for r in pairs)
    out["paired"] = {"n": len(pairs), "excluded_missing": len(rows)-len(pairs),
                     "ours": sum(r["ours"]["prediction"] == r["truth"] for r in pairs),
                     "theirs": sum(r["theirs"]["prediction"] == r["truth"] for r in pairs),
                     "ours_only_right": b, "theirs_only_right": c, "paired_p": lead.paired_p(b, c)}
    return out


class RetryRecorder(lead.Recorder):
    def __init__(self, original, cap):
        super().__init__(True, cap)
        self.original = original
        self.historical = set(json.loads((ROOT / "prior-request-hashes.json").read_text()))
        self.key_locks = {}
        if self.records:
            raise lead.StopRun("Retry ledger already exists; no second retry run")

    def call(self, system, user):
        key = lead.call_key("haiku", system, user)
        if key in self.historical:
            raise lead.StopRun(f"Refusing historical request {key}")
        with self.lock:
            key_lock = self.key_locks.setdefault(key, threading.Lock())
        with key_lock:
            prior = self.original.get(key)
            if prior is not None and not timeout(prior):
                self.keys().append(key)
                with self.lock:
                    self.replays += 1
                if prior.get("error"):
                    raise ValueError(prior["error"])
                return prior["result"]
            if key in self.records:
                self.keys().append(key)
                row = self.records[key]
                with self.lock:
                    self.replays += 1
                if row.get("error"):
                    raise ValueError(row["error"])
                return row["result"]
            with self.lock:
                with (RETRY / "reservations.jsonl").open("a") as stream:
                    stream.write(json.dumps({"request_sha256": key,
                                             "kind": "timeout-retry" if prior else "previously-unreached-stage",
                                             **self.local.context}) + "\n")
                    stream.flush()
                    os.fsync(stream.fileno())
            return super().call(system, user)


def main():
    frozen, cases, prompts = power.verify()
    policy = json.loads(POLICY.read_text())
    if power.digest(Path(__file__).read_bytes()) != policy["retry_runner_sha256"]:
        raise ValueError("Retry runner changed since policy freeze")
    for path in [POLICY, Path(__file__)]:
        if path.read_bytes() != power.git("show", f"HEAD:{path.relative_to(power.REPO)}"):
            raise ValueError("Retry policy and runner must be committed")
    main_run = json.loads((ROOT / "results.json").read_text())
    if len(main_run["rows"]) != frozen["n"] or "summary" not in main_run:
        raise ValueError("Main pass must finish before retries")
    original = {r["request_sha256"]: r for r in lead.records(ROOT / "calls.jsonl")}
    retry_keys = {k for k, r in original.items() if timeout(r)}
    selected = {r["id"] for r in main_run["rows"] if any(
        key in retry_keys for side in ["ours", "theirs"] for key in r[side]["request_sha256s"])}
    RETRY.mkdir(exist_ok=True)
    with (RETRY / "launch.json").open("x") as stream:
        json.dump({"timestamp": datetime.now(timezone.utc).isoformat(),
                   "commit": power.git("rev-parse", "HEAD").decode().strip(),
                   "timeout_requests": len(retry_keys), "affected_cases": len(selected),
                   "main_results_sha256": power.digest((ROOT / "results.json").read_bytes())}, stream)
    lead.CALLS = RETRY / "calls.jsonl"
    rec = RetryRecorder(original, max(0, power.CAP-main_run["fresh_usd"]))
    metric = lead.metrics(rec)
    results = {r["id"]: r for r in main_run["rows"]}
    lock = threading.Lock()
    done = []
    target = ROOT / "retry-results.json"

    def save():
        out = {"settings": frozen["settings"], "rows": sorted(results.values(), key=lambda r: r["id"]),
               "main_usd": main_run["fresh_usd"], "retry_usd": rec.spent,
               "retry_fresh_calls": len(rec.fresh), "retry_replays": rec.replays,
               "affected_cases": len(selected), "retry_cases_completed": len(done)}
        tmp = target.with_suffix(".tmp")
        power.dump(tmp, out)
        tmp.replace(target)

    def one(case):
        result = {"row": "knowledge retention", "set": "knowledge", "id": case["id"], "truth": case["truth"]}
        rec.local.context = {"run": "power-timeout-retry", "set": "knowledge", "case": case["id"]}
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
        parsed = lead.bridge({"action": "parse", "rows": [{"request": prompts[case["id"]]["request"],
                                                            "raw": result["ours"].get("raw", "")}]})[0]
        bad = result["ours"].get("error") or parsed.get("unparsed") or parsed["answer"]["outcome"] == "inconclusive"
        result["ours"]["prediction"] = None if bad else parsed["answer"]["outcome"] == "pass"
        result["ours"]["result"] = parsed
        with lock:
            results[case["id"]] = result
            done.append(case["id"])
            save()
            print(f"retry: {len(done)}/{len(selected)}; fresh ${rec.spent:.4f}", flush=True)

    with ThreadPoolExecutor(max_workers=3) as pool:
        for future in [pool.submit(one, c) for c in cases if c["id"] in selected]:
            future.result()
    save()
    output = json.loads(target.read_text())
    output["before"] = available_summary(main_run["rows"])
    output["after"] = available_summary(output["rows"])
    output["retry_complete"] = True
    power.dump(target, output)
    print(json.dumps({"before": output["before"], "after": output["after"]}, indent=2))


if __name__ == "__main__":
    os.environ.setdefault("DEEPEVAL_TELEMETRY_OPT_OUT", "YES")
    main()
