"""Scoring and transport contracts; no model calls."""
import json
import unittest
from pathlib import Path
from run import key, parse, score, wilson

ROOT = Path(__file__).resolve().parent

class ScoreContract(unittest.TestCase):
    def test_exact_correctness_boundary_and_half_sensitivity(self):
        self.assertEqual(score('theirs', '{"score":0.99}', 1), 'fail')
        self.assertEqual(score('theirs', '{"score":0.99}', .5), 'pass')
        self.assertEqual(score('theirs', '{"score":1}', 1), 'pass')
        self.assertEqual(score('theirs', '{"score":0}', 1), 'fail')

    def test_invalid_scores_are_errors_not_negative_verdicts(self):
        for value in [True, False, '1', None, -1, 1.1, float('nan')]:
            self.assertEqual(score('theirs', json.dumps({'score': value}), 1), 'unparsed')
        self.assertEqual(score('theirs', 'broken', 1), 'unparsed')

    def test_binary_side_uses_verdict_not_probability(self):
        self.assertEqual(score('ours', '{"outcome":"fail","score":1}', 1), 'fail')
        self.assertEqual(score('ours', '{"outcome":"inconclusive"}', 1), 'inconclusive')
        self.assertEqual(score('ours', '{}', 1), 'unparsed')

    def test_fences_and_arrays(self):
        self.assertEqual(parse('```json\n{"score":1}\n```'), {'score': 1})
        self.assertEqual(parse('[{"score":1}]'), {})
        self.assertEqual(parse('prose {"score":0} then {"score":1} trailing prose'), {'score': 1})
        self.assertEqual(parse('{"score":1} then {"score":'), {})

    def test_same_strict_quote_repair_for_both_sides(self):
        broken = '{"score":0,"reasoning":"means ("available"), reversing negation"}'
        self.assertEqual(score('theirs', broken, 1), 'fail')
        self.assertEqual(parse(broken)['reasoning'], 'means ("available"), reversing negation')

    def test_cassette_fingerprint_includes_both_prompts(self):
        self.assertNotEqual(key('a', 'b'), key('a changed', 'b'))
        self.assertNotEqual(key('a', 'b'), key('a', 'b changed'))

    def test_wilson_reference_values(self):
        lo, hi = wilson(120, 120)
        self.assertAlmostEqual(lo, .9689808336, places=8)
        self.assertAlmostEqual(hi, 1, places=8)
        lo, hi = wilson(60, 120)
        self.assertAlmostEqual(lo + hi, 1)
        self.assertLess(lo, .5)
        self.assertGreater(hi, .5)

    def test_ledger_verdict_comes_from_facts_not_a_model_label(self):
        good = {'facts': [{'reference': 'price is 47', 'reply': '47', 'status': 'match'}], 'unsupported': []}
        self.assertEqual(score('ours-audit', json.dumps(good), 1), 'pass')
        bad = {**good, 'unsupported': ['free forever']}
        self.assertEqual(score('ours-audit', json.dumps(bad), 1), 'fail')
        for state in ['wrong', 'missing']:
            bad = {'facts': [{'reference': 'price is 47', 'reply': '', 'status': state}], 'unsupported': []}
            self.assertEqual(score('ours-audit', json.dumps(bad), 1), 'fail')
        for malformed in [{'facts': [], 'unsupported': []}, {'facts': good['facts'] * 2, 'unsupported': []}, {'facts': [{'reference': 'x', 'reply': 'x', 'status': 'unknown'}], 'unsupported': []}, {**good, 'unsupported': [None]}, {**good, 'facts': [None]}]:
            self.assertEqual(score('ours-audit', json.dumps(malformed), 1), 'unparsed')

    def test_heldout_inputs_are_disjoint_and_procedures_are_frozen(self):
        import hashlib
        original = json.loads((ROOT / 'hard.json').read_text())
        heldout = json.loads((ROOT / 'heldout-cases.json').read_text())
        manifest = json.loads((ROOT / 'manifest.json').read_text())
        self.assertEqual(len(heldout), 120)
        self.assertEqual(sum(c['label'] == 'pass' for c in heldout), 60)
        self.assertEqual(hashlib.sha256((ROOT / 'heldout-cases.json').read_bytes()).hexdigest(), manifest['sha256']['heldout-cases.json'])
        self.assertEqual(hashlib.sha256((ROOT / 'audit.txt').read_bytes()).hexdigest(), manifest['sha256']['audit.txt'])
        for field in ['query', 'reference', 'output']:
            self.assertFalse({c[field] for c in original} & {c[field] for c in heldout})
        a = json.loads((ROOT / 'prompts.json').read_text())
        b = json.loads((ROOT / 'heldout-prompts.json').read_text())
        for side in ['ours', 'ours-audit', 'theirs']:
            self.assertEqual({p[side]['system'] for p in a}, {p[side]['system'] for p in b})
        self.assertEqual({c['family'] for c in original}, {c['family'] for c in heldout})

    def test_labels_are_not_sent_and_template_is_verbatim(self):
        cases = json.loads((ROOT / 'hard.json').read_text())
        prompts = {p['id']: p for p in json.loads((ROOT / 'prompts.json').read_text())}
        self.assertEqual(len(cases), 120)
        self.assertEqual(sum(c['label'] == 'pass' for c in cases), 60)
        template = (ROOT / 'vendor/correctness.txt').read_text()
        for c in cases:
            expected = template.replace('{{query}}', c['query']).replace('{{generation}}', c['output']).replace('{{ground_truth}}', c['reference'])
            self.assertEqual(prompts[c['id']]['theirs']['user'], expected)
            self.assertNotIn(c['id'], prompts[c['id']]['ours']['user'])
            self.assertNotIn('"label"', prompts[c['id']]['ours']['user'])
            self.assertEqual(prompts[c['id']]['ours']['user'].count('</transcript_data>'), 1)

class RunnerContract(unittest.TestCase):
    def exercise(self, cap, recordings=None, deadline=None):
        import contextlib
        import io
        import tempfile
        import run
        from unittest.mock import patch
        from types import SimpleNamespace
        runtime = ROOT / 'runtime'
        runtime.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=runtime) as tmp:
            root = Path(tmp)
            prompt = {'system': 'first', 'user': 'question'}
            (root / 'hard.json').write_text(json.dumps([{'id': 'fixture', 'family': 'units', 'label': 'pass'}]))
            (root / 'prompts.json').write_text(json.dumps([{'id': 'fixture', 'ours': prompt, 'theirs': {'system': 'second', 'user': 'question'}}]))
            if recordings:
                (root / 'calls.jsonl').write_text(''.join(json.dumps(r) + '\n' for r in recordings))
            if deadline:
                (root / 'experiment.json').write_text(json.dumps({'deadline': deadline}))
            reply = SimpleNamespace(stdout=json.dumps({'result': '{"outcome":"pass","reasoning":"matches"}', 'total_cost_usd': .02}), stderr='', returncode=0)
            with patch.object(run, 'ROOT', root), patch('sys.argv', ['run.py', 'fixture', '--cap-usd', str(cap)]), patch.object(run.subprocess, 'run', return_value=reply) as model, contextlib.redirect_stdout(io.StringIO()):
                try:
                    run.main()
                except SystemExit as error:
                    self.assertEqual(error.code, 1)
            return json.loads((root / 'fixture.json').read_text()), model.call_count

    def recording(self, cost, error=False):
        return {'request_sha256': key('first', 'question'), 'cost_usd': cost, 'returncode': int(error), 'is_error': error, 'result': '{"outcome":"pass","reasoning":"matches"}'}

    def test_result_tags_cannot_overwrite_frozen_inputs(self):
        import run
        from unittest.mock import patch
        for tag in ['hard', 'heldout-cases', 'manifest', 'prompts', 'heldout-prompts']:
            with patch('sys.argv', ['run.py', tag]), self.assertRaisesRegex(SystemExit, 'conflicts'):
                run.main()

    def test_zero_cap_never_launches_missing_calls(self):
        result, calls = self.exercise(0)
        self.assertEqual(calls, 0)
        self.assertIn('budget reached', result['failure'])

    def test_cached_answer_is_free_and_missing_second_answer_stops(self):
        result, calls = self.exercise(0, [self.recording(.02)])
        self.assertEqual(calls, 0)
        self.assertEqual(result['summary']['ours']['correct'], 1)
        self.assertEqual(result['fresh_cost_usd'], 0)

    def test_reservation_enforces_invocation_budget(self):
        result, calls = self.exercise(.03)
        self.assertEqual(calls, 1)
        self.assertEqual(result['fresh_cost_usd'], .02)
        self.assertIn('budget reached', result['failure'])

    def test_cumulative_budget_counts_prior_spend(self):
        result, calls = self.exercise(1, [self.recording(7.99)])
        self.assertEqual(calls, 0)
        self.assertEqual(result['cumulative_cost_usd'], 7.99)

    def test_cached_errors_are_never_successful_verdicts(self):
        result, calls = self.exercise(1, [self.recording(.02, error=True)])
        self.assertEqual(calls, 0)
        self.assertIn('cached model error', result['failure'])
        self.assertEqual(result['summary'], {})

    def test_expired_deadline_blocks_new_calls(self):
        result, calls = self.exercise(1, deadline='2000-01-01T07:00:00+01:00')
        self.assertEqual(calls, 0)
        self.assertIn('deadline reached', result['failure'])

if __name__ == '__main__':
    unittest.main()
