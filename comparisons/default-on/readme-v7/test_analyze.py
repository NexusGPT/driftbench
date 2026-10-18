"""analyze.py on recorded answers: no model call, no file write."""
import importlib.util
import json
import math
from pathlib import Path
import unittest

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
spec = importlib.util.spec_from_file_location('readme_v7_analyze', HERE / 'analyze.py')
analyze_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(analyze_module)
analyze = analyze_module.analyze


def exact(b, c):
    n, k = b + c, min(b, c)
    return min(1.0, 2 * sum(math.comb(n, i) for i in range(k + 1)) / 2 ** n) if n else 1.0


def recorded_run(row_name, dataset, rows):
    """A manifest row and v7-shaped results whose answers are the recorded driftbench answers."""
    label = lambda truth: 'pass' if truth else 'fail'
    verdict = lambda prediction: 'inconclusive' if prediction is None else label(prediction)
    peer = {r['id']: r['theirs']['prediction'] == r['truth'] for r in rows}
    ours = {r['id']: r['ours']['prediction'] == r['truth'] for r in rows}
    results = [{'frozen': 'f', 'variant': 'new', 'dataset': dataset, 'id': r['id'], 'status': 'returned',
                'gold': label(r['truth']), 'prediction': verdict(r['ours']['prediction'])} for r in rows]
    return {'row': row_name, 'dataset': dataset, 'peerCorrect': peer, 'oldOursCorrect': ours}, results


class Analyze(unittest.TestCase):
    def test_fresh_rows_exclude_answers_without_a_verdict_from_the_pairs(self):
        lead = ROOT / 'comparisons/deepeval/lead'
        geval = [r for r in json.loads((lead / 'fresh-retry.json').read_text())['rows'] if r['row'] == 'G-Eval strict']
        power = json.loads((lead / 'power/api/retry/results.json').read_text())
        retention = [r for r in power['rows'] if r['row'] == 'knowledge retention']
        g_row, g_results = recorded_run('G-Eval strict', 'g', geval)
        k_row, k_results = recorded_run('Knowledge retention', 'k', retention)
        out = analyze({'rows': [g_row, k_row]}, g_results + k_results, 'f')
        g, k = out['rows']
        # Retention replays the recorded paired test: 2 inconclusive answers excluded, 1270 pairs, p 1.
        recorded = next(s for s in [power['summary']] if s['row'] == 'knowledge retention')['paired']
        self.assertEqual((k['v7'], k['peer'], k['n']), (1270, 1272, 1272))
        self.assertEqual((k['pairedN'], k['pairedP']), (recorded['n'], recorded['paired_p']))
        self.assertEqual(k['pairedHolmP'], 1.0)
        # G-Eval: its one unparsed answer still counts wrong in the score, and leaves the pairs.
        self.assertEqual((g['v7'], g['peer'], g['n'], g['pairedN']), (474, 451, 480, 479))
        self.assertEqual((g['v7OnlyRight'], g['peerOnlyRight']), (29, 5))
        self.assertAlmostEqual(g['pairedP'], exact(29, 5), places=15)
        self.assertEqual(g['standing'], 'lead')
        self.assertEqual(len(out['notInPairs']), 3)

    def test_rows_sharing_a_dataset_count_its_cost_once(self):
        manifest = {'rows': [
            {'row': 'a', 'dataset': 'shared', 'peerCorrect': {'1': True, '2': True, '3': False}, 'oldOursCorrect': {'1': True, '2': True, '3': True}},
            {'row': 'b', 'dataset': 'shared', 'peerCorrect': {'1': False, '2': True, '3': False}, 'oldOursCorrect': {'1': True, '2': True, '3': True}},
            {'row': 'c', 'dataset': 'own', 'peerCorrect': {'1': True, '2': True}, 'oldOursCorrect': {'1': True, '2': True}},
        ]}
        results = [{'frozen': 'f', 'variant': 'new', 'dataset': d, 'id': i, 'status': 'returned', 'gold': 'pass',
                    'prediction': 'pass', 'result': {'costUsd': 1.0}}
                   for d, ids in (('shared', '123'), ('own', '12')) for i in ids]
        out = analyze(manifest, results, 'f')
        self.assertEqual(out['totalV7CostUsd'], 5.0)
        self.assertEqual([r['v7CostUsd'] for r in out['rows']], [3.0, 3.0, 2.0])

    def test_a_missing_or_failed_result_counts_wrong_and_leaves_the_pairs(self):
        manifest = {'rows': [{'row': 'a', 'dataset': 'd', 'peerCorrect': {'1': True, '2': True, '3': True},
                              'oldOursCorrect': {'1': True, '2': True, '3': True}}]}
        results = [{'frozen': 'f', 'variant': 'new', 'dataset': 'd', 'id': '1', 'status': 'returned', 'gold': 'pass', 'prediction': 'pass'},
                   {'frozen': 'f', 'variant': 'new', 'dataset': 'd', 'id': '2', 'status': 'error'}]
        row = analyze(manifest, results, 'f')['rows'][0]
        self.assertEqual((row['v7'], row['n'], row['pairedN'], row['returned']), (1, 3, 1, 1))


if __name__ == '__main__':
    unittest.main()
