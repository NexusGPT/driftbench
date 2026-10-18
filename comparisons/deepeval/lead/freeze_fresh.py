"""Freeze the fresh corpus, the driftbench settings and every source before the first fresh call.

Run once after generating sets-fresh.json and before any fresh call:
  .venv/bin/python comparisons/deepeval/lead/freeze_fresh.py --seed SEED --pairs-per-family N
run.py --corpus fresh calls verify() and stops on any difference.
"""
import argparse
from datetime import datetime
import hashlib
import importlib.metadata
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
FREEZE = ROOT / "fresh-freeze.json"
SOURCES = [
    "comparisons/deepeval/lead/run.py", "comparisons/deepeval/lead/bridge.mts",
    "comparisons/deepeval/lead/freeze_fresh.py", "comparisons/deepeval/lead/sets-fresh.json",
    "comparisons/deepeval/hard/run.py", "comparisons/deepeval/hard/recordings.py",
    "comparisons/deepeval/hard/generate.py",
    "examples/criteria/relevancy.yaml", "examples/criteria/knowledge_retention.yaml",
]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def package_hashes():
    folder = REPO / "packages" / "judges" / "src"
    return {str(p.relative_to(REPO)): sha(p.read_bytes()) for p in sorted(folder.rglob("*")) if p.is_file()}


def prompts_sha(prompts):
    ordered = [[k, prompts[k]["system"], prompts[k]["user"]] for k in sorted(prompts)]
    return sha(json.dumps(ordered, ensure_ascii=False).encode())


def state(prompts, settings):
    return {
        "sources": {name: sha((REPO / name).read_bytes()) for name in SOURCES},
        "package": package_hashes(),
        "settings": settings,
        "driftbench_prompts_sha256": prompts_sha(prompts),
        "driftbench_requests": len(prompts),
        "deepeval": importlib.metadata.version("deepeval"),
    }


def verify(prompts, settings):
    frozen = json.loads(FREEZE.read_text())
    if frozen["state"] != state(prompts, settings):
        raise ValueError("Fresh corpus, settings, prompts or sources changed after the freeze")
    return frozen


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--seed", type=int, required=True)
    ap.add_argument("--pairs-per-family", type=int, required=True)
    args = ap.parse_args()
    if FREEZE.exists():
        raise SystemExit("Already frozen; a fresh corpus is frozen once")
    import sys
    sys.path.insert(0, str(ROOT))
    from run import SETTINGS, load, render
    regenerated = subprocess.run(
        ["python3", "-c", "import json,sys; sys.path.insert(0,'comparisons/deepeval/hard');"
         f"from generate import build; print(json.dumps(build({args.seed},{args.pairs_per_family}),"
         "ensure_ascii=False, indent=2))"], cwd=REPO, text=True, capture_output=True, check=True).stdout
    if regenerated != (ROOT / "sets-fresh.json").read_text():
        raise SystemExit("sets-fresh.json is not the generator output for this seed and size")
    sets = list(SETTINGS)
    cases, _ = load("fresh", sets)
    prompts = render(cases, dict(SETTINGS))
    for c in cases:  # labels, ids and families never enter a request
        text = prompts[c["id"]]["system"] + prompts[c["id"]]["user"]
        if c["id"] in text or c["pair"] in text or '"truth"' in text:
            raise SystemExit(f"Case metadata entered a request: {c['id']}")
    cli = subprocess.run(["claude", "--version"], text=True, capture_output=True).stdout.strip()
    frozen = {"timestamp": datetime.now().astimezone().isoformat(), "seed": args.seed,
              "pairs_per_family": args.pairs_per_family, "generator": "comparisons/deepeval/hard/generate.py",
              "cases": {s: sum(c["set"] == s for c in cases) for s in sets}, "claude_cli": cli,
              "designed_on": "hard v3 (120 per set) and the old held-out set (72 per set) only",
              "state": state(prompts, dict(SETTINGS))}
    FREEZE.write_text(json.dumps(frozen, indent=2) + "\n")
    print(json.dumps({k: v for k, v in frozen.items() if k != "state"}, indent=2))


if __name__ == "__main__":
    main()
