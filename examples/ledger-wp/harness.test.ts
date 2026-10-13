import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Budget, cheater, FirstAnswerGate, HERE, isTransportFailure, parsePromptfoo, promptfoo, runLimitedJobs, sha, transportBackoffMs, verifyFreeze } from './harness';
import { judgePairLedger, pairLedgerRequest } from '../../packages/judges/src/pair-ledger';
import { responseSchema } from '../../packages/judges/src/assessment';
import { buildPrompt } from '../../packages/judges/src/prompt';

test('constant FIRST has exactly one correct game for either gold side',()=>{
  for(const label of ['A','B'])assert.equal(cheater({},'constant-FIRST').filter(x=>x===label).length,1);
});
test('longer cheater uses Chinese characters and preserves normalized choice',()=>{
  assert.deepEqual(cheater({a:'中文很长',b:'短',language:'zh'},'longer-wins'),['A','A']);
  assert.deepEqual(cheater({a:'two words',b:'one',language:'en'},'longer-wins'),['A','A']);
});
test('integer parser accepts only the pinned first integer and records unparsed as tie',()=>{
  assert.equal(parsePromptfoo('choice: 1'),'B');assert.equal(parsePromptfoo('2 then 0'),'tie');
  assert.equal(parsePromptfoo('none'),'tie');assert.equal(parsePromptfoo('0'),'A');
});
test('transport retry classification excludes billing, authentication and content failures',()=>{
  for(const text of ['shim error: fetch failed','Owned Claude call timed out','Provider 503: unavailable','Provider 429: Resource has been exhausted (e.g. check quota).'])assert.equal(isTransportFailure(text),true);
  for(const text of ['Provider 402: billing credits required','Provider 401: invalid API key','Unparsed JSON','0','1','provider refused'])assert.equal(isTransportFailure(text),false);
});
test('HTTP 429 uses the owner-authorized 60, 120 and 240 second waits',()=>{
  assert.deepEqual([2,3,4].map(n=>transportBackoffMs('shim error: Provider 429: shared quota',n)),[60000,120000,240000]);
  assert.equal(transportBackoffMs('shim error: fetch failed',2),1500);
});
test('per-model queues preserve sealed start order and independent concurrency bounds',async()=>{
  const maxima:Record<string,number>={};
  const limits:Record<string,number>={haiku:2,'gpt-6-luna':8,'gemini-3.8-flash':2};
  await Promise.all(Object.entries(limits).map(async([model,limit])=>{
    let active=0;const starts:number[]=[];maxima[model]=0;
    const jobs=Array.from({length:17},(_,i)=>i);
    await runLimitedJobs(jobs,limit,async job=>{
      starts.push(job);active++;maxima[model]=Math.max(maxima[model],active);
      await new Promise(resolve=>setTimeout(resolve,job%2));active--;return true;
    });
    assert.deepEqual(starts,jobs);
    assert.equal(maxima[model],limit);
  }));
});
test('an exhausted provider stops its queue without stopping another provider',async()=>{
  const failed:number[]=[];const healthy:number[]=[];
  const jobs=[0,1,2,3,4];
  const results=await Promise.all([
    runLimitedJobs(jobs,1,async job=>{failed.push(job);return false;}),
    runLimitedJobs(jobs,2,async job=>{healthy.push(job);return true;}),
  ]);
  assert.deepEqual(results,[false,true]);assert.deepEqual(failed,[0]);assert.deepEqual(healthy,jobs);
});
test('Gemini submits one missing probe before allowing a second call',async()=>{
  const gate=new FirstAnswerGate();const starts:number[]=[];let finish!:(value:string)=>void;
  const probe=new Promise<string>(resolve=>finish=resolve);let observed='';
  const first=gate.run(()=>{starts.push(1);return probe;},value=>observed=value);
  const second=gate.run(async()=>{starts.push(2);return 'next';},()=>assert.fail('Second call is not a probe'));
  await Promise.resolve();assert.deepEqual(starts,[1]);
  finish('malformed returned answer');await Promise.all([first,second]);
  assert.equal(observed,'malformed returned answer');assert.deepEqual(starts,[1,2]);
});
test('a rejected Gemini probe parks waiting submissions',async()=>{
  const gate=new FirstAnswerGate();let submissions=0;
  const attempt=()=>gate.run(async()=>{submissions++;throw Error('Provider 402');},()=>assert.fail());
  const results=await Promise.allSettled([attempt(),attempt()]);
  assert.equal(submissions,1);assert.ok(results.every(r=>r.status==='rejected'));
});
test('upstream rendering has byte-identical two-output format and opaque input',()=>{
  const out=promptfoo('Brief','first','second');
  assert.equal(out.user,'Output the index now.');
  assert.ok(out.system.includes('<Text index="0">\nfirst\n</Text>\n\n<Text index="1">\nsecond\n</Text>'));
  assert.ok(out.system.endsWith('You must output a single integer.'));
  assert.ok(promptfoo('Brief','{{b}}','secret').system.includes('<Text index="0">\n{{b}}\n</Text>'));
});
test('concurrent reservations count before settlement and survive a restart',()=>{
  const dir=mkdtempSync(resolve(HERE,'runtime/budget-test-'));
  const file=resolve(dir,'spend.jsonl');const b=new Budget(file,1);
  b.reserve('one',.6);assert.throws(()=>b.reserve('two',.5),/CAP/);
  assert.throws(()=>b.reserve('one',.1),/Unresolved/);
  b.settle('one',.2);b.reserve('two',.5);
  const resumed=new Budget(file,1);assert.equal(resumed.totals().actual,.2);assert.equal(resumed.totals().reserved,.5);
  assert.throws(()=>resumed.reserve('three',.4),/CAP/);
});
test('only a proven HTTP 402 rejection releases a provider reservation',()=>{
  const dir=mkdtempSync(resolve(HERE,'runtime/rejection-test-'));
  const b=new Budget(resolve(dir,'spend.jsonl'),1);b.reserve('rejected',.1);b.reserve('unknown',.1);
  assert.throws(()=>b.releaseRejected('unknown',429),/proven HTTP 402/);
  b.releaseRejected('rejected',402);
  assert.deepEqual(b.totals().pending,['unknown']);assert.equal(b.totals().actual,0);
});
test('freeze gate blocks pending core and corrupted files before calls',()=>{
  assert.throws(()=>verifyFreeze({core:{}}),/CORE_PR/);
  const freeze={core:{pr:'https://example.test/1',commit:'x',pushed:true},files:{'examples/ledger-wp/stats.py':'wrong'},seals:{},capUsd:35,models:['haiku']};
  assert.throws(()=>verifyFreeze(freeze),/FROZEN_SOURCE/);
  freeze.files['examples/ledger-wp/stats.py']=sha(readFileSync(resolve(HERE,'stats.py')));
  assert.doesNotThrow(()=>verifyFreeze(freeze));
});
test('pushed core adapter carries exact caller rows through both orders without labels',async()=>{
  const item=JSON.parse(readFileSync(resolve(HERE,'seals/fixtures.json'),'utf8'))[0];
  const request=pairLedgerRequest({name:'writing',rubric:'Follow the writing request.'},[{role:'user',text:item.question}],item.a,item.b,
    {requirements:item.requirements.map((r:any)=>({name:r.id,rubric:r.definition,hard:r.hard})),reasoning:'medium'});
  let calls=0;
  const client:any={id:'mock',family:'test',cls:'system2',cost:0,dialect:'openai-json-schema',reasoning:'medium',judge:async(r:any)=>{
    calls++;
    const prompt=buildPrompt(r);assert.ok(prompt.user.includes('<first_data>'));assert.ok(!prompt.user.includes('sourceScores'));
    const schema:any=responseSchema(r);assert.equal(schema.properties.items.minItems,item.requirements.length);
    const first=r.candidates.A.includes('Ada');
    return {raw:JSON.stringify({items:item.requirements.map((row:any)=>({name:row.id,first:first?4:0,second:first?0:4,reasoning:'Literal fixture requirement.',evidence:null}))}),costUsd:0};
  }};
  const result=await judgePairLedger(client,request,{stage0:{correctness:false,compute:false},tiePolicy:'canonical'});
  assert.equal(calls,2);assert.equal(result.choice,'first');assert.equal(result.status,'decided');
});
