"""Extract the offline fixture from pinned Git objects, never another worktree or a provider.

Run from the repository root. The original objects must already exist locally.
Only uncertainty rows need the later seats. Dataset prompts and candidate text are omitted.
"""

import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
COUNCIL = subprocess.check_output(["git", "rev-parse", "140f406a^{commit}"], text=True).strip()
HAIKU = "0278595cb5b5a6b49830a1cacdbfd22bb951c0de"
BASE = "examples/judge-benchmarks/experiments/mm-results/"
sources = []


def read(commit, path):
    raw = subprocess.check_output(["git", "show", f"{commit}:{path}"])
    blob = subprocess.check_output(["git", "rev-parse", f"{commit}:{path}"], text=True).strip()
    sources.append({"commit": commit, "path": path, "gitBlob": blob,
                    "sha256": hashlib.sha256(raw).hexdigest()})
    return ([json.loads(line) for line in raw.splitlines()] if path.endswith(".jsonl")
            else json.loads(raw))


ids = read(COUNCIL, "examples/council/inputs/mm-dev400-ids.json")
direct = {r["id"]: r for r in read(HAIKU, BASE + "native-dev400-c576-direct-decisions.jsonl")}
chat = {r["id"]: r for r in read(HAIKU, BASE + "vote3-dev400-c576-chat-decisions.jsonl")}
refusals = {r["id"] for r in read(HAIKU, BASE + "native-dev400-c576-provider-refusals.jsonl")}
meta = {r["id"]: r for b in read(HAIKU, BASE + "native-dev400-c576-items.json")["batches"] for r in b}
score_rows = read(COUNCIL, "examples/council/results/items-mmeval-gpt-5.4-mini-driftbench.json")
labels = {r["id"]: r["label"] for r in score_rows}
raw_seats = {}
for model in ["gpt-5.4-mini", "gemini-3.8-flash"]:
    raw_seats[model] = {(r["item"], r["order"]): r for r in
                        read(COUNCIL, f"examples/council/recordings/mmeval/{model}.jsonl")
                        if r["contestant"] == "driftbench"}
jev = read(COUNCIL, "examples/council/results/jev-mmeval.json")
expected = read(COUNCIL, "examples/council/results/mm-stack-replay.json")


def comparisons(sample):
    return [{"key": r["key"], "order": r["order"], "rawWinner": r["rawWinner"],
             "unparsed": r["unparsed"], "textSha256": hashlib.sha256(r["text"].encode()).hexdigest()}
            for r in sample["rawComparisons"]]


rows = []
for item in ids:
    record = chat.get(item, direct.get(item))
    games = record["games"] if record else None
    assert record or item in refusals, f"Unexplained missing Haiku row: {item}"
    uncertain = games is None or games[0] != games[1] or games[0] == "tie"
    then = None
    if uncertain:
        then = {model: [{"key": raw_seats[model][item, order]["key"], "order": order,
                         "text": raw_seats[model][item, order]["text"]} for order in ["AB", "BA"]]
                for model in raw_seats}
        # These are per-call decoded results, not the label-derived aggregate vote.
        then["jev"] = [seat["sides"][item] for seat in jev["seatSides"]]
    rows.append({"id": item, "subset": meta[item]["group"], "language": meta[item]["language"],
                 "label": labels[item], "generatorFamily": None,
                 "first": {"kind": "chat-vote3" if item in chat else "direct" if record else "provider-refusal",
                           "samples": [comparisons(s) for s in record.get("samples", [record])] if record else []},
                 "then": then})

fixture = {"schema": 1, "sources": sources,
           "scorer": {"commit": COUNCIL, "path": "examples/council/stack/mm_stack.py",
                      "sha256": hashlib.sha256(subprocess.check_output(
                          ["git", "show", f"{COUNCIL}:examples/council/stack/mm_stack.py"])).hexdigest()},
           "ids": ids, "expected": {key: expected["designs"][key] for key in ["frozen", "cascade"]}}
ROOT.joinpath("fixtures").mkdir(exist_ok=True)
out = ROOT / "fixtures" / "mm-dev400.jsonl"
out.write_text("\n".join(json.dumps(row, ensure_ascii=False, separators=(",", ":"))
                         for row in [fixture, *rows]) + "\n")
print(json.dumps({"path": str(out), "rows": len(rows), "escalationRecordings": sum(r["then"] is not None for r in rows),
                  "bytes": out.stat().st_size, "sha256": hashlib.sha256(out.read_bytes()).hexdigest()}))
