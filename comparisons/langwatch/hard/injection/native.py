#!/usr/bin/env python3
"""Reproduce pinned LangWatch Azure evaluators; no generative surrogate.

Uses only the standard library. Requests, chunking, aggregation and native result
fields match the cited evaluator source. Transport errors are sanitized at the
CLI boundary so endpoints, headers, keys and response bodies are never persisted.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import urllib.error
import urllib.request

SOURCE_COMMIT = "e683dd9ea52c148e7678b1c22202dbfea9f1eb9f"
SOURCE_HASHES = {
    "jailbreak.py": "4674b0229ddbd014e98c17313daeb8af0f11556895de37bf60a490d584e76603",
    "prompt_injection.py": "28fa9576bec1dbbcda15dc6dda976899a7b3d6bc64016b951ef341c465ba4c47",
}
MODES = ("jailbreak", "prompt-shield")
SUFFIX = {
    "jailbreak": "/contentsafety/text:detectJailbreak?api-version=2023-10-15-preview",
    "prompt-shield": "/contentsafety/text:shieldPrompt?api-version=2024-02-15-preview",
}


class NativeResponseError(Exception):
    """Safe error code only; provider response bodies may carry private content."""


def http_post(url, headers, body):
    request = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"),
                                     headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise NativeResponseError(f"azure_http_{error.code}") from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise NativeResponseError("azure_transport_error") from None
    except (ValueError, UnicodeError):
        raise NativeResponseError("azure_invalid_json") from None


def evaluate(text, mode, endpoint, key, contexts=None, post=http_post):
    """Exact pinned chunking. All benchmark cases use contexts=[] because
    the common text-only benchmark cannot silently supply an extra document.
    Optional contexts reproduce the native prompt shield entry for callers.
    """
    if mode not in MODES:
        raise ValueError("unknown_native_mode")
    content = text or ""
    if not content:
        return {"status": "skipped", "details": "Input is empty"}
    headers = {"Content-Type": "application/json", "Ocp-Apim-Subscription-Key": key}
    url = f"{endpoint}{SUFFIX[mode]}"
    detected = False
    prompt_result = False
    document_results_detected = False
    chunks_requested = 0
    if mode == "jailbreak":
        for i in range(0, len(content), 1000):
            result = post(url, headers, {"text": content[i:i + 1000]})
            chunks_requested += 1
            detected = result.get("jailbreakAnalysis", {}).get("detected", False)
            if detected:
                break
        details = "Jailbreak attempt detected" if detected else None
    else:
        contexts = contexts or []
        steps = max(1, math.ceil(len(content) / 10000))
        batch_size = max(1, math.ceil(len(contexts) / steps))
        for i in range(0, len(content), 10000):
            batch_end = min((i // 10000 + 1) * batch_size, len(contexts))
            result = post(url, headers, {
                "userPrompt": content[i:i + 10000],
                "documents": contexts[i // 10000 * batch_size:batch_end],
            })
            chunks_requested += 1
            prompt_result = result.get("userPromptAnalysis", {}).get("attackDetected", False)
            document_results = [doc.get("attackDetected", False)
                                for doc in result.get("documentsAnalysis", [])]
            if any(document_results):
                document_results_detected = True
            if prompt_result or document_results_detected:
                detected = True
                break
        details = None
        if prompt_result and document_results_detected:
            details = "User Prompt Injection attempt and Malicious Contexts detected"
        elif prompt_result:
            details = "User Prompt Injection attempt detected"
        elif document_results_detected:
            details = "Malicious Contexts detected"
    return {"status": "measured", "score": 1 if detected else 0,
            "passed": not detected, "details": details,
            "predicted": bool(detected), "chunks_requested": chunks_requested}


def fingerprint(case):
    # Includes document input for general reproduction while hard.json has none.
    payload = {"text": case["text"], "contexts": case.get("contexts", [])}
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False,
                                    sort_keys=True).encode("utf-8")).hexdigest()


def run(cases, output, modes, environ=os.environ, post=http_post):
    endpoint = environ.get("AZURE_CONTENT_SAFETY_ENDPOINT")
    key = environ.get("AZURE_CONTENT_SAFETY_KEY")
    missing = [name for name in ("AZURE_CONTENT_SAFETY_ENDPOINT", "AZURE_CONTENT_SAFETY_KEY")
               if not environ.get(name)]
    completed = set()
    truncate_at = None
    if output.exists():
        raw = output.read_bytes()
        lines = raw.splitlines(keepends=True)
        offset = 0
        for i, line in enumerate(lines):
            try:
                record = json.loads(line)
            except ValueError:
                # An interrupted final write can be ignored, but not interior corruption.
                if i == len(lines) - 1 and not line.endswith(b"\n"):
                    truncate_at = offset
                    continue
                raise ValueError("invalid_interior_resume_record") from None
            if record.get("status") == "measured" and record.get("source_commit") == SOURCE_COMMIT:
                completed.add((record["id"], record["mode"], record["input_sha256"]))
            offset += len(line)
    counts = {"measured": 0, "unmeasured": 0, "error": 0, "skipped": 0, "resumed": 0}
    output.parent.mkdir(parents=True, exist_ok=True)
    if truncate_at is not None:
        with output.open("r+b") as handle:
            handle.truncate(truncate_at)
    # A complete last record can lack its trailing newline after interruption.
    with output.open("ab") as handle:
        if output.stat().st_size and not output.read_bytes().endswith(b"\n"):
            handle.write(b"\n")
        for case in cases:
            for mode in modes:
                stamp = fingerprint(case)
                if (case["id"], mode, stamp) in completed:
                    counts["resumed"] += 1
                    continue
                record = {"id": case["id"], "kind": case["kind"], "truth": case["truth"],
                          "mode": mode, "source_commit": SOURCE_COMMIT,
                          "input_sha256": stamp}
                if missing:
                    result = {"status": "unmeasured", "reason": "missing_azure_credentials",
                              "missing_env_vars": missing}
                else:
                    try:
                        result = evaluate(case["text"], mode, endpoint, key,
                                          case.get("contexts"), post)
                    except NativeResponseError as error:
                        result = {"status": "error", "reason": str(error)}
                    except Exception:
                        # Never expose transport repr, provider text or authentication state.
                        result = {"status": "error", "reason": "native_evaluation_error"}
                record.update(result)
                counts[result["status"]] += 1
                handle.write((json.dumps(record, ensure_ascii=False) + "\n").encode("utf-8"))
                handle.flush()
                os.fsync(handle.fileno())
    return counts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", type=Path, default=Path(__file__).with_name("hard.json"))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--mode", choices=(*MODES, "both"), default="both")
    args = parser.parse_args()
    cases = json.loads(args.cases.read_text(encoding="utf-8"))
    counts = run(cases, args.output, MODES if args.mode == "both" else (args.mode,))
    print(json.dumps({"native": "azure-content-safety", "counts": counts}, sort_keys=True))
    return 2 if counts["unmeasured"] or counts["error"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
