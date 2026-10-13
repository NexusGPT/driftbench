import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {responsesBody,readResponses,createTransport as originalTransport} from './adapter.mjs';
import {postOne} from './sol-http.mjs';

export function createTransport(model,settings){
  if(model!=='gpt-6.1-sol')throw new Error('Sol cell only');
  const original=originalTransport(model,settings);
  const key=readFileSync(join(homedir(),'.nexus-secrets/openai.key'),'utf8').trim();
  return {maximumCostUsd:original.maximumCostUsd,async call(prompt,{schema}){
    const started=Date.now();
    const result=await postOne(settings.route,{authorization:`Bearer ${key}`},responsesBody(prompt,schema,settings),{timeoutMs:settings.timeoutMs});
    if(result.value===undefined)return {text:result.raw,rawProvider:result.raw,httpReceipt:result.receipt,returnedAnswer:true,graderError:true,finishReason:'invalid-provider-json',elapsedMs:Date.now()-started};
    return {...readResponses(result.value),httpReceipt:result.receipt,elapsedMs:Date.now()-started};
  }};
}
