"""The fitted terminal gate must reject low-confidence reference authority."""
import unittest
from unittest.mock import patch
from moj import pointwise_router as r

class ThresholdTests(unittest.TestCase):
    def run_case(self, p, c, threshold, reference=True):
        item={'bench':'fictional','id':'x','kind':'point','question':'2+2?','a':'4','b':''}
        if reference:item['reference']='4'
        expert='pw_whole' if reference else 'pw_ref_luna'
        cfg={'terminal_reference':True,'solve_unreferenced':True,'terminal_threshold':threshold,
             'terminal_calibration':{expert:{'x':[0,1],'y':[c,c]}},
             'reference':True,'panel':False,'s2_maps':{}}
        def signal(i,name,stores):
            return {'pA':p if name==expert else 0.,'detail':{'reference':'4'},'usage':[]}
        with patch.object(r,'old_signal',side_effect=signal), \
             patch.object(r,'get_signal',return_value={'usage':[],'detail':{'needs_reasoning':0}}), \
             patch.object(r,'raw_base',side_effect=AssertionError('S1 correctness must not enter')):
            return r.decide(item,{},cfg,{})

    def test_below_threshold_continues(self):
        d=self.run_case(.9,.7,.8)
        self.assertEqual(d['verdict'],'B')
        self.assertEqual(d['path'],['terrain','pw_whole','luna'])

    def test_at_threshold_stops(self):
        d=self.run_case(.9,.8,.8)
        self.assertEqual((d['verdict'],d['level']),('A','terminal'))

    def test_generated_reference_fallback_never_calls_s1_correctness(self):
        d=self.run_case(.9,.7,.8,reference=False)
        self.assertEqual(d['verdict'],'B')
        self.assertEqual(d['path'],['terrain','pw_ref_luna','luna'])

    def test_raw_margin_cannot_replace_calibrated_confidence(self):
        d=self.run_case(.99,.7,.8)
        self.assertNotIn('level',d)
        self.assertEqual(d['verdict'],'B')

if __name__=='__main__':unittest.main()
