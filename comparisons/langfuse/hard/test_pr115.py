"""Spend and freeze gates for the default-contract follow-up; no model calls."""
import datetime
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('pr115_run', Path(__file__).with_name('pr115-run.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)

class FollowUpContract(unittest.TestCase):
    def test_budget_reserves_before_call_and_counts_prior_round_spend(self):
        now = datetime.datetime.now(datetime.timezone.utc)
        deadline = now + datetime.timedelta(hours=1)
        for spent, initial, cap in [(0, 0, 0), (.99, .99, 1), (.1, 0, .12)]:
            with self.assertRaisesRegex(RuntimeError, 'budget'):
                runner.permit_call(spent, initial, cap, now, deadline)
        runner.permit_call(.1, 0, 1, now, deadline)

    def test_deadline_blocks_new_calls(self):
        now = datetime.datetime.now(datetime.timezone.utc)
        with self.assertRaisesRegex(RuntimeError, 'deadline'):
            runner.permit_call(0, 0, 1, now, now)

    def test_inputs_and_native_source_are_frozen(self):
        freeze = runner.validate_freeze()
        self.assertEqual(freeze['judge_commit'], runner.COMMIT)
        self.assertEqual(freeze['budget_usd'], 1)

if __name__ == '__main__':
    unittest.main()
