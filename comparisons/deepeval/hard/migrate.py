"""Rename recording-hash metadata without modifying prompts or raw answers."""
import json
from pathlib import Path


def migrate(root):
    changed = []
    from recordings import paths
    for calls in paths(root/"calls.jsonl"):
        rows = [json.loads(line) for line in calls.read_text().splitlines()]
        count = 0
        for row in rows:
            if "key" in row:
                digest = row.pop("key")
                if "request_sha256" in row and row["request_sha256"] != digest:
                    raise ValueError("Conflicting request digest")
                row["request_sha256"] = digest
                count += 1
        if count:
            temporary = calls.with_suffix(".jsonl.tmp")
            temporary.write_text("".join(json.dumps(row,ensure_ascii=False)+"\n" for row in rows))
            temporary.replace(calls)
            changed.append((calls.name,count))
    for path in root.glob("*.json"):
        value = json.loads(path.read_text())
        if not isinstance(value,dict) or not isinstance(value.get("rows"),list):
            continue
        count = 0
        for row in value["rows"]:
            for side in ["ours","theirs"]:
                result = row.get(side,{})
                if "keys" in result:
                    result["request_sha256s"] = result.pop("keys")
                    count += 1
        if count:
            temporary = path.with_suffix(".tmp")
            temporary.write_text(json.dumps(value,ensure_ascii=False,indent=2)+"\n")
            temporary.replace(path)
            changed.append((path.name,count))
    return changed


if __name__ == "__main__":
    import fcntl
    root = Path(__file__).resolve().parent
    with (root/".run.lock").open("a") as lock:
        fcntl.flock(lock,fcntl.LOCK_EX | fcntl.LOCK_NB)
        print(migrate(root))
