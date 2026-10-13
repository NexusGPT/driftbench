import {appendFileSync,readFileSync,writeFileSync,openSync,closeSync,unlinkSync,existsSync,mkdirSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {setTimeout as timer} from 'node:timers/promises';
import {hash,readJson,readJsonl,verifySeal,promptfooPrompt,parsePromptfoo,REQUIREMENTS} from '../src/harness.mjs';
import {drainQueue} from '../parallel-remaining.mjs';
import {judgePair} from './adapter.mjs';
import {createTransport} from './sol-transport.mjs';
import {RecoveryJournal,healthGate,missingRequests} from './recovery.mjs';
import {PHASES,cellJobs,report as baseReport} from './report.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),repo=resolve(root,'../..');
const args=process.argv.slice(2),flag=name=>args[args.indexOf(name)+1],model=flag('--model');
if(args.includes('--help')){console.log('run-sol-recovery.mjs --model gpt-6.1-sol --execute --spend-ledger PATH');process.exit(0);}
if(!args.includes('--execute')||model!=='gpt-6.1-sol'||!args.includes('--spend-ledger'))throw new Error('Explicit model, execution and spend path required');
const cell=join(root,'cells',model),freeze=readJson(join(cell,'freeze.json')),freezeSha256=hash(readFileSync(join(cell,'freeze.json')));
verifySeal(root);
if(hash(execFileSync('git',['show',`HEAD:examples/ledger-jb/cells/${model}/freeze.json`],{cwd:repo}))!==freezeSha256)throw new Error('Freeze not committed');
for(const [path,digest] of Object.entries(freeze.hashes)){
  if(hash(readFileSync(join(repo,path)))!==digest || hash(execFileSync('git',['show',`HEAD:${path}`],{cwd:repo,maxBuffer:20*1024*1024}))!==digest)throw new Error(`Frozen source changed: ${path}`);
}
execFileSync('git',['merge-base','--is-ancestor',freeze.coreCommit,'HEAD'],{cwd:repo});
if(freeze.workers!==2||!freeze.networkRecovery||freeze.capUsd!==35)throw new Error('Wrong recovery contract');
for(const other of ['claude-sonnet-5-5','gpt-6.1-sol'])if(existsSync(join(root,'cells',other,'.paid-run.lock')))throw new Error('Another model runner is active');
const lock=join(root,'additional','.recovery-run.lock'),fd=openSync(lock,'wx');
process.on('exit',()=>{closeSync(fd);unlinkSync(lock);});
const stop={},abort=new AbortController(),state={model,pid:process.pid,mode:'network-recovery-sol',freezeSha256,workers:2};
const sleep=ms=>timer(ms,undefined,{signal:abort.signal});
function event(value){Object.assign(state,value,{at:new Date().toISOString()});writeFileSync(join(cell,'state.json'),JSON.stringify(state,null,2)+'\n');console.log(JSON.stringify(state));}
process.on('SIGUSR2',()=>{stop.error??=new Error('OPERATOR_DRAIN');abort.abort();});
const guard=()=>{if(stop.error)throw stop.error;if(Date.now()>=Date.parse(freeze.lastCallCutoff))throw new Error('CUTOFF_STOP');};
const journal=new RecoveryJournal(join(cell,'calls.jsonl'),{capUsd:freeze.capUsd,appendSpend(row){
  appendFileSync(flag('--spend-ledger'),`| ${row.at} | ledger-jb recovery ${row.phase} ${row.contestant} ${row.itemId} ${row.order} | ${model} | 1 call | ${row.costUsd.toFixed(8)} USD${row.costEstimated?' reserved, actual unknown':''} | separate ${model} liability ${journal.liability().toFixed(8)} / ${freeze.capUsd} USD |\n`);
}});
if(journal.starts.size!==journal.finishes.size)throw new Error('Unresolved in-flight receipt requires reconciliation');
const gate=healthGate({model,path:join(cell,'network-health.jsonl'),sleep,guard,event:row=>event({network:row,status:row.status})});
if(freeze.nativeEnv?.DISABLE_PROMPT_CACHING==='1')process.env.DISABLE_PROMPT_CACHING='1';
const transport=createTransport(model,freeze.settings),data=Object.fromEntries(['fixtures','pilot','noise','pool','validity'].map(name=>[name,readJson(join(root,`data/${name}.json`))]));
const template=readFileSync(join(root,'data/promptfoo-select-best.txt'),'utf8');
const incompleteJobs=()=>new Set(missingRequests(journal.rows).map(x=>`${x.last.phase}:${model}:${x.last.itemId}:${x.last.repeat}:${x.last.contestant}`));
function report(){
  const value=baseReport(root,cell,model);value.budget.capUsd=freeze.capUsd;
  const missing=missingRequests(journal.rows).filter(x=>x.last.phase==='test');
  value.transportMissing=missing.map(x=>({key:x.key,itemId:x.last.itemId,contestant:x.last.contestant}));
  if(missing.length){
    value.status='TRANSPORT_MISSING';value.verdict='WITHHELD_PENDING_TRANSPORT_RECOVERY';
    for(const key of ['ledger','promptfoo','difference','p','wins','losses','decisions'])value[key]=null;
  }
  writeFileSync(join(cell,'report.json'),JSON.stringify(value,null,2)+'\n');return value;
}
async function runPhase(phase){
  const output=join(cell,`decisions-${phase}.jsonl`),previous=readJsonl(output),bad=incompleteJobs();
  const reopen=previous.filter(x=>bad.has(x.key)),kept=previous.filter(x=>!bad.has(x.key));
  if(reopen.length){
    mkdirSync(join(cell,'transport-recovery'),{recursive:true});
    appendFileSync(join(cell,'transport-recovery','superseded-decisions.jsonl'),reopen.map(x=>JSON.stringify({reopenedAt:new Date().toISOString(),reason:'No model answer for a required transport request',priorDecision:x})).join('\n')+'\n');
    writeFileSync(output,kept.map(x=>JSON.stringify(x)).join('\n')+(kept.length?'\n':''));
  }
  const done=new Set(kept.map(x=>x.key));if(done.size!==kept.length)throw new Error('Duplicate decision');
  const planned=cellJobs(data,phase,model),queue=planned.filter(x=>!done.has(x.key));
  event({status:'running',phase,completed:done.size,planned:planned.length,reopened:reopen.length});
  await drainQueue(queue,async job=>{
    const call=async(prompt,{order,attempt=0,schema}={})=>{
      const key=`${job.key}:${order}:${attempt}:${hash(JSON.stringify({prompt,schema,settings:freeze.settings}))}`;
      return journal.recoverCall(key,transport.maximumCostUsd(prompt,schema),()=>transport.call(prompt,{schema}),
        {phase,model,contestant:job.contestant,itemId:job.itemId,repeat:job.repeat,order,attempt,billingRoute:freeze.nativeEnv?.DISABLE_PROMPT_CACHING==='1'?'cache-disabled':'cache-default'},
        {gate,guard,sleep,quotaBackoffMs:freeze.transportPolicy.quotaBackoffMs});
    };
    let result;
    if(job.contestant==='ledger')result=await judgePair({item:job.item,requirements:REQUIREMENTS,model,call,settings:freeze.settings});
    else{const games=[];let graderErrors=0;for(const order of ['AB','BA']){const response=await call(promptfooPrompt(template,job.item,order),{order});const game=response.graderError?null:parsePromptfoo(response.text,order);graderErrors+=Number(game===null);games.push(game);}result={games,graderErrors};}
    if(result.games.length!==2||result.games.some(x=>!['A','B','tie',null].includes(x)))throw new Error('Invalid decision');
    appendFileSync(output,JSON.stringify({...result,key:job.key,itemId:job.itemId,group:job.item.group,label:job.item.label,phase,model,repeat:job.repeat,contestant:job.contestant,freezeSha256})+'\n');
    done.add(job.key);event({status:'running',completed:done.size,liabilityUsd:journal.liability(),requests:journal.finishes.size});
  },2,stop);
}
try{
  report();await gate.before();
  for(const phase of PHASES){
    if(phase==='test'&&!Object.values(report().readiness).every(Boolean))throw new Error('READINESS_STOP');
    await runPhase(phase);report();
  }
  if(missingRequests(journal.rows).some(x=>x.last.phase==='test'))throw new Error('TRANSPORT_MISSING');
  event({status:'finished',liabilityUsd:journal.liability()});
}catch(error){event({status:'stopped',error:error.message});process.exitCode=1;}
finally{report();}
