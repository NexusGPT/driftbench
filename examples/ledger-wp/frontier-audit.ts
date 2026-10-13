/** Independent offline replay. No network or provider process is available here. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { HERE, sha, promptfoo, parsePromptfoo, Budget } from './harness';
import { verifyCell, solCost } from './frontier';
import { pairLedgerRequest, judgePairLedger } from '../../packages/judges/src/pair-ledger';
import { buildPrompt } from '../../packages/judges/src/prompt';
import { responseSchema } from '../../packages/judges/src/assessment';
const criterion='The response is the better piece of writing for the instruction: it follows every requirement of the instruction and is of higher quality.';
const rows=(p:string)=>readFileSync(p,'utf8').split('\n').filter(Boolean).map(x=>JSON.parse(x));
const flip=(x:string)=>x==='A'?'B':x==='B'?'A':'tie';
for(const model of process.argv.slice(2)) {
  const {dir,f}=verifyCell(model),calls=rows(resolve(dir,'calls.jsonl')),decisions=rows(resolve(dir,'decisions.jsonl'));
  const missing=existsSync(resolve(dir,'missing.jsonl'))?rows(resolve(dir,'missing.jsonl')):[];
  const answers=calls.filter(r=>!r.providerError),byKey=new Map(answers.map(r=>[r.logicalKey,r]));
  assert.equal(byKey.size,answers.length,'An answered call was resubmitted');
  const decisionKey=(r:any)=>JSON.stringify([r.model,r.split,r.sample,r.contestant,r.id]);
  assert.equal(new Set(decisions.map(decisionKey)).size,decisions.length,'Duplicate decision');
  let replayed=0;
  for(const split of f.phases) {
    const items=JSON.parse(readFileSync(resolve(HERE,'seals',split+'.json'),'utf8'));
    const selected=decisions.filter(r=>r.split===split);
    if(split==='test')assert.equal(selected.length,f.phaseComparisons[split],'Incomplete TEST');
    else if(selected.length!==f.phaseComparisons[split]) {
      const done=new Set(selected.map(decisionKey));
      const absent=new Set(missing.filter(r=>r.split===split&&!done.has(decisionKey(r))).map(decisionKey));
      assert.equal(selected.length+absent.size,f.phaseComparisons[split],'Unaccounted development items');
    }
    for(const result of selected) {
      const item=items.find((i:any)=>i.id===result.id);assert(item);
      const {model,split,sample,contestant,id,requestId}=result;
      const job={model,split,sample,contestant,id,requestId};let callCount=0,cost=0;
      const ask=async(prompt:any,schema?:any)=>{
        const meta={...job,callIndex:callCount++};
        const key=sha(JSON.stringify([meta,prompt,schema,{reasoning:f.reasoning,maxOutputTokens:f.maxOutputTokens}]));
        const out=byKey.get(key);assert(out,'Unrecorded answer '+key);
        assert.equal(out.promptHash,sha(JSON.stringify(prompt)));assert.equal(out.schemaHash,schema?sha(JSON.stringify(schema)):null);
        cost+=model==='gpt-6.1-sol'?solCost(out.usage):out.costUsd;return out;
      };
      let games:string[],details:any,errors=0;
      if(contestant==='promptfoo') {
        const ab=await ask(promptfoo(item.question,item.a,item.b)),ba=await ask(promptfoo(item.question,item.b,item.a));
        games=[parsePromptfoo(ab.text),flip(parsePromptfoo(ba.text))];errors=games.filter(x=>x==='tie').length;
      } else {
        const native=model==='claude-sonnet-5-5';
        const client:any={id:model,family:native?'anthropic':'openai',cls:'system2',cost:1,dialect:native?'scratchpad-json':'openai-json-schema',reasoning:'medium',
          judge:async(r:any)=>{const out=await ask(buildPrompt(r),native?undefined:responseSchema(r));return {raw:out.text,costUsd:out.costUsd};}};
        const request=pairLedgerRequest({name:'writing',rubric:criterion},[{role:'user',text:item.question}],item.a,item.b,
          {requirements:item.requirements.map((r:any)=>({name:r.id,rubric:r.definition,hard:r.hard})),reasoning:'medium'});
        details=await judgePairLedger(client,request,{stage0:{correctness:false,compute:false,language:item.language},tiePolicy:'canonical'});
        const choice=details.choice==='first'?'A':details.choice==='second'?'B':'tie';games=[choice,choice];
        errors=details.reads.filter((r:any)=>r.result.unparsed).length;
        assert.deepEqual(details,result.details);
      }
      assert.deepEqual(games,result.games);assert.equal(errors,result.graderErrors);assert.equal(callCount,result.callCount);assert(Math.abs(cost-result.costUsd)<1e-10);replayed++;
    }
    const firstStarts=calls.filter(r=>r.split===split&&r.callIndex===0&&r.transportAttempt===1);
    const expected:any[]=[];
    for(let sample=0;sample<(['fixtures','dev'].includes(split)?3:1);sample++)for(const item of items)for(const contestant of f.contestants)expected.push({model,split,sample,contestant,id:item.id});
    const key=(r:any)=>JSON.stringify([r.model,r.split,r.sample,r.contestant,r.id]);
    const starts=new Map(firstStarts.map(r=>[key(r),Date.parse(r.startedAt)]));
    assert.equal(starts.size,expected.length);
    const orderedTimes=expected.map(r=>starts.get(key(r))!);
    assert(orderedTimes.every((t,i)=>Number.isFinite(t)&&(i===0||orderedTimes[i-1]<=t)),'Sealed submission order changed');
  }
  const events=calls.flatMap(r=>[{t:r.startedAt,d:1},{t:r.finishedAt,d:-1}]).sort((a,b)=>a.t.localeCompare(b.t)||a.d-b.d);
  let active=0,peak=0;for(const e of events){active+=e.d;peak=Math.max(peak,active);}assert.equal(active,0);assert(peak<=f.maxConcurrentCalls);
  const budget=new Budget(resolve(dir,'spend.jsonl'),f.capUsd).totals();
  const known=calls.reduce((n,r)=>n+(model==='gpt-6.1-sol'&&!r.providerError?solCost(r.usage):r.costUsd),0);
  assert(Math.abs(budget.actual-known)<1e-9);assert(budget.actual+budget.reserved<=f.capUsd);
  const audit={model,at:new Date().toISOString(),passed:true,replayedComparisons:replayed,answeredCalls:answers.length,
    developmentMissingComparisons:new Set(missing.filter(r=>r.split!=='test'&&!decisions.some(d=>decisionKey(d)===decisionKey(r))).map(decisionKey)).size,
    noAnsweredResubmissions:true,sealedJobOrder:true,peakConcurrentCalls:peak,spend:budget,freezeSha256:sha(readFileSync(resolve(dir,'freeze.json'))),
    originalSourceAndSealHashes:'verified by verifyCell -> verifyFreeze',networkCalls:0};
  writeFileSync(resolve(dir,'audit.json'),JSON.stringify(audit,null,2)+'\n');console.log(JSON.stringify(audit));
}
