"""Construction checks for the held-out sets: balance, pairing, reproducibility, no label in a prompt."""
import json
import unittest
from pathlib import Path

import generate

HERE = Path(__file__).resolve().parent


class HeldOut(unittest.TestCase):
    def test_reproducible_and_balanced(self):
        sets = generate.build()
        for key, items in sets.items():
            stored = json.loads((HERE / 'sets' / f"{key.replace('/', '-')}.json").read_text())
            self.assertEqual(items, stored, key)
            self.assertEqual(len(items), 126)
            self.assertEqual(sum(x['truth'] for x in items), 63)
            for cls in generate.CLASSES:
                self.assertEqual(sum(x['kind'] == cls for x in items), 18, (key, cls))

    def test_pairs_differ_only_in_the_judged_part(self):
        sets = generate.build()
        for key, items in sets.items():
            by_pair = {}
            for x in items:
                by_pair.setdefault(x['pair'], []).append(x)
            for pair, (a, b) in by_pair.items():
                self.assertNotEqual(a['truth'], b['truth'])
                shared = {k for k in a if k not in ('id', 'truth', 'reply', 'output', 'turns', 'endState')}
                for k in shared:
                    self.assertEqual(a[k], b[k], (key, pair, k))
                judged = [k for k in ('reply', 'output', 'turns', 'endState') if k in a]
                self.assertTrue(any(a[k] != b[k] for k in judged), (key, pair))

    def test_no_label_or_id_in_competitor_prompts(self):
        for path in (HERE / 'prompts').glob('*.json'):
            for case_id, prompt in json.loads(path.read_text()).items():
                text = prompt['system'] + prompt['user']
                for leak in (case_id, '"truth"', '"kind"', '"pair"', *generate.CLASSES):
                    self.assertNotIn(leak, text, (path.name, case_id, leak))


if __name__ == '__main__':
    unittest.main()
