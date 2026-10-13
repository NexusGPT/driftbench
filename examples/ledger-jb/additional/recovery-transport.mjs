import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {responsesBody,readResponses,createTransport as originalTransport} from './adapter.mjs';
import {createTransport as sonnetTransport} from './sonnet-transport.mjs';
import {JudgeError} from '../../../packages/judges/src/http.ts';

export function createTransport(model, settings) {
  if (model === 'claude-sonnet-5-5') return sonnetTransport(model, settings);
  const original = originalTransport(model,settings);
  const key = readFileSync(join(homedir(),'.nexus-secrets/openai.key'),'utf8').trim();
  const scrub = text => text.split(key).join('[redacted]');
  return {maximumCostUsd:original.maximumCostUsd,async call(prompt,{schema}) {
    const started=Date.now(); let response, raw;
    try {
      response=await fetch(settings.route,{method:'POST',redirect:'error',
        headers:{'content-type':'application/json',authorization:`Bearer ${key}`},
        body:JSON.stringify(responsesBody(prompt,schema,settings)),signal:AbortSignal.timeout(settings.timeoutMs)});
      raw=await response.text();
    } catch (cause) {
      const error=new JudgeError('network',`OpenAI connection failed (${cause.name}; ${cause.cause?.code ?? 'cause unavailable'})`,{retryable:true});
      error.raw=JSON.stringify({errorClass:cause.name,causeCode:cause.cause?.code ?? null,providerReceipt:null});
      throw error;
    }
    let value;try{value=JSON.parse(raw);}catch{
      if(response.ok)return {text:raw,rawProvider:scrub(raw),returnedAnswer:true,graderError:true,finishReason:'invalid-provider-json',elapsedMs:Date.now()-started};
    }
    if(response.ok)return {...readResponses(value),elapsedMs:Date.now()-started};
    const error=new JudgeError('http',`OpenAI HTTP ${response.status}: ${scrub(value?.error?.message ?? raw).slice(0,500)}`,
      {status:response.status,retryable:response.status===429 || response.status>=500});
    error.raw=scrub(raw);
    const u=value?.usage;
    if(u?.input_tokens===0 && u?.output_tokens===0 && !(value?.output?.length)) {
      error.usage={input:0,output:0,cached:0,cacheWrite:0};error.costUsd=0;
    }
    throw error;
  }};
}
