import unittest
from score import result,fold,wilson,metric
class ScoreTests(unittest.TestCase):
 def test_missing_and_none_are_incorrect_in_full_denominator(self):
  c=[{'id':'a','truth':False},{'id':'b','truth':True},{'id':'c','truth':False}]
  r=result(c,[{'id':'a','p':False},{'id':'b','p':None}],lambda a:a['p'],lambda c:c['truth'])
  self.assertEqual((r['correct'],r['n'],r['unanswered']),(1,3,2))
 def test_unrecovered_native_transport_is_unscored(self):
  cases=[{'id':'failed','truth':True},{'id':'ok','truth':False}]
  r=result(cases,[{'id':'failed','p':None,'unscored':True},{'id':'ok','p':False}],lambda a:a['p'],lambda c:c['truth'])
  self.assertEqual((r['correct'],r['n'],r['total'],r['unanswered'],r['unscored']),(1,1,2,0,1))
  self.assertEqual(r['unscored_ids'],['failed'])
 def test_pending_submission_is_coverage_not_quality_loss(self):
  cases=[{'id':'done','truth':True},{'id':'pending','truth':False}]
  r=metric(cases,{'complete':False,'answers':[{'id':'done','p':True,'costUsd':.01}]},lambda a:a['p'],lambda c:c['truth'])
  self.assertEqual((r['correct'],r['n'],r['total'],r['pending'],r['transportUnscored']),(1,1,2,1,0))
 def test_independent_failure_dominates_missing(self):
  self.assertEqual(fold(['inconclusive','fail']),'fail')
  self.assertEqual(fold(['pass','inconclusive']),'inconclusive')
  self.assertIsNone(fold(['pass',None]))
 def test_interval_uses_full_n(self):
  lo,hi=wilson(120,120);self.assertGreater(lo,.96);self.assertLessEqual(hi,1)
  self.assertLess(wilson(88,120)[0],.65)
if __name__=='__main__':unittest.main()
