"""Offline failure and replay checks. No provider calls."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

source = Path(__file__).resolve().parents[1] / 'src/rubric-ledger-supervisor.py'
spec = importlib.util.spec_from_file_location('supervisor', source)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=mod.BASE, prefix='supervisor-selftest-')
        self.root = Path(self.temp.name)
        self.patches = [patch.object(mod, 'ROOT', self.root),
                        patch.object(mod, 'BASE', self.root),
                        patch.object(mod, 'STATE', self.root / 'state.json')]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()
        self.temp.cleanup()

    def test_reconcile_only_unfinished_and_retain_hold(self):
        folder = self.root / 'model/live'
        folder.mkdir(parents=True)
        starts = [{'key': key, 'reserveUsd': .25,
                   'identity': {'item': key, 'contestant': 'pair-ledger'}}
                  for key in ['answered', 'unfinished']]
        (folder / 'starts-000.jsonl').write_text(''.join(json.dumps(r) + '\n' for r in starts))
        original = json.dumps({'key': 'answered', 'text': 'saved answer', 'status': 'ok'}) + '\n'
        (folder / 'calls-000.jsonl').write_text(original)
        self.assertEqual(mod.recover_missing('model'), 1)
        self.assertEqual(mod.recover_missing('model'), 0)
        self.assertTrue((folder / 'calls-000.jsonl').read_text().startswith(original))
        row = mod.rows(folder, 'calls')[-1]
        self.assertEqual((row['costUsd'], row['costBasis'], row['text']), (.25, 'reservation', ''))
        self.assertTrue(row['retryable'])
        self.assertIn('actual termination time unknown', row['completionTimestampKind'])
        self.assertTrue(row['completedAt'])

    def test_latest_answer_replaces_transport_missing(self):
        folder = self.root / 'model'
        folder.mkdir()
        rows = [dict(model='model', phase='test', id='1', contestant='pair-ledger', sample=0, status=s)
                for s in ['transport-error', 'decided']]
        (folder / 'decisions-test-000.jsonl').write_text(''.join(json.dumps(r) + '\n' for r in rows))
        self.assertEqual(mod.completed_decisions('model', 'test'), 1)

    def test_failed_child_waits_and_retries_without_exiting(self):
        supervisor = mod.Supervisor()
        supervisor.event = Mock()
        supervisor.sleep = Mock()
        supervisor.honor_pause = Mock()
        children = [Mock(pid=123, returncode=2), Mock(pid=124, returncode=0)]
        for child in children:
            child.poll.return_value = child.returncode
        with patch.object(mod.subprocess, 'Popen', side_effect=children) as launch, \
             patch.object(mod, 'group_members', return_value=[]):
            supervisor.run('model', 'sol', 'offline', ['dummy'])
        self.assertEqual(launch.call_count, 2)
        self.assertEqual(supervisor.sleep.call_args.args[0], 600)
        self.assertTrue(launch.call_args.kwargs['start_new_session'])

    def test_success_exit_with_missing_decisions_does_not_advance(self):
        supervisor = mod.Supervisor()
        supervisor.event = Mock()
        supervisor.sleep = Mock()
        supervisor.honor_pause = Mock()
        child = Mock(pid=123, returncode=0)
        child.poll.return_value = 0
        with patch.object(mod.subprocess, 'Popen', return_value=child) as launch, \
             patch.object(mod, 'group_members', return_value=[]), \
             patch.object(mod, 'recover_missing', return_value=0), \
             patch.object(mod, 'completed_decisions', side_effect=[0, 39, 40]):
            supervisor.run('model', 'sol', 'pilot', ['dummy'], paid=True)
        self.assertEqual(launch.call_count, 1)
        self.assertEqual(supervisor.sleep.call_args.args[0], 600)

    def test_gate_failure_waits_until_gate_recovers(self):
        supervisor = mod.Supervisor()
        supervisor.event = Mock()
        supervisor.sleep = Mock()
        supervisor.honor_pause = Mock()
        action = Mock(side_effect=[RuntimeError('connection unavailable'), 'recovered'])
        self.assertEqual(supervisor.checked('model', 'sol', 'gate', action), 'recovered')
        self.assertEqual(action.call_count, 2)
        self.assertEqual(supervisor.sleep.call_args.args[0], 600)


if __name__ == '__main__':
    unittest.main()
