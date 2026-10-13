"""Matching fictional tool receipts, constructed without reading truth labels."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def augment(case):
    result = deepcopy(case)
    request = "\n".join(m["content"] for m in case["turns"] if m["role"] == "user")
    result["tool_receipts"] = [{"name": "acme.task_receipt",
                                "input_parameters": {"request": request},
                                "output": {"result": case["turns"][-1]["content"]}}]
    return result


if __name__ == "__main__":
    for suffix in ["", "-heldout"]:
        original = json.loads((ROOT/f"sets{suffix}.json").read_text())
        text = json.dumps({"task": [augment(c) for c in original["task"]]},ensure_ascii=False,indent=2)+"\n"
        path = ROOT/f"sets-receipts{suffix}.json"
        path.write_text(text)
        print(path.name,hashlib.sha256(text.encode()).hexdigest())
