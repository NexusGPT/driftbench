"""Resume only on the owner's signal, keeping completed cases and every recorded stage.

The three canceled in-flight requests are unfinished work, not timeout verdicts.
The source/settings freeze is verified before any model call.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import threading

import power_run as power

lead = power.lead
ROOT = power.OUT
POLICY = ROOT / "resume-policy.json"


class ResumeRecorder(lead.Recorder):
    def __init__(self, cap, interrupted):
        super().__init__(True, cap)
        self.interrupted = set(interrupted)
        self.historical = set(json.loads((ROOT / "prior-request-hashes.json").read_text()))
        self.reserved = {r["request_sha256"] for r in
                         (json.loads(line) for line in (ROOT / "reservations.jsonl").read_text().splitlines())}
        self.key_locks = {}

    def call(self, system, user):
        key = lead.call_key("haiku", system, user)
        if key in self.historical:
            raise lead.StopRun(f"Refusing historical request {key}")
        with self.lock:
            key_lock = self.key_locks.setdefault(key, threading.Lock())
        with key_lock:
            if key in self.records:
                self.keys().append(key)
                record = self.records[key]
                with self.lock:
                    self.replays += 1
                if record.get("error"):
                    raise ValueError(record["error"])
                return record["result"]
            if key in self.reserved and key not in self.interrupted:
                raise lead.StopRun(f"Unresolved reservation outside owner pause: {key}")
            with self.lock:
                kind = "owner-interrupted-unfinished-request" if key in self.interrupted else "new-stage"
                with (ROOT / "resume-reservations.jsonl").open("a") as stream:
                    stream.write(json.dumps({"request_sha256": key, "kind": kind, **self.local.context}) + "\n")
                    stream.flush()
                    os.fsync(stream.fileno())
                self.reserved.add(key)
                self.interrupted.discard(key)
            return super().call(system, user)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--owner-resumed", action="store_true")
    if not parser.parse_args().owner_resumed:
        raise SystemExit("Await the owner's explicit resume signal; the estimated time is not authorization")
    frozen, cases, prompts = power.verify()
    policy = json.loads(POLICY.read_text())
    if power.digest(Path(__file__).read_bytes()) != policy["resume_runner_sha256"]:
        raise ValueError("Resume runner changed after freeze")
    for path in [POLICY, Path(__file__)]:
        if path.read_bytes() != power.git("show", f"HEAD:{path.relative_to(power.REPO)}"):
            raise ValueError("Resume policy and runner must be committed")
    path = ROOT / "results.json"
    prior = json.loads(path.read_text())
    completed = {r["id"] for r in prior["rows"]}
    if sorted(completed) != policy["completed_case_ids"]:
        raise ValueError("Completed-case checkpoint changed")
    lead.CALLS = ROOT / "calls.jsonl"
    records = list(lead.records(lead.CALLS))
    if power.digest(json.dumps(sorted(r["request_sha256"] for r in records)).encode()) != policy["recorded_requests_digest"]:
        raise ValueError("Recorded-stage checkpoint changed")
    baseline_cost = sum(r["charged_usd"] for r in records) + policy["interrupted_cost_reservation_usd"]
    with (ROOT / "resume-launch.json").open("x") as stream:
        json.dump({"timestamp": datetime.now(timezone.utc).isoformat(),
                   "commit": power.git("rev-parse", "HEAD").decode().strip(),
                   "kept_cases": len(completed), "kept_call_records": len(records),
                   "interrupted_request_count": len(policy["interrupted_request_keys"])}, stream)
    rec = ResumeRecorder(max(0, power.CAP-baseline_cost), policy["interrupted_request_keys"])
    metric = lead.metrics(rec)
    results, lock = list(prior["rows"]), threading.Lock()

    def save():
        out = {"settings": frozen["settings"], "corpus_sha256": prior["corpus_sha256"],
               "rows": sorted(results, key=lambda r: r["id"]),
               "fresh_calls": len(records)+len(rec.fresh), "fresh_usd": baseline_cost+rec.spent,
               "replays": prior["replays"]+rec.replays,
               "owner_pause": {"kept_cases": len(completed), "interrupted_requests": len(policy["interrupted_request_keys"]),
                               "cost_reservation_usd": policy["interrupted_cost_reservation_usd"], "counted_as_timeout": False}}
        tmp = path.with_suffix(".tmp")
        power.dump(tmp, out)
        tmp.replace(path)

    def one(case):
        result = {"row": "knowledge retention", "set": "knowledge", "id": case["id"], "truth": case["truth"]}
        rec.local.context = {"run": "power-resumed", "set": "knowledge", "case": case["id"]}
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
            print(f"power resumed: {len(results)}/{len(cases)}; cost/reserve ${baseline_cost+rec.spent:.4f}", flush=True)

    with ThreadPoolExecutor(max_workers=3) as pool:
        for future in [pool.submit(one, c) for c in cases if c["id"] not in completed]:
            future.result()
    parsed = lead.bridge({"action": "parse", "rows": [
        {"request": prompts[r["id"]]["request"], "raw": r["ours"].get("raw", "")} for r in results]})
    for row, answer in zip(results, parsed):
        bad = row["ours"].get("error") or answer.get("unparsed") or answer["answer"]["outcome"] == "inconclusive"
        row["ours"]["prediction"] = None if bad else answer["answer"]["outcome"] == "pass"
        row["ours"]["result"] = answer
    save()
    output = json.loads(path.read_text())
    output["summary"] = lead.summary(output["rows"])
    power.dump(path, output)
    print("Main pass complete; authorized timeout retry may now begin", flush=True)


if __name__ == "__main__":
    os.environ.setdefault("DEEPEVAL_TELEMETRY_OPT_OUT", "YES")
    main()
