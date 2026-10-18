"""Records the reference implementation's ROUGE-L and BLEU (the ragas library) on heldout.json.

Run with an environment that has ragas 0.4 installed, from the repository root:
    <env>/bin/python comparisons/langwatch/overlap/theirs.py
"""

import json
import os

from ragas import SingleTurnSample
from ragas.metrics import BleuScore, RougeScore

HERE = os.path.dirname(os.path.abspath(__file__))
items = json.load(open(os.path.join(HERE, "heldout.json")))
rouge = RougeScore(rouge_type="rougeL", mode="fmeasure")
bleu = BleuScore()
out = []
for item in items:
    sample = SingleTurnSample(response=item["reply"], reference=item["reference"])
    out.append({"id": item["id"], "rougeL": float(rouge.single_turn_score(sample)), "bleu": float(bleu.single_turn_score(sample))})
json.dump(out, open(os.path.join(HERE, "recorded", "overlap-theirs.json"), "w"), indent=1)
print(f"theirs: {len(out)} pairs recorded")
