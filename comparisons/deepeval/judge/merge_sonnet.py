"""Builds results/sonnet-merged.json, the sonnet input of judge/tally.py.

The six original sets were run on sonnet before the cassette existed (results/sonnet-stored-100.json): those answers
are not in cassettes/sonnet.json, so they cannot be replayed. The knowledge2 set was recorded with the cassette
(results/sonnet-cassette.json), so it can. The merged file says which rows came from which source.
Usage: python judge/merge_sonnet.py
"""
import json, os
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
stored = json.load(open(os.path.join(ROOT, "results", "sonnet-stored-100.json")))["rows"]
cass = json.load(open(os.path.join(ROOT, "results", "sonnet-cassette.json")))["rows"]
for r in stored: r["source"] = "stored, not replayable"
for r in cass: r["source"] = "cassette, replayable"
merged = {"model": "sonnet", "rows": stored + cass}
json.dump(merged, open(os.path.join(ROOT, "results", "sonnet-merged.json"), "w"), indent=1)
print("stored", len(stored), "cassette", len(cass))
