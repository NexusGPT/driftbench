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
