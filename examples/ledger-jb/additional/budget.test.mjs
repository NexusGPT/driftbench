import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Journal} from '../src/harness.mjs';
import {claudeEnvironment} from './adapter.mjs';

test('expanded Sonnet cap counts unknown holds and blocks before crossing 45',async()=>{
  const j=new Journal(join(mkdtempSync(join(tmpdir(),'jb-cap-test-')),'calls.jsonl'),{capUsd:45});
  await j.call('earlier',44.6,async()=>({text:'',costUsd:44.6,costEstimated:true}),{model:'claude-sonnet-5-5'});
  await assert.rejects(j.call('over',.5,async()=>{throw new Error('must not dispatch');},{model:'claude-sonnet-5-5'}),/BUDGET_STOP/);
  assert.equal(j.starts.size,1);assert.equal(j.liability(),44.6);
});
test('cache switch is forwarded without removing the output limit or effort',()=>{
  const env=claudeEnvironment({DISABLE_PROMPT_CACHING:'1'});
  assert.equal(env.DISABLE_PROMPT_CACHING,'1');assert.equal(env.CLAUDE_CODE_MAX_OUTPUT_TOKENS,'8192');assert.equal(env.CLAUDE_CODE_EFFORT_LEVEL,'medium');
});
test('a five-call continuation preserves five earlier receipts',async()=>{
  const j=new Journal(join(mkdtempSync(join(tmpdir(),'jb-cache-test-')),'calls.jsonl'),{capUsd:45});let physical=0;
  const guard=()=>{if(j.starts.size>=10)throw new Error('probe stop');};
  const ask=i=>j.transportCall(`request-${i}`,.5,async()=>{physical++;return {text:'answer',costUsd:.01};},{model:'claude-sonnet-5-5'},{beforeDispatch:guard});
  for(let i=0;i<5;i++)await ask(i);
  for(let i=0;i<10;i++)await ask(i);
  await assert.rejects(ask(10),/probe stop/);assert.equal(physical,10);assert.equal(j.finishes.size,10);
});
