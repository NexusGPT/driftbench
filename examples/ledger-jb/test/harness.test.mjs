import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Journal, jobs, promptfooPrompt, parsePromptfoo, verifySeal } from '../src/harness.mjs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const temp = join(root, 'results/.test-tmp');
mkdirSync(temp, { recursive: true });

test('pool and all sealed artifacts retain their hashes', () => {
  assert.equal(verifySeal(root).eligibleCount, 270);
});
test('noise cache identity differs by repeat and contestant', () => {
  const planned = jobs({ noise: [{ id:'a' }, { id:'b' }] }, 'noise', 'gpt-6-luna');
  assert.equal(planned.length, 12); assert.equal(new Set(planned.map(x => x.key)).size, 12);
  assert.throws(() => jobs({noise:[]}, 'noise', 'gpt-5.4-mini'));
});
test('fixed prompt rendering preserves dollar sequences and handles order', () => {
  const item={question:'why $&',a:'A $`',b:'B $\''};
  assert.equal(promptfooPrompt('{{criteria}}|{{a}}|{{b}}',item,'BA').system.endsWith('|B $\'|A $`'),true);
  assert.equal(parsePromptfoo('1','BA'),'A'); assert.equal(parsePromptfoo('2','AB'),null);
});
test('budget is reserved before a call and identical replay is free', async () => {
  const path = join(mkdtempSync(join(temp,'jb-journal-')), 'calls.jsonl');
  const journal = new Journal(path,{capUsd:.5}); let calls = 0;
  await journal.call('a',.4,async()=>{calls++;return {costUsd:.2,text:'ok'};});
  await journal.call('a',.4,async()=>{calls++;return {costUsd:.2,text:'wrong'};});
  await assert.rejects(journal.call('b',.4,async()=>{calls++;return {costUsd:0};}),/BUDGET_STOP/);
  assert.equal(calls,1); assert.equal(new Journal(path,{capUsd:.5}).liability(),.2);
});
test('an interrupted call cannot silently retry or lose its cost reserve', async () => {
  const path = join(mkdtempSync(join(temp,'jb-journal-')), 'calls.jsonl');
  const journal=new Journal(path);
  await assert.rejects(journal.call('a',.4,async()=>{throw new Error('transport');}));
  const resumed = new Journal(path);
  assert.equal(resumed.liability(),.4);
  await assert.rejects(resumed.call('a',.4,async()=>({costUsd:0})),/Unresolved earlier call/);
});

test('unknown cost retains liability and concurrent reservations cannot overspend', async () => {
  const path=join(mkdtempSync(join(temp,'jb-journal-')),'calls.jsonl');
  const journal=new Journal(path,{capUsd:.5});
  let release;
  const first=journal.call('first',.4,()=>new Promise(resolve=>{release=resolve;}));
  await assert.rejects(journal.call('second',.2,async()=>({costUsd:.01})),/BUDGET_STOP/);
  release({costUsd:.1}); await first;
  await assert.rejects(journal.call('unknown',.3,async()=>({text:'unpriced'})),/Unknown usage cost/);
  assert.ok(Math.abs(journal.liability()-.4)<1e-9);
});


test('transport retries stop at three and keep every failed reservation', async () => {
  const path=join(mkdtempSync(join(temp,'jb-retry-')),'calls.jsonl');
  const journal=new Journal(path,{capUsd:1}); let calls=0;
  const response=await journal.transportCall('a',.2,async()=>{
    calls++; if(calls<3)throw Object.assign(new Error('offline'),{code:'network',retryable:true});
    return {text:'valid',costUsd:.01};
  },{}, {sleep:async()=>{}});
  assert.equal(response.text,'valid'); assert.equal(calls,3); assert.ok(Math.abs(journal.liability()-.41)<1e-9);
  await journal.transportCall('a',.2,async()=>{throw new Error('returned answer reissued');},{},{sleep:async()=>{}});
  assert.equal(calls,3);
});
test('three failed attempts exhaust and returned content is never retried', async () => {
  const path=join(mkdtempSync(join(temp,'jb-retry-')),'calls.jsonl');
  const journal=new Journal(path);let calls=0;
  const exhausted=await journal.transportCall('a',.1,async()=>{calls++;throw Object.assign(new Error('offline'),{code:'network'});},{},{sleep:async()=>{}});
  assert.equal(calls,3);assert.equal(exhausted.graderError,true);
  const invalid=await journal.transportCall('b',.1,async()=>{calls++;return {text:'bad json',costUsd:.01};});
  assert.equal(calls,4);assert.equal(invalid.text,'bad json');
  const unpriced=await journal.transportCall('c',.1,async()=>{calls++;return {text:'answer'};});
  assert.equal(calls,5);assert.equal(unpriced.costEstimated,true);
});


test('429 waits 60, 120 and 240 seconds, then stops without a judge error',async()=>{
  const path=join(mkdtempSync(join(temp,'jb-quota-')),'calls.jsonl');
  const journal=new Journal(path);let calls=0;const waits=[];
  await assert.rejects(journal.transportCall('quota',.1,async()=>{
    calls++;throw Object.assign(new Error('quota'),{code:'http',status:429,retryable:true});
  },{}, {sleep:async ms=>{waits.push(ms);}}),/QUOTA_STOP/);
  assert.equal(calls,4);assert.deepEqual(waits,[60000,120000,240000]);
  assert.equal([...journal.finishes.values()].every(x=>x.quotaResponse&&!x.graderError),true);
});
test('a successful quota retry returns exactly one answer and preserves accounting',async()=>{
  const path=join(mkdtempSync(join(temp,'jb-quota-')),'calls.jsonl');
  const journal=new Journal(path);let calls=0;const waits=[];
  const response=await journal.transportCall('quota',.1,async()=>{
    calls++;if(calls===1)throw Object.assign(new Error('quota'),{code:'http',status:429,retryable:true});
    return {text:'0',costUsd:.001};
  },{}, {sleep:async ms=>{waits.push(ms);}});
  assert.equal(response.text,'0');assert.equal(calls,2);assert.deepEqual(waits,[60000]);
  assert.ok(Math.abs(journal.liability()-.101)<1e-9);
});

test('402 stops that model immediately, releases proven rejection, and persists across restart',async()=>{
  const path=join(mkdtempSync(join(temp,'jb-billing-')),'calls.jsonl');
  const journal=new Journal(path);let calls=0;const waits=[];
  const reject=async()=>{calls++;throw Object.assign(new Error('Your prepayment credits are depleted.'),{code:'http',status:402,retryable:true});};
  await assert.rejects(journal.transportCall('first',.1,reject,{model:'gemini'},{sleep:async ms=>waits.push(ms)}),/BILLING_STOP/);
  await assert.rejects(journal.transportCall('next',.1,reject,{model:'gemini'}),/BILLING_STOP/);
  await assert.rejects(new Journal(path).transportCall('restart',.1,reject,{model:'gemini'}),/BILLING_STOP/);
  assert.equal(calls,1);assert.deepEqual(waits,[]);assert.equal(journal.liability(),0);
  assert.equal(journal.finishes.get('first').graderError,false);
  assert.equal(journal.finishes.get('first').billingRejected,true);
  assert.equal((await journal.transportCall('haiku',.1,async()=>({text:'0',costUsd:.01}),{model:'haiku'})).text,'0');
});

test('unexplained 402 stops without releasing an unproven cost hold',async()=>{
  const path=join(mkdtempSync(join(temp,'jb-billing-')),'calls.jsonl');const journal=new Journal(path);
  await assert.rejects(journal.transportCall('first',.1,async()=>{throw Object.assign(new Error('Payment required'),{code:'http',status:402});},{model:'gemini'}),/BILLING_STOP/);
  assert.equal(journal.liability(),.1);assert.equal(journal.finishes.get('first').graderError,false);
});

test('402 in a sibling call prevents a waiting 429 call from retrying',async()=>{
  const path=join(mkdtempSync(join(temp,'jb-billing-')),'calls.jsonl');const journal=new Journal(path);let calls=0;
  await assert.rejects(journal.transportCall('quota',.1,async()=>{calls++;throw Object.assign(new Error('quota'),{code:'http',status:429,retryable:true});},{model:'gemini'},{sleep:async()=>{
    await assert.rejects(journal.transportCall('billing',.1,async()=>{throw Object.assign(new Error('prepayment credits are depleted'),{code:'http',status:402});},{model:'gemini'}),/BILLING_STOP/);
  }}),/BILLING_STOP/);
  assert.equal(calls,1);assert.equal(journal.liability(),.1);
});

test('explicit top-up resumes only rejected keys and never reissues an answered call',async()=>{
  const path=join(mkdtempSync(join(temp,'jb-topup-')),'calls.jsonl');let calls=0;
  const first=new Journal(path);
  await first.transportCall('answered',.1,async()=>({text:'saved answer',costUsd:.01}),{model:'gemini'});
  await assert.rejects(first.transportCall('rejected',.1,async()=>{throw Object.assign(new Error('prepayment credits are depleted'),{code:'http',status:402});},{model:'gemini'}),/BILLING_STOP/);
  assert.throws(()=>new Journal(path,{billingResumeKeys:['answered']}),/only proven no-answer/);
  const resumed=new Journal(path,{billingResumeKeys:['rejected']});
  const operation=async()=>{calls++;return {text:'new answer',costUsd:.02};};
  assert.equal((await resumed.transportCall('answered',.1,operation,{model:'gemini'})).text,'saved answer');
  const response=await resumed.transportCall('rejected',.1,operation,{model:'gemini'});
  assert.equal(response.key,'rejected:transport:2');assert.equal(response.text,'new answer');assert.equal(calls,1);
  await resumed.transportCall('rejected',.1,operation,{model:'gemini'});assert.equal(calls,1);
  await assert.rejects(resumed.transportCall('new-rejection',.1,async()=>{throw Object.assign(new Error('prepayment credits are depleted'),{code:'http',status:402});},{model:'gemini'}),/BILLING_STOP/);
  await assert.rejects(new Journal(path,{billingResumeKeys:['rejected']}).transportCall('later',.1,operation,{model:'gemini'}),/BILLING_STOP/);
  assert.equal(calls,1);
});

test('daily quota resumption skips recorded rejections and preserves answered cache',async()=>{
  const path=join(mkdtempSync(join(temp,'jb-daily-')),'calls.jsonl');
  const first=new Journal(path);
  await assert.rejects(first.transportCall('quota',.1,async()=>{throw Object.assign(new Error('daily quota'),{code:'http',status:429,retryable:true});},{model:'gemini'},{quotaBackoffMs:[]}),/QUOTA_STOP/);
  await first.transportCall('answered',.1,async()=>({text:'saved',costUsd:.01}),{model:'gemini'});
  assert.throws(()=>new Journal(path,{quotaResumeKeys:['answered']}),/only proven no-answer/);
  const resumed=new Journal(path,{quotaResumeKeys:['quota']});let calls=0;const waits=[];
  const operation=async()=>{calls++;return {text:'new answer',costUsd:.02};};
  assert.equal((await resumed.transportCall('quota',.1,operation,{model:'gemini'},{sleep:async ms=>waits.push(ms)})).key,'quota:transport:2');
  await resumed.transportCall('quota',.1,operation,{model:'gemini'});
  assert.equal((await resumed.transportCall('answered',.1,operation,{model:'gemini'})).text,'saved');
  assert.equal(calls,1);assert.deepEqual(waits,[]);assert.ok(Math.abs(resumed.liability()-.13)<1e-9);
});

test('stop during quota backoff prevents another reservation or request',async()=>{
  const path=join(mkdtempSync(join(temp,'jb-stop-')),'calls.jsonl');
  const journal=new Journal(path);let stopped=false,calls=0;
  await assert.rejects(journal.transportCall('quota',.1,async()=>{calls++;throw Object.assign(new Error('quota'),{code:'http',status:429,retryable:true});},{model:'gemini'},{
    sleep:async()=>{stopped=true;},beforeDispatch:()=>{if(stopped)throw new Error('OPERATOR_DRAIN');}
  }),/OPERATOR_DRAIN/);
  assert.equal(calls,1);assert.equal(journal.starts.size,1);assert.equal(journal.finishes.size,1);
});

test('cutoff before dispatch writes no unresolved call or spend',async()=>{
  const path=join(mkdtempSync(join(temp,'jb-cutoff-')),'calls.jsonl');const journal=new Journal(path);
  await assert.rejects(journal.transportCall('late',.1,async()=>{throw new Error('must not call');},{},{beforeDispatch:()=>{throw new Error('cutoff');}}),/cutoff/);
  assert.equal(journal.starts.size,0);assert.equal(journal.liability(),0);
});
