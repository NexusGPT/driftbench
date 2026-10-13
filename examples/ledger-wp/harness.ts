import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
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
  reserve(key:string,usd:number) {
    const state=this.totals();
    if(state.pending.includes(key)) throw Error('Unresolved prior paid call: '+key);
    if(state.actual+state.reserved+usd>this.cap) throw Error('LANE_CAP_REACHED');
    const event={kind:'reserve',key,usd,at:new Date().toISOString()};append(this.file,event);this.events.push(event);
  }
  settle(key:string,usd:number) {
    if(!Number.isFinite(usd)||usd<0)throw Error('Invalid provider cost');
    const event={kind:'settle',key,usd,at:new Date().toISOString()};append(this.file,event);this.events.push(event);
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
}

async function runClaude(prompt: {system:string;user:string}, cwd:string): Promise<any> {
  const args=['-p','--output-format','json','--model','haiku','--system-prompt',prompt.system,'--tools','','--setting-sources','','--strict-mcp-config','--no-session-persistence','--max-turns','1','--max-budget-usd','0.10'];
  return new Promise((resolvePromise,reject)=> {
    const env={...process.env,TMPDIR:cwd};delete env.CLAUDECODE;
    const child=spawn('claude',args,{cwd,env,stdio:['pipe','pipe','pipe']});
    let out='',err='';
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Owned Claude call timed out; reservation retained'));},180_000);
    child.stdout.on('data',x=>out+=x.toString());child.stderr.on('data',x=>err+=x.toString());
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    child.on('close',code=>{clearTimeout(timer);try {const data=JSON.parse(out);resolvePromise({...data,exitCode:code});} catch {reject(Error('Claude output not JSON, exit '+code+'; stderr '+err.slice(0,100)));}});
    child.stdin.on('error',()=>{});child.stdin.end(prompt.user);
  });
}

async function main() {
  const arg=(name:string)=>{const i=process.argv.indexOf('--'+name);return i<0?undefined:process.argv[i+1];};
  if(process.argv.includes('--help')) {
    console.log('harness.ts --cheaters | --phase pilot|dev|fixtures|validity|test [--model haiku|gpt-6-luna|gemini-3.8-flash] [--concurrency N] [--replay-only]');return;
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
  const phase=arg('phase');if(!['pilot','dev','fixtures','validity','test'].includes(phase??''))throw Error('Explicit phase required');
  const freeze=load('freeze.json');verifyFreeze(freeze);
  const core:any=await import(pathToFileURL(resolve(ROOT,'packages/judges/src/pair-ledger.ts')).href);
  const promptModule:any=await import(pathToFileURL(resolve(ROOT,'packages/judges/src/prompt.ts')).href);
  const schemaModule:any=await import(pathToFileURL(resolve(ROOT,'packages/judges/src/assessment.ts')).href);
  const shim:any=await import(pathToFileURL(resolve(ROOT,'examples/judge-benchmarks/src/llm-shim.mjs')).href);
  const modelArg=arg('model');const models=modelArg?[modelArg]:freeze.models;
  if(models.some((x:string)=>!freeze.models.includes(x)))throw Error('Model not frozen');
  const concurrency=Number(arg('concurrency')??4);if(!Number.isInteger(concurrency)||concurrency<1||concurrency>4)throw Error('Concurrency outside 1..4');
  const budget=new Budget();
  const recorded=new Map(rows('results/calls.jsonl').map(r=>[r.key,r]));
  const decisions=rows('results/decisions.jsonl');
  const decisionKey=(x:any)=>JSON.stringify([x.split,x.model,x.contestant,x.id,x.sample??0]);
  const done=new Set(decisions.map(decisionKey));
  let stop=false,completed=0;
  const calls=async(prompt:any,meta:any,schema?:any)=> {
    const key=sha(JSON.stringify([meta,prompt,schema,freeze.reasoning]));
    if(recorded.has(key)) {
      const prior=recorded.get(key);
      if(prior.providerError)throw Error('Recorded provider error; no automatic retry');
      return prior;
    }
    if(process.argv.includes('--replay-only'))throw Error('REPLAY_MISS '+key);
    if(Date.now()>Date.parse(freeze.lastCallUtc))throw Error('LAST_CALL_CUTOFF');
    budget.reserve(key,meta.model==='haiku'?0.25:0.10);
    const started=Date.now();let payload:any;let providerMeta:any={};
    if(meta.model==='haiku')payload=await runClaude(prompt,resolve(HERE,'runtime/empty'));
    else {
      const argv=['--model',meta.model,'--system-prompt',prompt.system,'--reasoning-effort',freeze.reasoning[meta.model]];
      if(schema)argv.push('--json-schema',JSON.stringify(schema));
      // The upstream shim owns pricing and provider shape. The bound is identical for all contestants.
      payload=await shim.runShim({argv,input:prompt.user,fetch:async(url:any,options:any)=> {
        const body=JSON.parse(options.body);
        if(meta.model.startsWith('gemini'))body.generationConfig={...body.generationConfig,maxOutputTokens:4096};
        else body.max_completion_tokens=4096;
        const response=await fetch(url,{...options,body:JSON.stringify(body),signal:AbortSignal.timeout(180_000)});
        if(!response.ok) {const data=await response.text();throw Error('Provider '+response.status+': '+data.slice(0,300));}
        const observed=await response.clone().json();
        providerMeta={usage:observed.usage??observed.usageMetadata,model:observed.model??observed.modelVersion,finishReason:observed.choices?.[0]?.finish_reason??observed.candidates?.[0]?.finishReason};
        return response;
      }});
    }
    const entry={key,...meta,promptHash:sha(JSON.stringify(prompt)),schemaHash:schema?sha(JSON.stringify(schema)):null,
      modelRequested:meta.model,text:payload.result??'',costUsd:payload.total_cost_usd,
      providerError:payload.is_error===true,usage:payload.usage??providerMeta.usage??null,modelUsage:payload.modelUsage??null,providerMeta,
      startedAt:new Date(started).toISOString(),finishedAt:new Date().toISOString(),durationMs:Date.now()-started};
    append('results/calls.jsonl',entry);recorded.set(key,entry);
    if(!entry.providerError&&Number.isFinite(entry.costUsd))budget.settle(key,entry.costUsd);
    if(entry.providerError)throw Error('Provider call failed; raw answer and reservation retained');
    return entry;
  };
  const items=load('seals/'+phase+'.json');
  const jobs:any[]=[];
  for(let sample=0;sample<(['dev','fixtures'].includes(phase!)?3:1);sample++)for(const item of items)for(const model of models)for(const contestant of ['pair-ledger','reader-first-c50b2dc3','promptfoo']) {
    const job={split:phase,model,contestant,id:item.id,requestId:item.requestId,sample};
    if(!done.has(decisionKey(job)))jobs.push({job,item});
  }
  let cursor=0;
  async function worker() {
    while(!stop&&cursor<jobs.length) {
      const {job,item}=jobs[cursor++];let costUsd=0,callCount=0;
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
        writeFileSync(resolve(HERE,'results/progress.json'),JSON.stringify({phase,completedThisInvocation:completed,remaining:jobs.length-completed,spend:budget.totals(),at:new Date().toISOString()})+'\n');
        if(completed%10===0)console.log(JSON.stringify({phase,completed,remaining:jobs.length-completed,spend:budget.totals()}));
      } catch(error) {
        stop=true;append('results/errors.jsonl',{...job,error:String(error),at:new Date().toISOString()});console.error(String(error));
      }
    }
  }
  await Promise.all(Array.from({length:concurrency},()=>worker()));
  console.log(JSON.stringify({phase,completed,stop,spend:budget.totals()}));
  if(stop)process.exitCode=1;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
