import test from 'node:test';
import assert from 'node:assert/strict';
import {postOne} from './sol-http.mjs';
const headers={authorization:'Bearer test-secret'};
test('failed HTTP receipt retains exact provider body and both identifiers without auth',async()=>{
  const raw=JSON.stringify({id:'resp_test',error:{message:'overloaded'},usage:{input_tokens:0,output_tokens:0}});
  try{await postOne('https://example.invalid',headers,{}, {fetchFn:async()=>new Response(raw,{status:503,headers:{'x-request-id':'req_test'}})});assert.fail('should reject');}
  catch(error){const receipt=JSON.parse(error.raw);assert.equal(receipt.providerBody,raw);assert.equal(receipt.requestId,'req_test');assert.equal(receipt.responseId,'resp_test');assert.equal(receipt.networkCause,null);assert.equal(error.costUsd,0);assert.equal(receipt.bodyComplete,true);assert.ok(!error.raw.includes('test-secret'));}
});
test('connection failure retains nested cause, explicitly missing body and identifiers',async()=>{
  const cause=Object.assign(new Error('connection reset'),{code:'ECONNRESET'});
  try{await postOne('https://example.invalid',headers,{}, {fetchFn:async()=>{throw new TypeError('fetch failed',{cause});}});assert.fail('should reject');}
  catch(error){const receipt=JSON.parse(error.raw);assert.equal(receipt.networkCause.cause.code,'ECONNRESET');assert.equal(receipt.providerBody,null);assert.equal(receipt.requestId,null);assert.equal(receipt.responseId,null);assert.equal(error.costUsd,undefined);}
});
test('body disconnect retains partial bytes and request id without claiming zero cost',async()=>{
  let count=0;const stream=new ReadableStream({pull(c){if(!count++)c.enqueue(new TextEncoder().encode('{"id":"resp_partial",'));else c.error(Object.assign(new Error('body disconnected'),{code:'ECONNRESET'}));}});
  try{await postOne('https://example.invalid',headers,{}, {fetchFn:async()=>new Response(stream,{status:200,headers:{'x-request-id':'req_partial'}})});assert.fail('should reject');}
  catch(error){const r=JSON.parse(error.raw);assert.equal(r.providerBody,'{"id":"resp_partial",');assert.equal(r.bodyComplete,false);assert.equal(r.requestId,'req_partial');assert.equal(r.networkCause.code,'ECONNRESET');assert.equal(error.costUsd,undefined);}
});
test('any echoed secret is removed from error receipts',async()=>{
  try{await postOne('https://example.invalid',headers,{}, {fetchFn:async()=>new Response('test-secret',{status:503})});assert.fail('should reject');}
  catch(error){assert.ok(!error.raw.includes('test-secret'));assert.ok(!error.message.includes('test-secret'));assert.ok(error.raw.includes('[redacted]'));}
});
test('partial model output never becomes a retryable connection failure',async()=>{
  let count=0;const stream=new ReadableStream({pull(c){if(!count++)c.enqueue(new TextEncoder().encode('{"output":[{"type":"message","content":[{"type":"output_text","text":"A'));else c.error(new Error('disconnect'));}});
  const result=await postOne('https://example.invalid',headers,{}, {fetchFn:async()=>new Response(stream,{status:200})});
  assert.equal(result.value,undefined);assert.equal(result.partial,true);assert.ok(result.raw.includes('output_text'));
  assert.equal(result.receipt.bodyComplete,false);assert.equal(result.receipt.networkCause.message,'disconnect');
});
