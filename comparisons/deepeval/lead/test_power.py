"""Offline power and no-rebill contract tests. No held-out labels or model calls."""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

import power_run as power


class Power(unittest.TestCase):
    def test_minimum_sample_size(self):
        result = power.calculation()
        self.assertEqual(result["minimum_n"], 1264)
        self.assertLess(result["previous_n_power"], .8)
        self.assertGreaterEqual(result["minimum_n_power"], .8)
        self.assertEqual(result["balanced_n"], 1272)
        self.assertEqual(power.lead.paired_p(5, 0), .0625)
        self.assertEqual(power.lead.paired_p(6, 0), .03125)


class NoRebill(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "prior-request-hashes.json").write_text("[]")
        self.out_patch = patch.object(power, "OUT", self.root)
        self.calls_patch = patch.object(power.lead, "CALLS", self.root / "calls.jsonl")
        self.out_patch.start()
        self.calls_patch.start()

    def tearDown(self):
        self.calls_patch.stop()
        self.out_patch.stop()
        self.tmp.cleanup()

    def test_historical_request_refused_before_call(self):
        key = power.lead.call_key("haiku", "system", "user")
        (self.root / "prior-request-hashes.json").write_text(json.dumps([key]))
        rec = power.OnceRecorder()
        with patch.object(power.lead.Recorder, "call") as send:
            with self.assertRaisesRegex(power.lead.StopRun, "historical"):
                rec.call("system", "user")
            send.assert_not_called()

    def test_shared_stage_sends_once_and_reserves_first(self):
        rec = power.OnceRecorder()
        barrier = threading.Barrier(3)

        def fake_send(self, system, user):
            key = power.lead.call_key("haiku", system, user)
            reservations = [json.loads(r) for r in (self_test.root / "reservations.jsonl").read_text().splitlines()]
            self_test.assertEqual([r["request_sha256"] for r in reservations], [key])
            self.records[key] = {"result": "answer"}
            return "answer"

        def call(i):
            rec.local.context = {"case": str(i)}
            barrier.wait()
            return rec.call("system", "user")

        self_test = self
        with patch.object(power.lead.Recorder, "call", autospec=True, side_effect=fake_send) as send:
            with ThreadPoolExecutor(3) as pool:
                self.assertEqual(list(pool.map(call, range(3))), ["answer"] * 3)
            self.assertEqual(send.call_count, 1)

    def test_recorded_failure_never_retried(self):
        rec = power.OnceRecorder()
        key = power.lead.call_key("haiku", "system", "user")
        rec.records[key] = {"error": "timeout", "result": ""}
        with patch.object(power.lead.Recorder, "call") as send:
            with self.assertRaisesRegex(ValueError, "timeout"):
                rec.call("system", "user")
            send.assert_not_called()

    def test_new_process_refuses_existing_ledger(self):
        row = {"request_sha256": "old", "charged_usd": .001, "result": "answer"}
        (self.root / "calls.jsonl").write_text(json.dumps(row) + "\n")
        with self.assertRaisesRegex(power.lead.StopRun, "already-recorded"):
            power.OnceRecorder()


if __name__ == "__main__":
    unittest.main()
