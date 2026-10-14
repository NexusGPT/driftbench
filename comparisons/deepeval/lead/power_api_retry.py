"""Reuse successful fresh parity answers when resolving old timeout chains.

The main pass retains the original missing answers. After it completes, an
already-recorded successful parity request supplies its authorized retry answer.
Only requests still unanswered make a new API call, once, at concurrency three.
"""
import json
import os
from pathlib import Path

import power_api as api

BaseRecorder = api.APIRecorder


class RetryRecorder(BaseRecorder):
    def __init__(self, phase, prior=None, retry_keys=(), credential=None):
        prior = dict(prior or {})
        retry_keys = set(retry_keys)
        reused = []
        for row in api.rows(api.API / "parity" / "calls.jsonl"):
            key = row["request_sha256"]
            if row["case"].startswith("power/") and not row.get("error"):
                if key in retry_keys:
                    reused.append(key)
                    retry_keys.remove(key)
                if key not in prior or api.timeout(prior[key]):
                    prior[key] = row
        api.power.dump(api.API / "retry" / "parity-reused.json", sorted(reused))
        super().__init__(phase, prior, retry_keys, credential)


if __name__ == "__main__":
    os.environ.setdefault("DEEPEVAL_TELEMETRY_OPT_OUT", "YES")
    path = Path(__file__)
    policy_path = api.API / "retry-cache-policy.json"
    policy = json.loads(policy_path.read_text())
    if api.power.digest(path.read_bytes()) != policy["runner_digest"]:
        raise ValueError("Retry cache adapter changed")
    for p in [path, policy_path]:
        if p.read_bytes() != api.power.git("show", "HEAD:"+str(p.relative_to(api.power.REPO))):
            raise ValueError("Retry adapter and policy must be committed")
    api.APIRecorder = RetryRecorder
    api.run("retry")
