import copy
import json
from pathlib import Path
import unittest
from prepare import GROUPS, cover, interactions, sha, split_of
from stats import bootstrap, cheaters, compare, exact_sign, game_score, macro
from compute import run


class OfflineTests(unittest.TestCase):
    def test_seal_and_exclusions(self):
        root = Path(__file__).parent / 'artifacts'
        seal = json.loads((root / 'pool-seal.json').read_text())
        for name, digest in seal['hashes'].items():
            self.assertEqual(sha((root / name).read_bytes()), digest, name)
        pool = json.loads((root / 'pool.json').read_text())
        ids = {r['id'] for r in pool}
        excluded = set(json.loads((root / 'excluded-ids.json').read_text()))
        self.assertEqual(len(ids), 600)
        self.assertFalse(ids & excluded)
        self.assertTrue(all(split_of(id) == 'test' for id in ids))
        coverage = set().union(*(interactions(r) for r in pool))
        self.assertEqual(len(coverage), seal['coverage']['feasibleInteractions'])
        for kind in ['pilot', 'noise', 'harm-fixtures']:
            self.assertFalse(ids & {r['id'] for r in json.loads((root / f'{kind}.json').read_text())})

    def test_selection_is_label_blind(self):
        rows = [{'id': str(i), 'group': GROUPS[i % 5], 'language': ['en', 'fr'][i % 2],
                 'a': 'I cannot help' if i % 3 == 0 else 'yes', 'b': 'reply', 'label': 'A'} for i in range(100)]
        selected, c = cover(rows, 40)
        flipped = copy.deepcopy(rows)
        for r in flipped:
            r['label'] = 'B'
        again, _ = cover(flipped, 40)
        self.assertEqual([r['id'] for r in selected], [r['id'] for r in again])
        self.assertEqual(c['coveredInteractions'], c['feasibleInteractions'])

    def test_official_scoring_and_missing(self):
        self.assertEqual(game_score('tie', 'A'), .5)
        self.assertEqual(game_score(None, 'A'), 0)
        self.assertEqual(game_score('error', 'A'), 0)
        values = [(g, float(i == 0)) for i, g in enumerate(GROUPS)]
        self.assertAlmostEqual(macro(values + [('chat', 1)] * 50), .2)

    def test_exact_sign(self):
        self.assertEqual(exact_sign(0, 0), 1)
        self.assertEqual(exact_sign(6, 0), .03125)
        self.assertEqual(exact_sign(1, 5), exact_sign(5, 1))

    def test_bootstrap_paired(self):
        values = [(g, .25) for g in GROUPS]
        self.assertEqual(bootstrap(values, 100), [.25, .25])

    def test_pending_not_win(self):
        self.assertEqual(compare([], [], 'haiku')['status'], 'pending')

    def test_cheater_order_mapping(self):
        rows = [{'id': str(i), 'group': g, 'a': 'longer', 'b': 'x', 'label': 'A'} for i, g in enumerate(GROUPS)]
        self.assertEqual(cheaters(rows)['constant-first'], .5)
        self.assertEqual(cheaters(rows)['longer-wins'], 1)

    def test_compute_checks_and_bounds(self):
        self.assertEqual(run('x = 3 * 4\nassert x / 4 == 3\nprint(x)')['answer'], '12')
        for code in ["import os\nprint(2)", "print(open('x').read())", 'x = 2 ** 1000\nassert x > 0\nprint(x)',
                     'x = 12\nassert x / 4 == 4\nprint(x)', 'print(12)']:
            with self.assertRaises((ValueError, KeyError)):
                run(code)


if __name__ == '__main__':
    unittest.main()
