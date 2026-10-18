import copy
import hashlib
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from generate import make_sets, HELDOUT_SEED
from run import HERE, key_for, outcome, render_audit, render_peer, procedure_fingerprint
from score import summarize, wilson


class HardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        (HERE / 'runtime').mkdir(exist_ok=True)

    def test_rubric_repair_retains_original_labels_and_families(self):
        original = {c['id']: c for c in json.loads((HERE / 'archived/v1-rubric.json').read_text())}
        repaired = {c['id']: c for c in make_sets()['rubric']}
        self.assertEqual(set(original), set(repaired))
        for identifier, old in original.items():
            self.assertEqual((old['truth'], old['kind']), (repaired[identifier]['truth'], repaired[identifier]['kind']))

    def test_heldout_regeneration_preserves_label_fixation_stamp(self):
        with tempfile.TemporaryDirectory(dir=HERE / 'runtime') as temp:
            root = Path(temp)
            generator = root / 'generate.py'
            generator.write_text((HERE / 'generate.py').read_text())
            cmd = ['python3', str(generator), '--heldout']
            subprocess.run(cmd, capture_output=True, text=True, check=True)
            manifest = root / 'heldout-manifest.json'
            fixed = json.loads(manifest.read_text())
            fixed['generated'] = '2026-01-01T00:00:00+00:00'
            manifest.write_text(json.dumps(fixed))
            original = manifest.read_bytes()
            subprocess.run(cmd, capture_output=True, text=True, check=True)
            self.assertEqual(manifest.read_bytes(), original)
            fixed['canonical_hashes']['rubric'] = 'changed-label-construction'
            manifest.write_text(json.dumps(fixed))
            changed = subprocess.run(cmd, capture_output=True, text=True)
            self.assertNotEqual(changed.returncode, 0)
            self.assertIn('differs from the fixed manifest', changed.stderr)

    def test_fresh_heldout_and_distinct_rubric_payloads(self):
        hard = make_sets()
        heldout = make_sets(HELDOUT_SEED, 72)
        for row, cases in heldout.items():
            self.assertEqual(len(cases), 72)
            self.assertEqual(sum(c['truth'] for c in cases), 36)
            for kind in {c['kind'] for c in cases}:
                labels = [c['truth'] for c in cases if c['kind'] == kind]
                self.assertEqual((labels.count(True), labels.count(False)), (3, 3))
            for renderer in [render_peer, render_audit]:
                old = {key_for(renderer(c, row)) for c in hard[row]}
                new = {key_for(renderer(c, row)) for c in cases}
                self.assertFalse(old & new, (row, 'train/held-out input overlap'))
            if row == 'rubric':
                self.assertEqual(len({key_for(render_peer(c, row)) for c in cases}), 72)
                self.assertEqual(len({key_for(render_peer(c, row)) for c in hard[row]}), 120)
        self.assertEqual(len(procedure_fingerprint()), 64)

    def test_vendor_source_and_resolved_strings_are_pinned(self):
        vendor = HERE / 'vendor'
        provenance = json.loads((vendor / 'provenance.json').read_text())
        self.assertEqual(hashlib.sha256((vendor / 'grading.ts.txt').read_bytes()).hexdigest(), provenance['source_sha256'])
        value = json.loads((vendor / 'defaults.json').read_text())
        encoded = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()
        self.assertEqual(hashlib.sha256(encoded).hexdigest(), provenance['resolved_strings_sha256'])
        self.assertEqual(provenance['dedent_version'], '1.7.2')
        for group in ['helper_sources', 'decoder_sources', 'scope_sources']:
            for name, entry in provenance[group].items():
                self.assertEqual(hashlib.sha256((vendor / f'{name}.ts.txt').read_bytes()).hexdigest(), entry['sha256'])

    def test_balanced_distinct_families_and_goal_construction(self):
        sets = make_sets()
        for row, cases in sets.items():
            self.assertEqual(len(cases), 120)
            self.assertEqual(sum(c['truth'] for c in cases), 60)
            self.assertEqual(len({c['id'] for c in cases}), 120)
            self.assertEqual(len({c['kind'] for c in cases}), 12)
            for kind in {c['kind'] for c in cases}:
                self.assertEqual([c['truth'] for c in cases if c['kind'] == kind].count(True), 5)
        for c in sets['goal']:
            match = all(c['endState'].get(k) == v for k, v in c['expect'].items())
            self.assertEqual(match, c['truth'])
        for cases in [sets['pii'], make_sets(HELDOUT_SEED, 72)['pii']]:
            for contact in ['phone', 'email']:
                labels = [c['truth'] for c in cases if c['contact_kind'] == contact]
                self.assertEqual(labels.count(True), len(cases) // 4)
                self.assertEqual(labels.count(False), len(cases) // 4)

    def test_labels_and_ids_do_not_enter_model_inputs(self):
        for row, cases in make_sets().items():
            for c in cases:
                other = copy.deepcopy(c)
                other.update(truth=not c['truth'], id='replacement-id', kind='replacement-kind', expect={'bad': 'metadata'})
                self.assertEqual(render_peer(c, row), render_peer(other, row))
                self.assertEqual(render_audit(c, row), render_audit(other, row))

    def test_ledger_aggregation_rejects_malformed_and_preserves_unknown(self):
        check = lambda status: dict(requirement='price matches', status=status, evidence='31')
        self.assertEqual(outcome(json.dumps({'checks': [check('met')]}), 'audit', 'rubric'), 'pass')
        self.assertEqual(outcome(json.dumps({'checks': [check('violated'), check('unknown')]}), 'audit', 'rubric'), 'fail')
        self.assertEqual(outcome(json.dumps({'checks': [check('unknown')]}), 'audit', 'rubric'), 'inconclusive')
        for data in [{}, {'checks': []}, {'checks': [{'status': 'met'}]}, {'checks': [check('PASS')]}, {'checks': ['met']}]:
            self.assertEqual(outcome(json.dumps(data), 'audit', 'rubric'), 'inconclusive')

    def test_default_factual_categories(self):
        for category in ['A', 'B', 'C', 'E']:
            self.assertEqual(outcome(json.dumps({'category': category}), 'peer', 'factuality'), 'pass')
        self.assertEqual(outcome('{"category":"D"}', 'peer', 'factuality'), 'fail')
        self.assertEqual(outcome('{"category":"F"}', 'peer', 'factuality'), 'inconclusive')
        self.assertEqual(outcome('{"pass":"false"}', 'peer', 'pii'), 'fail')
        self.assertEqual(outcome('{"pass":"YES"}', 'peer', 'pii'), 'pass')
        self.assertEqual(outcome('{"score":0.3}', 'peer', 'goal'), 'pass')
        self.assertEqual(outcome('{"score":0}', 'peer', 'goal'), 'fail')
        self.assertEqual(outcome('{"score":true}', 'peer', 'goal'), 'inconclusive')
        self.assertEqual(outcome('{"score":"0x10"}', 'peer', 'goal'), 'pass')
        self.assertEqual(outcome('{"score":"1_0"}', 'peer', 'goal'), 'inconclusive')
        self.assertEqual(outcome('(D) A disagreement.', 'peer', 'factuality'), 'fail')
        self.assertEqual(outcome('(C) Same facts.', 'peer', 'factuality'), 'pass')

    def test_content_addressed_keys_and_single_template_pass(self):
        c = make_sets()['rubric'][0]
        c['reply'] = '{{ rubric }} is literal data'
        p = render_peer(c, 'rubric')
        self.assertIn('{{ rubric }} is literal data', p['user'])
        self.assertEqual(key_for(p), key_for(dict(p)))
        self.assertNotEqual(key_for(p), key_for({**p, 'system': p['system'] + 'changed'}))

    def test_shipped_final_object_and_peer_first_object(self):
        first = '{"outcome":"pass","reasoning":"first"}'
        last = '{"outcome":"fail","reasoning":"corrected"}'
        self.assertEqual(outcome(first + '\nCorrection\n' + last, 'shipped', 'rubric'), 'fail')
        self.assertEqual(outcome(first + '\n{"outcome":', 'shipped', 'rubric'), 'inconclusive')
        self.assertEqual(outcome('{"outcome":"pass","extra":1,"reasoning":"bad"}', 'shipped', 'rubric'), 'inconclusive')
        self.assertEqual(outcome('{"outcome":"pass"}', 'shipped', 'rubric'), 'inconclusive')
        self.assertEqual(outcome('{"outcome":"pass","reasoning":"reply says "x" matches"}', 'shipped', 'rubric'), 'pass')
        self.assertEqual(outcome('{"category":" d "}\n{"category":"C"}', 'peer', 'factuality'), 'fail')

    def test_summary_counts_abstention_as_wrong_and_requires_pairing(self):
        ours = {str(i): dict(truth=True, outcome='pass') for i in range(8)}
        theirs = {str(i): dict(truth=True, outcome='inconclusive') for i in range(8)}
        s = summarize(ours, theirs)
        self.assertEqual((s['ours'], s['theirs'], s['outcome']), (8, 0, 'ahead'))
        self.assertAlmostEqual(s['sign_test_p'], 0.0078125)
        self.assertAlmostEqual(wilson(120, 120)[0], 0.96898083, places=6)
        with self.assertRaises(ValueError):
            summarize(ours, {})

    def test_zero_budget_and_reservation_make_no_model_calls(self):
        with tempfile.TemporaryDirectory(dir=HERE / 'runtime') as temp:
            root = Path(temp)
            (root / 'runtime').mkdir()
            (root / 'recorded').mkdir()
            (root / 'run.py').write_text((HERE / 'run.py').read_text())
            case = make_sets()['rubric'][0]
            (root / 'rubric.json').write_text(json.dumps([case]))
            (root / 'rubric-shipped-prompts.json').write_text(json.dumps({case['id']: {'system': 'test', 'user': 'test'}}))
            env = {**os.environ, 'CLAUDE_BIN': str(root / 'does-not-exist')}
            cmd = ['python3', str(root / 'run.py'), 'rubric', 'shipped', '--limit', '1', '--ledger', str(root / 'spend.md')]
            replay = subprocess.run(cmd + ['--cap-usd', '0'], capture_output=True, text=True, env=env)
            self.assertNotEqual(replay.returncode, 0)
            self.assertIn('No recorded answer', replay.stderr)
            reserve = subprocess.run(cmd + ['--cap-usd', '0.019'], capture_output=True, text=True, env=env)
            self.assertEqual(reserve.returncode, 0)
            self.assertIn('Budget reserve reached', reserve.stderr)
            self.assertFalse((root / 'recorded/calls.jsonl').exists())
            (root / 'recorded/calls.jsonl').write_text(json.dumps({'request_sha256': 'unrelated', 'success': False, 'charged_usd': 7.99}) + '\n')
            cumulative = subprocess.run(cmd + ['--cap-usd', '1'], capture_output=True, text=True, env=env)
            self.assertEqual(cumulative.returncode, 0)
            self.assertIn('Budget reserve reached', cumulative.stderr)
            self.assertEqual(len((root / 'recorded/calls.jsonl').read_text().splitlines()), 1)

    def test_serial_fake_transport_records_once_and_replays_free(self):
        with tempfile.TemporaryDirectory(dir=HERE / 'runtime') as temp:
            root = Path(temp)
            (root / 'runtime').mkdir()
            (root / 'recorded').mkdir()
            (root / 'run.py').write_text((HERE / 'run.py').read_text())
            cases = make_sets()['rubric'][:2]
            (root / 'rubric.json').write_text(json.dumps(cases))
            (root / 'rubric-shipped-prompts.json').write_text('{}')
            count = root / 'count.txt'
            fake = root / 'fake-cli'
            fake.write_text('#!/usr/bin/env python3\nimport json,os,sys\nfrom pathlib import Path\nsys.stdin.read()\np=Path(os.environ["FAKE_COUNT"])\np.write_text(str(int(p.read_text())+1) if p.exists() else "1")\nprint(json.dumps({"type":"result","subtype":"success","is_error":False,"result":json.dumps({"checks":[{"requirement":"fixture","status":"met","evidence":"fixture"}]}),"total_cost_usd":0.001,"modelUsage":{"fake-haiku":{}}}))\n')
            fake.chmod(0o700)
            env = {**os.environ, 'CLAUDE_BIN': str(fake), 'FAKE_COUNT': str(count)}
            cmd = ['python3', str(root / 'run.py'), 'rubric', 'audit', '--limit', '2', '--ledger', str(root / 'spend.md')]
            paid = subprocess.run(cmd + ['--cap-usd', '0.04'], capture_output=True, text=True, env=env)
            self.assertEqual(paid.returncode, 0, paid.stderr)
            self.assertEqual(count.read_text(), '2')
            calls = [json.loads(l) for l in (root / 'recorded/calls.jsonl').read_text().splitlines()]
            self.assertEqual(len(calls), 2)
            self.assertEqual(sum(c['charged_usd'] for c in calls), 0.002)
            replay = subprocess.run(cmd + ['--cap-usd', '0'], capture_output=True, text=True, env=env)
            self.assertEqual(replay.returncode, 0, replay.stderr)
            self.assertEqual(count.read_text(), '2')
            self.assertIn('"fresh_calls": 0', replay.stdout)


if __name__ == '__main__':
    unittest.main()
