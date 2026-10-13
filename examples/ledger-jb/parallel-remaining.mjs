#!/usr/bin/env node
// Operational scheduler only. Judge, prompts, scoring and request keys are unchanged.
import {appendFileSync,closeSync,existsSync,openSync,readFileSync,unlinkSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
import {loadavg} from 'node:os';
import {hash,readJson,readJsonl,verifyFreeze,jobs,Journal,promptfooPrompt,parsePromptfoo,REQUIREMENTS} from './src/harness.mjs';

export async function runModels(models, runPhase, ready, event=()=>{}) {
  const blocked=[];
  await Promise.all(models.map(async model=>{
    for(const phase of ['pilot','fixtures','noise','validity','test']) {
      if(phase==='test'&&!ready(model)) { blocked.push(model);event({status:'model-blocked',model});break; }
      event({status:'phase-running',model,phase});
      await runPhase(model,phase);
      event({status:'phase-finished',model,phase});
    }
  }));
  return blocked;
}

export async function drainQueue(queue,runJob,concurrency,stop) {
  let next=0;const running=new Set();
  const limit=()=>typeof concurrency==='function'?concurrency():concurrency;
  while(next<queue.length||running.size){
    while(!stop.error&&next<queue.length&&running.size<limit()){
      const job=queue[next++];
      const task=Promise.resolve().then(()=>runJob(job)).catch(error=>{stop.error??=error;}).finally(()=>running.delete(task));
      running.add(task);
    }
    if(!running.size)break;
    await Promise.race(running);
  }
  if(stop.error)throw stop.error;
}

export function createHaikuPacer({journal,load=()=>loadavg()[0],now=()=>Date.now(),event=()=>{}}){
  let reason;
  return ()=>{
    if(!reason){
      const hostLoad=load(),cutoff=now()-600000;
      const failures=[...journal.finishes.values()].filter(x=>x.model==='claude-haiku-5-5'&&x.transportFailure&&!x.returnedAnswer&&Date.parse(x.at)>=cutoff).length;
      if(hostLoad>60||failures>=2){
        reason=hostLoad>60?'one-minute host load exceeds 60':'two no-answer transport failures within ten minutes';
        event({reason,hostLoad,transportFailuresInTenMinutes:failures,workers:2});
      }
    }
    return reason?2:4;
  };
}

async function main(){
  const root=dirname(fileURLToPath(import.meta.url)),repo=resolve(root,'../..'),r=join(root,'results');
  const argv=process.argv.slice(2);
  if(argv.includes('--help')){console.log('node --import tsx examples/ledger-jb/parallel-remaining.mjs --execute --core-dossier PATH --spend-ledger PATH\nResumes all models side by side with frozen per-model limits and one shared budget journal.');return;}
  if(!argv.includes('--execute'))throw new Error('Explicit --execute required');
  const flag=name=>argv[argv.indexOf(name)+1];
  if(!argv.includes('--core-dossier')||!argv.includes('--spend-ledger'))throw new Error('Dossier and spend ledger are required');
  const freezePath=join(root,'freeze.json'),freeze=readJson(freezePath),freezeSha256=hash(readFileSync(freezePath));
  verifyFreeze(root,repo,freeze,readFileSync(flag('--core-dossier'),'utf8'));
  if(!freeze.hashes['examples/ledger-jb/parallel-remaining.mjs'])throw new Error('Parallel scheduler is not frozen');
  const lock=join(r,'.paid-run.lock'),fd=openSync(lock,'wx');
  process.on('exit',()=>{closeSync(fd);unlinkSync(lock);});
  const allModels=['gpt-6-luna','claude-haiku-5-5','gemini-3.8-flash'];
  const models=allModels.filter(model=>!freeze.pausedModels?.[model]);
  const limits={'gpt-6-luna':8,'claude-haiku-5-5':4,'gemini-3.8-flash':2};
  if(allModels.some(model=>freeze.modelConcurrency[model]!==limits[model]))throw new Error('Frozen concurrency does not match the owner pacing amendment');
  const data=Object.fromEntries(['fixtures','pilot','noise','pool','validity'].map(name=>[name,readJson(join(root,`data/${name}.json`))]));
  const adapter=await import(pathToFileURL(resolve(repo,freeze.adapter)).href);
  const transports=Object.fromEntries(await Promise.all(models.map(async model=>[model,await adapter.createTransport({model,settings:freeze.models[model],root})])));
  const journal=new Journal(join(r,'calls.jsonl'),{capUsd:25,billingResumeKeys:freeze.billingResumption?.rejectedKeys??[],quotaResumeKeys:freeze.dailyQuotaPause?.noAnswerKeys??[],outageResumeKeys:freeze.outageResumption?.noAnswerKeys??[],appendSpend(row){
    appendFileSync(flag('--spend-ledger'),`| ${row.at} | ledger-jb ${row.phase} ${row.contestant} ${row.itemId} ${row.order} | ${row.model} | 1 call | ${row.costUsd.toFixed(8)} USD${row.costEstimated?' reserved, actual unknown':''} | lane liability ${journal.liability().toFixed(8)} USD |\n`);
  }});
  const template=readFileSync(join(root,'data/promptfoo-select-best.txt'),'utf8'),stop={},backoffAbort=new AbortController();
  // A runtime amendment can drain every owned call without losing its receipt.
  process.on('SIGUSR2',()=>{stop.error??=new Error('OPERATOR_DRAIN: finish active requests and stop dispatching');backoffAbort.abort();});
  const state={status:'running',pid:process.pid,core:freeze.coreCommit,concurrency:models.reduce((sum,m)=>sum+limits[m],0),models:Object.fromEntries(allModels.filter(m=>freeze.pausedModels?.[m]).map(m=>[m,{status:freeze.dailyQuotaPause?.model===m?'paused-daily-quota':'paused-billing',reason:freeze.pausedModels[m],concurrency:0}]))};
  function event(value){
    if(value.model)state.models[value.model]={phase:value.phase??state.models[value.model]?.phase,status:value.status,concurrency:limits[value.model]};
    else Object.assign(state,value);
    state.at=new Date().toISOString();
    writeFileSync(join(r,'driver-state.json'),JSON.stringify(state,null,2)+'\n');
    console.log(JSON.stringify({at:state.at,...value}));
  }
  const haikuLimit=createHaikuPacer({journal,event(value){
    appendFileSync(join(r,'pacing-events.jsonl'),JSON.stringify({at:new Date().toISOString(),model:'claude-haiku-5-5',freezeSha256,...value})+'\n');
    state.models['claude-haiku-5-5'].effectiveWorkers=value.workers;
    event({pacingFallback:value});
  }});
  function reports(){
    for(const path of ['src/report.mjs','summarize-reasks.mjs']){
      const output=execFileSync('node',[join(root,path)],{cwd:repo,encoding:'utf8',maxBuffer:10*1024*1024});
      appendFileSync(join(r,'report-build.log'),output);
    }
  }
  function ready(model){
    const x=readJson(join(r,`readiness-${model}.json`));
    return x.freezeSha256===freezeSha256&&['pilotComplete','fixturesComplete','noiseComplete','validityPassed'].every(k=>x[k]);
  }
  async function runPhase(model,phase){
    const guard=()=>{
      if(stop.error)throw stop.error;
      if(Date.now()>=Date.parse(freeze.modelLastCallCutoff?.[model]??freeze.lastCallCutoff))throw new Error('Frozen last-call cutoff reached');
    };
    guard();
    const transport=transports[model],output=join(r,`decisions-${phase}-${model}.jsonl`),previous=readJsonl(output),completed=new Set(previous.map(x=>x.key));
    if(completed.size!==previous.length)throw new Error('Duplicate saved decisions');
    const planned=jobs(data,phase,model),queue=planned.filter(job=>!completed.has(job.key));
    async function runJob(job){
      const call=async(prompt,{order,attempt=0,schema}={})=>{
        guard();
        const key=`${job.key}:${order}:${attempt}:${hash(JSON.stringify({prompt,schema,settings:(freeze.cacheIdentityModels??freeze.models)[model]}))}`;
        const reserveUsd=transport.maximumCostUsd(prompt,schema);
        return journal.transportCall(key,reserveUsd,()=>transport.call(prompt,{schema,reserveUsd}),{phase,model,contestant:job.contestant,itemId:job.itemId,repeat:job.repeat,order,attempt},{beforeDispatch:guard,sleep:ms=>sleep(ms,undefined,{signal:backoffAbort.signal})});
      };
      let result;
      if(job.contestant==='ledger')result=await adapter.judgePair({item:job.item,requirements:REQUIREMENTS,model,call,settings:freeze.models[model]});
      else{
        const games=[];let graderErrors=0;
        for(const order of ['AB','BA']){
          const response=await call(promptfooPrompt(template,job.item,order),{order});
          const game=response.graderError?null:parsePromptfoo(response.text,order);
          graderErrors+=Number(game===null);games.push(game);
        }
        result={games,graderErrors};
      }
      if(!Array.isArray(result.games)||result.games.length!==2||result.games.some(x=>!['A','B','tie',null].includes(x)))throw new Error('Invalid adapter pair result');
      const row={...result,key:job.key,itemId:job.itemId,group:job.item.group,label:job.item.label,phase,model,repeat:job.repeat,contestant:job.contestant,freezeSha256};
      appendFileSync(output,`${JSON.stringify(row)}\n`);completed.add(job.key);
      console.log(JSON.stringify({phase,model,completed:completed.size,planned:planned.length,liabilityUsd:journal.liability()}));
    }
    await drainQueue(queue,runJob,model==='claude-haiku-5-5'?haikuLimit:limits[model],stop);
    reports();
  }
  event({status:'running'});
  // allSettled drains owned in-flight calls before releasing the single writer lock.
  const result=await Promise.allSettled(models.map(model=>runModels([model],runPhase,ready,event)));
  reports();
  const errors=result.filter(x=>x.status==='rejected');
  if(errors.length){event({status:'stopped-on-error',error:errors[0].reason.message});throw errors[0].reason;}
  event({status:Object.keys(freeze.pausedModels??{}).length?'finished-available-models':'finished',pausedModels:freeze.pausedModels??{},blocked:result.flatMap(x=>x.value)});
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
