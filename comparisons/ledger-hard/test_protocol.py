import unittest
from common import *
from score import exact, holm, bootstrap

class Protocol(unittest.TestCase):
    def test_frozen_candidate(self):
        self.assertEqual(native.procedure_fingerprint(), 'd7f5e226bf5afe7b955ee0f2247835cd19953001c196dcc7260d1f0c37922587')
    def test_exact_known_values(self):
        self.assertEqual(exact(7,1)['two_sided_exact'],'9/128')
        self.assertEqual(exact(7,1)['one_sided_exact'],'9/256')
        self.assertEqual(exact(0,0)['two_sided_p'],1)
        self.assertEqual(exact(0,10)['two_sided_p'],exact(10,0)['two_sided_p'])
    def test_inconclusive(self):
        self.assertEqual(native.outcome('{"checks":[]}','audit','rubric'),'inconclusive')
        self.assertEqual(native.outcome('{"checks":[{"requirement":"x","status":"violated","evidence":"x"}]}','audit','rubric'),'fail')
    def test_holm(self):
        self.assertEqual(holm({'a':.001,'b':.01,'c':.1}),{'a':.003,'b':.02,'c':.1})
    def test_bootstrap_keeps_pairs(self):
        units=[{'row':'r','family':str(i),'ours_right':True,'peer_right':True} for i in range(12)]
        self.assertEqual(bootstrap(units,100)['difference'],[0,0])
    def test_no_label_leak_and_full_evidence(self):
        for row in ROWS:
            for item in generator.make_sets(33731111,24)[row]:
                p=prompt(item,row,'audit')
                self.assertNotIn('"truth"',p['user'])
                self.assertNotIn('"kind"',p['user'])
                self.assertNotIn('"expect"',p['user'])
                if row=='goal':self.assertEqual(json.loads(p['user'])['persisted_final_state'],item['endState'])

if __name__=='__main__':unittest.main()
