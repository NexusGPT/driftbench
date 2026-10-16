/** Offline replay selects each item's original concurrent answer before ordinary cache fallback. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {contestantById} from '../judge-benchmarks/src/contestants';
import {CRITERIA} from '../judge-benchmarks/src/data';
import {schemaFor} from './schemas';
const base=resolve('examples/ledger-verify/lite'),source=resolve('examples/judge-benchmarks/src');
const prepareTest=process.argv.includes('--prepare-test-recovery');
const prepareRecovery=process.argv.includes('--prepare-recovery')||prepareTest;
const generated=resolve(base,'cache/item-history');await mkdir(generated,{recursive:true});
const runtime=JSON.parse(await readFile(resolve(base,'evidence/runtime-freeze.json'),'utf8'));
const call=await readFile(resolve(source,'call.ts'),'utf8'),run=await readFile(resolve(source,'run.ts'),'utf8');
const anchor='      const hit = recordings.get(key);';assert.equal(call.split(anchor).length,2);
const replacement=`      const ctx=(globalThis as any).__itemHistory;
      const ownStage=ctx.entries.filter((r:any)=>r.item===labels.item&&r.contestant===labels.contestant&&r.order===labels.order);
      const own=ownStage.filter((r:any)=>r.key===key).at(-1);
      const candidates=[...new Map(ctx.entries.filter((r:any)=>r.key===key).map((r:any)=>[r.text+'|'+r.failure,r])).values()] as any[];
      const branch=labels.contestant+'|'+labels.item+'|'+labels.order+'|'+key;
      const index=ctx.choice[branch]??0;
      if(!own&&ownStage.length===0&&candidates.length>1)ctx.branches.push({branch,n:candidates.length,index});
      const hit=own??(ownStage.length?undefined:candidates[index]);
      const fingerprint=createHash('sha256').update(JSON.stringify({core:ctx.core,model:options.model,system:prompt.system,user:prompt.user,schema:ctx.schemaFor(prompt.system),reasoning:'medium'})).digest('hex');
      if(ctx.allowed.has(fingerprint))ctx.requests.set(fingerprint,{fingerprint,system:prompt.system,user:prompt.user,key});
      ctx.rows.push({phase:ctx.phase,model:options.model,key,fingerprint,...labels,selection:own?'original item-labelled answer':'ordinary cache fallback'});`;
function imports(text:string,callPath?:string){return text.replace(/from '\.\/([^']+)'/g,(_all,name)=>`from '${callPath&&name==='call'?callPath:resolve(source,name)}'`);}
await writeFile(resolve(generated,'call.ts'),imports(call.replace(anchor,replacement)));
await writeFile(resolve(generated,'run.ts'),imports(run,resolve(generated,'call')));
const {runBenchmark}=await import(pathToFileURL(resolve(generated,'run.ts')).href);
const wave=JSON.parse(await readFile(resolve(base,`evidence/${prepareTest?'test-network':'network'}-wave.json`),'utf8'));
const allowed=new Set(wave.errors.map((r:any)=>r.fingerprint));
const ctx={allowed,requests:new Map<string,any>(),core:runtime.coreSha,schemaFor,entries:[] as any[],rows:[] as any[],phase:'',choice:{} as any,branches:[] as any[]};(globalThis as any).__itemHistory=ctx;
const phases=[];
for(const phase of ['pilot','validity','noise-0','noise-1','noise-2','results']){
 const model='gemini-3.5-flash-lite';let saved:any;
 if(prepareTest&&phase!=='results')continue;
 if(prepareRecovery&&!prepareTest&&['noise-1','noise-2','results'].includes(phase))continue;
 const archive=prepareTest?'.pre-test-network-recovery':prepareRecovery&&phase==='noise-0'?'.pre-network-recovery':'';
 try{saved=JSON.parse(await readFile(resolve(base,phase,`${model}${archive}.json`),'utf8'));}catch(e:any){if(e.code==='ENOENT')continue;throw e;}
 const name=phase==='validity'?'validity-items':phase==='results'?'pool':'dev';
 let items=JSON.parse(await readFile(resolve(base,'evidence',`${name}.json`),'utf8'));
 if(name==='dev')items=items.sort((a:any,b:any)=>a.id.localeCompare(b.id)).slice(0,phase==='pilot'?20:30);
 ctx.phase=phase==='results'?'test':phase;
 const dir=resolve(base,'recordings',phase==='pilot'?runtime.pilotRecordingsId:runtime.recordingsId,ctx.phase);
 const phaseEntries=(await readFile(resolve(dir,'longjudge-verify',`${model}${archive}.jsonl`),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
 let preserved:any[]=[];let before:any[]=[];
 if(phase==='noise-0'&&!prepareRecovery){
  try{
   preserved=JSON.parse(await readFile(resolve(base,'evidence/first-final-preservation.json'),'utf8')).kept;
   before=(await readFile(resolve(dir,'longjudge-verify',`${model}.pre-network-recovery.jsonl`),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  }catch(e:any){if(e.code!=='ENOENT')throw e;}
 }
 const merged:any[]=[[],[]];let stopped:string|undefined;let searchAttempts=0;
 for(const item of items){
  const prior=preserved.filter(p=>p.id===item.id);
  ctx.entries=[...phaseEntries.filter(r=>!prior.some(p=>r.item===p.id&&r.contestant===p.contestant)),...before.filter(r=>prior.some(p=>r.item===p.id&&r.contestant===p.contestant))];
  const queue:any[]=[{}];let found:any;let chosenRows:any[]=[];
  const visited=new Set<string>();
  while(queue.length){
   ctx.choice=queue.shift();ctx.branches=[];const begin=ctx.rows.length;searchAttempts++;
   const attempt=await runBenchmark({bench:'longjudge-verify',model,contestants:['driftbench-verify-uncertainty-cascade','promptfoo'].map(contestantById),items:[item],criterion:CRITERIA['longjudge-verify'],split:'all',concurrency:1,includeDecisions:true,replayOnly:saved.stopped?'lenient':true,recordingsDir:dir,command:'/no-paid-command'});
   assert.equal(attempt.newCalls,0);assert.equal(attempt.newSpendUsd,0);
   const observed=ctx.rows.splice(begin);
   if(!attempt.stopped){found=attempt;chosenRows=observed;break;}
   stopped=attempt.stopped;
   for(const branch of ctx.branches)for(let index=0;index<branch.n;index++){
    const choice={...ctx.choice,[branch.branch]:index};const key=JSON.stringify(Object.entries(choice).sort());
    if(!visited.has(key)){visited.add(key);queue.push(choice);}
   }
  }
  assert(found,`No recorded request chain for ${phase} ${item.id}: ${stopped}`);
  ctx.rows.push(...chosenRows);for(let i=0;i<2;i++)merged[i].push(...found.contestants[i].decisions);
 }
 const report={...saved,contestants:saved.contestants.map((c:any,i:number)=>({...c,decisions:merged[i]})),newCalls:0,newSpendUsd:0};
 if(!prepareRecovery)await writeFile(resolve(base,phase,`${model}.history-replay.json`),JSON.stringify(report,null,2)+'\n');
 const changes=[];
 for(let i=0;i<saved.contestants.length;i++)for(let j=0;j<saved.contestants[i].decisions.length;j++){
 const a=saved.contestants[i].decisions[j],b=report.contestants[i].decisions[j];
 if(JSON.stringify(a)!==JSON.stringify(b))changes.push({contestant:saved.contestants[i].contestant,id:a.id,original:a,replay:b});
 }
 console.log(JSON.stringify({phase,items:items.length,searchAttempts,changed:changes.length}));

 phases.push({model,phase,items:items.length,originalStopped:saved.stopped,identicalDecisions:!changes.length,changed:changes,newCalls:0});
}
if(!prepareRecovery){
 await writeFile(resolve(base,'evidence/item-history-replay.json'),JSON.stringify({at:new Date().toISOString(),phases,sourceHashes:{call:createHash('sha256').update(call).digest('hex'),run:createHash('sha256').update(run).digest('hex')},mechanism:'Read-only copied caller prefers the original item/order answer among concurrently returned duplicate keys. Final decisions are recomputed, never replaced by expected labels.',providerCalls:0},null,2)+'\n');
 await writeFile(resolve(base,'evidence/history-request-attribution.json'),JSON.stringify({at:new Date().toISOString(),rows:ctx.rows,newModelCalls:0},null,2)+'\n');
}else{
 assert.equal(ctx.requests.size,allowed.size,'Every authorized request must be reconstructed exactly');
 const folder=resolve(base,`cache/${prepareTest?'test-network':'network'}-recovery`);
 await mkdir(folder,{recursive:true});
 await writeFile(resolve(folder,'requests.json'),JSON.stringify([...ctx.requests.values()],null,2)+'\n');
}
console.log(JSON.stringify(phases.map(p=>({...p,changed:p.changed.length}))));
assert(phases.filter(p=>!p.originalStopped).every(p=>p.identicalDecisions),'Completed phase differs; inspect without paid retries');
