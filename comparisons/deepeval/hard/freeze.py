"""Freeze the hard-selected candidate before any held-out measurement."""
from datetime import datetime
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FILES = ["audit.py", "sets.json", "sets-heldout.json", "audit-v2.json"]


def hashes(root):
    return {name: hashlib.sha256((root/name).read_bytes()).hexdigest() for name in FILES}


def verify(root):
    frozen = json.loads((root/"candidate-freeze.json").read_text())
    if frozen["sha256"] != hashes(root):
        raise ValueError("Frozen candidate, selection results or corpora changed")
    return frozen


def freeze(root):
    from score import tally
    selected = json.loads((root/"audit-v2.json").read_text())
    tally(selected)
    current = hashes(root)
    if selected.get("procedure_sha256") != current["audit.py"] or selected.get("sets_sha256") != current["sets.json"]:
        raise ValueError("Selection results do not measure the current candidate and hard corpus")
    path = root/"candidate-freeze.json"
    if path.exists():
        return verify(root)
    calls = root/"calls.jsonl"
    if calls.exists() and any(r.get("run", "").endswith("heldout") for r in map(json.loads,calls.read_text().splitlines())):
        raise ValueError("Held-out recording already exists; cannot select a new candidate")
    frozen = {"label": "not yet the shipped default", "selected_on": "corrected hard corpus v2 only",
              "timestamp": datetime.now().astimezone().isoformat(), "sha256": current}
    path.write_text(json.dumps(frozen,indent=2)+"\n")
    return frozen


if __name__ == "__main__":
    print(json.dumps(freeze(ROOT),indent=2))
