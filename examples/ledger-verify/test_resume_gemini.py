"""Offline checks for reset timing and preservation of returned Gemini answers."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import resume_gemini as driver


class ResetRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.amendment = dict(automaticResumeNotBefore='2026-10-14T00:00:00Z', completionDeadline='2026-10-14T12:00:00Z')

    def test_no_early_or_late_calls(self):
        start = driver.timestamp(self.amendment['automaticResumeNotBefore'])
        end = driver.timestamp(self.amendment['completionDeadline'])
        self.assertEqual(driver.window(self.amendment, start - .001), 'waiting for authorized reset')
        self.assertEqual(driver.window(self.amendment, start), 'eligible')
        self.assertEqual(driver.window(self.amendment, end - .001), 'eligible')
        self.assertEqual(driver.window(self.amendment, end), 'completion deadline reached')

    def test_recovery_preserves_answer_bytes_and_partial_report(self):
        with tempfile.TemporaryDirectory(dir=driver.ROOT / '.tmp') as name:
            base = Path(name)
            phase = base / 'noise-2'
            phase.mkdir()
            report = phase / f'{driver.MODEL}.json'
            report.write_text(json.dumps(dict(stopped='Transport quota: HTTP 429')))
            archive = phase / 'partial.json'
            archive.write_bytes(report.read_bytes())
            recording = base / 'recordings/frozen/noise-2/longjudge-verify' / f'{driver.MODEL}.jsonl'
            recording.parent.mkdir(parents=True)
            answer = b'{"key":"already-answered","text":"keep exactly"}\n'
            recording.write_bytes(answer)
            (phase / f'{driver.MODEL}.started.json').write_text('{}')
            amendment = dict(stoppedReport='noise-2/partial.json', cassetteSha256=driver.hashlib.sha256(answer).hexdigest())
            with patch.object(driver, 'BASE', base):
                flags = driver.prepare_phase('noise-2', amendment, dict(recordingsId='frozen'))
            self.assertEqual(flags, ['--noise', '2', '--resume-interrupted'])
            self.assertEqual(recording.read_bytes(), answer)
            self.assertTrue(archive.exists())
            self.assertFalse(report.exists())

    def test_answered_phase_is_never_repeated(self):
        with tempfile.TemporaryDirectory(dir=driver.ROOT / '.tmp') as name:
            base = Path(name)
            (base / 'results').mkdir()
            (base / 'results' / f'{driver.MODEL}.json').write_text('{}')
            with patch.object(driver, 'BASE', base):
                self.assertIsNone(driver.prepare_phase('results', {}, {}))

    def test_nonquota_stop_cannot_be_reopened(self):
        with tempfile.TemporaryDirectory(dir=driver.ROOT / '.tmp') as name:
            base = Path(name)
            (base / 'noise-2').mkdir()
            path = base / 'noise-2' / f'{driver.MODEL}.json'
            path.write_text(json.dumps(dict(stopped='Transport missing: returned error')))
            before = path.read_bytes()
            with patch.object(driver, 'BASE', base), self.assertRaises(AssertionError):
                driver.prepare_phase('noise-2', {}, {})
            self.assertEqual(path.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
