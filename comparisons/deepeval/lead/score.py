"""Free scoring of the fresh run into fresh-scores.json, the file the README chart reads. No model call.

Scores fresh-retry.json: the fresh run after its 9 timed-out calls were called again with the
frozen settings (replay.py --retry-failures). Pass fresh.json to score the run before the retries.
"""
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / "hard"))
from recordings import records  # noqa: E402

ROWS = {"G-Eval strict": "relevancy", "knowledge retention": "knowledge"}


def main():
    name = sys.argv[1] if len(sys.argv) > 1 else "fresh-retry.json"
    run = json.loads((ROOT / name).read_text())
    freeze = json.loads((ROOT / "fresh-freeze.json").read_text())
    if run.get("stopped") or run["settings"] != freeze["state"]["settings"]:
        raise SystemExit("The fresh run is incomplete or used other settings")
    cost = {r["request_sha256"]: r["charged_usd"] for r in records(ROOT / "calls.jsonl")}
    summary = {s["row"]: s for s in run["summary"]}
    out = []
    for name, set_name in ROWS.items():
        rows = [r for r in run["rows"] if r["row"] == name]
        if len(rows) != freeze["cases"][set_name] or len({r["id"] for r in rows}) != len(rows):
            raise SystemExit(f"{name}: {len(rows)} rows, expected {freeze['cases'][set_name]}")
        s = summary[name]
        keys = {r["ours"]["request_sha256"] for r in rows} | {k for r in rows for k in r["theirs"]["request_sha256s"]}
        out.append({
            "row": name, "n": s["n"], "ours": s["ours"], "theirs": s["theirs"],
            "ours_ci": s["ours_ci"], "theirs_ci": s["theirs_ci"],
            "ours_distinct_inputs": len({r["ours"]["request_sha256"] for r in rows}),
            "theirs_distinct_inputs": len({tuple(r["theirs"]["request_sha256s"]) for r in rows}),
            "ours_only_right": s["ours_only_right"], "theirs_only_right": s["theirs_only_right"],
            "paired_p": s["paired_p"],
            "outcome": "ahead" if s["ours"] > s["theirs"] else "behind" if s["ours"] < s["theirs"] else "equal",
            "ours_unparsed": s["ours_unparsed"], "theirs_unparsed": s["theirs_unparsed"],
            "ours_wrong": s["ours_wrong"], "theirs_wrong": s["theirs_wrong"],
            "cost_usd": sum(cost.get(k, 0) for k in keys),
            "setting": run["settings"][set_name],
            "run": name,
            "corpus": f"fresh, generate.py seed {freeze['seed']}, {freeze['pairs_per_family']} pairs per family",
        })
    # Holm over the two rows reported here.
    order = sorted(range(len(out)), key=lambda i: out[i]["paired_p"])
    running = 0.0
    for rank, i in enumerate(order):
        running = max(running, min(1.0, (len(out) - rank) * out[i]["paired_p"]))
        out[i]["paired_p_holm"] = running
    (ROOT / "fresh-scores.json").write_text(json.dumps(out, indent=1) + "\n")
    print(json.dumps([{k: v for k, v in e.items() if not k.endswith("wrong")} for e in out], indent=1))


if __name__ == "__main__":
    main()
