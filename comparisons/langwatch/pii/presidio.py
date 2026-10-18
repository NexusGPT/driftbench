"""Runs Presidio's analyzer (spaCy en_core_web_sm) on a seeded set and records what it finds, keyed by message hash.

Setup once, in a scratch folder outside the repository:
    python3 -m venv presidio-venv
    presidio-venv/bin/pip install presidio-analyzer spacy
    presidio-venv/bin/python -m spacy download en_core_web_sm

Run from the repository root:
    presidio-venv/bin/python comparisons/langwatch/pii/presidio.py dev
    presidio-venv/bin/python comparisons/langwatch/pii/presidio.py check
"""

import hashlib
import json
import os
import subprocess
import sys

from presidio_analyzer import AnalyzerEngine
from presidio_analyzer.nlp_engine import NlpEngineProvider

HERE = os.path.dirname(os.path.abspath(__file__))
MAP = {"EMAIL_ADDRESS": "email", "PHONE_NUMBER": "phone", "IBAN_CODE": "iban", "PERSON": "person"}


def build_set(name):
    raw = subprocess.run(
        ["node", os.path.join(HERE, "set.mjs"), "--set", name], check=True, capture_output=True, text=True, cwd=os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
    ).stdout
    return json.loads(raw)


name = sys.argv[1] if len(sys.argv) > 1 else "dev"
provider = NlpEngineProvider(
    nlp_configuration={"nlp_engine_name": "spacy", "models": [{"lang_code": "en", "model_name": "en_core_web_sm"}]}
)
engine = AnalyzerEngine(nlp_engine=provider.create_engine())

out = []
occurrence = {}
for item in build_set(name):
    results = engine.analyze(text=item["text"], language="en")
    kinds = sorted({MAP[r.entity_type] for r in results if r.entity_type in MAP})
    digest = hashlib.sha256(item["text"].encode()).hexdigest()
    count = occurrence.get(digest, 0)
    occurrence[digest] = count + 1
    key = digest if count == 0 else f"{digest}-{count}"
    out.append({"hash": key, "found": kinds})

os.makedirs(os.path.join(HERE, "recorded"), exist_ok=True)
with open(os.path.join(HERE, "recorded", f"presidio-{name}.json"), "w") as f:
    json.dump({"set": name, "answers": out}, f, indent=1)
print(f"presidio {name}: {len(out)} messages scored")
