#!/usr/bin/env python3
"""Execute pinned evaluate methods with fake HTTP and compare this adapter.

No source imports, dependency installs, credentials or network requests are used.
The method AST is extracted unchanged from the supplied source checkout.
"""
import argparse
import ast
import hashlib
import importlib.util
import math
from pathlib import Path
import types

spec = importlib.util.spec_from_file_location("injection_native", Path(__file__).with_name("native.py"))
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)


def source_method(checkout, mode, replies):
    name = "jailbreak.py" if mode == "jailbreak" else "prompt_injection.py"
    path = checkout / "services/langevals/evaluators/azure/langevals_azure" / name
    raw = path.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == native.SOURCE_HASHES[name], "Source does not match pinned hash"
    tree = ast.parse(raw)
    evaluator = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name.endswith("Evaluator"))
    method = next(node for node in evaluator.body if isinstance(node, ast.FunctionDef) and node.name == "evaluate")
    # Only remove runtime annotation evaluation. The executable body is unchanged.
    method.returns = None
    for argument in method.args.args:
        argument.annotation = None
    calls = []
    class Client:
        def __enter__(self):
            return self
        def __exit__(self, *args):
            return False
        def post(self, url, headers, json):
            calls.append((url, headers, json))
            reply = replies[len(calls) - 1]
            return types.SimpleNamespace(is_error=False, json=lambda: reply)
    namespace = {"Client": Client, "Response": object, "math": math,
                 "AzureJailbreakResult": lambda **kwargs: kwargs,
                 "AzurePromptShieldResult": lambda **kwargs: kwargs,
                 "EvaluationResultSkipped": lambda **kwargs: {"status": "skipped", **kwargs}}
    exec(compile(ast.Module(body=[method], type_ignores=[]), str(path), "exec"), namespace)
    return namespace["evaluate"], calls


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkout", type=Path, required=True)
    args = parser.parse_args()
    tests = 0
    endpoint, key = "https://fixture.example", "fictional-key"
    fake_self = types.SimpleNamespace(get_env=lambda name: endpoint if name.endswith("ENDPOINT") else key)
    for mode in native.MODES:
        for length in (0, 1, 999, 1000, 1001, 9999, 10000, 10001, 20001):
            for detection in ("none", "prompt", "document", "both"):
                if mode == "jailbreak" and detection in ("document", "both"):
                    continue
                reply = ({"jailbreakAnalysis": {"detected": detection == "prompt"}} if mode == "jailbreak" else
                         {"userPromptAnalysis": {"attackDetected": detection in ("prompt", "both")},
                          "documentsAnalysis": [{"attackDetected": detection in ("document", "both")}]})
                replies = [reply] * 30
                method, source_calls = source_method(args.checkout, mode, replies)
                text = "é" * length
                contexts = ["document-a", "document-b", "document-c", "document-d", "document-e"]
                expected = method(fake_self, types.SimpleNamespace(input=text, contexts=contexts))
                actual_calls = []
                def post(url, headers, body):
                    actual_calls.append((url, headers, body))
                    return replies[len(actual_calls) - 1]
                actual = native.evaluate(text, mode, endpoint, key, contexts, post)
                assert actual_calls == source_calls, (mode, length, detection, "request mismatch")
                assert all(actual.get(field) == value for field, value in expected.items()), (mode, length, detection, "result mismatch")
                tests += 1
    print(f"Pinned-source parity passed for {tests} fake-response scenarios; zero network requests.")


if __name__ == "__main__":
    main()
