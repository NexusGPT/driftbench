import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { runBenchmark } from '../../examples/planted-verify/src/run';
import { contestantById as verifyById } from '../../examples/planted-verify/src/contestants';
import { createCaller, Recordings } from '../../examples/planted-verify/src/call';
import { RUBRIC_ATOMIC, atomicChecks } from '../../examples/planted-rb/src/rubric-atomic';

const root=resolve('research/planted');
const runtime=join(root,'runtime');
await mkdir(runtime,{recursive:true});
const read=async(name:string)=>JSON.parse(await readFile(join(root,name),'utf8'));
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const command=join(root,'claude-meter.py');
const deadline=Date.parse('2026-10-13T06:35:00+02:00');
const reportPath=process.env.ASTRA_REPORT!;
const ledger=process.env.ASTRA_LEDGER!;
const manifest=await read('manifest.json');
for(const [file,hash] of Object.entries(manifest.files)) {
  if(sha(await readFile(join(root,file),'utf8'))!==hash)throw Error(`Bank hash differs: ${file}`);
  execFileSync('git',['ls-files','--error-unmatch',`research/planted/${file}`],{stdio:'pipe'});
}
execFileSync('git',['diff','--exit-code','HEAD','--','research/planted/bank-verify.json','research/planted/bank-rb.json','research/planted/noise-cohorts.json','research/planted/manifest.json'],{stdio:'pipe'});
const freezeCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const start={freezeCommit,startedAt:new Date().toISOString(),deadline,model:'haiku',concurrency:6,cap:16};
try { await readFile(join(runtime,'run-start.json'),'utf8'); await appendFile(join(runtime,'resumes.jsonl'),JSON.stringify(start)+'\n'); }
catch { await writeFile(join(runtime,'run-start.json'),JSON.stringify(start,null,2)+'\n'); }
const meter=async()=>{try{return await read('runtime/meter-state.json')}catch{return{spent:0,unknownReserved:0,calls:0,peak:0}}};
const progress=async(label:string,done:number,total:number)=>{
  const m=await meter();
  console.log(JSON.stringify({at:new Date().toISOString(),label,done,total,spent:m.spent,calls:m.calls}));
  await writeFile(join(runtime,'progress.json'),JSON.stringify({at:new Date().toISOString(),label,done,total,...m},null,2)+'\n');
  await appendFile(ledger,`| ${new Date().toLocaleTimeString('en-GB',{timeZone:'Europe/Brussels'})} | research/astra-planted-truth ${label}: ${done}/${total} | haiku | ${m.calls} cumulative calls | 16.00 cap | ${m.spent.toFixed(7)} cumulative | unknown reserve ${m.unknownReserved.toFixed(2)} |\n`);
};
async function pool<T>(xs:T[],fn:(x:T)=>Promise<void>){let n=0;await Promise.all([0,1,2,3,4,5].map(async()=>{while(n<xs.length){const x=xs[n++]!;await fn(x)}}))}
const rbJudge=RUBRIC_ATOMIC.find(x=>x.id==='driftbench-rb-binary-canonical-executed')!;
async function rbRun(items:any[],tag:string,bank:boolean){
  const path=join(runtime,tag+'.json');
  try { const prior=JSON.parse(await readFile(path,'utf8')); if(prior.length===items.length)return prior; } catch{}
  const recordings=await new Recordings(join(runtime,'recordings',tag,'haiku.jsonl')).load();
  const caller=createCaller(recordings,{model:'haiku',command},{capUsd:16,deadlineAt:deadline});
  const rows:any[]=[];
  await pool(items,async(item)=>{
    const a=bank?item.clean:item.a;const b=bank?item.defect:item.b;
    const reversed=sha(a)>sha(b);const presentedA=reversed?b:a;const presentedB=reversed?a:b;
    const reference=await rbJudge.pairEvidence!({question:item.question,a:presentedA,b:presentedB});
    const prompt=rbJudge.pair!({question:item.question,a:presentedA,b:presentedB,criterion:item.criterion,...(reference===undefined?{}:{reference})});
    const result=await caller.call(prompt,{bench:'rubricbench',contestant:rbJudge.id,item:item.id,order:'canonical'});
    const raw=rbJudge.parsePair!(result.text);const decision=reversed?(raw==='A'?'B':raw==='B'?'A':'tie'):raw;
    const checks=atomicChecks(result.text);
    const row={id:item.id,decision,reversed,key:result.key,costUsd:result.costUsd,checks:checks?.checks,
      ...(bank?{cleanPass:checks?.checks.length===1?(reversed?checks.checks[0]!.b:checks.checks[0]!.a)===2:null,
      defectCaught:checks?.checks.length===1?(reversed?checks.checks[0]!.a:checks.checks[0]!.b)<2:null}:{correct:decision===item.label})};
    rows.push(row);await appendFile(join(runtime,tag+'.jsonl'),JSON.stringify(row)+'\n');
    if(rows.length%10===0)await progress(tag,rows.length,items.length);
  });
  rows.sort((a,b)=>a.id.localeCompare(b.id));
  await writeFile(path,JSON.stringify(rows,null,2)+'\n');await progress(tag,rows.length,items.length);return rows;
}
async function verifyRun(items:any[],tag:string,concurrency=6){
  let rows:any[]=[];
  const path=join(runtime,tag+'.json');
  try{rows=JSON.parse(await readFile(path,'utf8'))}catch{}
  const done=new Set(rows.map(x=>x.id));const pending=items.filter(x=>!done.has(x.id));
  for(let at=0;at<pending.length;at+=10){
    const chunk=pending.slice(at,at+10);
    const rep=await runBenchmark({bench:'longjudge-verify',model:'haiku',contestants:[verifyById('driftbench-verify-uncertainty-cascade')],items:chunk,
      criterion:'The final answer the response gives to the question is correct.',concurrency,capUsd:16,deadlineAt:deadline,
      command,recordingsDir:join(runtime,'recordings',tag),includeDecisions:true});
    await appendFile(join(runtime,tag+'-batches.jsonl'),JSON.stringify(rep)+'\n');
    rows.push(...(rep.contestants[0]?.decisions??[]));
    await writeFile(path,JSON.stringify(rows,null,2)+'\n');await progress(tag,rows.length,items.length);
    if(rep.stopped||rep.failedCalls||rows.some(x=>x.pass===undefined))throw Error(`Incomplete ${tag}: ${rep.stopped??'missing judgments'}`);
  }
  return rows;
}
try{
  const rb=await read('bank-rb.json');
  await rbRun(rb,'bank-rb',true);
  const vb=await read('bank-verify.json');
  const points=['clean','defect'].flatMap(side=>vb.map((x:any)=>({kind:'point',id:x.id+'-'+side,question:x.question,response:x[side],correct:side==='clean',group:side})));
  await verifyRun(points,'bank-verify');
  const cohorts=await read('noise-cohorts.json');
  // All bank calls finish before any noise call. Every repeat gets a fresh recording namespace.
  for(let k=1;k<=3;k++)await rbRun(cohorts.rb,`noise-rb-${k}`,false);
  await Promise.all([1,2,3].map(k=>verifyRun(cohorts.verify,`noise-verify-${k}`,2)));
  await progress('all measured',430,430);
}catch(error){
  await writeFile(join(runtime,'stop.json'),JSON.stringify({at:new Date().toISOString(),error:String(error),meter:await meter()},null,2)+'\n');
  console.error(String(error));process.exitCode=1;
}
