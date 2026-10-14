"""Offline transport checks: no API credentials or network required."""
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

import power_api as api
import power_api_retry


class Response(io.BytesIO):
    headers = {"request-id": "fixture"}


def response():
    return Response(json.dumps({"model": api.MODEL, "content": [{"type": "text", "text": "{}"}],
        "stop_reason": "end_turn", "usage": {"input_tokens": 100, "output_tokens": 10}}).encode())


class TransportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "api").mkdir()
        (self.root / "prior-request-hashes.json").write_text("[]")
        self.patches = [patch.object(api, "ROOT", self.root), patch.object(api, "API", self.root / "api")]
        for p in self.patches:
            p.start()
        self.rec = api.APIRecorder("parity", credential="fixture")
        self.rec.local.keys = []
        self.rec.local.context = {"case": "fixture", "side": "ours"}

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def test_body_unchanged_and_recorded_request_never_rebilled(self):
        with patch.object(api.urllib.request, "urlopen", return_value=response()) as network:
            self.assertEqual(self.rec.call("system exactly", "user exactly"), "{}")
            self.assertEqual(self.rec.call("system exactly", "user exactly"), "{}")
        self.assertEqual(network.call_count, 1)
        body = json.loads(network.call_args.args[0].data)
        self.assertEqual(body, {"model": api.MODEL, "max_tokens": 32768, "system": "system exactly",
                              "messages": [{"role": "user", "content": "user exactly"}]})
        self.assertAlmostEqual(self.rec.spent, .000015)

    def test_429_and_5xx_retry_identical_body(self):
        def error(code):
            return urllib.error.HTTPError("fixture", code, "fixture", {"retry-after": "0"}, io.BytesIO(b'{}'))
        with patch.object(api.urllib.request, "urlopen", side_effect=[error(429), error(503), response()]) as network, patch.object(api.time, "sleep"):
            self.rec.call("s", "u")
        self.assertEqual(network.call_count, 3)
        self.assertEqual(len({c.args[0].data for c in network.call_args_list}), 1)
        self.assertEqual(len(api.rows(self.rec.path)), 1)

    def test_timeout_never_automatically_reasked(self):
        with patch.object(api.urllib.request, "urlopen", side_effect=TimeoutError("timed out")) as network:
            for _ in range(2):
                with self.assertRaisesRegex(ValueError, "timed out after"):
                    self.rec.call("s", "u")
        self.assertEqual(network.call_count, 1)
        self.assertTrue(api.timeout(api.rows(self.rec.path)[0]))

    def test_success_replayed_and_only_timeout_retry_allowed(self):
        key = api.lead.call_key("haiku", "s", "u")
        self.rec.prior[key] = {"result": "old"}
        with patch.object(api.urllib.request, "urlopen") as network:
            self.assertEqual(self.rec.call("s", "u"), "old")
        network.assert_not_called()
        self.rec.retry_keys = {key}
        self.rec.prior[key] = {"error": "timed out after 180 seconds"}
        with patch.object(api.urllib.request, "urlopen", return_value=response()) as network:
            self.assertEqual(self.rec.call("s", "u"), "{}")
            self.assertEqual(self.rec.call("s", "u"), "{}")
        self.assertEqual(network.call_count, 1)

    def test_auth_failure_halts_instead_of_consuming_corpus(self):
        error = urllib.error.HTTPError("fixture", 401, "fixture", {}, io.BytesIO(b'{}'))
        with patch.object(api.urllib.request, "urlopen", side_effect=error) as network:
            for user in ["one", "two"]:
                with self.assertRaises(api.lead.StopRun):
                    self.rec.call("s", user)
        self.assertEqual(network.call_count, 1)

    def test_usage_price_and_budget_guard(self):
        self.assertAlmostEqual(api.usage_cost({"input_tokens": 100001, "output_tokens": 10}), .0500255)
        self.rec.baseline = 9.96
        with patch.object(api.urllib.request, "urlopen") as network:
            with self.assertRaises(api.lead.StopRun):
                self.rec.call("s", "u")
        network.assert_not_called()

    def test_retry_reuses_successful_parity_for_old_timeout(self):
        key = api.lead.call_key("haiku", "s", "u")
        api.power.dump(self.rec.directory / "unused.json", {})
        self.rec.journal("calls.jsonl", {"request_sha256": key, "case": "power/fixture",
                                         "result": "already answered", "charged_usd": .00001})
        (self.root / "api/retry").mkdir()
        retry = power_api_retry.RetryRecorder("retry", {key: {"error": "timed out after 180 seconds"}}, {key}, credential="fixture")
        retry.local.keys = []
        retry.local.context = {}
        with patch.object(api.urllib.request, "urlopen") as network:
            self.assertEqual(retry.call("s", "u"), "already answered")
        network.assert_not_called()
        self.assertEqual(json.loads((self.root / "api/retry/parity-reused.json").read_text()), [key])


if __name__ == "__main__":
    unittest.main()
