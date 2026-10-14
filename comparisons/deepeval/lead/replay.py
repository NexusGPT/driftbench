"""Free replay of a recorded run with run.py unchanged, plus two replay rules.

- A recorded failure replays as that failure. run.py caches successes only, so it would stop as a miss.
- An answer replays for the case that recorded it. With parallel workers, the two cases of a pair can
  send the same first-stage DeepEval prompt at the same moment; each got its own answer, both recorded.
  A third case can then reuse either answer. When one prompt has several recorded answers, the replay
  takes the one whose extracted facts, as DeepEval renders them, appear in that case's recorded next-stage prompt (fresh.json).
- With --retry-failures, only the cases that hold a failed call are called again, with the frozen settings.
  Their recorded successful calls still replay; any other case that misses a recording stops the run.
Usage: .venv/bin/python comparisons/deepeval/lead/replay.py --corpus fresh --tag replay-fresh
       .venv/bin/python comparisons/deepeval/lead/replay.py --corpus fresh --tag fresh-retry --retry-failures --workers 3
"""
import importlib.util
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location("lead_run", ROOT / "run.py")
lead = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lead)


RETRY_CAP_USD = 1.0


class ReplayRecorder(lead.Recorder):
    retry = set()

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.by_case, self.answers, self.users = {}, {}, {}
        for r in lead.records(lead.CALLS):
            self.users[r["request_sha256"]] = r["user"]
            if not r.get("error"):
                self.by_case[(r["request_sha256"], r.get("case"))] = r["result"]
                self.answers.setdefault(r["request_sha256"], []).append(r["result"])
        run = ROOT / "fresh.json"
        self.chain = {}
        if run.exists():
            for row in json.loads(run.read_text())["rows"]:
                self.chain[row["id"]] = row.get("theirs", {}).get("request_sha256s", [])

    def pick(self, key, case):
        """Of several recorded answers to one prompt, the one this case's next prompt was built from."""
        candidates = list(dict.fromkeys(self.answers.get(key, [])))
        if len(candidates) < 2:
            return None
        chain = self.chain.get(case, [])
        later = chain[chain.index(key) + 1:] if key in chain else []
        text = " ".join(self.users.get(k, "") for k in later)
        fits = []
        for answer in candidates:
            try:
                facts = lead.hard_run.parse(answer).get("data", {})
            except (ValueError, AttributeError):
                continue
            if facts and repr(facts) in text:
                fits.append(answer)
        if len(fits) != 1:
            raise lead.StopRun(f"Ambiguous recorded answers for {key} in {case}")
        return fits[0]

    def call(self, system, user):
        key = lead.call_key("haiku", system, user)
        case = getattr(self.local, "context", {}).get("case")
        own = self.by_case.get((key, case))
        if own is None:
            own = self.pick(key, case)
        if own is not None:
            self.keys().append(key)
            with self.lock:
                self.replays += 1
            return own
        if case in self.retry:
            return super().call(system, user)
        failed = self.records.get(key, {}).get("error")
        if failed and key not in self.cache:
            self.keys().append(key)
            raise ValueError(failed)
        if key not in self.cache:
            self.keys().append(key)
            raise lead.StopRun(f"Replay miss outside the retried cases: {key} in {case}")
        return super().call(system, user)


if __name__ == "__main__":
    if "--record" in sys.argv:
        raise SystemExit("replay.py records only through --retry-failures")
    if "--retry-failures" in sys.argv:
        sys.argv.remove("--retry-failures")
        rows = json.loads((ROOT / "fresh.json").read_text())["rows"]
        ReplayRecorder.retry = {r["id"] for r in rows
                                if r.get("ours", {}).get("error") or r.get("theirs", {}).get("error")}
        print(f"Retrying the failed calls of {len(ReplayRecorder.retry)} cases", flush=True)
        sys.argv += ["--record", "--cap-usd", str(RETRY_CAP_USD)]
    lead.Recorder = ReplayRecorder
    lead.os.environ.setdefault("DEEPEVAL_TELEMETRY_OPT_OUT", "YES")
    lead.main()
