import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTransport, reserve, spendTotals, readRows, networkLatched, claudeConfig, claudeUser, sha, append } from './transport.ts';
const fresh = () => mkdtempSync(join(tmpdir(),'tie-transport-test-'));
const prompt = {system:'Fictional test judge.',user:'Compare fictional apples.'};
const hooks = (send: any, sleeps: number[] = []) => ({send,probe:async()=>{},sleep:async(ms:number)=>{sleeps.push(ms);}});

test('reserves before submitting and shares exact request across metadata and callers', async () => {
  const dir=fresh(); let calls=0; const pauses:number[]=[];
  const t=createTransport({dir,model:'gpt-6-luna',_test:hooks(async()=>{
    calls++; assert.equal(spendTotals(dir).reservations,1); return {text:'A',costUsd:.001,raw:{fictional:true}};
  },pauses)});
  const [a,b]=await Promise.all([t.ask(prompt,undefined,{phase:'dev'}),t.ask(prompt,undefined,{phase:'other'})]);
  assert.equal(calls,1); assert.equal(a.text,b.text); assert.equal((await t.ask(prompt)).cached,true);
  assert.equal(pauses.filter(x=>x===30000).length,9);
  assert.equal(readRows(join(dir,'probes.jsonl')).length,10);
  assert.equal(t.totals().spentUsd,.001); assert.equal(t.totals().heldUsd,0);
});

test('malformed, empty and refusal answers are final and never resent',async()=>{
  const dir=fresh(); let calls=0;
  const t=createTransport({dir,model:'gpt-6-luna',_test:hooks(async(p:any)=>{calls++;return {text:p.user==='empty'?'':'not JSON refusal',raw:{fictional:true},costUsd:.0001};})});
  for(const user of ['empty','refusal']) {await t.ask({...prompt,user},{type:'object'});await t.ask({...prompt,user},{type:'object'});}
  assert.equal(calls,2);
});

test('shared global cap rejects before send across models',async()=>{
  const dir=fresh(); let calls=0;
  const t=createTransport({dir,model:'gpt-6.1-sol',_test:hooks(async()=>{calls++;throw Error('unexpected');})});
  reserve(dir,'prior','gpt-6-luna',39.99999);
  await assert.rejects(t.ask(prompt),/BUDGET_CAP/); assert.equal(calls,0);
});

test('three connection failures latch across success and hold ten minutes before re-probing',async()=>{
  assert.equal(networkLatched([{connectionFailure:true},{connectionFailure:true},{connectionFailure:true},{connectionFailure:false}]),true);
  const dir=fresh();let calls=0;const waits:number[]=[];
  const t=createTransport({dir,model:'gpt-6-luna',_test:hooks(async()=>{calls++;if(calls<=3)throw Error('fetch failed');return {text:'B',costUsd:.0001,raw:{fictional:true}};},waits)});
  const answer=await t.ask(prompt);assert.equal(answer.text,'B');assert.equal(calls,4);
  assert.ok(waits.some(n=>n>=599000)); assert.equal(readRows(join(dir,'probes.jsonl')).length,20);
  assert.equal(t.totals().reservations,4);assert.ok(t.totals().heldUsd>0);
  await t.ask(prompt);assert.equal(calls,4);
});

test('unknown provider errors stop without retry',async()=>{
  const dir=fresh();let calls=0;
  const t=createTransport({dir,model:'gpt-6-luna',_test:hooks(async()=>{calls++;throw Error('HTTP 401 unauthorized');})});
  await assert.rejects(t.ask(prompt),/HTTP 401/);await assert.rejects(t.ask({...prompt,user:'another'}),/NONTRANSPORT/);assert.equal(calls,1);
});

test('Claude session limit is a durable terminal stop and answer remains recorded',async()=>{
  const dir=fresh();let calls=0;
  const t=createTransport({dir,model:'claude-haiku-5-5',_test:hooks(async()=>{calls++;return {text:'Session limit reached',sessionLimit:true,costUsd:0,raw:{fictional:true}};})});
  await assert.rejects(t.ask(prompt,undefined,{phase:'heldout',benchmark:'writing'}),/SESSION_LIMIT/);
  await assert.rejects(t.ask({...prompt,user:'different'},undefined,{phase:'heldout',benchmark:'writing'}),/SESSION_LIMIT/);
  assert.equal(calls,1);assert.equal(readRows(join(dir,'calls.jsonl'))[0].answered,true);
  const cfg=claudeConfig(prompt,4096);assert.equal(cfg.env.DISABLE_PROMPT_CACHING,'1');assert.ok(cfg.args.includes('haiku'));assert.ok(cfg.args.includes('--no-session-persistence'));
});

test('Claude restricted to heldout writing and global 400 calls',async()=>{
  const dir=fresh();const t=createTransport({dir,model:'claude-haiku-5-5',_test:hooks(async()=>{throw Error('unexpected');})});
  await assert.rejects(t.ask(prompt,undefined,{phase:'dev',benchmark:'writing'}),/HELDOUT_WRITING_ONLY/);
  for(let i=0;i<400;i++) reserve(dir,'fictional'+i,'claude-haiku-5-5',0);
  assert.throws(()=>reserve(dir,'extra','claude-haiku-5-5',0),/CLAUDE_CALL_CAP/);
});

test('global concurrency never exceeds two across model transports',async()=>{
  const dir=fresh();let active=0,peak=0;
  const send=async()=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,2));active--;return {text:'A',costUsd:.0001,raw:{fictional:true}};};
  const a=createTransport({dir,model:'gpt-6-luna',_test:hooks(send)}),b=createTransport({dir,model:'gemini-3.5-flash-lite',_test:hooks(send)});
  await Promise.all(Array.from({length:8},(_,i)=>(i%2?a:b).ask({...prompt,user:'fiction '+i})));
  assert.equal(peak,2);
});


test('unreceipted reservations stop for reconciliation before sending',async()=>{
  const dir=fresh();reserve(dir,'fictional-interrupted','gpt-6-luna',.01);let calls=0;
  const t=createTransport({dir,model:'gpt-6-luna',_test:hooks(async()=>{calls++;throw Error('unexpected');})});
  await assert.rejects(t.ask(prompt),/AMBIGUOUS_UNRECEIPTED_RESERVATION/);assert.equal(calls,0);
});

test('recorded returned answer survives reconstruction without paid call',async()=>{
  const dir=fresh();const model='gpt-6-luna';
  const logicalKey=sha({model,prompt,schema:null,maxOutputTokens:4096,reasoning:'medium'});
  reserve(dir,logicalKey+':1',model,.01);append(join(dir,'calls.jsonl'),{logicalKey,attemptKey:logicalKey+':1',answered:true,text:'fictional refusal',costUsd:.01});
  const t=createTransport({dir,model,_test:hooks(async()=>{throw Error('unexpected');})});
  assert.equal((await t.ask(prompt)).text,'fictional refusal');assert.equal(t.totals().heldUsd,.01);
});

test('native schema suffix is canonical and absent schema preserves exact user text',()=>{
  assert.equal(claudeUser(prompt),prompt.user);const schema={type:'object'};
  assert.equal(claudeUser(prompt,schema),prompt.user+'\n\nThink first in plain text. Then write the JSON object last, matching this schema:\n'+JSON.stringify(schema));
});

test('HTTP 500 is recovered only when no answer was recorded',async()=>{
  const dir=fresh();let calls=0;
  const t=createTransport({dir,model:'gpt-6-luna',_test:hooks(async()=>{if(++calls===1)throw Error('HTTP 500: unavailable');return {text:'A',costUsd:.0001,raw:{fictional:true}};})});
  await t.ask(prompt);assert.equal(calls,2);assert.ok(t.totals().heldUsd>0);
});
