import unittest
from unittest.mock import patch
from moj import two_step as t

class TwoStepTests(unittest.TestCase):
    def item(self,**kw):return dict(bench='fictional',id='x',kind='point',question='q',a='a',b='',rubric='criterion',**kw)

    def cfg(self):
        return {'commit_threshold':.9,'commit_maps':{'rubric':{'x':[0,1],'y':[.99,.99]}},'expert_maps':{}}

    def test_commit_never_calls_router(self):
        s={'pA':.9,'detail':{'can_commit':.99},'usage':[]}
        with patch.object(t,'get',return_value=s),patch.object(t,'collect_one',return_value=s) as collect,patch.object(t,'stage2',side_effect=AssertionError('router forbidden')):
            d=t.decide(self.item(),self.cfg(),{},collect=True)
        self.assertEqual(d['path'],['commit'])
        self.assertEqual([x.args[1] for x in collect.call_args_list],['commit'])

    def test_abstention_calls_router_separately(self):
        s={'pA':.9,'detail':{'can_commit':.99},'usage':[]};cfg={**self.cfg(),'commit_threshold':1.01}
        with patch.object(t,'get',return_value=s),patch.object(t,'collect_one',return_value=s) as collect,patch.object(t,'stage2',return_value={'path':['route','pw_rows'],'usage':[],'verdict':'A'}):
            d=t.decide(self.item(),cfg,{},collect=True)
        self.assertEqual([x.args[1] for x in collect.call_args_list],['commit','route'])
        self.assertEqual(d['path'][0],'abstain')

    def test_unsupported_correctness_abstains(self):
        i=self.item();i.pop('rubric');cfg=self.cfg();cfg['commit_maps']['question']={'x':[0,1],'y':[1,1]}
        with patch.object(t,'get',return_value={'pA':1,'detail':{'can_commit':1}}):
            self.assertFalse(t.committed(i,cfg)[0])

    def test_no_cross_mode_label_leak(self):
        tune=t.population('tune');valid=t.population('valid')
        a={i['id'] for i in tune if i['bench'].startswith('verify')}
        b={i['id'] for i in valid if i['bench'].startswith('verify')}
        self.assertFalse(a&b)
        twins=[i for i in tune if i['bench'].startswith('verify')]
        by={}
        for i in twins:by.setdefault(i['id'],set()).add(t.fold(i))
        self.assertTrue(all(len(v)==1 for v in by.values()))

    def test_judge_menu_has_no_other_system2_family(self):
        for b in ('pair','reference_solution','reference_facts','rubric_compound','rubric_simple','question'):
            self.assertFalse(any('gemini' in n or 'haiku' in n for n in t.menu(b)))

if __name__=='__main__':unittest.main()
