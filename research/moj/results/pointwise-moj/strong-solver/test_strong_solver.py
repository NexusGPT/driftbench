"""Focused boundary checks; no model calls."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from moj import verify_strong_solver as s


class StrongSolverTests(unittest.TestCase):
    def test_cost_cache_and_reasoning(self):
        raw={'usage':{'prompt_tokens':1000,'completion_tokens':200,
             'prompt_tokens_details':{'cached_tokens':300,'cache_write_tokens':400},
             'completion_tokens_details':{'reasoning_tokens':150}}}
        self.assertAlmostEqual(s.sol_cost(raw),.00363)
        self.assertIsNone(s.sol_cost({}))

    def test_transport_and_prompt_boundary(self):
        req=s.request('sol','QUESTION_ONLY_SENTINEL')
        self.assertEqual(req['body']['messages'],[{'role':'system','content':s.SOLVE_SYSTEM},{'role':'user','content':'QUESTION_ONLY_SENTINEL'}])
        self.assertNotIn('temperature',req['body'])
        self.assertEqual(req['body']['reasoning_effort'],'medium')
        self.assertEqual(s.request('sonnet','q')['environment']['DISABLE_PROMPT_CACHING'],'1')

    def test_returned_malformed_answer_never_repeated(self):
        with tempfile.TemporaryDirectory() as d, patch.object(s,'OUT',Path(d)), patch.object(s,'send',return_value={'text':'bad','usd':.01}) as send:
            rec=s.Recorder(); first=rec.call('sol','test')
            self.assertEqual(first,rec.call('sol','test'))
            self.assertEqual(first,s.Recorder(True).call('sol','test'))
            self.assertEqual(send.call_count,1)
            self.assertAlmostEqual(rec.spend(),.01)

    def test_cap_and_missing_are_not_passes(self):
        with tempfile.TemporaryDirectory() as d, patch.object(s,'OUT',Path(d)), patch.object(s,'CAP',.001), patch.object(s,'send') as send:
            with self.assertRaisesRegex(RuntimeError,'Budget cap'):s.Recorder().call('sol','test')
            send.assert_not_called()
        self.assertEqual(s.decisions({'x':{'pA':None}},0.)['x']['verdict'],'missing')

    def test_threshold_preserves_recall(self):
        items=[{'bench':'verify','id':str(k),'label':label} for k,label in enumerate(['A','A','B','B'])]
        sigs={'verify|'+str(k):{'pA':p} for k,p in enumerate([.2,.8,.7,.9])}
        chosen=s.select(items,sigs)
        self.assertGreaterEqual(chosen['sensitivity'],.5)
        self.assertNotEqual(chosen['threshold'],1.01)

if __name__=='__main__':unittest.main()
