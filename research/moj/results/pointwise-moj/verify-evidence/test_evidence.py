import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from moj import verify_evidence as e

class Recorder:
    def __init__(self,obj):self.obj=obj;self.user=None
    def call(self,provider,system,user,tag):
        import json
        self.user=json.loads(user)
        return {'key':'fictional','answer':{'text':json.dumps(self.obj)}}
    def accounting(self,key):return {'calls':1,'usd':.001}

class Ctx:
    calls=[]
    def __init__(self,*args):pass
    def jev(self,state,questions):return {'defect':.99}

class EvidenceTests(unittest.TestCase):
    def check(self,quote,final=True):
        rec=Recorder({'error_found':True,'quote':quote,'changes_final_answer':final})
        with tempfile.TemporaryDirectory(dir=e.OUT) as folder,patch.object(e,'path',return_value=Path(folder)/'new.json'),patch.object(e.r,'Ctx',Ctx):
            result=e.collect_one({'question':'q','a':'2 + 2 = 5','id':'x','label':'B','reference':'SECRET_GOLD'},rec,False)
        self.assertEqual(set(rec.user),{'question','candidate'})
        return result
    def test_unquoted_allegation_cannot_veto(self):self.assertEqual(self.check('not in candidate')['pA'],1)
    def test_abandoned_error_cannot_veto(self):self.assertEqual(self.check('2 + 2 = 5',False)['pA'],1)
    def test_quoted_final_error_can_veto(self):self.assertLess(self.check('2 + 2 = 5')['pA'],.02)
    def test_returned_answer_is_not_asked_again(self):
        with tempfile.TemporaryDirectory(dir=e.OUT) as folder:
            p=Path(folder)/'cached.json';p.write_text('{"pA":0.4}')
            with patch.object(e,'path',return_value=p):
                self.assertEqual(e.collect_one({},None,False),{'pA':.4})
if __name__=='__main__':unittest.main()
