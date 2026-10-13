"""Runs the competitor's exact-match evaluator on heldout.json.

Pass the checkout of the competitor's repository (the folder that holds services/langevals) and a Python
environment with litellm, tenacity, tqdm and pydantic installed. Run it from outside the repository, because the
package import is shadowed by the working folder:
    python comparisons/langwatch/exact/theirs.py <checkout>
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
root = os.path.join(sys.argv[1], "services", "langevals")
sys.path[:0] = [os.path.join(root, "langevals_core"), os.path.join(root, "evaluators", "langevals")]

from langevals_langevals.exact_match import ExactMatchEntry, ExactMatchEvaluator

items = json.load(open(os.path.join(HERE, "heldout.json")))
evaluator = ExactMatchEvaluator()
out = []
for item in items:
    result = evaluator.evaluate(ExactMatchEntry(output=item["reply"], expected_output=item["reference"]))
    out.append({"id": item["id"], "passed": bool(result.passed)})
json.dump(out, open(os.path.join(HERE, "recorded", "exact-theirs.json"), "w"), indent=1)
print(f"theirs: {len(out)} verdicts recorded")
