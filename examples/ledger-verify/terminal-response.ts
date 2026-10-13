/** Native refusals are terminal product responses, including zero-output refusals. */
export function nativeRefusal(raw:any):boolean {
 return raw?.stop_reason==='refusal'||raw?.finish_reason==='refusal'||
  (typeof raw?.refusal==='string'&&raw.refusal.length>0)||
  (raw?.output??[]).some((x:any)=>(x.content??[]).some((c:any)=>c.type==='refusal'));
}
