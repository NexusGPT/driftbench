"""Offline power and no-rebill contract tests. No held-out labels or model calls."""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

import power_run as power
import power_retry as retry
import power_resume as resume


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


class TimeoutAmendment(unittest.TestCase):
    def test_missing_answer_is_not_a_discordant_verdict(self):
        rows = [{"truth": True, "ours": {"prediction": None}, "theirs": {"prediction": True}},
                {"truth": True, "ours": {"prediction": True}, "theirs": {"prediction": False}}]
        result = retry.available_summary(rows)
        self.assertEqual(result["ours"], {"correct": 1, "incorrect": 0, "missing": 1, "timeouts": 0, "observed": 1})
        self.assertEqual(result["paired"]["n"], 1)
        self.assertEqual(result["paired"]["theirs_only_right"], 0)

    def test_success_and_non_timeout_failure_are_never_retried(self):
        for original in [{"result": "valid verdict"}, {"error": "parse failure", "result": ""}]:
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                (root / "prior-request-hashes.json").write_text("[]")
                key = power.lead.call_key("haiku", "system", "user")
                with patch.object(retry, "ROOT", root), patch.object(power.lead, "CALLS", root / "calls.jsonl"):
                    rec = retry.RetryRecorder({key: original}, 1)
                    with patch.object(power.lead.Recorder, "call") as send:
                        if original.get("error"):
                            with self.assertRaisesRegex(ValueError, "parse failure"):
                                rec.call("system", "user")
                        else:
                            self.assertEqual(rec.call("system", "user"), "valid verdict")
                        send.assert_not_called()

    def test_repeated_timeout_gets_no_third_attempt(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "prior-request-hashes.json").write_text("[]")
            key = power.lead.call_key("haiku", "system", "user")
            failure = {"result": "", "error": "Command timed out after 180 seconds"}
            with patch.object(retry, "ROOT", root), patch.object(retry, "RETRY", root), patch.object(power.lead, "CALLS", root / "calls.jsonl"):
                rec = retry.RetryRecorder({key: failure}, 1)
                rec.local.context = {"case": "test"}
                def fail_again(self, system, user):
                    self.records[key] = failure
                    raise ValueError(failure["error"])
                with patch.object(power.lead.Recorder, "call", autospec=True, side_effect=fail_again) as send:
                    for _ in range(2):
                        with self.assertRaisesRegex(ValueError, "timed out"):
                            rec.call("system", "user")
                    self.assertEqual(send.call_count, 1)


class Resume(unittest.TestCase):
    def test_recorded_stage_is_reused_and_only_interrupted_reservation_can_restart(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            recorded = power.lead.call_key("haiku", "system", "recorded")
            interrupted = power.lead.call_key("haiku", "system", "interrupted")
            unexplained = power.lead.call_key("haiku", "system", "unexplained")
            (root / "prior-request-hashes.json").write_text("[]")
            (root / "calls.jsonl").write_text(json.dumps({"request_sha256": recorded, "result": "kept", "charged_usd": .001})+'\n')
            (root / "reservations.jsonl").write_text('\n'.join(json.dumps({"request_sha256": k}) for k in [recorded, interrupted, unexplained]))
            with patch.object(resume, "ROOT", root), patch.object(power.lead, "CALLS", root / "calls.jsonl"):
                rec = resume.ResumeRecorder(1, [interrupted])
                rec.local.context = {"case": "unfinished"}
                with patch.object(power.lead.Recorder, "call", return_value="new answer") as send:
                    self.assertEqual(rec.call("system", "recorded"), "kept")
                    send.assert_not_called()
                    with self.assertRaisesRegex(power.lead.StopRun, "outside owner pause"):
                        rec.call("system", "unexplained")
                    send.assert_not_called()
                    self.assertEqual(rec.call("system", "interrupted"), "new answer")
                    self.assertEqual(send.call_count, 1)
                    with self.assertRaisesRegex(power.lead.StopRun, "outside owner pause"):
                        rec.call("system", "interrupted")
                    self.assertEqual(send.call_count, 1)


if __name__ == "__main__":
    unittest.main()
