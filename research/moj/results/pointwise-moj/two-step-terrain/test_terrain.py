import unittest
from unittest.mock import patch
from moj import two_step_terrain as z

class TerrainTests(unittest.TestCase):
    def test_disagreement_forces_full_judge(self):
        i={'kind':'point','rubric':'all conditions','bench':'fictional','id':'x'}
        first={'pA':.9,'usage':[]};second={'pA':.1,'usage':[]}
        with patch.object(z,'terrain',return_value='hard_criterion'),patch.object(z,'agreement',return_value=(False,.9,first,second)),patch.object(z.t,'collect_one',return_value={'usage':[]}) as route,patch.object(z.r,'old_signal',return_value={'pA':0,'usage':[]}):
            d=z.hard_decision(i,{}, {'thresholds':{'hard_criterion':0}}, {'hard_criterion':{'x':[0,1],'y':[1,1]}})
        self.assertEqual(d['level'],'routed');self.assertEqual(d['verdict'],'B');route.assert_called_once()

    def test_agreement_below_confidence_still_routes(self):
        s={'pA':.9,'usage':[]}
        with patch.object(z,'terrain',return_value='hard_criterion'),patch.object(z,'agreement',return_value=(True,.9,s,s)),patch.object(z.t,'collect_one',return_value={'usage':[]}),patch.object(z.r,'old_signal',return_value={'pA':0,'usage':[]}):
            d=z.hard_decision({}, {}, {'thresholds':{'hard_criterion':.8}}, {'hard_criterion':{'x':[0,1],'y':[.7,.7]}})
        self.assertEqual(d['level'],'routed')

    def test_rubric_pair_never_calls_router(self):
        with patch.object(z,'terrain',return_value='rubric_pair'),patch.object(z.r,'old_signal',return_value={'pA':.1,'usage':[]}),patch.object(z.t,'decide',side_effect=AssertionError('forbidden')):
            d=z.decide({}, {}, {})
        self.assertEqual(d['path'],['commit-rubric-rows'])

if __name__=='__main__':unittest.main()
