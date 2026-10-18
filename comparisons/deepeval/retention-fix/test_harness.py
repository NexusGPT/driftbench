"""Offline tests. No Claude invocation and no heldout corpus reads."""
import argparse
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import run


class Guards(unittest.TestCase):
    def test_environment_excludes_loader_and_provider_overrides(self):
        with patch.dict(run.os.environ, {'NODE_OPTIONS':'--import unwanted',
                                        'ANTHROPIC_BASE_URL':'https://unwanted.invalid',
                                        'TSX_TSCONFIG_PATH':'unwanted.json'}):
            clean = run.clean_env()
        self.assertNotIn('NODE_OPTIONS', clean)
        self.assertNotIn('ANTHROPIC_BASE_URL', clean)
        self.assertNotIn('TSX_TSCONFIG_PATH', clean)

    def test_selected_report_tampering_invalidates_freeze(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp)
            hard = state / 'hard'
            hard.mkdir()
            for name in ('sets.json', 'sets-heldout.json'):
                (hard / name).write_text('{"synthetic":true}')
            report = state / 'selected.json'
            run.write(report, {'phase':'tuning', 'complete':True, 'source_sha256':{'a':'new'},
                               'sets_sha256':run.digest((hard / 'sets.json').read_bytes())})
            with patch.object(run, 'HARD', hard), patch.object(run, 'source_hashes', return_value={'a':'new'}):
                run.freeze(state, report)
                run.verify_frozen(state)
                report.write_text(report.read_text() + ' ')
                with self.assertRaisesRegex(ValueError, 'report changed'):
                    run.verify_frozen(state)

    def test_reservation_survives_crash_and_settlement_replaces_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'budget.jsonl'
            call = run.reserve_call(path, 0, 1, 'request')
            self.assertEqual(run.budget_used(path), run.RESERVE)
            run.append(path, {'call_id': call, 'charged_usd': .003})
            self.assertEqual(run.budget_used(path), .003)

    def test_total_cap_blocks_call_before_execution(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'budget.jsonl'
            run.append(path, {'call_id': 'old', 'charged_usd': 4.99})
            with self.assertRaisesRegex(ValueError, 'Spend cap'):
                run.reserve_call(path, 0, 1, 'next')
            self.assertEqual(len(run.read_rows(path)), 1)

    def test_unknown_cost_cannot_reset_budget(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'budget.jsonl'
            run.append(path, {'call_id': 'bad', 'charged_usd': float('nan')})
            with self.assertRaisesRegex(ValueError, 'Invalid budget'):
                run.budget_used(path)

    def test_heldout_marker_blocks_second_attempt_and_tuning(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp)
            (state / 'heldout-started.json').write_text('{}')
            for phase in ('tuning', 'heldout'):
                with self.assertRaises(ValueError):
                    run.ensure_phase(phase, state)

    def test_freeze_requires_matching_production_and_no_override(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp)
            report = state / 'selected.json'
            run.write(report, {'phase':'tuning', 'complete':True, 'source_sha256':{'a':'old'}})
            with patch.object(run, 'source_hashes', return_value={'a':'new'}):
                with self.assertRaisesRegex(ValueError, 'current production'):
                    run.freeze(state, report)
            run.write(report, {'phase':'tuning', 'complete':True, 'criterion_override':True})
            with self.assertRaisesRegex(ValueError, 'complete tuning'):
                run.freeze(state, report)

    def test_heldout_dry_run_does_not_consume_attempt(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp)
            args = argparse.Namespace(phase='heldout', record=False, tag='heldout')
            with patch.object(run, 'HERE', state):
                with self.assertRaisesRegex(ValueError, 'Heldout requires --record'):
                    run.evaluate(args)
            self.assertFalse((state / 'heldout-started.json').exists())

    def test_response_privacy_keeps_original_private(self):
        with tempfile.TemporaryDirectory() as tmp:
            private = Path(tmp) / 'private'
            row = {'system':'Judge.', 'user':'Hi Mira.', 'result':'operator@private.invalid'}
            clean = run.safe_record(row, private)
            self.assertNotIn('operator@private.invalid', json.dumps(clean))
            self.assertIn('operator@private.invalid', (private / 'originals.jsonl').read_text())
            self.assertEqual((private / 'originals.jsonl').stat().st_mode & 0o777, 0o600)


class ProductionBridge(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.prompt = run.bridge('render', cases=[{'id':'synthetic', 'truth':False,
            'turns':[{'role':'user','content':'My name is Mira.'},
                     {'role':'assistant','content':'Hi Mira.'}]}])[0]

    def test_labels_do_not_reach_renderer(self):
        self.assertNotIn('truth', self.prompt['request'])
        self.assertNotIn('truth', self.prompt['user'])
        self.assertEqual(self.prompt['request']['transcript'][1]['role'], 'agent')

    def test_actual_parser_rejects_legacy_verdict_and_unknown_requirement(self):
        results = run.bridge('parse', rows=[
            {'request':self.prompt['request'], 'raw':'{"outcome":"pass","reasoning":"guess"}'},
            {'request':self.prompt['request'], 'raw':json.dumps({'checks':[
                {'id':'invented', 'reasoning':'guess', 'evidence':'Hi Mira.', 'met':True}]})}])
        for result in results:
            self.assertEqual(result['answer']['outcome'], 'inconclusive')

    def test_actual_parser_accepts_correct_requirement_evidence(self):
        result = run.bridge('parse', rows=[{'request':self.prompt['request'], 'raw':json.dumps({'checks':[
            {'id':'knowledge_retention', 'reasoning':'The reply uses the supplied name.',
             'evidence':'Hi Mira.', 'met':True}]})}])[0]
        self.assertEqual(result['answer']['outcome'], 'pass')


if __name__ == '__main__':
    unittest.main()
