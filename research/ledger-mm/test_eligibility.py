"""Offline checks for eligibility.json against the recordings. No model calls."""
import json
from pathlib import Path
import unittest

HERE = Path(__file__).parent


def lines(name):
    return [json.loads(x) for x in (HERE / name).read_text().splitlines() if x.strip()]


class Eligibility(unittest.TestCase):
    def setUp(self):
        self.e = json.loads((HERE / 'eligibility.json').read_text())
        self.calls = lines('recordings/calls.jsonl')
        self.decisions = lines('recordings/decisions.jsonl')

    def test_no_answered_call_is_listed(self):
        answered = {c['key'] for c in self.calls if 'response' in c}
        self.assertFalse(answered & set(self.e['callKeys']))

    def test_every_listed_call_exhausted_without_answer(self):
        rows = {c['key']: c for c in self.calls if c['key'] in set(self.e['callKeys']) and (c.get('round') or 0) == 0}
        self.assertEqual(set(rows), set(self.e['callKeys']))
        self.assertTrue(all(r.get('transportExhausted') and 'response' not in r and r['model'] == self.e['model'] for r in rows.values()))

    def test_listed_decisions_have_no_game(self):
        rows = [d for d in self.decisions if d['key'] in set(self.e['decisionKeys']) and 'TRANSPORT_EXHAUSTED' in (d.get('error') or '')]
        self.assertEqual({d['key'] for d in rows}, set(self.e['decisionKeys']))
        self.assertTrue(all(d['games'] == [None, None] and d['phase'] == 'test' for d in rows))
        self.assertEqual(sorted({d['id'] for d in rows}), self.e['items'])

    def test_scope_is_the_13_items_and_one_model(self):
        self.assertEqual((len(self.e['items']), len(self.e['decisionKeys']), self.e['model']), (13, 26, 'gemini-3.8-flash'))


if __name__ == '__main__':
    unittest.main()
