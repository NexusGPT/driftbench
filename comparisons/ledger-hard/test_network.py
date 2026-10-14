import tempfile,unittest
from contextlib import ExitStack
from unittest.mock import patch
from common import HERE,load_module
n=load_module('tested_network_runtime',HERE/'network-resume.py')

class NetworkPolicy(unittest.TestCase):
    def test_saved_answer_receipt_is_recovered_without_a_provider_call(self):
        with tempfile.TemporaryDirectory(dir=HERE) as temp:
            root=n.Path(temp);dest=root/'gpt-6.1-sol';(dest/'primary').mkdir(parents=True);(dest/'dialect').mkdir()
            answer={'event':'finish','request_sha256':'answered','attempt':1,'experiment':'primary','side':'peer','row':'rubric','success':True,'text':'{"pass":true}','provider_response':{'status':'completed'}}
            n.r.append(dest/'attempts.jsonl',answer)
            with patch.object(n,'HERE',root),patch.object(n.r.Driver,'attempt',side_effect=AssertionError('Must not call provider')):
                n.recover_answer_receipts('gpt-6.1-sol');n.recover_answer_receipts('gpt-6.1-sol')
            recorded=n.r.answers(dest);self.assertEqual(len(recorded),1)
            self.assertEqual(recorded[0]['outcome'],'pass');self.assertTrue(recorded[0]['recovered_from_durable_attempt_receipt'])
    def test_zero_token_session_limit_waits_without_becoming_an_answer(self):
        raw={'is_error':True,'result':'You have hit your usage limit.','usage':{'input_tokens':0,'output_tokens':0},'total_cost_usd':0}
        answer=n.normalize_session_limit({'provider_response':raw,'integrity_stop':True,'measured_usd':0})
        self.assertFalse(n.has_answer(answer));self.assertTrue(n.transport_no_answer(answer))
        self.assertEqual(answer['cli_error_response'],raw);self.assertEqual(answer['error']['type'],'SessionLimitError')
        self.assertEqual(answer['unreported_cost_reserve_usd'],.10);self.assertNotIn('integrity_stop',answer)
    def test_model_text_about_limits_is_never_reclassified(self):
        raw={'is_error':False,'result':'The policy has a usage limit.','usage':{'input_tokens':10,'output_tokens':8}}
        answer=n.normalize_session_limit({'provider_response':raw})
        self.assertTrue(n.has_answer(answer));self.assertIn('provider_response',answer)
    def test_recovery_cycles_keep_one_answer_per_key(self):
        with tempfile.TemporaryDirectory(dir=HERE) as temp,ExitStack() as stack:
            root=n.Path(temp);dest=root/'gpt-6.1-sol';(dest/'primary').mkdir(parents=True);(dest/'dialect').mkdir()
            (dest/'seal.json').write_text('{"last_call_cutoff":"2099-01-01T00:00:00+00:00"}')
            requests=[{'request_sha256':str(i),'id':str(i),'row':'rubric','side':'peer','experiment':'primary','model':'gpt-6.1-sol'} for i in range(2)]
            def fake_attempt(driver,request,number):
                common={**request,'attempt':number,'finished':n.stamp(),'text':'','success':False,'measured_usd':None,'unreported_cost_reserve_usd':.05}
                if number<3:return common|{'error':{'type':'ConnectionResetError'}}
                return common|{'success':True,'text':'{"pass":true}','provider_response':{'status':'completed'},'measured_usd':.001,'unreported_cost_reserve_usd':0}
            clock=iter(range(0,100000,60));n.STOP.clear()
            for obj,name,value in [(n,'HERE',root),(n.r,'HERE',root),(n.r.primary,'LEDGER',root/'ledger.md')]:stack.enter_context(patch.object(obj,name,value))
            stack.enter_context(patch.object(n.r,'verify',return_value={}));stack.enter_context(patch.object(n.r,'ordered_unique',return_value=requests))
            stack.enter_context(patch.object(n.r.Driver,'attempt',fake_attempt));gate=stack.enter_context(patch.object(n,'gate',return_value=True))
            stack.enter_context(patch.object(n,'interrupted_wait',return_value=False));stack.enter_context(patch.object(n.time,'monotonic',side_effect=lambda:next(clock)))
            self.assertTrue(n.run_cell('gpt-6.1-sol'))
            answers=n.r.answers(dest);self.assertEqual(len(answers),2);self.assertEqual({x['request_sha256'] for x in answers},{'0','1'})
            self.assertTrue(all(x['attempt']==3 for x in answers));self.assertEqual(len(n.r.lines(dest/'starts.jsonl')),2)
            self.assertGreaterEqual(gate.call_count,2);self.assertAlmostEqual(n.r.accounting(dest)[1],.2)
    def test_three_connection_failures_trip_and_success_cannot_reopen(self):
        c=n.Circuit();error={'error':{'type':'ConnectionResetError'}}
        self.assertFalse(c.observe(error));self.assertFalse(c.observe(error));self.assertTrue(c.observe(error))
        self.assertTrue(c.observe({'provider_response':{'status':'completed'}}))
    def test_success_resets_pretrip_streak(self):
        c=n.Circuit();error={'error':{'type':'URLError'}}
        c.observe(error);c.observe(error);c.observe({'provider_response':{'status':'completed'}})
        self.assertFalse(c.observe(error));self.assertEqual(c.streak,1)
    def test_gate_needs_ten_healthy_with_spacing_and_reset(self):
        with tempfile.TemporaryDirectory(dir=HERE) as temp:
            root=n.Path(temp);(root/'test').mkdir();results=[{'healthy':True}]*4+[{'healthy':False}]+[{'healthy':True}]*10
            with patch.object(n,'HERE',root),patch.object(n.health,'probe',side_effect=results) as probe,patch.object(n,'interrupted_wait',return_value=False) as wait:
                self.assertTrue(n.gate('test',lambda *args,**kwargs:None))
                self.assertEqual(probe.call_count,15);self.assertEqual(wait.call_count,14)
                self.assertTrue(all(x.args==(30,) for x in wait.call_args_list))
    def test_budget_includes_existing_and_inflight_holds(self):
        self.assertTrue(n.within_cap(24,0.9,0,.1,25));self.assertFalse(n.within_cap(24,0.9,1,.1,25))
    def test_zero_token_cli_error_is_missing_but_model_content_is_never_retried(self):
        raw={'terminal_reason':'api_error','usage':{'input_tokens':0,'output_tokens':0}}
        self.assertFalse(n.has_answer({'provider_response':raw}));self.assertTrue(n.transport_no_answer({'provider_response':raw}))
        self.assertTrue(n.has_answer({'provider_response':{'status':'completed','output':[{'type':'message','content':[]}]} ,'text':'malformed model text'}))
        self.assertFalse(n.transport_no_answer({'error':{'type':'JSONDecodeError'}}))

if __name__=='__main__':unittest.main()
