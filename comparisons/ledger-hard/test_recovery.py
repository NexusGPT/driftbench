"""No network: validate one recorded answer and transport-only retries."""
import unittest
from unittest.mock import patch
import resume as r

class RecoveryTests(unittest.TestCase):
    def test_limits_are_shared_across_experiments(self):
        active={i:{'experiment':'primary' if i%2 else 'dialect','model':'gpt-6-luna'} for i in range(8)}
        self.assertFalse(r.model_slot_available('gpt-6-luna',active))
        self.assertTrue(r.model_slot_available('haiku',active))
        active[8]={'experiment':'primary','model':'haiku'}
        self.assertTrue(r.model_slot_available('haiku',active))
        active[9]={'experiment':'dialect','model':'haiku'}
        self.assertFalse(r.model_slot_available('haiku',active))
        for i in (10,11):active[i]={'experiment':'dialect','model':'gemini-3.8-flash'}
        self.assertFalse(r.model_slot_available('gemini-3.8-flash',active))
        active.pop(0)
        self.assertTrue(r.model_slot_available('gpt-6-luna',active))
    def test_daily_hold_releases_only_at_reset(self):
        hold={'models':['gemini-3.8-flash'],'resume_not_before':'2026-10-14T00:00:00+00:00'}
        before=r.datetime.datetime.fromisoformat('2026-10-13T23:59:59+00:00')
        after=r.datetime.datetime.fromisoformat('2026-10-14T00:00:00+00:00')
        self.assertEqual(r.hold_after_reset(hold,before)['models'],['gemini-3.8-flash'])
        self.assertEqual(r.hold_after_reset(hold,after)['models'],[])
        self.assertEqual(hold['models'],['gemini-3.8-flash'])
        billing={'models':['gemini-3.8-flash'],'reason':'HTTP 402'}
        self.assertEqual(r.hold_after_reset(billing,after),billing)
    def test_owner_hold_survives_reset_and_forces_provider_block(self):
        after=r.datetime.datetime.fromisoformat('2026-10-14T01:00:00+00:00')
        for models in [[],['gemini-3.8-flash']]:
            hold={'models':models,'resume_not_before':'2026-10-14T00:00:00+00:00','requires_owner_resume':True}
            self.assertEqual(r.hold_after_reset(hold,after)['models'],['gemini-3.8-flash'])
    def test_cutoff_extension_applies_only_to_gemini(self):
        amendment={'gemini_missing_only_cutoff':'2026-10-14T12:00:00+00:00'}
        self.assertEqual(r.deadline_for('gemini-3.8-flash',amendment),'2026-10-14T12:00:00+00:00')
        for model in ['haiku','gpt-6-luna']:
            self.assertEqual(r.deadline_for(model,amendment),'2026-10-13T20:00:00+00:00')
    def request(self):return {'experiment':'primary','model':'gpt-6-luna','request_sha256':'fixture','side':'audit','row':'rubric','crash_reask':True}
    def invoke(self,answers):
        events=[]
        with patch.object(r,'PROVIDER_HOLDS',set()),patch.object(r,'dump'),patch.object(r.primary,'call_once',side_effect=answers) as call, patch.object(r.primary,'append',side_effect=lambda p,x:events.append((p.name,x))),patch.object(r.time,'sleep') as sleep:
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
    def test_402_stops_provider_without_retry_or_judge_result(self):
        result,events,n,delays=self.invoke([{'success':False,'text':'','error':{'status':402}}])
        self.assertEqual((n,delays),(1,[]))
        self.assertEqual(sum(p=='calls.jsonl' for p,x in events),0)
        self.assertEqual(sum(p=='billing-rejections.jsonl' for p,x in events),1)
        self.assertTrue(result['billing_pending'] and result['proven_rejection'])
        self.assertNotIn('outcome',result)
    def test_provider_hold_prevents_new_http_dispatch(self):
        with patch.object(r,'PROVIDER_HOLDS',{'gpt-6-luna'}),patch.object(r.primary,'call_once') as call:
            result=r.work(self.request())
        call.assert_not_called()
        self.assertTrue(result['hold_without_dispatch'])

if __name__=='__main__':unittest.main()
