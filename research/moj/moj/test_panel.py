"""Deterministic tests of routing, voting, replay, and the spending boundary."""
import json
from pathlib import Path
import tempfile
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from .panel import combine, cross_family_panel, member, evaluate
from .panel_clients import Recorder, lines


class Fake:
    def __init__(self, answers):
        self.answers, self.calls = iter(answers), []
    def call(self, family, system, user, tag):
        self.calls.append((family, json.loads(user)))
        return {'key': str(len(self.calls)), 'answer': {'text': next(self.answers), 'usd': .001}, 'seconds': 1}


def context(low=True):
    return SimpleNamespace(item={'a': 'alpha', 'b': 'beta', 'question': 'q', 'low_confidence': low},
                           bench={'criterion': 'correct'}, offline=True)


class PanelTests(unittest.TestCase):
    def test_order_remapping(self):
        rec = Fake(['A', 'B'])
        result = member(context(), 'luna', rec)
        self.assertEqual(result['pA'], 1)
        self.assertEqual(rec.calls[1][1]['A'], 'beta')
    def test_strict_one_token_and_no_retry(self):
        rec = Fake(['A because', 'B'])
        self.assertIsNone(member(context(), 'luna', rec)['pA'])
        self.assertEqual(len(rec.calls), 2)
    def test_high_confidence_zero_calls(self):
        rec = Fake([])
        self.assertIsNone(cross_family_panel(context(False), recorder=rec)['pA'])
        self.assertEqual(rec.calls, [])
    def test_cascade_stops_after_two_consistent_members(self):
        rec = Fake(['A', 'B', 'A', 'B'])
        self.assertEqual(cross_family_panel(context(), cascade=True, recorder=rec)['pA'], 1)
        self.assertEqual(len(rec.calls), 4)
    def test_order_ties_escalate(self):
        rec = Fake(['A', 'A', 'A', 'A', 'A', 'B'])
        out = cross_family_panel(context(), cascade=True, recorder=rec)
        self.assertEqual(len(rec.calls), 6)
        self.assertGreater(out['pA'], .5)
    def test_agreement_and_swap_symmetry(self):
        m = {k: {'pA': p} for k,p in zip('xyz', [1, 0, 1])}
        out = combine(m)
        self.assertAlmostEqual(out['confidence'], 2/3)
        w = [2, 1, .5]
        flipped = {k: {'pA': 1-v['pA']} for k,v in m.items()}
        self.assertAlmostEqual(combine(m, w)['pA']+combine(flipped, w)['pA'], 1)
    def test_missing_member_never_silently_becomes_smaller_panel(self):
        self.assertIsNone(combine({'a': {'pA': 1}, 'b': {'pA': None}})['pA'])


class RecorderTests(unittest.TestCase):
    def test_replay_never_sends_even_invalid_answer(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)
            with patch('moj.panel_clients.send', return_value={'text': 'invalid', 'usd': .001}) as send:
                rec=Recorder(p, spend_path=p/'spend.jsonl')
                a=rec.call('luna', 's', 'u', 't')
                self.assertEqual(a,rec.call('luna', 's', 'u', 't'))
                self.assertEqual(send.call_count,1)
            offline=Recorder(p, offline=True, spend_path=p/'spend.jsonl')
            with patch('moj.panel_clients.send', side_effect=AssertionError('NETWORK')):
                self.assertEqual(a,offline.call('luna','s','u','t'))
                with self.assertRaises(RuntimeError):offline.call('luna','s','new','t')
    def test_budget_before_send(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)
            with patch('moj.panel_clients.send', side_effect=AssertionError('NETWORK')):
                rec=Recorder(p,budget=.001,spend_path=p/'spend.jsonl')
                with self.assertRaisesRegex(RuntimeError,'Budget cap'):rec.call('luna','s','u','t')
    def test_no_answer_retries_capped_across_restart(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)
            with patch('moj.panel_clients.send', side_effect=TimeoutError), patch('moj.panel_clients.time.sleep'):
                rec=Recorder(p,spend_path=p/'spend.jsonl')
                rec.call('luna','s','u','t')
            with patch('moj.panel_clients.send', side_effect=AssertionError('NETWORK')):
                rec=Recorder(p,spend_path=p/'spend.jsonl')
                self.assertIsNone(rec.call('luna','s','u','t')['answer'])
            self.assertEqual(max(r['submission'] for r in lines(p/'calls.jsonl')),3)


if __name__ == '__main__':unittest.main()


class RouterTests(unittest.TestCase):
    def test_reference_goes_first_and_can_stop(self):
        from .panel import route_item
        ctx = context()
        ctx.item['reference'] = 'trusted'
        with patch('moj.reference_first.reference_first', return_value={'pA': .9, 'confidence': .9, 'detail': {}}) as ref:
            stage = unittest.mock.Mock(side_effect=AssertionError('stage1 should not run'))
            out = route_item(ctx, {}, stage)
        self.assertEqual(out['path'], ['reference_first'])
        ref.assert_called_once()
    def test_uncertain_reference_then_low_stage_then_panel(self):
        from .panel import route_item
        ctx = context()
        ctx.item['reference'] = 'trusted'
        events=[]
        def ref(c):events.append('reference');return {'pA': .5, 'confidence': .5, 'detail': {}}
        def s1(c):events.append('stage1');return {'pA': .6, 'detail': {}}
        def panel(c, **kw):events.append('panel');return {'pA': 1, 'detail': {}}
        with patch('moj.reference_first.reference_first', side_effect=ref), patch('moj.panel.cross_family_panel', side_effect=panel):
            out=route_item(ctx,{},s1)
        self.assertEqual(events,['reference','stage1','panel'])
        self.assertEqual(out['path'],['reference_first','stage1','panel'])
    def test_high_stage_never_calls_panel(self):
        from .panel import route_item
        with patch('moj.panel.cross_family_panel',side_effect=AssertionError('should not call')):
            self.assertEqual(route_item(context(),{},lambda c:{'pA':.9})['path'],['stage1'])


class RegressionTests(unittest.TestCase):
    def test_duplicate_source_splits_count_once(self):
        from .panel import unique_population
        rows=[{'key':'b|id','label':'A','input_hash':'one'}, {'key':'b|id','label':'A','input_hash':'two'}]
        self.assertEqual(len(unique_population(rows)),1)
        rows[1]['label']='B'
        with self.assertRaises(ValueError):unique_population(rows)
    def test_gemini_402_skips_are_recorded_and_offline(self):
        import urllib.error
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)
            error=urllib.error.HTTPError('https://example.invalid',402,'payment',{},None)
            with patch('moj.panel_clients.send',side_effect=error) as send:
                rec=Recorder(p,spend_path=p/'spend.jsonl')
                rec.call('gemini','s','u','t')
                blocked=rec.call('gemini','s','other','t')
                self.assertEqual(send.call_count,1)
                self.assertEqual(blocked['submission'],0)
                self.assertEqual(rec.accounting(blocked['key'])['calls'],0)
            offline=Recorder(p,offline=True,spend_path=p/'spend.jsonl')
            self.assertEqual(blocked,offline.call('gemini','s','other','t'))
    def test_timeout_cost_stays_unknown_after_success(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)
            with patch('moj.panel_clients.send',side_effect=[TimeoutError(),{'text':'A','usd':.001}]), patch('moj.panel_clients.time.sleep'):
                rec=Recorder(p,spend_path=p/'spend.jsonl')
                result=rec.call('luna','s','u','t')
            cost=rec.accounting(result['key'])
            self.assertEqual(cost['calls'],2)
            self.assertFalse(cost['cost_complete'])
            self.assertGreater(cost['unpriced_reservations_usd'],0)
    def test_point_kind_is_single_candidate(self):
        from .reference_first import reference_first
        ctx=context();ctx.item.update(kind='point',reference='trusted')
        ctx.jev=unittest.mock.Mock(return_value={'point_0':.8})
        self.assertEqual(reference_first(ctx)['pA'],.8)
        self.assertEqual(ctx.jev.call_count,1)
