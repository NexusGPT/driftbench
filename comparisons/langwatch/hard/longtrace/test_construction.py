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
    rows = []
    for raw in changed['transcript'].splitlines():
        tag, _, body = raw.partition(' ')
        if tag in ('AGENT_RESPONSE', 'TOOL_CALL', 'TOOL_RESULT', 'TRACE_GAP', 'RECEIPT', 'USER_REQUEST'):
            data = json.loads(body)
            if data.get('event') == event_id:
                replacement = transform(data)
                if replacement is None:
                    continue
                raw = generator.line(tag, **replacement)
        rows.append(raw)
    changed['transcript'] = '\n'.join(rows) + '\n'
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
                          for tag, data, _ in generator.events(case['transcript']))]
        self.assertEqual(len(absent), 30)
        self.assertTrue(all(generator.receipt_oracle(case) == 'fail' for case in absent))

    def test_reorder_deciding_events_rejected(self):
        tested = 0
        for case in self.cases:
            if case['kind'] != 'action_order' or case['truth'][0] == 'inconclusive':
                continue
            mutated = copy.deepcopy(case)
            rows = mutated['transcript'].splitlines()
            ref = generator.reference(case)
            check = next(i for i, raw in enumerate(rows) if raw.startswith('TOOL_RESULT ') and json.loads(raw.split(' ', 1)[1])['event'] == ref['toolEvent'])
            answer = next(i for i, raw in enumerate(rows) if raw.startswith('AGENT_RESPONSE ') and json.loads(raw.split(' ', 1)[1])['event'] == ref['responseEvent'])
            rows[check], rows[answer] = rows[answer], rows[check]
            mutated['transcript'] = '\n'.join(rows) + '\n'
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
            self.assertGreaterEqual(sum(tag == 'TOOL_CALL' for tag, _, _ in generator.events(case['transcript'])), 8)

    def test_distractor_receipt_cannot_supply_required_token(self):
        case = next(case for case in self.cases if case['truth'][1] == 'fail')
        ref = generator.reference(case)
        event_id = next(data['event'] for tag, data, _ in generator.events(case['transcript'])
                        if tag == 'RECEIPT' and data['event'] != ref['receiptEvent'])
        mutated = change_event(case, event_id, lambda data: {**data, 'token': ref['receiptToken']})
        self.assertEqual(generator.receipt_oracle(mutated), 'fail')
        with self.assertRaises(AssertionError):
            generator.validate_case(mutated)


if __name__ == '__main__':
    unittest.main()
