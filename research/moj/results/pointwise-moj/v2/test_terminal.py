"""Behavior checks for terminal authority and evidence boundaries."""
import unittest
from unittest.mock import patch
from moj import pointwise_router as r

class TerminalTests(unittest.TestCase):
    def item(self, **extra):
        return dict(bench='arbitrary', id='fictional', kind='point', question='2+2?', a='4', b='', **extra)

    def decide(self, item, signal):
        cfg = {'terminal_reference': True, 'solve_unreferenced': True,
               'terminal_calibration': {'pw_whole': {'x':[0,1], 'y':[0,0]},
                                        'pw_ref_luna': {'x':[0,1], 'y':[0,0]}}}
        with patch.object(r, 'old_signal', return_value=signal) as expert, \
             patch.object(r, 'get_signal', return_value={'usage':[], 'detail':{'needs_reasoning':0}}), \
             patch.object(r, 'raw_base', side_effect=AssertionError('forbidden override')), \
             patch.object(r, 'ensure_panel', side_effect=AssertionError('forbidden panel')):
            decision = r.decide(item, {}, cfg, {})
        return decision, expert.call_args.args[1]

    def test_reference_terminal_even_when_uncalibrated_and_near_tie(self):
        d, expert = self.decide(self.item(reference='4'), {'pA':.51,'detail':{},'usage':[]})
        self.assertEqual((d['verdict'],d['level'],d['confidence'],expert), ('A','terminal',0,'pw_whole'))

    def test_no_evidence_solves_even_when_terrain_says_no_reasoning(self):
        d, expert = self.decide(self.item(), {'pA':.49,'detail':{'reference':'4'},'usage':[{'provider':'luna','count':1,'usd':.01}]})
        self.assertEqual((d['verdict'],expert), ('B','pw_ref_luna'))
        self.assertEqual(d['path'], ['terrain','pw_ref_luna'])
        self.assertEqual(sum(u.get('count',1) for u in d['usage']),1)

    def test_missing_generated_evidence_cannot_fall_back_to_s1(self):
        with self.assertRaisesRegex(RuntimeError,'evidence missing'):
            self.decide(self.item(), {'pA':.9,'detail':{},'usage':[]})

    def test_invalid_probabilities_do_not_become_verdicts(self):
        for p in (None, float('nan'), float('inf'), -1, 2, True):
            with self.subTest(p=p), self.assertRaisesRegex(RuntimeError,'evidence missing'):
                self.decide(self.item(reference='4'), {'pA':p,'detail':{},'usage':[]})

    def test_rubric_and_pair_are_not_unsupported_correctness(self):
        cfg={'terminal_reference':True,'solve_unreferenced':True}
        self.assertIsNone(r.terminal_expert(self.item(rubric='Say hello'),cfg))
        self.assertIsNone(r.terminal_expert(self.item(rows=[('r','Say hello')]),cfg))
        self.assertIsNone(r.terminal_expert({**self.item(),'kind':'pair'},cfg))

    def test_no_benchmark_or_label_can_change_authority(self):
        cfg={'terminal_reference':True,'solve_unreferenced':True}
        for reference,name in (('', 'pw_ref_luna'),('4','pw_whole')):
            for bench in ('verify','hardrows','fictional'):
                i={**self.item(reference=reference),'bench':bench,'label':'B','half':'valid'}
                self.assertEqual(r.terminal_expert(i,cfg),name)

if __name__=='__main__':unittest.main()
