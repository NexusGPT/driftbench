"""Offline checks for the new model's accounting and no-answer retry rules."""
import unittest
from unittest.mock import patch
from common import load_module,HERE
r=load_module('test_lite_runner',HERE/'lite-run.py')

class LiteTests(unittest.TestCase):
    def request(self):return {'request_sha256':'fixture','experiment':'primary','side':'peer','row':'rubric'}
    def invoke(self,answers):
        events=[];r.STOP.clear()
        with patch.object(r,'recorded_attempt',side_effect=answers) as attempt,patch.object(r,'append',side_effect=lambda p,x:events.append((p.name,x))),patch.object(r.STOP,'wait') as wait:
            answer=r.work(self.request())
        r.STOP.clear()
        return answer,events,attempt.call_count,[c.args[0] for c in wait.call_args_list]
    def failure(self,status):return {'success':False,'text':'','error':{'status':status},'measured_usd':0,'request_sha256':'fixture','experiment':'primary','side':'peer','row':'rubric'}
    def test_cached_input_and_thinking_are_priced(self):
        self.assertAlmostEqual(r.cost({'promptTokenCount':1000000,'cachedContentTokenCount':200000,'candidatesTokenCount':100000,'thoughtsTokenCount':200000}),.996)
    def test_answered_malformed_content_is_not_retried(self):
        a=self.failure(0);a.update(success=True,provider_response={'candidates':[{}]},text='malformed')
        result,events,n,waits=self.invoke([a])
        self.assertEqual((n,waits,result['outcome']),(1,[],'inconclusive'))
        self.assertEqual(sum(p=='calls.jsonl' for p,x in events),1)
    def test_quota_waits_and_pending_never_scored(self):
        result,events,n,waits=self.invoke([self.failure(429) for _ in range(4)])
        self.assertEqual((n,waits),(4,[20,60,180]))
        self.assertTrue(result['pending']);self.assertNotIn('outcome',result)
        self.assertEqual(sum(p=='calls.jsonl' for p,x in events),0)
    def test_billing_stops_without_retry(self):
        result,events,n,waits=self.invoke([self.failure(402)])
        self.assertEqual((n,waits),(1,[]));self.assertTrue(result['pending'])
        self.assertEqual(sum(p=='calls.jsonl' for p,x in events),0)
    def test_transport_has_three_attempts(self):
        failures=[self.failure(503) for _ in range(3)]
        result,events,n,waits=self.invoke(failures)
        self.assertEqual((n,waits,result['outcome']),(3,[10,30],'inconclusive'))
    def test_circuit_prevents_new_http_call(self):
        r.STOP.set()
        with patch.object(r,'recorded_attempt') as attempt,patch.object(r,'append'):
            self.assertTrue(r.work(self.request())['pending'])
        attempt.assert_not_called();r.STOP.clear()

if __name__=='__main__':unittest.main()
