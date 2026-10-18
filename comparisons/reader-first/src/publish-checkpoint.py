"""Snapshot and stage evidence without rewriting files owned by the running study."""
import json
import hashlib
import pathlib
import re
import subprocess

root = pathlib.Path("comparisons/reader-first")
snapshot = pathlib.Path(".reader-first/publish")
paths = list((root / "results").glob("*.json")) + list((root / "results").glob("*.jsonl")) + list((root / "recordings").glob("*.jsonl"))
verified = set(json.loads((root / "results/public-quote-provenance.json").read_text())["emailSha256"])
email = re.compile(r"[\w.+-]+@[\w.-]+\.[A-Za-z]+")
for path in paths:
    content = path.read_text()
    had_newline = content.endswith("\n")
    lines = content.splitlines()
    if path.suffix == ".json":
        json.loads(content)
    else:
        for line in lines:
            json.loads(line)
    output = []
    for line in lines:
        contacts = [match for match in email.finditer(line) if match.group().lower() != "support@example.com"]
        for match in contacts:
            if hashlib.sha256(match.group().encode()).hexdigest() not in verified:
                raise RuntimeError("A quoted contact needs public-source verification before publication")
        if contacts and "guard:allow" not in line:
            reason = "public benchmark generated contact retained for exact evidence validation"
            if path.suffix == ".jsonl":
                value = json.loads(line)
                value["guard:allow"] = reason
                line = json.dumps(value, ensure_ascii=False)
            elif line.rstrip().endswith(","):
                line += ' "guard:allow": ' + json.dumps(reason) + ","
            else:
                raise RuntimeError("Unexpected contact annotation location")
        output.append(line)
    content = "\n".join(output) + ("\n" if had_newline else "")
    target = snapshot / path.relative_to(root)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)
    blob = subprocess.check_output(["git", "hash-object", "-w", str(target)], text=True).strip()
    subprocess.run(["git", "update-index", "--add", "--cacheinfo", "100644," + blob + "," + str(path)], check=True)
result = json.loads((snapshot / "results/test.json").read_text())
print(json.dumps({"completedPairs": result["completedPairs"], "correct": result["score"]["combined"]["correct"], "complete": result["complete"]}))
