"""Published comparison commands, offline and unchanged on a fresh checkout."""
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class ComparisonReproduction(unittest.TestCase):
    def command(self, *args, cwd=ROOT):
        result = subprocess.run(args, cwd=cwd, capture_output=True, text=True,
                                env={**os.environ, 'CLAUDE_BIN': '/model-calls-forbidden'},
                                timeout=120)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result.stdout

    def assert_unchanged(self, folder, before):
        after = self.snapshot(folder)
        self.assertEqual(set(after), set(before))
        for path in before:
            self.assertEqual(after[path], before[path], str(path))

    def snapshot(self, folder):
        # Include committed artifacts and newly added source, excluding runtime data.
        return {p: (hashlib.sha256(p.read_bytes()).hexdigest(), p.stat().st_mtime_ns)
                for p in folder.rglob('*') if p.is_file()
                and not {'runtime', '.runtime', '__pycache__'} & set(p.parts)
                and p.suffix != '.lock'}

    def test_deepeval_score_preserves_published_bytes_and_mtimes(self):
        folder = ROOT / 'comparisons/deepeval/hard'
        before = self.snapshot(folder)
        self.command(sys.executable, str(folder / 'score.py'), str(folder / 'baseline-v3.json'),
                     '--output', str(folder / 'baseline-v3-scores.json'))
        self.assert_unchanged(folder, before)
        # No-op protection must still allow a genuinely stale audit body to be rebuilt.
        with tempfile.TemporaryDirectory() as temp:
            recording = Path(temp) / 'baseline-v3.json'
            audit = Path(temp) / 'losses-baseline-v3.md'
            shutil.copyfile(folder / recording.name, recording)
            expected = (folder / audit.name).read_bytes()
            audit.write_bytes(expected + b'\nSTALE AUDIT BODY\n')
            self.command(sys.executable, str(folder / 'score.py'), str(recording))
            self.assertEqual(audit.read_bytes(), expected)

    def test_promptfoo_verify_uses_pinned_judge_and_preserves_published_results(self):
        folder = ROOT / 'comparisons/promptfoo/hard'
        before = self.snapshot(folder)
        output = self.command(sys.executable, str(folder / 'verify.py'))
        self.assertIn('c07c705cbd0275ec2c59ca8119fab09a539179e5', output)
        self.assertIn('2496 case/procedure decisions verified', output)
        self.command(sys.executable, str(folder / 'score.py'))
        self.assert_unchanged(folder, before)

    def test_langfuse_pr115_freeze_and_replay_use_recorded_judge(self):
        folder = ROOT / 'comparisons/langfuse/hard'
        before = self.snapshot(folder)
        self.command(sys.executable, '-m', 'unittest', 'discover', '-s', str(folder),
                     '-p', 'test_pr115.py')
        self.command('node', '--import', 'tsx', str(folder / 'pr115.mts'), 'render')
        output = self.command(sys.executable, str(folder / 'pr115-run.py'), '--cap-usd', '0')
        self.assertIn('8195902dd20c84267f85feba268c17868e00dfbe', output)
        self.assertIn('"fresh_calls": 0', output)
        self.assert_unchanged(folder, before)

    def test_default_on_readme_v7_analysis_replays_recorded_pairs(self):
        folder = ROOT / 'comparisons/default-on/readme-v7'
        before = self.snapshot(folder)
        self.command(sys.executable, '-m', 'unittest', 'discover', '-s', str(folder), '-p', 'test_analyze.py')
        self.assert_unchanged(folder, before)

    def test_promptfoo_python_tests_set_up_missing_runtime(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp) / 'hard'
            shutil.copytree(ROOT / 'comparisons/promptfoo/hard', folder,
                            ignore=shutil.ignore_patterns('runtime', '__pycache__', '*.lock'))
            self.assertFalse((folder / 'runtime').exists())
            self.command(sys.executable, '-m', 'unittest', 'discover', '-s', str(folder),
                         '-p', 'test_hard.py')
            self.assertTrue((folder / 'runtime').is_dir())


if __name__ == '__main__':
    unittest.main()
