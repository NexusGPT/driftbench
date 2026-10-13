"""Run from research/moj: python3 -m unittest discover -s results/confidence -v."""
import copy
import math
import unittest
from unittest.mock import patch

import numpy as np

from moj.confidence import (ConfidenceModel, Isotonic, binomial_lower, calibrate_experts,
                            certify, choose_level, crossfit, minimum_labels, pair_confidence,
                            prepare, reliability, threshold_grid, validate_rows)
from moj.policy import Combiner


def synthetic(n=120, seed=77):
    rng = np.random.default_rng(seed)
    out = []
    for i in range(n):
        pa = float(rng.uniform(0.01, 0.99))
        label = 'A' if rng.random() < pa else 'B'
        row = {'_id': str(i), '_meta': {'label': label, 'half': 'tune', 'split': 'practice'}}
        for name in ('s1p', 'ref', 's1r', 's2v', 's2h'):
            p = pa if name == 's1p' else (0.95 if label == 'A' else 0.05)
            row[name] = {'pA': p, 'detail': {'AB': p, 'BA': 1 - p}, 'missing': 0,
                         'calls': {'jev': 2 if name in ('s1p', 's1r', 'ref') else 0,
                                   'luna': 0 if name in ('s1p', 's1r') else 1}, 'usd': 0.0}
        out.append(row)
    return out


class ConfidenceTests(unittest.TestCase):
    def test_pava_known_solution_and_duplicate_weights(self):
        m = Isotonic.fit([0.1, 0.2, 0.3, 0.4], [0, 1, 0, 1])
        np.testing.assert_allclose(m.y, [0, 0.5, 0.5, 1])
        m = Isotonic.fit([0.1, 0.1, 0.2], [1, 1, 0])
        np.testing.assert_allclose(m.y, [2 / 3, 2 / 3])
        self.assertTrue(np.all(np.diff(m.predict(np.linspace(0, 1, 100))) >= 0))
        self.assertEqual(m.predict(-2), m.y[0])

    def test_invalid_calibration_rejected(self):
        for x, y in [([], []), ([0.3], []), ([float('nan')], [0]), ([2], [1])]:
            with self.assertRaises(ValueError):
                Isotonic.fit(x, y)

    def test_known_miscalibration_is_corrected_out_of_sample(self):
        # True event rates 0.2 and 0.8, but reported probabilities 0.01 and 0.99.
        train_p = np.repeat([0.01, 0.99], 500)
        train_y = np.r_[np.tile([1, 0, 0, 0, 0], 100), np.tile([1, 1, 1, 1, 0], 100)]
        model = Isotonic.fit(train_p, train_y)
        val_p = np.repeat([0.01, 0.99], 250)
        val_y = np.r_[np.tile([0, 1, 0, 0, 0], 50), np.tile([1, 0, 1, 1, 1], 50)]
        self.assertAlmostEqual(reliability(val_p, val_y)['ece'], 0.19)
        self.assertAlmostEqual(reliability(model.predict(val_p), val_y)['ece'], 0.0)

    def test_reliability_endpoints_and_empty(self):
        self.assertAlmostEqual(reliability([0, 1], [0, 1])['ece'], 0)
        self.assertEqual(sum(b['n'] for b in reliability([0, 1], [0, 1])['curve']), 2)
        self.assertIsNone(reliability([], [])['ece'])

    def test_order_semantics_and_swap(self):
        p = pair_confidence(0.9, 0.2)
        self.assertAlmostEqual(p['pA'], 0.85)
        self.assertAlmostEqual(p['margin'], 0.7)
        self.assertAlmostEqual(p['order_gap'], 0.1)
        self.assertFalse(p['order_disagreement'])
        self.assertTrue(pair_confidence(0.9, 0.8)['order_disagreement'])
        self.assertTrue(pair_confidence(0.5, 0.5)['order_tie'])
        self.assertAlmostEqual(pair_confidence(0.2, 0.9)['pA'], 1 - p['pA'])
        self.assertIsNone(pair_confidence(None, 0.1)['pA'])
        self.assertIsNone(pair_confidence(float('nan'), 0.1)['pA'])

    def test_exact_binomial_math(self):
        self.assertEqual(binomial_lower(0, 0), 0)
        self.assertAlmostEqual(binomial_lower(10, 10), 0.05 ** 0.1)
        # P[Bin(2,p)>=1] = 2p-p^2 = alpha.
        self.assertAlmostEqual(binomial_lower(1, 2), 1 - math.sqrt(0.95))
        self.assertEqual(minimum_labels(), 29)
        self.assertEqual(minimum_labels(comparisons=2), 36)
        n = minimum_labels(comparisons=2 * len(threshold_grid()))
        self.assertGreaterEqual(binomial_lower(n, n, 0.05 / (2 * len(threshold_grid()))), 0.9)
        self.assertLess(binomial_lower(n - 1, n - 1, 0.05 / (2 * len(threshold_grid()))), 0.9)

    def test_exact_bound_coverage_exhaustive_small_binomial(self):
        # Exact enumeration, no Monte Carlo uncertainty in this mathematical test.
        for n in (1, 5, 20, 50):
            for p in (0.01, 0.1, 0.5, 0.8, 0.9, 0.99):
                violation = sum(math.comb(n, k) * p ** k * (1 - p) ** (n - k)
                                for k in range(n + 1) if binomial_lower(k, n) > p + 1e-12)
                self.assertLessEqual(violation, 0.05 + 1e-12)

    def test_guarantee_small_sample_falls_back(self):
        rows = synthetic()
        model = ConfidenceModel(rows[:60])
        cert = certify(prepare(rows[60:80], model), model)
        self.assertFalse(cert['nontrivial'])
        self.assertEqual((cert['hi'], cert['lo']), (1.01, 1.01))

    def test_guarantee_can_accept_and_stale_reference_rejected(self):
        rows = synthetic(400)
        model = ConfidenceModel(rows[:80])
        records = prepare(rows[80:], model)
        for r in records:
            r['predictions'] = ['A', 'A', 'A']
            r['confidence'] = 0.95
            r['forced_full'] = False
        cert = certify(records, model)
        self.assertTrue(cert['nontrivial'])
        choose_level(rows[0], model, cert['hi'], cert['lo'], certificate=cert)
        altered = ConfidenceModel.from_dict(model.to_dict())
        altered.full_weights[0] += 0.01
        with self.assertRaises(ValueError):
            choose_level(rows[0], altered, cert['hi'], cert['lo'], certificate=cert)

    def test_runtime_does_not_read_gold_or_unrun_experts(self):
        rows = synthetic()
        model = ConfidenceModel(rows)
        expected = choose_level(rows[0], model)
        self.assertEqual(choose_level({'s1p': rows[0]['s1p']}, model), expected)
        self.assertEqual(choose_level({}, model)['level'], 'full')
        with self.assertRaises(ValueError):
            choose_level(rows[0], model, 0.5, 0.8)

    def test_exact_fixed_boundaries_and_order_guard(self):
        model = ConfidenceModel(synthetic())
        for p, expected in ((0.9, 'stop'), (0.7, 'one_more'), (0.69, 'full')):
            row = {'s1p': {'pA': p, 'detail': {'AB': p, 'BA': 1 - p}}}
            self.assertEqual(choose_level(row, model, raw=True)['level'], expected)
        row = {'s1p': {'pA': 0.55, 'detail': {'AB': 0.9, 'BA': 0.8}}}
        self.assertEqual(choose_level(row, model, hi=0, lo=0)['level'], 'full')

    def test_missing_full_expert_is_excluded_not_imputed(self):
        rows = synthetic()
        model = ConfidenceModel(rows)
        row = copy.deepcopy(rows[0])
        row['ref']['pA'] = None
        self.assertEqual(prepare([row], model), [])

    def test_fit_and_validation_separation(self):
        rows = synthetic(30)
        first = calibrate_experts(rows[:15], rows[15:])
        altered = copy.deepcopy(rows[15:])
        for r in altered:
            r['_meta']['label'] = 'B' if r['_meta']['label'] == 'A' else 'A'
        second = calibrate_experts(rows[:15], altered)
        self.assertEqual(first['s1p']['map'], second['s1p']['map'])

    def test_crossfit_never_scores_its_training_item(self):
        rows = synthetic(20)
        original = prepare
        def checked(eval_rows, model):
            self.assertFalse(set(model.fit_ids) & {r['_id'] for r in eval_rows})
            return original(eval_rows, model)
        init = ConfidenceModel.__init__
        def tagged(model, train, *args, **kwargs):
            init(model, train, *args, **kwargs)
            model.fit_ids = [r['_id'] for r in train]
        with patch.object(ConfidenceModel, '__init__', tagged), patch('moj.confidence.prepare', checked):
            result = crossfit(rows)
        self.assertEqual({r['id'] for r in result}, {r['_id'] for r in rows})

    def test_sealed_and_unknown_provenance_rejected(self):
        for split in ('TEST', 'sealed_test', 'unknown'):
            rows = synthetic(2)
            rows[0]['_meta']['split'] = split
            with self.assertRaises(ValueError):
                validate_rows(rows)

    def test_serialization_and_full_parameter(self):
        rows = synthetic()
        model = ConfidenceModel(rows, full_experts=('s1p', 'ref'))
        restored = ConfidenceModel.from_dict(model.to_dict())
        self.assertEqual(model.signature, restored.signature)
        self.assertEqual(prepare(rows[:2], model), prepare(rows[:2], restored))

    def test_full_cost_does_not_charge_skipped_middle_expert(self):
        rows = synthetic()
        model = ConfidenceModel(rows, full_experts=('s1p', 's2v'), extra='ref')
        record = prepare(rows[:1], model)[0]
        self.assertEqual(record['costs'][2]['jev'], 2)
        self.assertEqual(record['costs'][2]['luna'], 1)

    def test_current_full_reference_transform_matches_harness(self):
        rows = synthetic()
        for r in rows:
            r['ref']['detail']['kind'] = 'open'
        model = ConfidenceModel(rows)
        harness = Combiner(rows)
        for r in rows[:10]:
            self.assertAlmostEqual(model.combine(r, model.full_experts, model.full_weights),
                                   harness.p(r, model.full_experts))

    def test_source_groups_never_cross_cv_folds(self):
        rows = synthetic(20)
        for i, row in enumerate(rows):
            row['_meta']['group_key'] = str(i // 2)
        original = prepare
        init = ConfidenceModel.__init__
        def tagged(model, train, *args, **kwargs):
            init(model, train, *args, **kwargs)
            model.fit_groups = {r['_meta']['group_key'] for r in train}
        def checked(eval_rows, model):
            self.assertFalse(model.fit_groups & {r['_meta']['group_key'] for r in eval_rows})
            return original(eval_rows, model)
        with patch.object(ConfidenceModel, '__init__', tagged), patch('moj.confidence.prepare', checked):
            self.assertEqual(len(crossfit(rows)), 20)

    def test_correlated_calibration_groups_cannot_certify(self):
        rows = synthetic(200)
        model = ConfidenceModel(rows[:50])
        records = prepare(rows[50:], model)
        for r in records:
            r['group_key'] = 'one-source'
            r['predictions'] = ['A', 'A', 'A']
            r['confidence'] = 0.99
        cert = certify(records, model)
        self.assertTrue(cert['repeated_calibration_groups'])
        self.assertFalse(cert['nontrivial'])


if __name__ == '__main__':
    unittest.main()
