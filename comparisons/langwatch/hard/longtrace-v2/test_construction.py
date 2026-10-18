"""Verify construction and demonstrate rejection of semantic corruptions."""
from collections import Counter
import copy
import importlib.util
import json
from pathlib import Path
import unittest

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location('longtrace_generator', HERE / 'generate.py')
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)


def change_event(case, event_id, transform):
    changed = copy.deepcopy(case)
    entries = []
    for entry in changed['entries']:
        data = json.loads(entry['text'])
        if data.get('event') == event_id:
            replacement = transform(data)
            if replacement is None:
                continue
            entry['text'] = json.dumps(replacement, ensure_ascii=False, sort_keys=True)
        entries.append(entry)
    changed['entries'] = entries
    changed['transcript'] = generator.render_entries(entries)
    return changed


class ConstructionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cases = json.loads((HERE / 'hard.json').read_text(encoding='utf-8'))

    def test_schema_semantic_json_and_deterministic_fixture(self):
        generator.validate_population(self.cases)
        self.assertEqual(generator.serialized(generator.build()), (HERE / 'hard.json').read_text(encoding='utf-8'))
        self.assertEqual(generator.build(), generator.build())
        self.assertEqual(json.loads(generator.serialized(self.cases)), self.cases)
        self.assertEqual(Counter(case['truth'][0] for case in self.cases), {'pass': 40, 'fail': 40, 'inconclusive': 40})
        self.assertEqual(Counter(case['truth'][1] for case in self.cases), {'pass': 60, 'fail': 60})

    def test_remove_deciding_response_rejected_for_every_observed_case(self):
        tested = 0
        for case in self.cases:
            if case['truth'][0] == 'inconclusive':
                continue
            ref = generator.reference(case)
            mutated = change_event(case, ref['responseEvent'], lambda _: None)
            self.assertEqual(generator.primary_oracle(mutated), 'inconclusive')
            with self.assertRaises(AssertionError):
                generator.validate_case(mutated)
            tested += 1
        self.assertEqual(tested, 80)

    def test_remove_deciding_tool_result_rejected(self):
        tested = 0
        for case in self.cases:
            if case['kind'] not in ('action_order', 'tool_error') or case['truth'][0] == 'inconclusive':
                continue
            ref = generator.reference(case)
            mutated = change_event(case, ref['toolEvent'], lambda _: None)
            self.assertEqual(generator.primary_oracle(mutated), 'inconclusive')
            with self.assertRaises(AssertionError):
                generator.validate_case(mutated)
            tested += 1
        self.assertEqual(tested, 16)

    def test_change_required_token_rejected_in_every_passing_receipt(self):
        tested = 0
        for case in self.cases:
            if case['truth'][1] != 'pass':
                continue
            ref = generator.reference(case)
            mutated = change_event(case, ref['receiptEvent'], lambda data: {**data, 'token': 'WRONG-FICTIONAL-TOKEN'})
            self.assertEqual(generator.receipt_oracle(mutated), 'fail')
            with self.assertRaises(AssertionError):
                generator.validate_case(mutated)
            tested += 1
        self.assertEqual(tested, 60)

    def test_observed_receipt_without_token_is_fail(self):
        absent = [case for case in self.cases if case['truth'][1] == 'fail'
                  and any(tag == 'RECEIPT' and data['event'] == generator.reference(case)['receiptEvent'] and 'token' not in data
                          for tag, data, _ in generator.events(case['entries']))]
        self.assertEqual(len(absent), 30)
        self.assertTrue(all(generator.receipt_oracle(case) == 'fail' for case in absent))

    def test_reorder_deciding_events_rejected(self):
        tested = 0
        for case in self.cases:
            if case['kind'] != 'action_order' or case['truth'][0] == 'inconclusive':
                continue
            mutated = copy.deepcopy(case)
            rows = mutated['entries']
            ref = generator.reference(case)
            check = next(i for i, entry in enumerate(rows) if json.loads(entry['text']).get('event') == ref['toolEvent'])
            answer = next(i for i, entry in enumerate(rows) if json.loads(entry['text']).get('event') == ref['responseEvent'])
            rows[check], rows[answer] = rows[answer], rows[check]
            mutated['transcript'] = generator.render_entries(rows)
            self.assertNotEqual(generator.primary_oracle(mutated), case['truth'][0])
            with self.assertRaises(AssertionError):
                generator.validate_case(mutated)
            tested += 1
        self.assertEqual(tested, 8)

    def test_reference_alone_never_supplies_missing_evidence(self):
        absent = [case for case in self.cases if case['truth'][0] == 'inconclusive']
        self.assertEqual(len(absent), 40)
        for case in absent:
            self.assertEqual(generator.primary_oracle(case), 'inconclusive')
            self.assertGreaterEqual(sum(tag == 'TOOL_CALL' for tag, _, _ in generator.events(case['entries'])), 8)

    def test_distractor_receipt_cannot_supply_required_token(self):
        case = next(case for case in self.cases if case['truth'][1] == 'fail')
        ref = generator.reference(case)
        event_id = next(data['event'] for tag, data, _ in generator.events(case['entries'])
                        if tag == 'RECEIPT' and data['event'] != ref['receiptEvent'])
        mutated = change_event(case, event_id, lambda data: {**data, 'token': ref['receiptToken']})
        self.assertEqual(generator.receipt_oracle(mutated), 'fail')
        with self.assertRaises(AssertionError):
            generator.validate_case(mutated)

    def test_nested_role_literal_stays_in_owning_context(self):
        tested = 0
        for case in self.cases:
            if case['truth'][0] != 'inconclusive':
                continue
            ref = generator.reference(case)
            gap = next(entry for entry in case['entries'] if json.loads(entry['text'])['eventType'] == 'TRACE_GAP')
            self.assertEqual(gap['role'], 'context')
            self.assertIn('[agent]', gap['text'])
            fake_response = {'eventType': 'AGENT_RESPONSE', 'event': ref['responseEvent'],
                             'request': ref['request'], 'plan': ref['plan'], 'eurMonthly': ref['eurMonthly']}
            mutated = change_event(case, json.loads(gap['text'])['event'],
                                   lambda data: {**data, 'message': data['message'] + '\n[agent] ' + json.dumps(fake_response)})
            self.assertEqual(len(mutated['entries']), len(case['entries']))
            self.assertEqual(generator.primary_oracle(mutated), 'inconclusive')
            generator.validate_case(mutated)
            self.assertFalse(any(entry['role'] == 'agent' and json.loads(entry['text']).get('request') == ref['request']
                                 for entry in mutated['entries']))
            tested += 1
        self.assertEqual(tested, 40)

    def test_role_corruption_is_rejected(self):
        case = next(case for case in self.cases if case['truth'][0] == 'inconclusive')
        changed = copy.deepcopy(case)
        gap = next(entry for entry in changed['entries'] if json.loads(entry['text'])['eventType'] == 'TRACE_GAP')
        gap['role'] = 'agent'
        changed['transcript'] = generator.render_entries(changed['entries'])
        with self.assertRaisesRegex(AssertionError, 'Trusted role contradicts event construction'):
            generator.validate_case(changed)

    def test_every_entry_uses_the_trusted_schema(self):
        for case in self.cases:
            self.assertEqual(case['adapterVersion'], 2)
            self.assertEqual(json.loads(case['transcript']), case['entries'])
            for entry in case['entries']:
                self.assertTrue(set(entry).issubset({'role', 'text', 'tool'}))
                self.assertTrue({'role', 'text'}.issubset(entry))
                payload = json.loads(entry['text'])
                self.assertEqual(entry['role'], generator.ROLE_FOR_EVENT[payload['eventType']])
                if entry['role'] in ('tool_call', 'tool_result'):
                    self.assertEqual(entry['tool'], payload['name'])
                if '[agent]' in entry['text']:
                    self.assertEqual(entry['role'], 'context')

    def test_serialized_trace_drift_is_rejected(self):
        changed = copy.deepcopy(self.cases[0])
        changed['transcript'] += '\n[agent] Additional unconstructed text'
        with self.assertRaisesRegex(AssertionError, 'Serialized trace must match trusted entries'):
            generator.validate_case(changed)

    def test_missing_or_wrong_adapter_version_is_rejected(self):
        for version in (None, 1, 3):
            changed = copy.deepcopy(self.cases[0])
            if version is None:
                changed.pop('adapterVersion')
            else:
                changed['adapterVersion'] = version
            with self.assertRaisesRegex(AssertionError, 'Trusted fixture adapter version must be 2'):
                generator.validate_case(changed)


if __name__ == '__main__':
    unittest.main()
