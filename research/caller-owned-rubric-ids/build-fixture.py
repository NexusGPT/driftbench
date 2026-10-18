"""Extract only affected recordings from pinned Git objects. No network or model calls."""
from hashlib import sha256
import json
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
DIAGNOSIS = "628a0c30433d4eaf385f398dbe59aa21a211cae3"
TRUTH = "492fce432e1d34a62c5f5c5586d23026133b390b"
sources = {}


def digest(value):
    return sha256(value.encode() if isinstance(value, str) else value).hexdigest()


def source(name, commit, path):
    spec = f"{commit}:{path}"
    data = subprocess.check_output(["git", "show", spec], cwd=ROOT)
    blob = subprocess.check_output(["git", "rev-parse", spec], cwd=ROOT, text=True).strip()
    sources[name] = {"commit": commit, "path": path, "gitBlob": blob,
                     "sha256": digest(data), "bytes": len(data)}
    return data.decode()


classification = json.loads(source("classification", DIAGNOSIS, "research/planted-why/classification.json"))
report = source("diagnosis", DIAGNOSIS, "research/planted-why/astra-planted-why.md")
bank = json.loads(source("bank", TRUTH, "research/planted/bank-rb.json"))
recordings = source("recordings", TRUTH, "research/planted/results/recordings/bank-rb/haiku.jsonl").splitlines()
decisions = json.loads(source("decisions", TRUTH, "research/planted/results/bank-rb.json"))
bank_by_id = {item["id"]: item for item in bank}
records = {row["key"]: (line, row) for line, row in
           ((i + 1, json.loads(text)) for i, text in enumerate(recordings))}
decisions_by_id = {item["id"]: item for item in decisions}
assert len(bank) == len(records) == len(decisions) == 60
affected = {item["id"] for item in decisions if len(item["checks"]) > 1}
assert affected == {item["id"] for item in classification["items"]}
assert len(affected) == 17
cases = []
for item in classification["items"]:
    bank_item = bank_by_id[item["id"]]
    decision = decisions_by_id[item["id"]]
    line, record = records[item["recordingKey"]]
    raw = record["text"]
    text = raw.strip()
    if text.startswith("```json") and text.endswith("```"):
        text = text[7:-3].strip()
    parsed = json.loads(text)
    assert record["item"] == item["id"] and record["order"] == "canonical"
    assert line == item["recordingLine"] and record["key"] == decision["key"]
    assert parsed["checks"] == decision["checks"]
    assert decision["cleanPass"] is None and decision["defectCaught"] is None
    for field in ["question", "criterion", "clean", "defect"]:
        assert item[field] == bank_item[field]
    reverse = digest(item["clean"]) > digest(item["defect"])
    assert reverse == item["reversed"] == decision["reversed"]
    assert item["canonicalClean"] == ("B" if reverse else "A")
    intended_id = item["intendedRow"]["id"]
    assert intended_id == (2 if item["id"] in {"rb-bank-025", "rb-bank-046"} else 1)
    intended = next(row for row in parsed["checks"] if row["id"] == intended_id)
    assert intended == item["intendedRow"]
    assert [row for row in parsed["checks"] if row["id"] != intended_id] == item["extraRows"]
    assert f"### {item['id']}" in report and intended["evidence"] in report
    cases.append({
        "id": item["id"], "sourceTemplate": item["sourceTemplate"],
        "question": item["question"], "rubric": item["criterion"],
        "stableRubricItemId": f"rubric:{item['sourceTemplate']}",
        "intendedLegacyRowId": intended_id,
        "intendedRowEvidenceSha256": digest(intended["evidence"]),
        "clean": item["clean"], "defect": item["defect"],
        "cleanSha256": digest(item["clean"]), "defectSha256": digest(item["defect"]),
        "canonicalClean": item["canonicalClean"], "reversed": reverse,
        "recordingDigest": record["key"], "recordingLine": line,
        "recordingModelLabel": record["model"], "raw": raw, "rawSha256": digest(raw),
    })
fixture = {"schemaVersion": 1, "sources": sources,
           "mappingBasis": "Explicitly verified intendedRow mapping from the pinned diagnosis; not inferred from numeric row position or scores.",
           "cases": cases}
(HERE / "fixture.json").write_text(json.dumps(fixture, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"cases": len(cases), "rawOutputs": len(cases), "sourceFiles": len(sources)}))
