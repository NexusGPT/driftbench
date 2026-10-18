#!/usr/bin/env python3
"""Run the pinned LangWatch evaluator itself, without changing its defaults."""
import argparse
import hashlib
import importlib
import importlib.metadata
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

HERE = Path(__file__).resolve().parent
PIN = "e683dd9ea52c148e7678b1c22202dbfea9f1eb9f"
EVALUATOR_REL = "services/langevals/evaluators/presidio/langevals_presidio/pii_detection.py"


def summarize(cases, results):
    by_id = {r["id"]: r for r in results}
    def score(selected):
        scored = [(c, by_id[c["id"]]) for c in selected]
        usable = [(c, r) for c, r in scored if isinstance(r["prediction"], bool)]
        return {
            "total": len(scored), "processed": len(usable),
            "correct": sum(r["prediction"] == c["truth"] for c, r in usable),
            "true_positive": sum(r["prediction"] and c["truth"] for c, r in usable),
            "false_positive": sum(r["prediction"] and not c["truth"] for c, r in usable),
            "true_negative": sum(not r["prediction"] and not c["truth"] for c, r in usable),
            "false_negative": sum(not r["prediction"] and c["truth"] for c, r in usable),
        }
    return {
        "full_pii": score(cases),
        "default_scope_subset": score([c for c in cases if not c["truth"] or c.get("identifier")]),
        "by_family": {kind: score([c for c in cases if c["kind"] == kind]) for kind in sorted({c["kind"] for c in cases})},
        "positive_subgroups": {flag: score([c for c in cases if c.get(flag)]) for flag in ["person", "address", "identifier"]},
        "identifier_types": {kind: score([c for c in cases if c.get("identifierType") == kind]) for kind in ["email", "phone", "ip", "iban"]},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkout", type=Path, required=True)
    parser.add_argument("--cases", type=Path, default=HERE / "hard.json")
    parser.add_argument("--output", type=Path, default=HERE / "native-results.json")
    args = parser.parse_args()
    output = args.output.resolve()
    if not output.is_relative_to(HERE):
        parser.error("Output must remain inside the adapter directory")
    checkout = args.checkout.resolve()
    revision = subprocess.check_output(["git", "-C", str(checkout), "rev-parse", "HEAD"], text=True).strip()
    if revision != PIN:
        parser.error(f"Expected pinned checkout {PIN}, got {revision}")
    source = checkout / EVALUATOR_REL
    committed = subprocess.check_output(["git", "-C", str(checkout), "show", f"{PIN}:{EVALUATOR_REL}"])
    if source.read_bytes() != committed:
        parser.error("Evaluator source differs from the pinned revision")

    # Imported source creates temporary DSP caches. Keep those and all optional
    # library caches in this directory, and prevent bytecode in the checkout.
    runtime = HERE / ".runtime"
    cache = runtime / "cache"
    cache.mkdir(parents=True, exist_ok=True)
    sys.dont_write_bytecode = True
    tempfile.tempdir = str(cache)
    for key in ["TMPDIR", "XDG_CACHE_HOME", "HF_HOME", "HUGGINGFACE_HUB_CACHE", "TRANSFORMERS_CACHE"]:
        os.environ[key] = str(cache)
    sys.path.insert(0, str(runtime / "site-packages"))
    sys.path.insert(0, str(checkout / "services/langevals/langevals_core"))
    sys.path.insert(0, str(checkout / "services/langevals/evaluators/presidio"))
    versions = {package: importlib.metadata.version(package) for package in ["spacy", "en-core-web-lg", "presidio-analyzer", "presidio-anonymizer", "pydantic", "litellm"]}
    if versions["spacy"] != "3.7.5" or versions["en-core-web-lg"] != "3.7.1":
        parser.error("Install the source-declared spaCy 3.7.5 and en_core_web_lg 3.7.1 before running")
    # Prove the model is an installed package before preload can fall back to
    # creating .cache in the source checkout. This does not alter evaluator code.
    importlib.import_module("en_core_web_lg")
    from langevals_presidio.pii_detection import PresidioPIIDetectionEvaluator, PresidioPIIDetectionEntry
    evaluator = PresidioPIIDetectionEvaluator()
    settings = evaluator.settings.model_dump()
    assert settings == PresidioPIIDetectionEvaluator.default_settings.model_dump()
    assert settings["entities"]["person"] is False
    assert settings["entities"]["location"] is False
    cases_bytes = args.cases.read_bytes()
    cases = json.loads(cases_bytes)
    results = []
    for case in cases:
        try:
            # Only fixture text enters the evaluator. Truth and subtype flags
            # are used by this recorder after the native result returns.
            result = evaluator.evaluate(PresidioPIIDetectionEntry(input=case["text"])).model_dump(mode="json")
            prediction = not result["passed"] if isinstance(result.get("passed"), bool) else None
            results.append({"id": case["id"], "prediction": prediction, "result": result})
        except Exception as error:
            results.append({"id": case["id"], "prediction": None, "result": {"status": "error", "error_type": type(error).__name__, "details": str(error)}})
    evidence = {
        "status": "measured", "measured_at": datetime.now(timezone.utc).isoformat(),
        "native_evaluator": "langevals_presidio.pii_detection.PresidioPIIDetectionEvaluator",
        "source_revision": revision, "source_path": EVALUATOR_REL,
        "source_sha256": hashlib.sha256(committed).hexdigest(),
        "dataset_sha256": hashlib.sha256(cases_bytes).hexdigest(),
        "python": sys.version.split()[0], "versions": versions,
        "settings": settings, "model": "en_core_web_lg", "language": "en",
        "model_cost_usd": 0,
        "scope_note": "Full PII truth includes private names and home addresses. Native default PERSON and LOCATION are false; those subgroup misses reflect scope, not measured enabled recognizer quality.",
        "summary": summarize(cases, results), "results": results,
    }
    output.write_text(json.dumps(evidence, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({"output": str(output), "summary": evidence["summary"]}, indent=2))
    if any(r["prediction"] is None for r in results):
        raise SystemExit("At least one native case did not produce a Boolean verdict")


if __name__ == "__main__":
    main()
