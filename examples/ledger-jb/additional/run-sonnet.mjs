import {appendFileSync,readFileSync,writeFileSync,openSync,closeSync,unlinkSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {loadavg} from 'node:os';
import {setTimeout as sleep} from 'node:timers/promises';
import {Journal,hash,readJson,readJsonl,verifySeal,promptfooPrompt,parsePromptfoo,REQUIREMENTS} from '../src/harness.mjs';
import {drainQueue} from '../parallel-remaining.mjs';
import {judgePair} from './adapter.mjs';
import {createTransport} from './sonnet-transport.mjs';
import {PHASES,cellJobs,project,report as baseReport} from './report.mjs';
function report(root,cell,model){const value=baseReport(root,cell,model);value.budget.capUsd=readJson(join(cell,'freeze.json')).capUsd;writeFileSync(join(cell,'report.json'),JSON.stringify(value,null,2)+'\n');return value;}

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),repo=resolve(root,'../..');
const args=process.argv.slice(2),model=args[args.indexOf('--model')+1],probe=args.includes('--probe-five');
if(args.includes('--help')){console.log('node --import tsx examples/ledger-jb/additional/run-sonnet.mjs --model claude-sonnet-5-5 --execute --spend-ledger PATH [--probe-five]');process.exit(0);}
if(!args.includes('--execute')||model!=='claude-sonnet-5-5'||!args.includes('--spend-ledger'))throw new Error('Explicit model, execution and append-only spend path required');
const cell=join(root,'cells',model),freeze=readJson(join(cell,'freeze.json')),freezeSha256=hash(readFileSync(join(cell,'freeze.json')));
verifySeal(root);
const freezeRelative=`examples/ledger-jb/cells/${model}/freeze.json`;
if(hash(execFileSync('git',['show',`HEAD:${freezeRelative}`],{cwd:repo}))!==freezeSha256)throw new Error('Freeze not committed');
for(const [path,digest]of Object.entries(freeze.hashes)){
  if(hash(readFileSync(join(repo,path)))!==digest||hash(execFileSync('git',['show',`HEAD:${path}`],{cwd:repo,maxBuffer:20*1024*1024}))!==digest)throw new Error(`Frozen source changed: ${path}`);
}
execFileSync('git',['merge-base','--is-ancestor',freeze.coreCommit,'HEAD'],{cwd:repo});
if(freeze.capUsd!==45||freeze.model!==model)throw new Error('Wrong cell budget or model');
const lock=join(cell,'.paid-run.lock'),fd=openSync(lock,'wx');
process.on('exit',()=>{closeSync(fd);unlinkSync(lock);});
const state={model,pid:process.pid,mode:probe?'cache-route-five':'run',freezeSha256},stop={},abort=new AbortController();
function event(value){Object.assign(state,value,{at:new Date().toISOString()});writeFileSync(join(cell,'state.json'),JSON.stringify(state,null,2)+'\n');console.log(JSON.stringify(state));}
process.on('SIGUSR2',()=>{stop.error??=new Error('OPERATOR_DRAIN');abort.abort();});
const journal=new Journal(join(cell,'calls.jsonl'),{capUsd:freeze.capUsd,appendSpend(row){
  appendFileSync(args[args.indexOf('--spend-ledger')+1],`| ${row.at} | ledger-jb additional ${row.phase} ${row.contestant} ${row.itemId} ${row.order} | ${model} | 1 call | ${row.costUsd.toFixed(8)} USD${row.costEstimated?' reserved, actual unknown':''} | separate ${model} liability ${journal.liability().toFixed(8)} / ${freeze.capUsd} USD |\n`);
}});
const data=Object.fromEntries(['fixtures','pilot','noise','pool','validity'].map(name=>[name,readJson(join(root,`data/${name}.json`))]));
if(freeze.nativeEnv?.DISABLE_PROMPT_CACHING==='1')process.env.DISABLE_PROMPT_CACHING='1';else delete process.env.DISABLE_PROMPT_CACHING;
if(hash(readFileSync(join(root,'data/seal.json')))!==freeze.sealSha256||hash(readFileSync(join(root,'data/pool.json')))!==freeze.poolSha256)throw new Error('Sealed hashes differ');
const template=readFileSync(join(root,'data/promptfoo-select-best.txt'),'utf8'),transport=createTransport(model,freeze.settings);
const guard=()=>{if(stop.error)throw stop.error;if(Date.now()>=Date.parse(freeze.lastCallCutoff))throw new Error('CUTOFF_STOP');
  if(probe&&[...journal.finishes.values()].filter(x=>x.billingRoute==='cache-disabled'&&!x.transportFailure&&x.modelActual===model).length>=5)throw new Error('PROBE_FIVE_COMPLETE');};
let fallback=false;
const workers=()=>{
  if(probe)return 1;if(model==='gpt-6.1-sol')return 8;
  const failures=[...journal.finishes.values()].filter(x=>x.transportFailure&&!x.returnedAnswer&&Date.parse(x.at)>Date.now()-600000).length;
  if(!fallback&&(loadavg()[0]>60||failures>=2)){fallback=true;appendFileSync(join(cell,'pacing-events.jsonl'),JSON.stringify({at:new Date().toISOString(),workers:2,load:loadavg()[0],failures})+'\n');}
  return fallback?2:4;
};
function costCheck(name){
  const finishes=name==='baseline'?[...journal.finishes.values()].slice(0,5):[...journal.finishes.values()].filter(x=>x.phase==='pilot');
  const decisions=readJsonl(join(cell,'decisions-pilot.jsonl'));
  const projection={...project(data,model,finishes,decisions),capUsd:freeze.capUsd};writeFileSync(join(cell,`projection-${name}.json`),JSON.stringify(projection,null,2)+'\n');
  if(projection.projectedUsd===null)throw new Error('PROJECTION_INCOMPLETE');
  if(projection.projectedUsd>freeze.capUsd)throw new Error(`PROJECTION_STOP: ${projection.projectedUsd.toFixed(6)} USD exceeds ${freeze.capUsd} USD`);
  return projection;
}
async function runPhase(phase){
  const output=join(cell,`decisions-${phase}.jsonl`),previous=readJsonl(output),done=new Set(previous.map(x=>x.key));
  if(done.size!==previous.length)throw new Error('Duplicate decision');
  const planned=cellJobs(data,phase,model),queue=planned.filter(x=>!done.has(x.key));
  event({status:'running',phase,completed:done.size,planned:planned.length});
  await drainQueue(queue,async job=>{
    const call=async(prompt,{order,attempt=0,schema}={})=>{
      const key=`${job.key}:${order}:${attempt}:${hash(JSON.stringify({prompt,schema,settings:freeze.settings}))}`;
      return journal.transportCall(key,transport.maximumCostUsd(prompt,schema),()=>transport.call(prompt,{schema}),
        {phase,model,contestant:job.contestant,itemId:job.itemId,repeat:job.repeat,order,attempt,billingRoute:freeze.nativeEnv?.DISABLE_PROMPT_CACHING==='1'?'cache-disabled':'cache-default'},
        {maxAttempts:3,beforeDispatch:guard,quotaBackoffMs:freeze.transportPolicy.quotaBackoffMs,sleep:ms=>sleep(ms,undefined,{signal:abort.signal})});
    };
    let result;
    if(job.contestant==='ledger')result=await judgePair({item:job.item,requirements:REQUIREMENTS,model,call,settings:freeze.settings});
    else{const games=[];let graderErrors=0;for(const order of ['AB','BA']){const response=await call(promptfooPrompt(template,job.item,order),{order});
      const game=response.graderError?null:parsePromptfoo(response.text,order);graderErrors+=Number(game===null);games.push(game);}result={games,graderErrors};}
    if(result.games.length!==2||result.games.some(x=>!['A','B','tie',null].includes(x)))throw new Error('Invalid decision');
    appendFileSync(output,JSON.stringify({...result,key:job.key,itemId:job.itemId,group:job.item.group,label:job.item.label,phase,model,repeat:job.repeat,contestant:job.contestant,freezeSha256})+'\n');
    done.add(job.key);event({completed:done.size,liabilityUsd:journal.liability(),requests:journal.finishes.size,workers:workers()});
  },workers,stop);
}
try{
  if(!probe){if(journal.finishes.size<10)throw new Error('Both five-request cost samples required');costCheck('baseline');}
  for(const phase of PHASES){
    if(phase==='test'){
      const r=report(root,cell,model);if(!Object.values(r.readiness).every(Boolean))throw new Error('READINESS_STOP');
    }
    await runPhase(phase);report(root,cell,model);
    if(phase==='pilot'&&!probe)costCheck('pilot');
  }
  event({status:'finished'});
}catch(error){
  if(error.message==='PROBE_FIVE_COMPLETE'){
    const projection={...project(data,model,[...journal.finishes.values()].filter(x=>x.billingRoute==='cache-disabled'&&!x.transportFailure&&x.modelActual===model).slice(0,5)),capUsd:freeze.capUsd};
    writeFileSync(join(cell,'projection-cache-disabled.json'),JSON.stringify(projection,null,2)+'\n');
    event({status:'probe-complete',projectionUsd:projection.projectedUsd,requests:journal.finishes.size,liabilityUsd:journal.liability()});
  }else{event({status:'stopped',error:error.message});process.exitCode=1;}
}finally{report(root,cell,model);}
