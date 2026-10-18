"""Free scoring and recording-integrity checks for the package relevance feature."""
import hashlib
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OLD = ROOT.parent / "deepeval" / "hard"


def read(name):
    return json.loads((ROOT / name).read_text())


def wilson(k, n):
    z = 1.96
    p = k / n
    d = 1 + z * z / n
    center = (p + z * z / (2 * n)) / d
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [center - half, center + half]


def score():
    phases = sys.argv[1:] or ["tuning"]
    assert all(phase in ["tuning", "heldout"] for phase in phases)
    if "heldout" in phases:
        assert (ROOT / "heldout-complete.json").exists(), "Finish the single heldout measurement first"
    calls = [json.loads(line) for line in (ROOT / "calls.jsonl").read_text().splitlines()]
    keyed = {}
    for call in calls:
        text = json.dumps(["haiku", call["system"], call["user"]], ensure_ascii=False, separators=(",", ":"))
        assert hashlib.sha256(text.encode()).hexdigest() == call["requestSha256"]
        assert call["requestSha256"] not in keyed, "Duplicate fresh call"
        keyed[call["requestSha256"]] = call
    spend = sum(call["chargedUsd"] for call in calls)
    assert spend <= 5
    reserved = sum(call["chargedUsd"] for call in calls if "costBasis" in call)
    result = {
        "costUsd": spend,
        "reportedCostUsd": spend - reserved,
        "conservativeReservationsUsd": reserved,
        "invocations": len(calls),
        "invocationErrors": sum("error" in call for call in calls),
        "rows": {},
    }
    for phase, expected in [("tuning", 120), ("heldout", 72)]:
        if phase not in phases:
            continue
        suffix = "v3" if phase == "tuning" else "heldout"
        old = json.loads((OLD / f"baseline-{suffix}.json").read_text())
        audit = json.loads((OLD / f"audit-{suffix}.json").read_text())
        baseline = [row for row in old["rows"] if row["row"] == "G-Eval strict"]
        candidate = [row for row in audit["rows"] if row["row"] == "G-Eval strict"]
        assert len(baseline) == len(candidate) == expected
        prior = {row["id"]: row for row in baseline}
        entry = {
            "cases": expected,
            "frozenShipped": sum(row["ours"]["prediction"] == row["truth"] for row in baseline),
            "frozenCandidate": sum(row["ours"]["prediction"] == row["truth"] for row in candidate),
            "deepeval": sum(row["theirs"]["prediction"] == row["truth"] for row in baseline),
        }
        for mode in ["default", "feature"]:
            path = ROOT / f"{mode}-{phase}.json"
            if not path.exists():
                continue
            measured = json.loads(path.read_text())
            replay_path = ROOT / f"{mode}-{phase}-replay.json"
            assert replay_path.exists(), f"Run free package replay before scoring {mode} {phase}"
            replay = json.loads(replay_path.read_text())
            assert replay["freshCalls"] == 0
            assert replay["rows"] == measured["rows"], "Recorded predictions must equal fresh package parser replay"
            rows = measured["rows"]
            assert len(rows) == expected, f"Incomplete {mode} {phase}"
            assert len({row["id"] for row in rows}) == expected
            assert {row["id"] for row in rows} == set(prior)
            for row in rows:
                assert row["truth"] == prior[row["id"]]["truth"]
                assert row["requestSha256"] in keyed
                assert row["correct"] == (row["prediction"] == row["truth"])
            correct = sum(row["correct"] for row in rows)
            gains = sum(row["correct"] and prior[row["id"]]["theirs"]["prediction"] != row["truth"] for row in rows)
            losses = sum(not row["correct"] and prior[row["id"]]["theirs"]["prediction"] == row["truth"] for row in rows)
            discordant = gains + losses
            p = min(1, 2 * sum(math.comb(discordant, j) for j in range(min(gains, losses) + 1)) / 2 ** discordant) if discordant else 1
            unique = {row["requestSha256"] for row in rows}
            entry[mode] = {
                "correct": correct,
                "distinctInputs": len(unique),
                "nominalWilson95": wilson(correct, expected),
                "unparsed": sum(row["result"].get("unparsed", False) for row in rows),
                "gainsVsDeepEval": gains,
                "lossesVsDeepEval": losses,
                "pairedExactP": p,
                "attributedUsd": sum(keyed[key]["chargedUsd"] for key in unique),
                "misses": [row["id"] for row in rows if not row["correct"]],
            }
        result["rows"][phase] = entry
    (ROOT / "scores.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    score()
