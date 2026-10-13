"""Offline contract probes for the isolated router."""
import copy
import unittest
from unittest.mock import patch
from moj import pointwise_router as r

class RouterTests(unittest.TestCase):
    def item(self, **kw):
        return {'bench':'verify','id':'fictional','question':'2 + 2?', 'a':'4','b':'',
                'kind':'point','label':'A','half':'tune','split_group':'fictional',**kw}

    def test_prompt_excludes_outcomes_and_identifiers(self):
        i=self.item(baselines={'secret':'B'},group='forbidden',reference='4')
        p=r.payload(i)
        self.assertFalse(set(p)&{'bench','id','label','half','group','baselines','split_group'})

    def test_input_shape_routes_without_benchmark_name(self):
        i=self.item()
        self.assertEqual(r.content(i),r.content({**i,'bench':'arbitrary'}))
        self.assertEqual(r.content({**i,'reference':'4'}),'evidence')
        self.assertEqual(r.content({**i,'kind':'pair','b':'5','rows':[('a','Correct?')]}),'pair')

    def test_calibration_never_reads_validation_labels(self):
        train=[self.item(),self.item(id='second',label='B')]
        with patch.object(r,'raw_base',side_effect=lambda i,*a:(.9 if i['id']=='fictional' else .1,[],[])):
            maps=r.calibrator(train,{},False,False)
        self.assertEqual(r.confidence(.9,'unreferenced',maps),1)
        self.assertEqual(r.confidence(None,'unreferenced',maps),0)

    def test_constant_fail_has_zero_sensitivity(self):
        items=[self.item(),self.item(id='negative',label='B')]
        ds={r.key(i):{'verdict':'B','usage':[]} for i in items}
        m=r.metrics(items,ds)
        self.assertEqual((m['balanced'],m['sensitivity'],m['specificity']),(.5,0,1))

    def test_tie_half_credit_is_explicit(self):
        i=self.item();m=r.metrics([i],{r.key(i):{'verdict':'tie','usage':[]}})
        self.assertEqual(m['accuracy'],.5)

    def test_same_reference_group_has_one_half(self):
        groups={}
        for i in r.rows():
            groups.setdefault(i['bench']+'|'+r.group_key(i),set()).add(i['half'])
        self.assertTrue(all(len(h)==1 for h in groups.values()))

    def test_reasoning_guard_overrides_confident_evidence(self):
        i=self.item(reference='4')
        cfg={'reference':True,'reasoning_guard':True,'s2_maps':{}}
        maps={'evidence':{'x':[.5,1.],'y':[.99,.99]}}
        with patch.object(r,'raw_base',return_value=(.9,['reference'],[])), \
             patch.object(r,'get_signal',return_value={'detail':{'needs_reasoning':.9}}), \
             patch.object(r,'old_signal',return_value={'pA':0.,'usage':[]}):
            d=r.decide(i,{},cfg,maps)
        self.assertEqual(d['verdict'],'B')
        self.assertIn('luna',d['path'])

    def test_supplied_reference_has_priority_over_rows(self):
        i=self.item(reference='4')
        def signal(i,name):
            return {'pA':.1,'detail':{},'usage':[]} if name=='reference' else {'detail':{},'usage':[]}
        with patch.object(r,'old_signal',return_value={'pA':.9,'usage':[]}), patch.object(r,'get_signal',side_effect=signal):
            p,path,_=r.raw_base(i,{})
        self.assertEqual(p,.1)
        self.assertIn('reference',path)

    def test_provider_model_and_limits(self):
        rec=r.recorder(True)
        self.assertEqual(r.panel_clients.MODELS['gemini'],'gemini-3.5-flash-lite')
        self.assertEqual(r.panel_clients.LIMITS['gemini'],8)
        self.assertEqual(r.panel_clients.LIMITS['haiku'],2)
        self.assertEqual(r.client.JEV_PARALLEL,3)
        self.assertEqual(rec.budget,15)

if __name__=='__main__':unittest.main()
