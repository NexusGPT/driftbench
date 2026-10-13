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
  assert.throws(() => jobs({noise:[]}, 'noise', 'gemini-3.8-flash'));
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
