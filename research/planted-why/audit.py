"""Read saved evidence, classify every extra-row case, and render the report.

Offline only: standard-library file reads and writes, no model or network calls.
The two displaced requirement IDs below are human annotations of recorded text.
They are diagnostic annotations, not an automatic semantic recovery algorithm.
"""
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
EVIDENCE = HERE / "evidence"


def read(name):
    return json.loads((EVIDENCE / name).read_text())


def parse_record(text):
    text = text.strip()
    if text.startswith("```json") and text.endswith("```"):
        text = text[7:-3].strip()
    return json.loads(text)


manifest = read("manifest.json")
for name, info in manifest["files"].items():
    data = (EVIDENCE / name).read_bytes()
    assert len(data) == info["bytes"]
    assert sha256(data).hexdigest() == info["sha256"], name
for name, digest in manifest["unchangedInputs"].items():
    assert sha256((ROOT / name).read_bytes()).hexdigest() == digest, name

verify = read("verify-decisions.json")
assert len(verify) == len({r["id"] for r in verify}) == 190
assert sum(r["pass"] is True for r in verify if r["id"].endswith("-clean")) == 95
assert sum(r["pass"] is False for r in verify if r["id"].endswith("-defect")) == 95
assert all(r["missing"] == 0 for r in verify)

bank = {x["id"]: x for x in json.loads((ROOT / "research/planted/bank-rb.json").read_text())}
rows = read("rb-decisions.json")
raw = [json.loads(line) for line in (EVIDENCE / "rb-recordings.jsonl").read_text().splitlines()]
records = {r["key"]: (i + 1, r) for i, r in enumerate(raw)}
assert len(bank) == len(rows) == len(raw) == len(records) == 60

names = {4: "All capitals", 5: "No capitals", 6: "No commas", 7: "Exactly four numbers", 8: "Second paragraph starts with it"}
displaced = {"rb-bank-025": 2, "rb-bank-046": 2}
classified = []
first_id_caught = scoped_caught = first_id_clean = scoped_clean = 0
for row in rows:
    item = bank[row["id"]]
    line, record = records[row["key"]]
    assert record["item"] == row["id"]
    parsed = parse_record(record["text"])
    checks = parsed["checks"]
    assert checks == row["checks"]
    assert [c["id"] for c in checks] == list(range(1, len(checks) + 1))
    reverse = sha256(item["clean"].encode()).hexdigest() > sha256(item["defect"].encode()).hexdigest()
    assert row["reversed"] is reverse
    clean_key, defect_key = ("b", "a") if reverse else ("a", "b")
    assert parsed["winner"] == ("B" if reverse else "A")
    assert row["decision"] == "A"
    intended_id = displaced.get(row["id"], 1)
    intended = next(c for c in checks if c["id"] == intended_id)
    first = checks[0]
    first_id_caught += first[defect_key] < 2
    first_id_clean += first[clean_key] == 2
    scoped_caught += intended[defect_key] < 2
    scoped_clean += intended[clean_key] == 2
    if len(checks) == 1:
        assert row["cleanPass"] is True and row["defectCaught"] is True
        continue
    assert row["cleanPass"] is None and row["defectCaught"] is None
    extras = [c for c in checks if c["id"] != intended_id]
    assert all(c["a"] == c["b"] == 2 for c in extras)
    group = "question constraints appended"
    if row["id"] in displaced:
        group = "question constraint prepended; rubric moved to id 2"
    if row["id"] == "rb-bank-036":
        group = "question constraint appended; score contradicts reasoning"
    classified.append({
        "id": row["id"], "sourceTemplate": item["source"]["id"],
        "family": item["family"], "template": names[item["family"]],
        "question": item["question"], "criterion": item["criterion"],
        "clean": item["clean"], "defect": item["defect"],
        "reversed": reverse, "canonicalClean": "B" if reverse else "A",
        "recordingKey": row["key"], "recordingLine": line,
        "cause": group, "intendedRow": intended,
        "cleanScore": intended[clean_key], "defectScore": intended[defect_key],
        "extraRows": extras,
    })

assert len(classified) == 17
assert sum(len(x["extraRows"]) for x in classified) == 22
assert (first_id_clean, first_id_caught) == (60, 57)
assert (scoped_clean, scoped_caught) == (60, 59)
assert Counter(x["cause"] for x in classified) == {
    "question constraints appended": 14,
    "question constraint prepended; rubric moved to id 2": 2,
    "question constraint appended; score contradicts reasoning": 1,
}
summary = {
    "snapshotAt": manifest["capturedAt"], "verifyCleanAccepted": 95,
    "verifyDefectsRejected": 95, "verifyFalseAccepts": 0,
    "rubricPairs": 60, "strictValidPairs": 43, "extraRowPairs": 17,
    "extraRows": 22, "cleanWinnerPairs": 60,
    "familyCounts": dict(Counter(x["template"] for x in classified)),
    "causeCounts": dict(Counter(x["cause"] for x in classified)),
    "retainId1Diagnostic": {"cleanAccepted": 60, "defectsRejected": 57},
    "humanScopedDiagnostic": {"cleanAccepted": 60, "defectsRejected": 59},
    "freshContractCalls": 0,
}
(HERE / "classification.json").write_text(json.dumps({"summary": summary, "items": classified}, indent=2) + "\n")

report = '''# Planted-truth diagnosis: denominator error and RubricBench requirement drift

## Verify correction

The 06:16 Brussels report counted 45 rejected defects over 95 planned defects while the final 50 judgments were pending. It marked those 50 pairs incomplete. The runner judges all clean twins before defective twins; missing outputs therefore looked like missed defects. Saved final decisions reject 95/95 defects and accept 95/95 clean twins. There are no observed verify misses to explain. Fix reporting by separating pending, invalid, false accept, and rejected outcomes, and show both completion and evaluated-only detection rates. The 52.63-point change is completed evidence, not a judge improvement.

## RubricBench result and top fix

All 17 invalid single-requirement outputs import requirements from the question into the rubric ledger. They introduce 22 extra rows. These are invented scoring rows, although their content comes from real question instructions. None is an unrelated preference. Every extra row awards both candidates 2/2, so the additions do not change the recorded clean winner. All 60 pairs choose the clean candidate.

**Top fix: bind checks to a caller-owned requirement list, with stable IDs, and validate against that exact list.** The current benchmark prompt sends an unnumbered rubric string and lets the model assign sequential IDs. Its parser accepts any number of sequential rows. The experiment wrapper then discards both single-requirement grades unless the array has exactly one row.

- Adopt the production criterion-ledger policy: ignore unknown IDs into diagnostics, require each requested ID exactly once, and compute the verdict from known rows.
- Supply the exact requirement definition with its ID. Keep question context outside the scored requirement list. A model-created integer position is not a stable requirement identity.
- Re-ask once when the required ledger is missing, duplicated, malformed, or fails grounding. If unresolved, preserve inconclusive. This is an existing production behavior, not an observed repair of this bank.
- Keep the frozen baseline unchanged. A changed request contract needs fresh recordings; this investigation makes no model calls.

**Recording-supported gain:** human identification of the intended row recovers correct grades in 16/17 affected pairs, changing strict defect detection from 43/60 (71.67%) to 59/60 (98.33%), a 26.67-point opportunity. This is an offline diagnostic upper target for a scope fix, not measured performance of a new prompt. All clean grades become 60/60. Re-ask success is unmeasured.

Blindly keeping `id=1` recovers only 14 affected defect grades: 57/60 (95.00%). In `rb-bank-025` and `rb-bank-046`, the actual rubric is row 2. In `rb-bank-036`, the actual rubric is row 1 but its numeric score contradicts its evidence. Do not silently turn that evidence into a replacement grade.

## Causes, with counts

| Cause | Pairs | Consequence | Existing mechanism and limit |
|---|---:|---|---|
| Extra question checks appended; requested rubric remains row 1 with correct scores | 14 | Strict wrapper rejects useful grades because the ledger is too long | Caller-owned requirement IDs plus unknown-ID diagnostics can retain only the scored rubric. Legacy positions need verified semantic mapping first. |
| Question check prepended; requested rubric displaced to row 2 | 2 | Keeping row 1 would accept the defect | Scope-bound requirement contract; re-ask an invalid or mismatched contract. Unknown-ID filtering alone cannot repair an old misassigned ID. |
| Extra question check plus numeric score contradicting the correct reasoning | 1 | `rb-bank-036` scores defective A as 2, despite saying 0 | An exact no-comma machine check settles this case. A new consistency gate could request repair. The existing ledger schema does not detect score/prose disagreement. |

| Supplied single requirement | Affected pairs | Invented scoring rows | Extra row count |
|---|---:|---|---:|
| All words in capitals | 2 | One fictional chant about the named subject | 2 |
| No capital letters | 4 | One fictional sentence about the named subject | 4 |
| No commas | 4 | One fictional sentence about the named subject | 4 |
| Exactly four numbers | 5 | Fictional inventory; use the word glimmer | 10 |
| Second paragraph starts with it | 2 | Exactly two fictional paragraphs about the named subject | 2 |
| Total | 17 | All imported from question context | 22 |

The recorded text directly supports scope confusion. For example, the judge explicitly labels an added check "Question requirement" in `rb-bank-015` and `rb-bank-054`. The prompt's instruction to choose weights "from the question and rubric" is a plausible contributor, not an isolated causal finding. No prompt ablation was run.

## Which safeguards apply

- **Requirement ledger validation** addresses the 22 additional scoring rows. The production `parseCriterionLedger` already ignores unknown IDs, rejects missing or duplicate requested IDs, validates evidence, and computes outcomes. Its string-ID, `met` contract differs from this benchmark's numeric-ID, `a`/`b` score contract; this is a design to adapt, not a drop-in parser swap.
- **Evidence quote grounding** verifies that quoted text exists. It does not decide whether a genuine question instruction belongs in the authoritative rubric. It also does not repair a wrong numeric grade. These recordings use free-form contrasting prose in `evidence`, not the production literal-quote contract. In `rb-bank-048`, even the quoted paragraph excerpts change the final period to a comma, so wholesale reuse as grounded quotes is unsafe.
- **Machine checks** can directly enforce these literal constraints: character case, comma absence, numeric count under a stated tokenization rule, and the second paragraph's first word. For `rb-bank-036`, the defective text contains a comma and the clean text does not. The existing bank construction audit already verifies that distinction; promoting an independent check into grading is a new scored method. Do not use planted labels as judge evidence.
- **One re-ask** is available in `singleJudgeCheck` for an invalid criterion ledger. The frozen RubricBench path calls its judge once and has no equivalent repair loop. No recording shows what a repair call would return. A schema-valid but semantically wrong grade needs a separate contradiction or machine-check trigger.

## Every affected item

Scores below map canonical A/B back to clean/defect using the saved `reversed` flag, independently checked against the candidate hashes. Each added-row quote is the judge's exact `evidence` text. "Invented" means outside the supplied single rubric, not absent from the question. Every listed added row scores both candidates 2/2.

'''

report += "| Item | Supplied rubric | True rubric row | Clean / defect score | Invented row IDs | Cause |\n|---|---|---:|---|---|---|\n"
for x in classified:
    report += f"| `{x['id']}` | {x['template']} | {x['intendedRow']['id']} | {x['cleanScore']} / {x['defectScore']} | {', '.join(str(c['id']) for c in x['extraRows'])} | {x['cause']} |\n"

for x in classified:
    item_id = x["id"]
    report += f"\n### {item_id}\n\n"
    report += f"- Template: `{x['sourceTemplate']}`. Canonical clean candidate: {x['canonicalClean']}.\n"
    report += f"- Question: {x['question']}\n"
    report += f"- Only supplied requirement: {x['criterion'].split(chr(10), 1)[1]}\n"
    report += f"- Recorded cause: {x['cause']}.\n"
    report += f"- Source: [recording line {x['recordingLine']}](evidence/rb-recordings.jsonl#L{x['recordingLine']}), key `{x['recordingKey']}`.\n"
    for c in x["extraRows"]:
        report += f"\nInvented row {c['id']}, canonical scores A={c['a']}, B={c['b']}:\n\n> {c['evidence']}\n"
    c = x["intendedRow"]
    report += f"\nActual rubric row {c['id']}, canonical scores A={c['a']}, B={c['b']}:\n\n> {c['evidence']}\n"
    if item_id in displaced:
        report += "\nThe added row occupies ID 1. Removing every ID other than 1 would retain the wrong check and discard the real rubric.\n"
    if item_id == "rb-bank-036":
        report += "\nThe evidence says A should score 0, but the structured field is `a: 2`. Both totals tie, so `atomicDecision` falls back to the correctly recorded winner B. Correct winner recovery therefore hides an incorrect per-requirement grade.\n"

report += f'''
## Evidence and reproducibility

- Snapshot: {manifest['capturedAt']}. Source branch: `research/astra-planted-truth`; analysis base: `{manifest['baseCommit']}`.
- [Manifest](evidence/manifest.json) records byte counts and SHA-256 hashes. [Raw RubricBench recordings](evidence/rb-recordings.jsonl), [saved RubricBench decisions](evidence/rb-decisions.json), and [saved verify decisions](evidence/verify-decisions.json) are copied unchanged.
- [Machine-readable classification](classification.json) contains all 17 affected items, all 22 extra rows, exact quotes, canonical mappings, and diagnostic rates.
- Run `python3 research/planted-why/audit.py` from the repository root. It checks snapshot hashes, all 60 raw records against saved rows, canonical order, all 17 annotations, counts, and all 190 verify decisions. It uses no network or model client.
- Frozen banks and judge sources remain unchanged. The original construction proof is retained in [bank-audit.json](evidence/bank-audit.json). That proof and the saved output are evidence; neither is a fresh model evaluation.

Source locations:

| Finding | Source |
|---|---|
| Clean judgments scheduled before defective judgments | [planted runner](../planted/run.ts), `points` construction with `['clean','defect'].flatMap` |
| Missing verify result contributes zero detections to the planned denominator | [summarizer](../planted/summarize.py), `dc=b.get('pass') is False` and `wilson(tpr,len(bank))` |
| Rubric sent as text; model supplies sequential check IDs | [atomic prompt and parser](../../examples/planted-rb/src/rubric-atomic.ts), `atomicPrompt`, `ATOMIC_SYSTEM`, `atomicChecks` |
| Single requirement grades become null if any additional row appears | [planted runner](../planted/run.ts), `checks?.checks.length===1` |
| Numeric score aggregation can defer to model winner on a tie | [atomic decision](../../examples/planted-rb/src/rubric-atomic.ts), `atomicDecision` |
| Caller-owned IDs, unknown-ID diagnostics, missing/duplicate rejection | [criterion ledger](../../packages/judges/src/criterion-ledger.ts), `requirementsFor`, `parseCriterionLedger` |
| One invalid-ledger re-ask, then inconclusive | [single judge](../../packages/judges/src/single.ts), `singleJudgeCheck` |
| Grounding proves text occurrence, not semantic correctness | [evidence code](../../packages/judges/src/evidence.ts), `groundEvidence`; [judge documentation](../../docs/concepts/judges.md), "The request and the answer" |

The 17 cases reuse five template families. The offline recovery counts describe this bank only. They do not establish a generalization gain, a repair-call success rate, or a benchmark-label correction.
'''
assert "\u2013" not in report and "\u2014" not in report
assert report.count("\n### rb-bank-") == 17
for x in classified:
    for c in [x["intendedRow"], *x["extraRows"]]:
        assert f"> {c['evidence']}" in report
(HERE / "astra-planted-why.md").write_text(report)
print(json.dumps(summary, indent=2))
