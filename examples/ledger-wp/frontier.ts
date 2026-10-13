import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { HERE, sha, Budget, verifyFreeze, promptfoo, parsePromptfoo, runLimitedJobs, isTransportFailure } from './harness';
import { pairLedgerRequest, judgePairLedger } from '../../packages/judges/src/pair-ledger';
import { buildPrompt } from '../../packages/judges/src/prompt';
import { responseSchema } from '../../packages/judges/src/assessment';

const ROOT=resolve(HERE,'../..');
const criterion='The response is the better piece of writing for the instruction: it follows every requirement of the instruction and is of higher quality.';
const load=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const rows=(p:string):any[]=>existsSync(p)?readFileSync(p,'utf8').split('\n').filter(Boolean).map(x=>JSON.parse(x)):[];
const append=(p:string,x:any)=>appendFileSync(p,JSON.stringify(x)+'\n');
const flip=(x:string)=>x==='A'?'B':x==='B'?'A':'tie';
export function responsesBody(prompt:any,schema?:any) {
  return {model:'gpt-6.1-sol',instructions:prompt.system,input:prompt.user,reasoning:{effort:'medium'},max_output_tokens:4096,
    service_tier:'default',store:false,...(schema?{text:{format:{type:'json_schema',name:'judge_answer',strict:true,schema}}}:{})};
}
export function solCost(u:any) {
  if(!u||!Number.isFinite(u.input_tokens)||!Number.isFinite(u.output_tokens))throw Error('Missing usage; cost cannot be settled');
  const cached=u.input_tokens_details?.cached_tokens??0, writes=u.input_tokens_details?.cache_write_tokens??u.input_tokens_details?.cache_creation_tokens??0;
  return ((u.input_tokens-cached-writes)*2+cached*.1+writes*2.5+u.output_tokens*10)/1e6;
}
export function claudeConfig(prompt:any,cwd:string) {
  const env={...process.env,TMPDIR:cwd,CLAUDE_CODE_MAX_OUTPUT_TOKENS:'4096',MAX_THINKING_TOKENS:'2048',
    CLAUDE_CODE_MAX_RETRIES:'0',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_PROMPT_CACHING:'1'};
  delete env.CLAUDECODE;delete env.OPENAI_API_KEY;delete env.CLAUDE_CODE_RETRY_WATCHDOG;
  return {env,args:['-p','--output-format','json','--model','sonnet','--effort','medium','--system-prompt',prompt.system,
    '--tools','','--setting-sources','','--strict-mcp-config','--no-session-persistence','--disable-slash-commands',
    '--max-turns','1','--max-budget-usd','0.25']};
}
async function claude(prompt:any,cwd:string) {
  const {args,env}=claudeConfig(prompt,cwd);
  return await new Promise<any>((yes,no)=>{
    const child=spawn('claude',args,{cwd,env,stdio:['pipe','pipe','pipe']});let out='',err='';
    const timer=setTimeout(()=>{child.kill('SIGKILL');no(Error('Owned Claude transport timeout'));},300000);
    child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);
    child.on('error',e=>{clearTimeout(timer);no(e);});
    child.on('close',code=>{clearTimeout(timer);try{yes({...JSON.parse(out),exitCode:code});}catch{no(Error('Claude transport invalid envelope: '+code+' '+err.slice(0,200)));}});
    child.stdin.on('error',()=>{});child.stdin.end(prompt.user);
  });
}
export function verifyCell(model:string) {
  if(!['claude-sonnet-5-5','gpt-6.1-sol'].includes(model))throw Error('Model outside additive authorization');
  const base=load(resolve(HERE,'freeze.json'));verifyFreeze(base);
  const dir=resolve(HERE,'cells',model),f=load(resolve(dir,'freeze.json'));
  if(sha(readFileSync(resolve(HERE,'freeze.json')))!==f.parentFreezeSha256)throw Error('Base freeze changed');
  for(const [p,h] of Object.entries(f.files))if(sha(readFileSync(resolve(ROOT,p)))!==h)throw Error('Frozen source changed: '+p);
  if(f.capUsd!==(model==='claude-sonnet-5-5'?45:25)||f.reasoning!=='medium'||f.maxOutputTokens!==4096)throw Error('Cell contract mismatch');
  const tracked=spawnSync('git',['diff','HEAD','--',resolve(dir,'freeze.json')],{cwd:ROOT,encoding:'utf8'});
  const exists=spawnSync('git',['ls-files','--error-unmatch',resolve(dir,'freeze.json')],{cwd:ROOT,encoding:'utf8'});
  if(tracked.status!==0||tracked.stdout||exists.status!==0)throw Error('Freeze must be committed before any call');
  return {dir,f};
}
async function main() {
  const [model,mode]=process.argv.slice(2);
  if(!['calibrate','run','replay'].includes(mode))throw Error('Usage: frontier.ts MODEL calibrate|run|replay');
  const {dir,f}=verifyCell(model);mkdirSync(resolve(dir,'runtime/empty'),{recursive:true});
  const budget=new Budget(resolve(dir,'spend.jsonl'),f.capUsd),history=rows(resolve(dir,'calls.jsonl'));
  const cached=new Map(history.filter(r=>!r.providerError).map(r=>[r.logicalKey,r]));
  const decisions=rows(resolve(dir,'decisions.jsonl'));
  const jobKey=(j:any)=>JSON.stringify([j.split,j.contestant,j.id,j.sample]);
  const done=new Set(decisions.map(jobKey));let stopped=false,submissions=0;
  const state=(status:string,extra:any={})=>writeFileSync(resolve(dir,'state.json'),JSON.stringify({pid:process.pid,model,mode,status,at:new Date().toISOString(),decisions:done.size,submissions,spend:budget.totals(),...extra},null,2)+'\n');
  process.on('SIGTERM',()=>{stopped=true;state('draining');});
  const submit=async(prompt:any,meta:any,schema?:any)=>{
    const key=sha(JSON.stringify([meta,prompt,schema,{reasoning:f.reasoning,maxOutputTokens:f.maxOutputTokens}]));
    if(cached.has(key))return cached.get(key);
    if(mode==='replay')throw Error('Replay miss '+key);
    if(stopped)throw Error('Provider stopped');
    if(mode==='calibrate'&&history.filter(r=>!r.providerError&&r.startedAt>=(f.calibrationAfter??'')).length>=5)throw Error('CALIBRATION_COMPLETE');
    let last:any;
    for(let attempt=1;attempt<=4;attempt++) {
      if(attempt===4&&last?.httpStatus!==429)break;
      const attemptKey=attempt===1?key:sha(key+':transport:'+attempt);
      const prior=history.find(r=>r.key===attemptKey);
      if(prior){last=prior;if(!prior.providerError)return prior;if(!isTransportFailure(prior.text))throw Error('Prior nontransport failure');continue;}
      if(budget.totals().pending.includes(attemptKey)){last={text:'Interrupted transport'};continue;}
      if(attempt>1){const delay=last?.httpStatus===429?[60000,120000,240000][attempt-2]:1500*(attempt-1);
        await new Promise(r=>setTimeout(r,Math.max(0,delay-(Date.now()-Date.parse(last?.finishedAt??new Date().toISOString())))));}
      if(stopped)throw Error('Provider stopped');
      if(Date.now()>Date.parse(f.lastCallUtc))throw Error('LAST_CALL_CUTOFF');
      budget.reserve(attemptKey,.25);submissions++;
      const startedAt=new Date().toISOString();let payload:any,httpStatus:number|undefined,providerMeta:any={};
      try {
        if(model==='claude-sonnet-5-5') {
          payload=await claude(prompt,resolve(dir,'runtime/empty'));
          providerMeta={modelUsage:payload.modelUsage,stopReason:payload.stop_reason??payload.stopReason,subtype:payload.subtype,
            outputTokenCap:4096,requestedThinkingBudget:2048,reasoningApplied:'medium',thinkingBudgetNote:'Adaptive Sonnet may ignore fixed budget; total output cap applies.'};
          if(payload.is_error&&payload.usage?.output_tokens>=4096){providerMeta.returnedOutputCapError=true;payload.is_error=false;}
          if(payload.is_error&&/\b429\b/.test(payload.result??'')){httpStatus=429;payload.result='Provider 429: '+payload.result;}
          const observed=Object.keys(payload.modelUsage??{});
          if(observed.some(x=>x!==model)) {stopped=true;providerMeta.modelMismatch=observed;}
        } else {
          const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'content-type':'application/json',Authorization:'Bearer '+process.env.OPENAI_API_KEY},
            body:JSON.stringify(responsesBody(prompt,schema)),signal:AbortSignal.timeout(300000)});
          httpStatus=response.status;
          if(!response.ok)throw Error('Provider '+response.status+': '+(await response.text()).slice(0,300));
          const raw:any=await response.json();
          const text=(raw.output??[]).flatMap((o:any)=>o.type==='message'?(o.content??[]).filter((c:any)=>c.type==='output_text').map((c:any)=>c.text):[]).join('\n');
          payload={result:text,total_cost_usd:solCost(raw.usage),usage:raw.usage,is_error:false};
          providerMeta={id:raw.id,model:raw.model,status:raw.status,incompleteDetails:raw.incomplete_details,reasoning:raw.reasoning,serviceTier:raw.service_tier,outputTokenCap:4096};
          if(raw.model!==model){stopped=true;providerMeta.modelMismatch=raw.model;}
        }
      } catch(error:any){payload={result:String(error),total_cost_usd:0,is_error:true};providerMeta.networkCode=error.cause?.code;}
      const entry={...meta,key:attemptKey,logicalKey:key,transportAttempt:attempt,promptHash:sha(JSON.stringify(prompt)),schemaHash:schema?sha(JSON.stringify(schema)):null,
        text:payload.result??'',costUsd:payload.total_cost_usd??0,usage:payload.usage??null,providerMeta,httpStatus,providerError:payload.is_error===true,
        startedAt,finishedAt:new Date().toISOString()};
      append(resolve(dir,'calls.jsonl'),entry);history.push(entry);last=entry;
      if(!entry.providerError){budget.settle(attemptKey,entry.costUsd);cached.set(key,entry);state('running');return entry;}
      budget.chargeError(attemptKey,entry.costUsd);
      if(httpStatus===402){budget.releaseRejected(attemptKey,402);stopped=true;throw Error('402 circuit break');}
      if(!isTransportFailure(entry.text)){stopped=true;throw Error('Nontransport provider failure: '+entry.text);}
    }
    append(resolve(dir,'missing.jsonl'),{...meta,logicalKey:key,reason:'Transport exhausted; no answer',at:new Date().toISOString()});
    throw Error('TRANSPORT_EXHAUSTED');
  };
  const runJob=async({job,item}:any)=>{
    let costUsd=0,callCount=0;
    try {
      const ask=async(prompt:any,schema?:any)=>{const out=await submit(prompt,{...job,callIndex:callCount++},schema);costUsd+=out.costUsd;return out;};
      let games:string[],details:any,graderErrors=0;
      if(job.contestant==='promptfoo') {
        const ab=await ask(promptfoo(item.question,item.a,item.b));
        const ba=await ask(promptfoo(item.question,item.b,item.a));
        games=[parsePromptfoo(ab.text),flip(parsePromptfoo(ba.text))];graderErrors=games.filter(g=>g==='tie').length;
      } else {
        const native=model==='claude-sonnet-5-5';
        const client:any={id:model,family:native?'anthropic':'openai',cls:'system2',cost:1,dialect:native?'scratchpad-json':'openai-json-schema',reasoning:'medium',
          judge:async(request:any)=>{const out=await ask(buildPrompt(request),native?undefined:responseSchema(request));return {raw:out.text,costUsd:out.costUsd};}};
        const request=pairLedgerRequest({name:'writing',rubric:criterion},[{role:'user',text:item.question}],item.a,item.b,
          {requirements:item.requirements.map((r:any)=>({name:r.id,rubric:r.definition,hard:r.hard})),reasoning:'medium'});
        details=await judgePairLedger(client,request,{stage0:{correctness:false,compute:false,language:item.language},tiePolicy:'canonical'});
        const choice=details.choice==='first'?'A':details.choice==='second'?'B':'tie';games=[choice,choice];
        graderErrors=details.reads.filter((r:any)=>r.result.unparsed).length;
      }
      const result={...job,games,costUsd,callCount,graderErrors,details};append(resolve(dir,'decisions.jsonl'),result);done.add(jobKey(job));state('running');return true;
    } catch(error) {
      const text=String(error);if(text.includes('CALIBRATION_COMPLETE'))return false;
      append(resolve(dir,'errors.jsonl'),{...job,error:text,at:new Date().toISOString()});
      if(text.includes('TRANSPORT_EXHAUSTED'))return true;
      stopped=true;state('stopped',{error:text});return false;
    }
  };
  if(mode==='run') {
    const p=load(resolve(dir,'projection.json'));
    if(p.answeredCalls!==5||p.projectedCellUsd>f.capUsd)throw Error('Five-call projection must pass before full cell');
  }
  state('running');
  for(const split of mode==='calibrate'?['pilot']:f.phases) {
    const jobs:any[]=[];
    for(let sample=0;sample<(['fixtures','dev'].includes(split)?3:1);sample++)for(const item of load(resolve(HERE,'seals',split+'.json')))for(const contestant of f.contestants) {
      const job={model,split,sample,contestant,id:item.id,requestId:item.requestId};
      if(!done.has(jobKey(job)))jobs.push({job,item});
    }
    if(!await runLimitedJobs(jobs,mode==='calibrate'?1:f.maxConcurrentCalls,runJob))break;
    if(stopped)break;
  }
  state(stopped?'stopped':mode==='calibrate'?'calibrated':'complete');
  console.log(JSON.stringify({model,mode,stopped,decisions:done.size,answeredCalls:history.filter(r=>!r.providerError).length,spend:budget.totals()}));
  if(stopped)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
