/** Endpoint adapter for the owner-requested Responses cell; frozen core owns prompt/schema construction. */
import assert from 'node:assert/strict';
import type { FetchLike } from '../../packages/judges/src/http';
export function responsesBody(chat: any) {
  assert.equal(chat.model, 'gpt-6.1-sol');
  assert.equal(chat.reasoning_effort, 'medium');
  assert.equal(chat.max_completion_tokens, 32768);
  assert(!('temperature' in chat));
  return {model:chat.model,input:chat.messages,reasoning:{effort:chat.reasoning_effort},
    max_output_tokens:chat.max_completion_tokens,service_tier:'default',store:false,
    ...(chat.response_format?{text:{format:{type:'json_schema',...chat.response_format.json_schema}}}:{})};
}
export function normalizeResponses(value:any) {
  const text=(value.output??[]).flatMap((x:any)=>x.type==='message'?x.content??[]:[])
    .filter((x:any)=>x.type==='output_text').map((x:any)=>x.text).join('');
  const limited=value.status==='incomplete'&&value.incomplete_details?.reason==='max_output_tokens';
  return {choices:[{message:{content:text},finish_reason:limited?'length':value.status}],
    usage:value.usage?{prompt_tokens:value.usage.input_tokens,completion_tokens:value.usage.output_tokens,
      prompt_tokens_details:{cached_tokens:value.usage.input_tokens_details?.cached_tokens??0},
      completion_tokens_details:value.usage.output_tokens_details}:undefined};
}
export function responsesFetch(onEnvelope:(value:any)=>Promise<void>,fetcher:FetchLike=fetch):FetchLike {
  return async(url,init)=>{
    assert.equal(url,'https://api.openai.com/v1/chat/completions');
    const body=responsesBody(JSON.parse(String(init.body)));
    const response=await fetcher('https://api.openai.com/v1/responses',{...init,body:JSON.stringify(body)});
    if(!response.ok)return response;
    const value=await response.json();await onEnvelope(value);
    return new Response(JSON.stringify(normalizeResponses(value)),{status:response.status,headers:{'content-type':'application/json'}});
  };
}
export function responsesCost(value:any) {
  const u=value.usage;assert(u&&Number.isFinite(u.input_tokens)&&Number.isFinite(u.output_tokens));
  const cached=u.input_tokens_details?.cached_tokens??0,written=u.input_tokens_details?.cache_write_tokens??0,long=u.input_tokens>272000;
  assert(cached>=0&&written>=0&&cached+written<=u.input_tokens,'Invalid cache accounting');
  // Standard USD/MTok, read 2026-10-13: https://developers.openai.com/api/docs/pricing
  return ((u.input_tokens-cached-written)*2*(long?2:1)+cached*.10*(long?2:1)+written*2.50*(long?2:1)+u.output_tokens*10*(long?1.5:1))/1e6;
}
