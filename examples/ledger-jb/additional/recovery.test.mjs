import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RecoveryJournal,healthGate,missingRequests,zeroCostConfirmed} from './recovery.mjs';

const temp=()=>mkdtempSync(join(tmpdir(),'jb-recovery-test-'));
test('ten consecutive healthy probes reset on failure and share one gate',async()=>{
  let time=0,calls=0;const waits=[];
  const gate=healthGate({model:'gpt-6.1-sol',path:join(temp(),'health.jsonl'),now:()=>time,
    sleep:async ms=>{waits.push(ms);time+=ms;},guard:()=>{},
    fetchFn:async()=>({status:++calls===4?503:401,text:async()=>''})});
  await Promise.all([gate.before(),gate.before()]);
  assert.equal(calls,14);assert.equal(waits.length,13);assert.ok(waits.every(x=>x===30000));
  for(let i=0;i<3;i++)gate.observe({transportFailure:true,returnedAnswer:false,text:'',errorCode:'network'});
  await gate.before();assert.equal(calls,24);assert.ok(waits.includes(600000));
});
test('unlimited no-answer recovery preserves returned-answer replay and unknown holds',async()=>{
  const journal=new RecoveryJournal(join(temp(),'calls.jsonl'),{capUsd:25});let calls=0;
  const options={gate:{before:async()=>{},observe:()=>{}},guard:()=>{},sleep:async()=>{},quotaBackoffMs:[1,2,3]};
  const op=async()=>{calls++;if(calls<5)throw Object.assign(new Error('no receipt'),{code:'network'});return {text:'model answer',returnedAnswer:true,costUsd:.01};};
  const first=await journal.recoverCall('x',.1,op,{model:'gpt-6.1-sol'},options);
  const again=await journal.recoverCall('x',.1,op,{model:'gpt-6.1-sol'},options);
  assert.equal(first.text,again.text);assert.equal(calls,5);assert.equal(journal.finishes.size,5);
  assert.ok(Math.abs(journal.liability()-.41)<1e-12);assert.equal(missingRequests(journal.rows).length,0);
});
test('provider zero-token receipt settles zero; absent usage retains a hold',async()=>{
  assert.equal(zeroCostConfirmed({costUsd:0,usage:{input:0,output:0}}),true);
  assert.ok(!zeroCostConfirmed({costUsd:0}));
  assert.equal(zeroCostConfirmed({costUsd:0,usage:{input:1,output:0}}),false);
  const journal=new RecoveryJournal(join(temp(),'calls.jsonl'),{capUsd:1});let calls=0;
  await journal.recoverCall('x',.5,async()=>{if(!calls++)throw Object.assign(new Error('provider zero'),{code:'network',costUsd:0,usage:{input:0,output:0}});return {text:'A',returnedAnswer:true,costUsd:.1};},
    {model:'claude-sonnet-5-5'},{gate:{before:async()=>{},observe:()=>{}},guard:()=>{},sleep:async()=>{},quotaBackoffMs:[]});
  assert.equal(journal.liability(),.1);assert.equal(journal.finishes.get('x').costEstimated,false);
});
test('an existing exhausted request resumes at the next attempt, without losing its receipts',async()=>{
  const journal=new RecoveryJournal(join(temp(),'calls.jsonl'),{capUsd:25});
  for(let i=1;i<=3;i++)await journal.call(i===1?'x':`x:transport:${i}`,.1,async()=>({text:'',transportFailure:true,returnedAnswer:false,costUsd:.1,costEstimated:true}),{model:'gpt-6.1-sol',transportAttempt:i});
  assert.equal(missingRequests(journal.rows).length,1);
  await journal.recoverCall('x',.1,async()=>({text:'B',returnedAnswer:true,costUsd:.02}),{model:'gpt-6.1-sol'},
    {gate:{before:async()=>{},observe:()=>{}},guard:()=>{},sleep:async()=>{},quotaBackoffMs:[]});
  assert.equal(journal.finishes.get('x:transport:4').text,'B');assert.equal(journal.finishes.size,4);
});
