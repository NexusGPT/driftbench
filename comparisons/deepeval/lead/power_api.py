"""Owner-authorized Messages transport, isolated parity check, and resumable evidence.

Original prompt renderers, parsers, metrics and settings remain frozen.
Each phase launches once; completed requests replay, never re-bill.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import random
import threading
import time
import urllib.error
import urllib.request

import power_run as power
from power_retry import available_summary, timeout

lead = power.lead
ROOT = power.OUT
API = ROOT / "api"
MODEL = "claude-haiku-5-5"
MAX_TOKENS = 32768
RESERVE = 0.05
PAUSE_RESERVE = 0.30  # Three original pause attempts plus three CLI-to-API switch attempts.


def rows(path):
    return list(lead.records(path)) if path.exists() else []


def usage_cost(usage):
    total_input = sum(usage.get(k, 0) for k in ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"])
    factor = 5 if total_input > 100000 else 1
    cache = usage.get("cache_creation", {})
    writes = usage.get("cache_creation_input_tokens", 0)
    hour = cache.get("ephemeral_1h_input_tokens", 0)
    return factor * (usage["input_tokens"] * .10 + usage["output_tokens"] * .50
                     + (writes-hour)*.125 + hour*.20 + usage.get("cache_read_input_tokens", 0)*.01) / 1000000


def ledger_cost():
    paths = [ROOT / "calls.jsonl", *(API / p / "calls.jsonl" for p in ["parity", "main", "retry"])]
    return PAUSE_RESERVE + sum(r["charged_usd"] for p in paths for r in rows(p))


def parse_ours(results, prompts):
    parsed = lead.bridge({"action": "parse", "rows": [
        {"request": prompts[r["id"]]["request"], "raw": r["ours"].get("raw") or ""} for r in results]})
    for row, answer in zip(results, parsed):
        bad = row["ours"].get("error") or answer.get("unparsed") or answer["answer"]["outcome"] == "inconclusive"
        row["ours"]["prediction"] = None if bad else answer["answer"]["outcome"] == "pass"
        row["ours"]["result"] = answer


def prepare():
    frozen, fresh, prompts = power.verify()
    API.mkdir(exist_ok=True)
    if (API / "policy.json").exists():
        raise ValueError("API policy already frozen")
    checkpoint = json.loads((ROOT / "results.json").read_text())
    parse_ours(checkpoint["rows"], prompts)
    power.dump(API / "checkpoint.json", checkpoint)
    completed = {r["id"]: r for r in checkpoint["rows"]}
    assert len(completed) == 7
    old = json.loads((power.ROOT / "sets-fresh.json").read_text())["knowledge"]
    old_refs = {r["id"]: r for r in json.loads((power.ROOT / "fresh-retry.json").read_text())["rows"] if r["set"] == "knowledge"}
    sampled = random.Random(20261215).sample(sorted(old, key=lambda c: c["id"]), 23)
    selected, references = [], []
    for source, items, refs in [("power", [c for c in fresh if c["id"] in completed], completed),
                                ("pilot", sampled, old_refs)]:
        for case in items:
            identity = source + "/" + case["id"]
            selected.append(dict(case, id=identity, set="knowledge", original_id=case["id"], source=source))
            references.append(dict(refs[case["id"]], id=identity, source=source))
    power.dump(API / "parity-cases.json", selected)
    power.dump(API / "parity-reference.json", references)
    paths = [Path(__file__), API / "checkpoint.json", API / "parity-cases.json", API / "parity-reference.json",
             ROOT / "calls.jsonl", ROOT / "reservations.jsonl", ROOT / "resume-reservations.jsonl"]
    power.dump(API / "policy.json", {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "authority": "Owner: Resume now, on the API; claude-haiku-5-5 for both sides, same prompts/settings; parity 7 completed plus 23 pilot cases; finish 1272; concurrency up to 16; retry 429/5xx; usage cost.",
        "transport": "POST https://api.anthropic.com/v1/messages", "model": MODEL,
        "api_version": "2023-06-01", "max_tokens": MAX_TOKENS,
        "defaults": "No temperature, top_p, thinking, effort, tools, cache_control or beta override. The original CLI did not set these in its command. CLI-internal defaults/envelope are not asserted identical to API defaults.",
        "prompts": "Byte-identical renderer/metric system and user strings, no wrapper additions. One user message and top-level system.",
        "settings": frozen["settings"], "concurrency": {"parity": 16, "main": 16, "timeout_retry": 3},
        "parity": {"completed": 7, "pilot": 23, "sample_seed": 20261215, "selection": "random.sample of id-sorted earlier 480; selected before calls", "replacement": False},
        "preservation": "Seven completed confirmation cases retained. All successful recorded stages replay. Parity is separate; matching fresh parity stages may replay without rebilling. Pilot requests forbidden in confirmation.",
        "retry": "429 and 5xx: same body, exponential backoff plus jitter, honor Retry-After, at most 8 attempts. Genuine timeout: one post-main retry at concurrency 3. No valid-answer retry. Missing is not a verdict.",
        "budget_usd": 10, "per_inflight_reservation_usd": RESERVE,
        "canceled_cli_attempts": 6, "canceled_cli_cost_reservation_usd": PAUSE_RESERVE,
        "pricing_per_million_usd": {"input": .10, "output": .50, "cache_write_5m": .125, "cache_write_1h": .20, "cache_read": .01, "over_100k_multiplier": 5},
        "pricing_source": "https://platform.claude.com/docs/en/about-claude/pricing",
        "request_source": "https://platform.claude.com/docs/en/api/messages/create",
        "files": {str(p.relative_to(power.REPO)): power.digest(p.read_bytes()) for p in paths}})


class APIRecorder:
    def __init__(self, phase, prior=None, retry_keys=(), credential=None):
        self.phase, self.prior, self.retry_keys = phase, prior or {}, set(retry_keys)
        self.directory = API / phase
        self.directory.mkdir(exist_ok=True)
        self.path = self.directory / "calls.jsonl"
        self.lock, self.local = threading.Lock(), threading.local()
        self.key_locks, self.records = {}, {}
        self.inflight, self.replays = 0., 0
        self.aborted = threading.Event()
        self.baseline, self.spent = ledger_cost(), 0.
        self.historical = set(json.loads((ROOT / "prior-request-hashes.json").read_text()))
        self.key = credential if credential is not None else (Path.home() / ".nexus-secrets/anthropic-driftbench.key").read_text().strip()
        if rows(self.path):
            raise lead.StopRun("Phase already recorded; refusing rebilling")

    def journal(self, name, row):
        with (self.directory / name).open("a") as stream:
            stream.write(json.dumps(row, ensure_ascii=False) + "\n")
            stream.flush()
            os.fsync(stream.fileno())

    def call(self, system, user):
        if self.aborted.is_set():
            raise lead.StopRun("Transport halted after fatal response")
        key = lead.call_key("haiku", system, user)
        self.local.keys.append(key)
        if self.phase != "parity" and key in self.historical:
            raise lead.StopRun("Historical request forbidden in confirmation")
        with self.lock:
            key_lock = self.key_locks.setdefault(key, threading.Lock())
        with key_lock:
            old = self.records.get(key) or (None if key in self.retry_keys else self.prior.get(key))
            if old is not None:
                with self.lock:
                    self.replays += 1
                if old.get("error"):
                    raise ValueError(old["error"])
                return old["result"]
            body = {"model": MODEL, "max_tokens": MAX_TOKENS, "system": system,
                    "messages": [{"role": "user", "content": user}]}
            payload = json.dumps(body, ensure_ascii=False).encode()
            if len(payload) > 100000:
                raise lead.StopRun("Payload exceeds conservative reservation envelope")
            with self.lock:
                if self.baseline+self.spent+self.inflight+RESERVE > power.CAP:
                    raise lead.StopRun("Total spend cap reached")
                self.inflight += RESERVE
                self.journal("reservations.jsonl", {"request_sha256": key, "body_digest": power.digest(payload), **self.local.context})
            row = {"request_sha256": key, "system": system, "user": user,
                   "requested_model": MODEL, "transport": "anthropic-messages-api",
                   "timestamp": datetime.now(timezone.utc).isoformat(), **self.local.context,
                   "body_digest": power.digest(payload), "max_tokens": MAX_TOKENS}
            try:
                for attempt in range(8):
                    req = urllib.request.Request("https://api.anthropic.com/v1/messages", data=payload,
                        headers={"x-api-key": self.key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
                    try:
                        with urllib.request.urlopen(req, timeout=180) as response:
                            envelope = json.load(response)
                            request_id = response.headers.get("request-id")
                        break
                    except urllib.error.HTTPError as exc:
                        message = exc.read().decode(errors="replace").replace(self.key, "[REDACTED]")
                        with self.lock:
                            self.journal("http-attempts.jsonl", {"request_sha256": key, "attempt": attempt+1,
                                "status": exc.code, "body": message, "request_id": exc.headers.get("request-id")})
                        if (exc.code == 429 or 500 <= exc.code < 600) and attempt < 7:
                            delay = max(min(60, 2**attempt)+random.random(), float(exc.headers.get("retry-after", "0")))
                            time.sleep(delay)
                            continue
                        if exc.code in (400, 401, 403, 404):
                            self.aborted.set()
                        raise ValueError(f"HTTP {exc.code}: {message}") from None
                row.update(envelope=envelope, request_id=request_id,
                    result="".join(c.get("text", "") for c in envelope.get("content", []) if c["type"] == "text"),
                    charged_usd=usage_cost(envelope["usage"]), usage=envelope["usage"], http_attempts=attempt+1)
                if envelope["model"] != MODEL:
                    self.aborted.set()
                    raise ValueError("Unexpected response model: " + envelope["model"])
                if envelope.get("stop_reason") != "end_turn":
                    row["error"] = "Non-verdict stop reason: " + str(envelope.get("stop_reason"))
            except Exception as exc:
                message = str(exc).replace(self.key, "[REDACTED]")
                if isinstance(exc, TimeoutError) or "timed out" in message:
                    message = "timed out after 180 seconds: " + message
                row.update(error=message)
                row.setdefault("result", "")
                row.setdefault("charged_usd", RESERVE)
                if "usage" not in row:
                    row["cost_is_reservation"] = True
            row = lead.sanitize(row)
            with self.lock:
                self.inflight -= RESERVE
                self.spent += row["charged_usd"]
                self.journal("calls.jsonl", row)
                self.records[key] = row
            if row.get("error"):
                if self.aborted.is_set():
                    raise lead.StopRun(row["error"])
                raise ValueError(row["error"])
            return row["result"]


def run(phase):
    frozen, fresh, prompts = power.verify()
    policy_path = API / "policy.json"
    policy = json.loads(policy_path.read_text())
    for name, digest in policy["files"].items():
        path = power.REPO / name
        if power.digest(path.read_bytes()) != digest or path.read_bytes() != power.git("show", "HEAD:"+name):
            raise ValueError("API protocol input changed: " + name)
    if policy_path.read_bytes() != power.git("show", "HEAD:"+str(policy_path.relative_to(power.REPO))):
        raise ValueError("API policy must be committed")
    checkpoint = json.loads((API / "checkpoint.json").read_text())
    prior = {r["request_sha256"]: r for r in rows(ROOT / "calls.jsonl")}
    retry_keys = set()
    if phase == "parity":
        cases = json.loads((API / "parity-cases.json").read_text())
        prompts = lead.render(cases, frozen["settings"])
        results = {}
    else:
        parity = json.loads((API / "parity" / "results.json").read_text())
        if not parity.get("complete"):
            raise ValueError("Parity must finish before confirmation resumes")
        for row in rows(API / "parity" / "calls.jsonl"):
            if row["case"].startswith("power/"):
                prior.setdefault(row["request_sha256"], row)
        if phase == "main":
            results = {r["id"]: r for r in checkpoint["rows"]}
            cases = [c for c in fresh if c["id"] not in results]
        else:
            main = json.loads((API / "main" / "results.json").read_text())
            if not main.get("complete") or len(main["rows"]) != 1272:
                raise ValueError("Main must finish before timeout retries")
            prior.update({r["request_sha256"]: r for r in rows(API / "main" / "calls.jsonl")})
            retry_keys = {k for k, row in prior.items() if timeout(row)}
            results = {r["id"]: r for r in main["rows"]}
            cases = [c for c in fresh if any(k in retry_keys for s in ["ours", "theirs"] for k in results[c["id"]][s]["request_sha256s"])]
    directory = API / phase
    directory.mkdir(exist_ok=True)
    with (directory / "launch.json").open("x") as stream:
        json.dump({"timestamp": datetime.now(timezone.utc).isoformat(), "commit": power.git("rev-parse", "HEAD").decode().strip(),
                   "phase": phase, "selected_cases": len(cases)}, stream)
    rec = APIRecorder(phase, {} if phase == "parity" else prior, retry_keys)
    metric = lead.metrics(rec)
    lock = threading.Lock()
    done = []

    def save(complete=False):
        output = {"settings": frozen["settings"], "rows": sorted(results.values(), key=lambda r: r["id"]),
                  "phase": phase, "complete": complete, "completed_this_phase": len(done), "selected_cases": len(cases),
                  "api_phase_usd": rec.spent, "api_calls": len(rec.records), "replays": rec.replays,
                  "total_cost_or_reservation_usd": rec.baseline+rec.spent}
        if complete:
            output["summary"] = available_summary(output["rows"])
            if phase == "parity":
                refs = {r["id"]: r for r in json.loads((API / "parity-reference.json").read_text())}
                output["agreement"] = {}
                for source in ["power", "pilot", "all"]:
                    selected = [r for r in output["rows"] if source == "all" or r["id"].startswith(source+"/")]
                    output["agreement"][source] = {}
                    for side in ["ours", "theirs"]:
                        pairs = [(r[side].get("prediction"), refs[r["id"]][side].get("prediction")) for r in selected]
                        valid = [(a,b) for a,b in pairs if isinstance(a,bool) and isinstance(b,bool)]
                        output["agreement"][source][side] = {"agree": sum(a==b for a,b in valid), "comparable": len(valid),
                            "missing_reference": sum(not isinstance(b,bool) for a,b in pairs), "missing_api": sum(not isinstance(a,bool) for a,b in pairs),
                            "disagree_ids": [r["id"] for r in selected if isinstance(r[side].get("prediction"), bool) and isinstance(refs[r["id"]][side].get("prediction"),bool) and r[side]["prediction"] != refs[r["id"]][side]["prediction"]]}
            if phase == "retry":
                output.update(before=available_summary(main["rows"]), after=output["summary"], retry_complete=True)
        tmp = directory / "results.tmp"
        power.dump(tmp, output)
        tmp.replace(directory / "results.json")

    def one(case):
        result = {"id": case["id"], "truth": case["truth"], "row": "knowledge retention", "set": "knowledge"}
        rec.local.context = {"run": "api-"+phase, "case": case["id"], "set": "knowledge"}
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
            results[case["id"]] = result
            done.append(case["id"])
            save()
            print(f"{phase}: {len(done)}/{len(cases)}; API ${rec.spent:.6f}", flush=True)

    with ThreadPoolExecutor(max_workers=3 if phase == "retry" else 16) as pool:
        for future in [pool.submit(one, c) for c in cases]:
            future.result()
    parse_ours(list(results.values()), prompts)
    save(True)
    output = json.loads((directory / "results.json").read_text())
    print(json.dumps(output.get("agreement", output["summary"]), indent=2), flush=True)


if __name__ == "__main__":
    os.environ.setdefault("DEEPEVAL_TELEMETRY_OPT_OUT", "YES")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["prepare", "parity", "main", "retry"])
    action = parser.parse_args().action
    prepare() if action == "prepare" else run(action)
