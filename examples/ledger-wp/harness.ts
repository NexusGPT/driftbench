import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readerFeatures } from './vendor/reader-c50/packages/judges/src/reader-first-features';
import { createReaderFirstJudge } from './vendor/reader-c50/packages/judges/src/reader-first';
import { buildPrompt as readerPrompt } from './vendor/reader-c50/packages/judges/src/prompt';
import { parseJudgeText as readerParse } from './vendor/reader-c50/packages/judges/src/assessment';

export const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(HERE, '../..');
const criterion = 'The response is the better piece of writing for the instruction: it follows every requirement of the instruction and is of higher quality.';
export const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const load = (file: string) => JSON.parse(readFileSync(resolve(HERE,file),'utf8'));
const rows = (file: string): any[] => existsSync(resolve(HERE,file)) ? readFileSync(resolve(HERE,file),'utf8').split('\n').filter(Boolean).map(x=>JSON.parse(x)) : [];
const append = (file: string, value: unknown) => appendFileSync(resolve(HERE,file),JSON.stringify(value)+'\n');
const flip = (x: string) => x==='A'?'B':x==='B'?'A':'tie';

export function promptfoo(question: string, a: string, b: string) {
  const template = readFileSync(resolve(HERE,'vendor/select-best.njk'),'utf8');
  const loop = '{% for output in outputs %}\n<Text index="{{ loop.index0 }}">\n{{ output }}\n</Text>\n{% endfor %}';
  if (!template.includes(loop)) throw Error('Upstream prompt template changed');
  const placeholders: Record<string,string> = {criteria: `${criterion} The question: ${question}`,a,b};
  const rendered = template.replace(loop,'<Text index="0">\n{{a}}\n</Text>\n\n<Text index="1">\n{{b}}\n</Text>');
  return {system:rendered.replace(/\{\{(criteria|a|b)\}\}/g,(_,key)=>placeholders[key]!),user:'Output the index now.'};
}
export function parsePromptfoo(text: string) {
  const n = text.match(/\d+/)?.[0];
  return n==='0'?'A':n==='1'?'B':'tie';
}
export function cheater(item: any, kind: string) {
  if (kind==='constant-FIRST') return ['A','B'];
  const af=readerFeatures(item.a,item.language),bf=readerFeatures(item.b,item.language);
  if(kind==='longer-wins') {const choice=af.length===bf.length?'tie':af.length>bf.length?'A':'B';return [choice,choice];}
  const refuses=(s:string)=>/\bI (?:cannot|can't|will not|won't|am unable to) (?:help|assist|provide|comply)\b|无法提供|不能帮助|不能协助|抱歉.{0,15}不能/iu.test(s);
  const a=refuses(item.a),b=refuses(item.b);
  const choice=a===b?'tie':a?'A':'B';return [choice,choice];
}

export const isRateLimit = (text:string) => /Provider 429\b/iu.test(text);
export const transportBackoffMs = (error:string,attempt:number,model?:string) => isRateLimit(error)?(model==='gemini-3.5-flash-lite'?[20_000,60_000,180_000][attempt-2]!:60_000*2**(attempt-2)):1500*(attempt-1);
export const transportWaitRemainingMs = (error:string,attempt:number,finishedAt?:string,now=Date.now(),model?:string) =>
  Math.max(0,transportBackoffMs(error,attempt,model)-(finishedAt?Math.max(0,now-Date.parse(finishedAt)):0));
export function isTransportFailure(text:string) {
  if(isRateLimit(text))return true;
  if(/spending cap|billing|invalid.api.key|authentication|insufficient_quota/iu.test(text))return false;
  return /fetch failed|timed? ?out|timeout|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|network error|Provider (?:429|5\d\d)\b/iu.test(text);
}

// Each queue starts jobs in sealed order. A stopped provider drains only its own queue.
export async function runLimitedJobs<T>(jobs:T[], limit:number, run:(job:T)=>Promise<boolean>) {
  if(!Number.isInteger(limit)||limit<1)throw Error('Invalid worker limit');
  let cursor=0,stopped=false;
  await Promise.all(Array.from({length:limit},async()=>{
    while(!stopped&&cursor<jobs.length) {
      const job=jobs[cursor++];
      if(!await run(job))stopped=true;
    }
  }));
  return !stopped;
}

// A returned answer, including malformed content, opens the provider queue.
export class FirstAnswerGate {
  private probe:Promise<unknown>|undefined;
  constructor(passed=false) {if(passed)this.probe=Promise.resolve();}
  async run<T>(submit:()=>Promise<T>,observe:(value:T)=>void):Promise<T> {
    if(this.probe) {await this.probe;return submit();}
    const pending=submit();
    this.probe=pending;
    const value=await pending;
    observe(value);
    return value;
  }
}

export class Budget {
  readonly file: string;
  readonly cap: number;
  events: any[];
  constructor(file='results/spend.jsonl', cap=35) {this.file=file;this.cap=cap;this.events=rows(file);}
  totals() {
    const pending=new Map<string,number>();let actual=0;
    for(const e of this.events) {
      if(e.kind==='reserve') pending.set(e.key,e.usd);
      if(e.kind==='settle') {pending.delete(e.key);actual+=e.usd;}
      if(e.kind==='release') pending.delete(e.key);
    }
    return {actual,reserved:[...pending.values()].reduce((a,b)=>a+b,0),pending:[...pending.keys()]};
  }
  canReserve(key:string,usd:number) {
    const state=this.totals();
    if(state.pending.includes(key)) throw Error('Unresolved prior paid call: '+key);
    if(state.actual+state.reserved+usd>this.cap) throw Error('LANE_CAP_REACHED');
  }
  reserve(key:string,usd:number) {
    this.canReserve(key,usd);
    const event={kind:'reserve',key,usd,at:new Date().toISOString()};append(this.file,event);this.events.push(event);
  }
  settle(key:string,usd:number) {
    if(!Number.isFinite(usd)||usd<0)throw Error('Invalid provider cost');
    const event={kind:'settle',key,usd,at:new Date().toISOString()};append(this.file,event);this.events.push(event);
  }
  releaseRejected(key:string,httpStatus:number) {
    if(httpStatus!==402||!this.totals().pending.includes(key))throw Error('Release requires a proven HTTP 402 rejection');
    const event={kind:'release',key,usd:0,reason:'Provider HTTP 402 rejection; no model answer',at:new Date().toISOString()};
    append(this.file,event);this.events.push(event);
  }
  chargeError(key:string,usd:number) {
    if(!Number.isFinite(usd)||usd<=0)return;
    const chargeKey='known-error-charge:'+key;
    if(this.events.some(e=>e.kind==='settle'&&e.key===chargeKey))return;
    const reserved=[...this.events].reverse().find(e=>e.kind==='reserve'&&e.key===key)?.usd??0;
    this.settle(chargeKey,usd);
    const event={kind:'reserve',key,usd:Math.max(0,reserved-usd),reason:'Known no-answer charge counted as actual; unresolved balance retained',at:new Date().toISOString()};
    append(this.file,event);this.events.push(event);
  }
}

export function verifyFreeze(freeze: any) {
  if (!freeze.core?.pr || !freeze.core?.commit || !freeze.core?.pushed) throw Error('CORE_PR_NOT_READY');
  for (const [path, expected] of Object.entries(freeze.files)) {
    if (sha(readFileSync(resolve(ROOT,path)))!==expected) throw Error('FROZEN_SOURCE_CHANGED: '+path);
  }
  for (const [split, expected] of Object.entries(freeze.seals)) {
    if(sha(readFileSync(resolve(HERE,'seals',split+'.json')))!==expected)throw Error('SEALED_POOL_CHANGED');
  }
  if(freeze.capUsd!==35 || freeze.models.some((x:string)=>!['haiku','gpt-6-luna','gemini-3.8-flash'].includes(x)))throw Error('Invalid spend/model authorization');
  for(const [model,cell] of Object.entries(freeze.additionalModelCells??{}) as [string,any][]) {
    if(model!=='gemini-3.5-flash-lite'||cell.capUsd!==5||cell.reasoning!=='medium'||cell.maxConcurrentCalls!==8||JSON.stringify(cell.contestants)!==JSON.stringify(['pair-ledger','promptfoo']))throw Error('Invalid additive model authorization');
    for(const [path,expected] of Object.entries(cell.runtimeArtifactHashes??{}))if(sha(readFileSync(resolve(ROOT,path)))!==expected)throw Error('ADDITIVE_RUNTIME_CHANGED: '+path);
  }

}

async function runClaude(prompt: {system:string;user:string}, cwd:string): Promise<any> {
  const args=['-p','--output-format','json','--model','haiku','--system-prompt',prompt.system,'--tools','','--setting-sources','','--strict-mcp-config','--no-session-persistence','--max-turns','1','--max-budget-usd','0.10'];
  return new Promise((resolvePromise,reject)=> {
    const env={...process.env,TMPDIR:cwd};delete env.CLAUDECODE;
    const child=spawn('claude',args,{cwd,env,stdio:['pipe','pipe','pipe']});
    let out='',err='';
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Owned Claude call timed out; reservation retained'));},300_000);
    child.stdout.on('data',x=>out+=x.toString());child.stderr.on('data',x=>err+=x.toString());
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    child.on('close',code=>{clearTimeout(timer);try {const data=JSON.parse(out);resolvePromise({...data,exitCode:code});} catch {reject(Error('Claude output not JSON, exit '+code+'; stderr '+err.slice(0,100)));}});
    child.stdin.on('error',()=>{});child.stdin.end(prompt.user);
  });
}

async function main() {
  const arg=(name:string)=>{const i=process.argv.indexOf('--'+name);return i<0?undefined:process.argv[i+1];};
  if(process.argv.includes('--help')) {
    console.log('harness.ts --cheaters | --phase pilot|dev|fixtures|validity|test|remaining [--model comma-separated frozen model IDs] [--model-concurrency JSON] [--replay-only]');return;
  }
  mkdirSync(resolve(HERE,'results'),{recursive:true});mkdirSync(resolve(HERE,'runtime/empty'),{recursive:true});
  if(process.argv.includes('--cheaters')) {
    const prior=rows('results/decisions.jsonl');
    for(const split of ['pilot','dev','test']) for(const item of load('seals/'+split+'.json')) for(const contestant of ['longer-wins','constant-FIRST','refusal-wins']) {
      if(prior.some(r=>r.split===split&&r.id===item.id&&r.contestant===contestant))continue;
      append('results/decisions.jsonl',{split,id:item.id,requestId:item.requestId,model:'machine',contestant,games:cheater(item,contestant),costUsd:0,graderErrors:0});
    }
    console.log('Machine controls recorded. No model calls.');return;
  }
  const phase=arg('phase');if(!['pilot','dev','fixtures','validity','test','remaining'].includes(phase??''))throw Error('Explicit phase required');
  const baseFreeze=load('freeze.json');verifyFreeze(baseFreeze);
  const additions=baseFreeze.additionalModelCells??{};
  const freeze={...baseFreeze,models:[...baseFreeze.models,...Object.keys(additions)],
    reasoning:{...baseFreeze.reasoning,...Object.fromEntries(Object.entries(additions).map(([model,c]:any)=>[model,c.reasoning]))}};
  // Original call keys retain their exact original reasoning map after an additive model amendment.
  const keyReasoning=(model:string)=>additions[model]?freeze.reasoning:baseFreeze.reasoning;
  const core:any=await import(pathToFileURL(resolve(ROOT,'packages/judges/src/pair-ledger.ts')).href);
  const promptModule:any=await import(pathToFileURL(resolve(ROOT,'packages/judges/src/prompt.ts')).href);
  const schemaModule:any=await import(pathToFileURL(resolve(ROOT,'packages/judges/src/assessment.ts')).href);
  const shim:any=await import(pathToFileURL(resolve(ROOT,'examples/judge-benchmarks/src/llm-shim.mjs')).href);
  const quotaBlocked=Date.now()<Date.parse(freeze.geminiDailyQuotaAmendment?.resumeNotBefore??'1970-01-01');
  const modelArg=arg('model');const models=modelArg?modelArg.split(','):freeze.models.filter((m:string)=>m!=='gemini-3.8-flash'||(!freeze.geminiOwnerHold?.active&&!freeze.geminiCreditHold?.active&&!quotaBlocked));
  if(models.some((x:string)=>!freeze.models.includes(x)))throw Error('Model not frozen');
  if(models.includes('gemini-3.8-flash')&&freeze.geminiOwnerHold?.active)throw Error('Gemini 3.8 is parked until the owner explicitly resumes it');
  if(models.includes('gemini-3.8-flash')&&freeze.geminiCreditHold?.active)throw Error('Gemini is parked pending owner-confirmed credit top-up');
  if(models.includes('gemini-3.8-flash')&&quotaBlocked)throw Error('Gemini not run: daily quota; wait for authorized reset or owner amendment');
  const authorizedLimits={...freeze.pacingAmendment?.maxConcurrentCalls,...Object.fromEntries(Object.entries(additions).map(([model,c]:any)=>[model,c.maxConcurrentCalls]))};
  if(!authorizedLimits)throw Error('Per-model pacing amendment required');
  const requestedLimits=arg('model-concurrency')?JSON.parse(arg('model-concurrency')!):{};
  const limits:Record<string,number>={};
  for(const model of models) {
    const limit=Number(requestedLimits[model]??arg('concurrency')??authorizedLimits[model]);
    if(!Number.isInteger(limit)||limit<1||limit>authorizedLimits[model])throw Error('Unauthorized concurrency: '+model);
    limits[model]=limit;
  }
  const budget=new Budget();
  const modelBudgets=new Map(Object.entries(additions).map(([model,c]:any)=>[model,new Budget(c.spendFile,c.capUsd)]));
  const history=rows('results/calls.jsonl');
  const recorded=new Map(history.map(r=>[r.logicalKey??r.key,r]));
  const attempts=new Map(history.map(r=>[r.key,r]));
  const decisions=rows('results/decisions.jsonl');
  const decisionKey=(x:any)=>JSON.stringify([x.split,x.model,x.contestant,x.id,x.sample??0]);
  const done=new Set(decisions.map(decisionKey));
  let stop=false,completed=0;
  const stoppedModels=new Set<string>();
  const geminiAbort=new AbortController();
  const modelProgress:Record<string,any>={};
  const phases=phase==='remaining'?['fixtures','validity','dev','test']:[phase!];
  const queues=new Map<string,any[]>();
  for(const model of models)for(const split of phases) {
    const jobs:any[]=[];
    if(additions[model]&&!additions[model].phases.includes(split)) {queues.set(model+':'+split,jobs);continue;}
    for(let sample=0;sample<(['dev','fixtures'].includes(split)?3:1);sample++)for(const item of load('seals/'+split+'.json'))for(const contestant of additions[model]?.contestants??['pair-ledger','reader-first-c50b2dc3','promptfoo']) {
      const job={split,model,contestant,id:item.id,requestId:item.requestId,sample};
      if(!done.has(decisionKey(job)))jobs.push({job,item});
    }
    queues.set(model+':'+split,jobs);
  }
  const planned=[...queues.values()].reduce((n,jobs)=>n+jobs.length,0);
  const progress=()=>writeFileSync(resolve(HERE,'results/progress.json'),JSON.stringify({phase,completedThisInvocation:completed,remaining:planned-completed,models:modelProgress,limits,spend:budget.totals(),at:new Date().toISOString()})+'\n');
  const reportPhase=()=>{
    for(const name of ['stats.py','phase_report.py','validity_report.py','report.py','verify_results.py']) {
      const out=spawnSync('python3',[resolve(HERE,name)],{cwd:ROOT,encoding:'utf8'});
      if(out.status!==0)throw Error('Offline report failed: '+name+' '+out.stderr+' '+out.stdout);
    }
  };
  process.on('SIGTERM',()=>{stop=true;progress();});
  const submit=async(prompt:any,meta:any,schema?:any)=> {
    const key=sha(JSON.stringify([meta,prompt,schema,keyReasoning(meta.model)]));
    if(recorded.has(key) && !recorded.get(key).providerError) return recorded.get(key);
    if(process.argv.includes('--replay-only'))throw Error('REPLAY_MISS '+key);
    const recovery=freeze.lunaRecoveryAmendment?.logicalCallKeys.includes(key)&&freeze.lunaRecoveryAmendment?.connectivityProbe.passed===true;
    let lastError="",lastFinishedAt:string|undefined;
    for(let attempt=1;attempt<=(recovery?6:4);attempt++) {
      if(attempt===4&&!recovery&&!isRateLimit(lastError))break;
      const attemptKey=attempt===1?key:sha(key+':transport:'+attempt);
      const prior=attempts.get(attemptKey);
      if(prior) {
        if(!prior.providerError)return prior;
        if(!isTransportFailure(prior.text))throw Error('Recorded non-transport failure; no retry');
        lastError=prior.text;lastFinishedAt=prior.finishedAt;continue;
      }
      // A crashed submission may still have incurred cost. Keep its reservation and count its try.
      if(budget.totals().pending.includes(attemptKey)){lastError="Interrupted transport";continue;}
      if(attempt>1)await new Promise(resolve=>setTimeout(resolve,transportWaitRemainingMs(lastError,attempt,lastFinishedAt,Date.now(),meta.model)));
      if(meta.model.startsWith('gemini')&&geminiAbort.signal.aborted)throw Error('Gemini credit hold; no new submission');
      if(Date.now()>Date.parse(freeze.modelLastCallUtc?.[meta.model]??freeze.lastCallUtc))throw Error('LAST_CALL_CUTOFF');
      const reserveUsd=meta.model==='haiku'?0.25:0.10;
      const cellBudget=modelBudgets.get(meta.model);
      budget.canReserve(attemptKey,reserveUsd);cellBudget?.canReserve(attemptKey,reserveUsd);
      budget.reserve(attemptKey,reserveUsd);cellBudget?.reserve(attemptKey,reserveUsd);
      const started=Date.now();let payload:any;let providerMeta:any={};
      try {
        if(meta.model==='haiku')payload=await runClaude(prompt,resolve(HERE,'runtime/empty'));
        else {
          const argv=['--model',meta.model,'--system-prompt',prompt.system,'--reasoning-effort',freeze.reasoning[meta.model]];
          if(schema)argv.push('--json-schema',JSON.stringify(schema));
          // The upstream shim owns pricing and provider shape. The bound is identical for all contestants.
          payload=await shim.runShim({argv,input:prompt.user,fetch:async(url:any,options:any)=> {
            const body=JSON.parse(options.body);
            if(meta.model.startsWith('gemini'))body.generationConfig={...body.generationConfig,maxOutputTokens:4096};
            else body.max_completion_tokens=4096;
            const timeout=AbortSignal.timeout(300_000);
            const response=await fetch(url,{...options,body:JSON.stringify(body),signal:meta.model.startsWith('gemini')?AbortSignal.any([timeout,geminiAbort.signal]):timeout});
            if(!response.ok) {
              providerMeta.httpStatus=response.status;
              if(meta.model.startsWith('gemini')&&response.status===402){geminiAbort.abort();stoppedModels.add(meta.model);}
              const data=await response.text();throw Error('Provider '+response.status+': '+data.slice(0,300));
            }
            const observed=await response.clone().json();
            providerMeta={usage:observed.usage??observed.usageMetadata,model:observed.model??observed.modelVersion,finishReason:observed.choices?.[0]?.finish_reason??observed.candidates?.[0]?.finishReason,
              appliedThinkingLevel:body.generationConfig?.thinkingConfig?.thinkingLevel};
            return response;
          }});
        }
      } catch(error) {
        payload={result:String(error),total_cost_usd:0,is_error:true};
      }
      const entry={key:attemptKey,logicalKey:key,transportAttempt:attempt,...meta,promptHash:sha(JSON.stringify(prompt)),schemaHash:schema?sha(JSON.stringify(schema)):null,
        modelRequested:meta.model,text:payload.result??'',costUsd:payload.total_cost_usd,
        providerError:payload.is_error===true,usage:payload.usage??providerMeta.usage??null,modelUsage:payload.modelUsage??null,providerMeta,
        startedAt:new Date(started).toISOString(),finishedAt:new Date().toISOString(),durationMs:Date.now()-started};
      append('results/calls.jsonl',entry);recorded.set(key,entry);attempts.set(attemptKey,entry);
      if(!entry.providerError) {
        if(Number.isFinite(entry.costUsd)){budget.settle(attemptKey,entry.costUsd);cellBudget?.settle(attemptKey,entry.costUsd);}
        return entry;
      }
      budget.chargeError(attemptKey,entry.costUsd);
      cellBudget?.chargeError(attemptKey,entry.costUsd);
      append('results/transport-errors.jsonl',{key:attemptKey,logicalKey:key,attempt,...meta,error:entry.text,at:new Date().toISOString()});
      if(meta.model.startsWith('gemini')&&providerMeta.httpStatus===402) {
        budget.releaseRejected(attemptKey,402);
        cellBudget?.releaseRejected(attemptKey,402);
        throw Error('Gemini HTTP 402 credit rejection; all Gemini submissions stopped');
      }
      if(!isTransportFailure(entry.text))throw Error('Non-transport provider error; no retry');
      lastError=entry.text;lastFinishedAt=entry.finishedAt;
    }
    throw Error((recovery?'AUTHORIZED_RECOVERY_EXHAUSTED '+key:'Transport attempts exhausted')+'; uncertain reservations retained');
  };
  const resumeAt=freeze.geminiDailyQuotaAmendment?.resumeNotBefore??freeze.geminiResumeAmendment?.at;
  const probeGate=new FirstAnswerGate(history.some(r=>r.model==='gemini-3.8-flash'&&!r.providerError&&resumeAt&&r.startedAt>=resumeAt));
  const addedGates=new Map(Object.keys(additions).map(model=>[model,new FirstAnswerGate(history.some(r=>r.model===model&&!r.providerError))]));
  const calls=async(prompt:any,meta:any,schema?:any)=> {
    const key=sha(JSON.stringify([meta,prompt,schema,keyReasoning(meta.model)]));
    const cached=recorded.get(key);
    if(cached&&!cached.providerError)return cached;
    if(addedGates.has(meta.model))return addedGates.get(meta.model)!.run(()=>submit(prompt,meta,schema),entry=>{
      writeFileSync(resolve(HERE,'results/'+meta.model+'-probe.json'),JSON.stringify({status:'answered',key:entry.key,
        startedAt:entry.startedAt,finishedAt:entry.finishedAt,reasoningApplied:entry.providerMeta.appliedThinkingLevel,
        costUsd:entry.costUsd,policy:'First sealed fixture call; answer retained and not resubmitted.'},null,2)+'\n');
    });
    if(meta.model!=='gemini-3.8-flash'||!resumeAt)return submit(prompt,meta,schema);
    return probeGate.run(()=>submit(prompt,meta,schema),entry=>{
      writeFileSync(resolve(HERE,freeze.geminiDailyQuotaAmendment?'results/gemini-daily-reset-probe.json':'results/gemini-resume-probe.json'),JSON.stringify({
        amendmentAt:resumeAt,status:'answered',key:entry.key,logicalKey:entry.logicalKey,
        transportAttempt:entry.transportAttempt,startedAt:entry.startedAt,finishedAt:entry.finishedAt,
        costUsd:entry.costUsd,policy:'First missing sealed call; returned answer retained regardless of content validity.',
      },null,2)+'\n');
    });
  };
  async function runModel(model:string) {
    for(const split of phases) {
      if(stop||stoppedModels.has(model))break;
      const jobs=queues.get(model+':'+split)!;
      modelProgress[model]={phase:split,status:'running',completedThisPhase:0,remainingThisPhase:jobs.length};progress();
      if(split==='test') {
        reportPhase();
        const disposition={at:new Date().toISOString(),modelScope:model,
          authorization:'Resume the writing cell: run the full 173-pair TEST on the sealed pool. Your cap is 35 USD.',
          pacing:'Owner authorizes all models side by side at per-model limits; phase order remains fixtures, validity, dev, test.',
          policy:'Run without tuning; report failed validity checks and withhold unsupported validation claims.',
          fixtureAndCheaterChecks:load('results/phase-report.json').dev.filter((r:any)=>r.model===model),
          editChecks:load('results/validity-checks.json').cells.filter((r:any)=>r.model===model)};
        writeFileSync(resolve(HERE,'results/pretest-disposition-'+model+'.json'),JSON.stringify(disposition,null,2)+'\n');
      }
      const complete=await runLimitedJobs(jobs,limits[model],async({job,item}:any)=>{
      if(stop)return false;
      let costUsd=0,callCount=0;
      try {
        const ask=async(prompt:any,schema?:any)=>{const out=await calls(prompt,{...job,callIndex:callCount++},schema);costUsd+=out.costUsd;return out;};
        let games:string[],details:any,graderErrors=0;
        if(job.contestant==='promptfoo') {
          const ab=await ask(promptfoo(item.question,item.a,item.b));
          const ba=await ask(promptfoo(item.question,item.b,item.a));
          games=[parsePromptfoo(ab.text),flip(parsePromptfoo(ba.text))];graderErrors=games.filter(g=>g==='tie').length;
        } else if(job.contestant==='reader-first-c50b2dc3') {
          const client:any={id:job.model,family:job.model==='haiku'?'anthropic':job.model.startsWith('gemini')?'google':'openai',cls:'system2',cost:1,
            judge:async(request:any)=>{const out=await ask(readerPrompt(request));return {...readerParse(out.text,request),costUsd:out.costUsd};}};
          details=await createReaderFirstJudge(client,{configuration:'reader-first',language:item.language}).judgePair(item.question,item.a,item.b);
          games=[details.choice,details.choice];graderErrors=Number(!details.ordered.valid)+Number(!details.swapped.valid);
        } else {
          const dialect=job.model==='haiku'?'scratchpad-json':job.model.startsWith('gemini')?'google-response-schema':'openai-json-schema';
          const client:any={id:job.model,family:job.model==='haiku'?'anthropic':job.model.startsWith('gemini')?'google':'openai',cls:'system2',cost:1,dialect,reasoning:freeze.reasoning[job.model],
            judge:async(request:any)=>{const out=await ask(promptModule.buildPrompt(request),job.model==='haiku'?undefined:schemaModule.responseSchema(request));return {raw:out.text,costUsd:out.costUsd};}};
          const request=core.pairLedgerRequest({name:'writing',rubric:criterion},[{role:'user',text:item.question}],item.a,item.b,
            {requirements:item.requirements.map((r:any)=>({name:r.id,rubric:r.definition,hard:r.hard})),reasoning:freeze.reasoning[job.model]});
          details=await core.judgePairLedger(client,request,{stage0:{correctness:false,compute:false,language:item.language},tiePolicy:'canonical'});
          const choice=details.choice==='first'?'A':details.choice==='second'?'B':'tie';games=[choice,choice];
          graderErrors=details.reads.filter((r:any)=>r.result.unparsed).length;
        }
        const result={...job,games,costUsd,callCount,graderErrors,details};append('results/decisions.jsonl',result);done.add(decisionKey(job));completed++;
        modelProgress[model].completedThisPhase++;
        modelProgress[model].remainingThisPhase--;progress();
        if(completed%10===0)console.log(JSON.stringify({phase,completed,remaining:planned-completed,models:modelProgress,spend:budget.totals()}));
        return true;
      } catch(error) {
        if(String(error).includes('AUTHORIZED_RECOVERY_EXHAUSTED')) {
          append('results/missing.jsonl',{...job,error:String(error),reason:'Owner-authorized recovery exhausted with no model answer',at:new Date().toISOString()});
          modelProgress[model].missingThisPhase=(modelProgress[model].missingThisPhase??0)+1;
          modelProgress[model].remainingThisPhase--;progress();
          return true;
        }
        stoppedModels.add(model);
        if(/LANE_CAP_REACHED|LAST_CALL_CUTOFF/.test(String(error)))stop=true;
        append('results/errors.jsonl',{...job,error:String(error),at:new Date().toISOString()});console.error(String(error));
        return false;
      }
      });
      modelProgress[model].status=complete?'complete':'stopped';progress();reportPhase();
      if(!complete)break;
    }
  }
  await Promise.all(models.map(runModel));
  console.log(JSON.stringify({phase,completed,stop,stoppedModels:[...stoppedModels],spend:budget.totals()}));
  if(stop||stoppedModels.size)process.exitCode=1;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
