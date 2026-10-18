import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import urllib.error
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("injection_native", Path(__file__).with_name("native.py"))
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)


class NativeTests(unittest.TestCase):
    def fake(self, responses):
        calls = []
        def post(url, headers, body):
            calls.append((url, headers, body))
            return responses[len(calls) - 1]
        return post, calls

    def test_jailbreak_shape_chunks_and_early_exit(self):
        post, calls = self.fake([{}, {"jailbreakAnalysis": {"detected": True}}])
        result = native.evaluate("é" * 2501, "jailbreak", "https://resource.example", "dummy", post=post)
        self.assertEqual([len(call[2]["text"]) for call in calls], [1000, 1000])
        self.assertEqual(calls[0][0], "https://resource.example/contentsafety/text:detectJailbreak?api-version=2023-10-15-preview")
        self.assertEqual(calls[0][1], {"Content-Type": "application/json", "Ocp-Apim-Subscription-Key": "dummy"})
        self.assertEqual(result, {"status": "measured", "score": 1, "passed": False,
                                 "details": "Jailbreak attempt detected", "predicted": True, "chunks_requested": 2})

    def test_jailbreak_final_short_chunk_and_default_false(self):
        post, calls = self.fake([{}, {}, {}])
        result = native.evaluate("x" * 2001, "jailbreak", "https://resource.example", "dummy", post=post)
        self.assertEqual([len(call[2]["text"]) for call in calls], [1000, 1000, 1])
        self.assertTrue(result["passed"])
        self.assertEqual(result["score"], 0)

    def test_shield_shape_context_batches_and_early_exit(self):
        post, calls = self.fake([{}, {"userPromptAnalysis": {"attackDetected": True},
                                    "documentsAnalysis": [{"attackDetected": True}]}])
        result = native.evaluate("x" * 20001, "prompt-shield", "https://resource.example", "dummy",
                                 ["a", "b", "c", "d", "e"], post)
        self.assertEqual(calls[0][0], "https://resource.example/contentsafety/text:shieldPrompt?api-version=2024-02-15-preview")
        self.assertEqual([call[2]["documents"] for call in calls], [["a", "b"], ["c", "d"]])
        self.assertEqual([len(call[2]["userPrompt"]) for call in calls], [10000, 10000])
        self.assertEqual(result["details"], "User Prompt Injection attempt and Malicious Contexts detected")
        self.assertFalse(result["passed"])

    def test_shield_empty_documents_and_final_chunk(self):
        post, calls = self.fake([{}, {}, {}])
        result = native.evaluate("x" * 20001, "prompt-shield", "https://resource.example", "dummy", post=post)
        self.assertEqual([call[2]["documents"] for call in calls], [[], [], []])
        self.assertEqual([len(call[2]["userPrompt"]) for call in calls], [10000, 10000, 1])
        self.assertTrue(result["passed"])

    def test_document_only_attack_details(self):
        post, calls = self.fake([{"documentsAnalysis": [{"attackDetected": True}]}])
        result = native.evaluate("hello", "prompt-shield", "https://resource.example", "dummy", ["document"], post)
        self.assertEqual(result["details"], "Malicious Contexts detected")
        self.assertEqual(len(calls), 1)

    def test_empty_input_skips_without_request(self):
        def forbidden(*args):
            self.fail("Empty input made a request")
        for mode in native.MODES:
            self.assertEqual(native.evaluate("", mode, "endpoint", "dummy", post=forbidden),
                             {"status": "skipped", "details": "Input is empty"})

    def test_http_errors_sanitized(self):
        error = urllib.error.HTTPError("https://secret.example/?key=secret", 403, "secret", {}, None)
        with patch.object(native.urllib.request, "urlopen", side_effect=error):
            with self.assertRaisesRegex(native.NativeResponseError, "^azure_http_403$"):
                native.http_post("https://resource.example", {}, {})

    def test_missing_credentials_unmeasured_and_no_requests(self):
        def forbidden(*args):
            self.fail("Missing credentials made a request")
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            output = Path(directory) / "output.jsonl"
            counts = native.run([{"id": "a", "kind": "attack", "truth": True, "text": "attack"}],
                                output, native.MODES, {}, forbidden)
            rows = [json.loads(line) for line in output.read_text().splitlines()]
            self.assertEqual(counts["unmeasured"], 2)
            self.assertTrue(all(row["status"] == "unmeasured" and "score" not in row for row in rows))
            self.assertEqual(rows[0]["reason"], "missing_azure_credentials")

    def test_resume_and_partial_last_write(self):
        cases = [{"id": "a", "kind": "attack", "truth": True, "text": "attack"}]
        env = {"AZURE_CONTENT_SAFETY_ENDPOINT": "https://resource.example", "AZURE_CONTENT_SAFETY_KEY": "dummy-secret"}
        post, calls = self.fake([{}])
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            output = Path(directory) / "output.jsonl"
            native.run(cases, output, ("jailbreak",), env, post)
            with output.open("ab") as handle:
                handle.write(b'{"interrupted":')
            counts = native.run(cases, output, ("jailbreak",), env, post)
            self.assertEqual(counts["resumed"], 1)
            self.assertEqual(len(calls), 1)
            self.assertEqual(len(output.read_text().splitlines()), 1)
            self.assertNotIn("dummy-secret", output.read_text())
            self.assertNotIn("resource.example", output.read_text())
            # Repeating resume again must not turn a partial last write into interior corruption.
            self.assertEqual(native.run(cases, output, ("jailbreak",), env, post)["resumed"], 1)

    def test_errors_are_recorded_without_transport_details(self):
        def failed(*args):
            raise RuntimeError("authorization dummy-secret https://secret.example")
        env = {"AZURE_CONTENT_SAFETY_ENDPOINT": "https://resource.example", "AZURE_CONTENT_SAFETY_KEY": "dummy-secret"}
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            output = Path(directory) / "output.jsonl"
            counts = native.run([{"id": "a", "kind": "attack", "truth": True, "text": "attack"}],
                                output, ("jailbreak",), env, failed)
            self.assertEqual(counts["error"], 1)
            self.assertNotIn("dummy-secret", output.read_text())
            self.assertEqual(json.loads(output.read_text())["reason"], "native_evaluation_error")


if __name__ == "__main__":
    unittest.main()
