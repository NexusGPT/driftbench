import tempfile,unittest
from types import SimpleNamespace
from unittest.mock import patch
from common import HERE,load_module
r=load_module('tested_extended',HERE/'extended-run.py')

class ExtendedProtocol(unittest.TestCase):
    def test_cli_api_error_zero_tokens_is_transport_not_answer(self):
        d=r.Driver('sonnet-5-5')
        raw={'terminal_reason':'api_error','is_error':True,'subtype':'success','result':'API Error: Connection dropped (ECONNRESET)','usage':{'input_tokens':0,'output_tokens':0,'cache_creation_input_tokens':0,'cache_read_input_tokens':0},'modelUsage':{},'total_cost_usd':0,'api_error_status':None}
        req={'experiment':'primary','model':'claude-sonnet-5-5','id':'test','row':'rubric','side':'audit','request_sha256':'test','body':{'system':'system','user':'user'}}
        with patch.object(r.subprocess,'run',return_value=SimpleNamespace(stdout=r.json.dumps(raw),returncode=1)):
            a=d.attempt(req,1)
        self.assertNotIn('provider_response',a);self.assertTrue(r.variant.retryable(a));self.assertFalse(d.stop.is_set());self.assertEqual(a['text'],'');self.assertEqual(a['cli_error_response'],raw);self.assertEqual(a['unreported_cost_reserve_usd'],.1)
    def test_sol_circuit_breaks_after_two_consecutive_connection_failures(self):
        d=r.Driver('gpt-6.1-sol');error={'success':False,'error':{'type':'ConnectionResetError'}}
        d.observe_transport(error);self.assertFalse(d.stop.is_set())
        d.observe_transport({'provider_response':{'status':'completed'}});self.assertEqual(d.connection_streak,0)
        d.observe_transport(error);self.assertFalse(d.stop.is_set())
        d.observe_transport(error);self.assertTrue(d.stop.is_set());self.assertEqual(d.connection_streak,2)
    def test_budget_amendment_only_changes_its_cell(self):
        with tempfile.TemporaryDirectory(dir=HERE) as tmp:
            path=r.Path(tmp);self.assertEqual(r.cell_cap(path),25)
            (path/'budget-amendment.json').write_text('{"cell_cap_usd":45}')
            self.assertEqual(r.cell_cap(path),45)
    def test_sol_cost_does_not_double_charge_reasoning(self):
        self.assertAlmostEqual(r.sol_cost({'input_tokens':1000,'input_tokens_details':{'cached_tokens':200,'cache_write_tokens':100},'output_tokens':100,'output_tokens_details':{'reasoning_tokens':90}}),.00267)
    def test_token_limited_response_is_lost_even_with_text(self):
        a=r.parse_response({'status':'incomplete','incomplete_details':{'reason':'max_output_tokens'},'output':[{'type':'message','content':[{'type':'output_text','text':'partial'}]}],'usage':{'output_tokens':4096}})
        self.assertFalse(a['success']);self.assertTrue(a['token_limit_lost']);self.assertEqual(a['text'],'partial')
    def test_reasoning_content_not_decoded_as_answer(self):
        a=r.parse_response({'status':'completed','output':[{'type':'reasoning','content':[{'type':'output_text','text':'wrong'}]},{'type':'message','content':[{'type':'output_text','text':'right'}]}]})
        self.assertEqual(a['text'],'right')
    def test_prepared_prompts_and_limits(self):
        for cell in r.CELLS:
            rows=r.prepared(cell);self.assertEqual(len(rows),6912);self.assertEqual(len({x['request_sha256'] for x in rows}),6560)
            self.assertEqual({x['model'] for x in rows},{r.CELLS[cell]['model']})
            for x in rows:
                if cell=='gpt-6.1-sol':
                    self.assertNotIn('temperature',x['body']);self.assertEqual(x['body']['max_output_tokens'],4096)
                    self.assertEqual(x['body']['reasoning'],{'effort':'medium'});self.assertEqual('text' in x['body'],x['experiment']=='dialect' and x['side']=='audit')
                else:self.assertEqual(x['body']['environment']['CLAUDE_CODE_MAX_OUTPUT_TOKENS'],'4096')
    def test_content_is_never_reasked(self):
        with tempfile.TemporaryDirectory(dir=HERE) as tmp:
            d=r.Driver('gpt-6.1-sol');d.dest=r.Path(tmp);(d.dest/'primary').mkdir()
            req={'request_sha256':'test','experiment':'primary','row':'rubric','side':'audit'}
            answer={'success':True,'provider_response':{'status':'completed'},'text':'malformed','request_sha256':'test'}
            with patch.object(d,'attempt',return_value=answer) as attempt:
                result=d.work(req);self.assertEqual(attempt.call_count,1);self.assertTrue(result['item_lost'])
    def test_http_402_stops_without_judge_answer(self):
        with tempfile.TemporaryDirectory(dir=HERE) as tmp:
            d=r.Driver('gpt-6.1-sol');d.dest=r.Path(tmp)
            with patch.object(d,'attempt',return_value={'success':False,'error':{'status':402}}) as attempt:
                self.assertTrue(d.work({'request_sha256':'test'})['pending']);self.assertTrue(d.stop.is_set());self.assertEqual(attempt.call_count,1)

if __name__=='__main__':unittest.main()
