"""Offline request comparison. Reads recordings only; makes no model calls."""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path("examples/judge-benchmarks/experiments/ledger-rb")


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def blocked(call):
    return (call["status"] == "ok" and not call["text"].strip()
            and bool(call.get("completion", {}).get("refusal")))


def candidates(request, contestant):
    if contestant == "promptfoo":
        patterns = [rf'<Text index="{i}">\n(.*?)\n</Text>' for i in [0, 1]]
        text = request["system"]
    else:
        patterns = [rf'<{tag}>\n(.*?)\n</{tag}>' for tag in ["first_data", "second_data"]]
        text = request["user"]
    found = [re.search(pattern, text, re.S) for pattern in patterns]
    return [match.group(1) for match in found] if all(found) else None


def describe(call):
    request = call["identity"]["request"]
    peer = call["contestant"] == "promptfoo"
    schema = request.get("schema")
    pair = candidates(request, call["contestant"])
    return {
        "key": call["key"], "phase": call["identity"]["phase"],
        "sample": call["identity"]["sample"], "ordinal": call["identity"]["ordinal"],
        "hasModelAnswer": call["status"] == "ok" and bool(call["text"].strip()),
        "providerBlocked": blocked(call), "httpStatus": call.get("httpStatus"),
        "systemSha256": digest(request["system"]), "systemChars": len(request["system"]),
        "userSha256": digest(request["user"]), "userChars": len(request["user"]),
        "candidateRole": "system" if peer else "user",
        "candidateTags": ['Text index="0"', 'Text index="1"'] if peer else ["first_data", "second_data"],
        "candidateChars": [len(value) for value in pair] if pair else None,
        "candidateSha256": [digest(value) for value in pair] if pair else None,
        "schemaPresent": schema is not None,
        "schemaSha256": digest(json.dumps(schema, sort_keys=True)) if schema else None,
        "schema": schema,
    }


def main():
    calls = [json.loads(line) for path in sorted((ROOT / "live").glob("calls-*.jsonl"))
             for line in path.read_text().splitlines()]
    rows = []
    systems = {}
    for call in calls:
        if call["contestant"] not in ["pair-ledger", "seat"] or not blocked(call):
            continue
        own = describe(call)
        pair = candidates(call["identity"]["request"], call["contestant"])
        peers = [peer for peer in calls if pair is not None and peer["contestant"] == "promptfoo"
                 and peer["model"] == call["model"] and peer["item"] == call["item"]
                 and candidates(peer["identity"]["request"], "promptfoo") == pair]
        # Match the same phase when available; the owner-authorized DEV probe is the fallback.
        same_phase = [peer for peer in peers if peer["identity"]["phase"] == call["identity"]["phase"]]
        peers = same_phase or [peer for peer in peers if peer["identity"]["phase"] == "provider-probe"]
        answered = [peer for peer in peers if peer["status"] == "ok" and peer["text"].strip() and not blocked(peer)]
        systems[own["systemSha256"]] = call["identity"]["request"]["system"]
        rows.append({"model": call["model"], "item": call["item"],
                     "blockReason": call["completion"]["refusal"], "ours": own,
                     "unblockedPromptfoo": [describe(peer) for peer in answered],
                     "otherPromptfoo": [describe(peer) for peer in peers if peer not in answered],
                     "sameCandidateTextAndOrder": pair is not None and bool(answered),
                     "interpretation": "Observed request differences only. No causal attribution without a controlled follow-up."})
    result = {"scope": "All recorded ledger and seat provider-content blocks, including DEV and TEST. HTTP 402 and 429 are excluded.",
              "method": "Exact candidate text and order match; same phase preferred, authorized DEV provider probe otherwise. No calls.",
              "blockedRequests": len(rows), "ourSystemTextsBySha256": systems, "rows": rows}
    (ROOT / "provider-block-request-audit.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"blockedRequests": len(rows),
                      "withUnblockedPeer": sum(bool(row["unblockedPromptfoo"]) for row in rows)}))


if __name__ == "__main__":
    main()
