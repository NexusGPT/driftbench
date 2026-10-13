import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MODELS,settingsFor,responsesBody,responseCost,readResponses,claudeEnvironment,claudeArgs,readClaude,judgePair} from './adapter.mjs';
import {REQUIREMENTS,Journal} from '../src/harness.mjs';
import {project,cellJobs} from './report.mjs';

test('Responses preserves both prompts, strict schema, medium and a combined output cap; no temperature',()=>{
  const body=responsesBody({system:'SYS',user:'USER'},{type:'object'},settingsFor(MODELS[1]));
  assert.equal(body.model,'gpt-6.1-sol');assert.equal(body.max_output_tokens,8192);assert.equal(body.reasoning.effort,'medium');
  assert.deepEqual(body.input,[{role:'system',content:'SYS'},{role:'user',content:'USER'}]);
  assert.equal(body.text.format.strict,true);assert.equal(body.service_tier,'default');assert.equal('temperature' in body,false);
  assert.equal('text' in responsesBody({system:'s',user:'u'},undefined,settingsFor(MODELS[1])),false);
});
test('Responses cost includes all reasoning output, cache read and cache write at separate rates',()=>{
  const value={usage:{input_tokens:1000,output_tokens:100,input_tokens_details:{cached_tokens:500,cache_write_tokens:100},output_tokens_details:{reasoning_tokens:90}}};
  assert.ok(Math.abs(responseCost(value)-.0021)<1e-12);assert.equal(responseCost({}),undefined);
  const r=readResponses({...value,model:'gpt-6.1-sol',status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output:[]});
  assert.equal(r.tokenCapHit,true);assert.equal(r.returnedAnswer,true);assert.equal(r.usage.reasoning,90);
});
test('Sonnet isolation retains lean core flags and caps adaptive thinking through total output',()=>{
  const env=claudeEnvironment({OPENAI_API_KEY:'sentinel',ANTHROPIC_API_KEY:'sentinel',MAX_THINKING_TOKENS:'65536',CLAUDECODE:'1'});
  assert.equal(env.OPENAI_API_KEY,undefined);assert.equal(env.ANTHROPIC_API_KEY,undefined);assert.equal(env.MAX_THINKING_TOKENS,undefined);
  assert.equal(env.CLAUDE_CODE_MAX_OUTPUT_TOKENS,'8192');assert.equal(env.CLAUDE_CODE_EFFORT_LEVEL,'medium');assert.equal(env.CLAUDE_CODE_MAX_RETRIES,'0');
  const args=claudeArgs({system:'SYS'});for(const x of ['--setting-sources','--tools','--strict-mcp-config','--no-session-persistence','--max-turns'])assert.ok(args.includes(x));
  assert.equal(args[args.indexOf('--model')+1],'sonnet');
});
test('CLI result with an answer is preserved even when error envelope accompanies it',()=>{
  const r=readClaude({code:1,stdout:JSON.stringify({type:'result',subtype:'error_max_turns',is_error:true,result:'answered',total_cost_usd:.01}),stderr:''});
  assert.equal(r.text,'answered');assert.equal(r.returnedAnswer,true);assert.equal(r.costUsd,.01);
  const lost=readClaude({code:1,stdout:JSON.stringify({type:'result',subtype:'error',is_error:true,errors:['max_tokens reached'],total_cost_usd:.02}),stderr:''});
  assert.equal(lost.tokenCapHit,true);assert.equal(lost.returnedAnswer,true);
});
test('both new identities use unchanged core and its single schema re-ask',async()=>{
  for(const model of MODELS){const seen=[];
    const result=await judgePair({item:{question:'Which is correct?',a:'first',b:'second'},requirements:REQUIREMENTS,model,settings:settingsFor(model),
      call:async(_,meta)=>{seen.push(`${meta.order}:${meta.attempt}`);return {text:seen.length===1?'malformed':JSON.stringify({items:REQUIREMENTS.map(r=>({name:r.name,first:meta.order==='BA'?0:4,second:meta.order==='BA'?4:0,reasoning:'fixture',evidence:null}))}),costUsd:0};}});
    assert.deepEqual(seen,['AB:0','AB:1','BA:0']);assert.deepEqual(result.games,['A','A']);
  }
});
test('five physical requests pause before a sixth; cached answers do not dispatch again',async()=>{
  const journal=new Journal(join(mkdtempSync(join(tmpdir(),'jb-new-test-')),'calls.jsonl'));let calls=0;
  const guard=()=>{if(journal.starts.size>=5)throw new Error('five');};
  const ask=i=>journal.transportCall(`request-${i}`,.1,async()=>{calls++;return {text:'answer',costUsd:.001};},{model:MODELS[0]},{beforeDispatch:guard});
  for(let i=0;i<5;i++)await ask(i);await assert.rejects(ask(5),/five/);
  for(let i=0;i<5;i++)await ask(i);assert.equal(calls,5);assert.equal(journal.starts.size,5);
});
test('projection prices both contestants and all sealed phases',()=>{
  const data=Object.fromEntries(['fixtures','pilot','noise','pool','validity'].map(n=>[n,[{id:n}]]));
  const jobs=cellJobs(data,'test',MODELS[1]);assert.equal(jobs.length,2);assert.ok(jobs.every(x=>x.key.includes(MODELS[1])));
  const p=project(data,MODELS[0],[{contestant:'ledger',costUsd:.01},{contestant:'promptfoo',costUsd:.001}]);
  assert.equal(p.parts.ledger.plannedDecisions,9);assert.equal(p.parts.promptfoo.plannedDecisions,5);assert.ok(p.projectedUsd>0);
});
