// Preserve failed HTTP attempts without ever retaining authentication headers.
import {JudgeError} from '../../../packages/judges/src/http.ts';

export async function postOne(url, headers, body, {timeoutMs=300000,fetchFn=fetch}={}) {
  const secretValues=Object.values(headers).flatMap(x=>[x,x.replace(/^Bearer\s+/i,'')]).filter(Boolean);
  const scrub=text=>secretValues.reduce((s,key)=>s.split(key).join('[redacted]'),text);
  let response, raw='', complete=false;
  const receipt=cause=>({httpStatus:response?.status ?? null,
    requestId:response?.headers.get('x-request-id') ?? response?.headers.get('request-id') ?? null,
    responseId:(()=>{try{return JSON.parse(raw).id ?? null;}catch{return null;}})(),
    providerBody:response?scrub(raw):null,bodyComplete:complete,
    networkCause:cause?{name:cause.name ?? null,message:scrub(cause.message ?? String(cause)),
      code:cause.code ?? null,cause:cause.cause?{name:cause.cause.name ?? null,code:cause.cause.code ?? null,message:scrub(cause.cause.message ?? '')}:null}:null});
  try {
    response=await fetchFn(url,{method:'POST',headers:{'content-type':'application/json',...headers},
      body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
    if(response.body){
      const reader=response.body.getReader(),decoder=new TextDecoder();
      for(;;){const value=await reader.read();if(value.done){raw+=decoder.decode();break;}raw+=decoder.decode(value.value,{stream:true});}
    }
    complete=true;
  }catch(cause){
    const partialModelOutput=response?.ok && /"type"\s*:\s*"(?:output_text|reasoning|message)"/.test(raw);
    if(partialModelOutput){
      let value;try{value=JSON.parse(raw);}catch{}
      // This is a returned answer. Keeping it on the answer path also preserves
      // the core's single schema re-ask after malformed model JSON.
      return {value,raw:scrub(raw),receipt:receipt(cause),partial:true};
    }
    const error=new JudgeError('network',
      `OpenAI connection failed (${cause.name}; ${cause.cause?.code ?? cause.code ?? 'cause unavailable'})`,{retryable:true});
    error.raw=JSON.stringify(receipt(cause));throw error;
  }
  let value;try{value=JSON.parse(raw);}catch{}
  if(response.ok)return {value,raw,receipt:receipt(null)};
  const error=new JudgeError('http',`OpenAI HTTP ${response.status}: ${scrub(value?.error?.message ?? raw).slice(0,500)}`,
    {status:response.status,retryable:response.status===429||response.status>=500});
  error.raw=JSON.stringify(receipt(null));
  if(value?.usage?.input_tokens===0 && value?.usage?.output_tokens===0 && !(value?.output?.length)){
    error.usage={input:0,output:0,cached:0,cacheWrite:0};error.costUsd=0;
  }
  throw error;
}
