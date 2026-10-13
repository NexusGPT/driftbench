"""Offline fixture checks for reference-first and its matched ablation."""
import copy
import json
import unittest

from .reference_first import eligible, reference_blind, reference_first, reference_of


class FixtureContext:
    def __init__(self, item=None, probabilities=None):
        self.item = item or {'question': 'Which city is the capital of France?',
                             'a': 'Paris', 'b': 'Lyon',
                             'reference_answer': 'REFERENCE_ONLY_SENTINEL Paris',
                             'label': 'LABEL_ONLY_SENTINEL',
                             'baselines': {'private': 'BASELINE_ONLY_SENTINEL'}}
        self.bench = {'criterion': 'The capital city is correct.',
                      'rows': [('city', 'The capital city is correct.'),
                               ('country', 'The country is correct.')]}
        self.requests = []
        self.probabilities = probabilities or {'Paris': 0.9, 'Lyon': 0.1}

    def jev(self, state, questions):
        self.requests.append(copy.deepcopy({'state': state, 'questions': questions}))
        return {name: self.probabilities[state['reply']] for name in questions}


class ReferenceFirstTests(unittest.TestCase):
    def test_reference_is_explicit_and_never_a_label(self):
        self.assertFalse(eligible({'label': 'Paris', 'a': 'Paris', 'b': 'Lyon'}))
        self.assertIsNone(reference_of({'reference': {'label': 'Paris'}}))
        self.assertEqual(reference_of({'reference': {'answer': 'Paris'}}), 'Paris')
        self.assertEqual(reference_of({'reference_rows': [{'statement': 'Paris'},
                                                           {'text': 'France'}]}), 'Paris\nFrance')
        self.assertEqual(reference_of({'reference_answer': 0}), '0')

    def test_pairwise_per_candidate_and_confidence(self):
        ctx = FixtureContext()
        result = reference_first(ctx)
        self.assertAlmostEqual(result['pA'], 0.9)
        self.assertAlmostEqual(result['confidence'], 0.9)
        self.assertEqual(len(ctx.requests), 2)
        self.assertEqual([r['state']['reply'] for r in ctx.requests], ['Paris', 'Lyon'])
        self.assertTrue(all(len(r['questions']) == 2 for r in ctx.requests))

    def test_ablation_has_no_reference_anywhere_in_payload(self):
        ctx = FixtureContext()
        reference_blind(ctx)
        payload = json.dumps(ctx.requests).lower()
        self.assertNotIn('reference', payload)
        self.assertEqual(len(ctx.requests), 2)

    def test_labels_and_baselines_never_enter_either_request(self):
        for expert in (reference_first, reference_blind):
            ctx = FixtureContext()
            expert(ctx)
            payload = json.dumps(ctx.requests)
            self.assertNotIn('LABEL_ONLY_SENTINEL', payload)
            self.assertNotIn('BASELINE_ONLY_SENTINEL', payload)

    def test_missing_reference_means_zero_calls_in_both_arms(self):
        for expert in (reference_first, reference_blind):
            ctx = FixtureContext({'question': 'Q', 'a': 'A', 'b': 'B', 'label': 'A'})
            result = expert(ctx)
            self.assertIsNone(result['pA'])
            self.assertFalse(result['detail']['eligible'])
            self.assertEqual(ctx.requests, [])

    def test_swapping_candidates_complements_probability(self):
        for expert in (reference_first, reference_blind):
            ctx = FixtureContext()
            first = expert(ctx)
            swapped = copy.deepcopy(ctx.item)
            swapped['a'], swapped['b'] = swapped['b'], swapped['a']
            second = expert(FixtureContext(swapped))
            self.assertAlmostEqual(first['pA'], 1 - second['pA'])
            self.assertAlmostEqual(first['confidence'], second['confidence'])

    def test_missing_answer_does_not_become_a_partial_verdict(self):
        ctx = FixtureContext(probabilities={'Paris': None, 'Lyon': 0.1})
        self.assertIsNone(reference_first(ctx)['pA'])
        self.assertEqual(len(ctx.requests), 2)

    def test_pointwise_is_explicit_and_uses_one_call(self):
        ctx = FixtureContext()
        ctx.item.update(kind='pointwise', b='')
        self.assertAlmostEqual(reference_first(ctx)['pA'], 0.9)
        self.assertEqual(len(ctx.requests), 1)
        ctx = FixtureContext()
        ctx.item.update(kind='pointwise', candidate_side='b')
        self.assertAlmostEqual(reference_first(ctx)['pA'], 0.9)

    def test_decompose_never_triggers_generation(self):
        ctx = FixtureContext()
        ctx.bench['rows'] = 'decompose'
        reference_first(ctx)
        self.assertEqual(len(ctx.requests[0]['questions']), 1)

    def test_nan_and_out_of_range_are_missing_answers(self):
        for bad in (float('nan'), float('inf'), -0.1, 1.1, True, '0.9'):
            ctx = FixtureContext(probabilities={'Paris': bad, 'Lyon': 0.1})
            self.assertIsNone(reference_first(ctx)['pA'])


if __name__ == '__main__':
    unittest.main()
