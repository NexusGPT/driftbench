/** Native refusals are terminal product responses, including zero-output refusals. */
export function nativeRefusal(raw:any):boolean {
 return raw?.stop_reason==='refusal'||raw?.finish_reason==='refusal'||
  (typeof raw?.refusal==='string'&&raw.refusal.length>0)||
  (raw?.output??[]).some((x:any)=>(x.content??[]).some((c:any)=>c.type==='refusal'));
}

export function nativeSessionQuota(raw:any):boolean {
 return raw?.is_error===true&&!nativeRefusal(raw)&&Number(raw?.usage?.output_tokens??0)===0&&
  !Object.values(raw?.modelUsage??{}).some((v:any)=>Number(v.outputTokens??0)>0)&&
  /^You've hit your (?:session|usage|weekly|daily) limit/i.test(raw.result??'');
}
