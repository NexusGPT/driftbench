"""No network: validate one recorded answer and transport-only retries."""
import unittest
from unittest.mock import patch
import resume as r

class RecoveryTests(unittest.TestCase):
    def request(self):return {'experiment':'primary','model':'gpt-6-luna','request_sha256':'fixture','side':'audit','row':'rubric','crash_reask':True}
    def invoke(self,answers):
        events=[]
        with patch.object(r.primary,'call_once',side_effect=answers) as call, patch.object(r.primary,'append',side_effect=lambda p,x:events.append((p.name,x))),patch.object(r.time,'sleep') as sleep:
            result=r.work(self.request())
        return result,events,call.call_count,[x.args[0] for x in sleep.call_args_list]
    def test_answered_malformed_content_never_retried(self):
        result,events,n,delays=self.invoke([{'success':True,'text':'malformed','provider_response':{'choices':[{}]}}])
        self.assertEqual((n,delays,result['outcome']),(1,[],'inconclusive'))
        self.assertEqual(sum(p=='calls.jsonl' for p,x in events),1)
    def test_transport_failure_then_one_answer(self):
        result,events,n,delays=self.invoke([{'success':False,'text':'','error':{'type':'URLError'}},{'success':True,'text':'{"checks":[{"requirement":"x","status":"met","evidence":"x"}]}','provider_response':{}}])
        self.assertEqual((n,delays,result['outcome']),(2,[10],'pass'))
        self.assertEqual(sum(p=='calls.jsonl' for p,x in events),1)
        self.assertEqual(sum(x.get('event')=='finish' for p,x in events),2)
        self.assertTrue(result['crash_reask'])
    def test_exhausted_transport_has_three_tries(self):
        result,events,n,delays=self.invoke([{'success':False,'text':'','error':{'type':'RemoteDisconnected'}} for _ in range(3)])
        self.assertEqual((n,delays,result['outcome']),(3,[10,30],'inconclusive'))
        self.assertEqual(sum(p=='calls.jsonl' for p,x in events),1)
    def test_http_content_error_never_retried(self):
        result,events,n,delays=self.invoke([{'success':False,'text':'','error':{'status':400}}])
        self.assertEqual((n,delays),(1,[]))
    def test_429_uses_quota_waits_then_records_only_answer(self):
        errors=[{'success':False,'text':'','error':{'status':429}} for _ in range(3)]
        result,events,n,delays=self.invoke(errors+[{'success':True,'text':'malformed','provider_response':{}}])
        self.assertEqual((n,delays),(4,[60,120,240]))
        self.assertEqual(sum(p=='calls.jsonl' for p,x in events),1)
        self.assertNotIn('quota_pending',result)
    def test_exhausted_429_stays_pending_and_unscored(self):
        result,events,n,delays=self.invoke([{'success':False,'text':'','error':{'status':429}} for _ in range(4)])
        self.assertEqual((n,delays),(4,[60,120,240]))
        self.assertEqual(sum(p=='calls.jsonl' for p,x in events),0)
        self.assertEqual(sum(p=='quota-pending.jsonl' for p,x in events),1)
        self.assertNotIn('outcome',result)
        self.assertTrue(result['quota_pending'])

if __name__=='__main__':unittest.main()
