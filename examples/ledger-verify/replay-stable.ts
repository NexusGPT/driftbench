/** Reconstruct a recorded request chain without changing or re-asking any model answer. */
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {promisify} from 'node:util';
import {contestantById} from '../judge-benchmarks/src/contestants';
import {CRITERIA} from '../judge-benchmarks/src/data';
import {scorePoints} from '../judge-benchmarks/src/score';
import {schemaFor} from './schemas';
const base=resolve('examples/ledger-verify'),source=resolve('examples/judge-benchmarks/src');
const model=process.argv[2],phase=process.argv[3],addendum=process.argv.includes('--addendum');
const generated=resolve(base,'cache/stable-replay',model,phase);await mkdir(generated,{recursive:true});
const runtime=JSON.parse(await readFile(resolve(base,'evidence/runtime-freeze.json'),'utf8'));
const pilot=JSON.parse(await readFile(resolve(base,'evidence/pilot-runtime-freeze.json'),'utf8'));
const saved=JSON.parse(await readFile(resolve(base,phase,`${model}.json`),'utf8'));
const call=await readFile(resolve(source,'call.ts'),'utf8'),run=await readFile(resolve(source,'run.ts'),'utf8');
const anchor='      const key = promptKey(options.model, prompt);';assert.equal(call.split(anchor).length,2);
const capture=`${anchor}\n      const ctx=(globalThis as any).__stableReplay;for(const core of ctx.cores){const fingerprint=createHash('sha256').update(JSON.stringify({core,model:options.model,system:prompt.system,user:prompt.user,schema:ctx.schemaFor(prompt.system),reasoning:options.model==='haiku'?null:'medium'})).digest('hex');ctx.rows.push({phase:ctx.phase,model:options.model,key,fingerprint,...labels});}`;
function imports(text:string,callPath?:string){return text.replace(/from '\.\/([^']+)'/g,(_all,name)=>`from '${callPath&&name==='call'?callPath:resolve(source,name)}'`);}
await writeFile(resolve(generated,'call.ts'),imports(call.replace(anchor,capture)));await writeFile(resolve(generated,'run.ts'),imports(run,resolve(generated,'call')));
const {runBenchmark}=await import(pathToFileURL(resolve(generated,'run.ts')).href);
const ctx={cores:[...new Set([runtime.coreSha,pilot.coreSha])],rows:[] as any[],phase:phase==='results'?'test':phase,schemaFor};(globalThis as any).__stableReplay=ctx;
const name=phase==='results'?'pool':phase==='validity'?'validity-items':'dev';let items=JSON.parse(await readFile(resolve(base,'evidence',name+'.json'),'utf8'));
if(name==='dev')items=items.sort((a:any,b:any)=>a.id.localeCompare(b.id)).slice(0,phase==='pilot'?20:30);
const dir=addendum?resolve(base,'luna-addendum/recordings'):resolve(base,'recordings',phase==='pilot'?runtime.pilotRecordingsId:runtime.recordingsId,ctx.phase);
const out:any[][]=[[],[]], choices=[];let replayed=0;
for(const item of items){
 let evidence:string|undefined;
 // This is offline reconstruction of the same deterministic, label-blind solver. Its old 5-second
 // timeout has two possible historical outputs: its exact JSON, or no evidence. Existing prompt
 // keys, never expected verdicts or labels, decide which one was actually consumed.
 const result=await new Promise<string>((ok,no)=>{const p=execFile('python3',['-I','-B',resolve(source,'verify-tools.py')],{timeout:60000,maxBuffer:10*1024*1024},(e,out,err)=>e?no(new Error(String(e)+' '+err)):ok(out.trim()));p.stdin!.end(item.question);});
 if(result!=='null'&&result)evidence='Deterministic tool evidence. Respect its explicit proof scope and uncertainty:\n'+result;
 const candidates=evidence===undefined?[undefined]:[evidence,undefined];let found:any,selected:any[]=[];
 for(const candidate of candidates){
  const before=ctx.rows.length;
  const contestants=['driftbench-verify-uncertainty-cascade','promptfoo'].map(contestantById).map(c=>c.toolEvidence?{...c,toolEvidence:async()=>candidate}:c);
  const report=await runBenchmark({bench:'longjudge-verify',model,contestants,items:[item],criterion:CRITERIA['longjudge-verify'],split:'all',concurrency:1,includeDecisions:true,replayOnly:saved.stopped?'lenient':true,recordingsDir:dir,command:'/no-paid-command'});
  const trace=ctx.rows.splice(before);assert.equal(report.newCalls,0);assert.equal(report.newSpendUsd,0);
  if(!report.stopped){found=report;selected=trace;choices.push({id:item.id,toolEvidence:candidate===undefined?'absent':'exact deterministic solver output'});break;}
 }
 assert(found,`No original recorded chain for ${model} ${phase} ${item.id}`);ctx.rows.push(...selected);replayed+=found.replayed;
 for(let i=0;i<2;i++)out[i].push(...found.contestants[i].decisions);
}
const report={...saved,newCalls:0,newSpendUsd:0,replayed,contestants:saved.contestants.map((c:any,i:number)=>({...c,decisions:out[i],summary:scorePoints(items.map((item:any,j:number)=>({item,decision:out[i][j],missing:out[i][j].missing})))}))};
let preserved=0,filled=0;
for(let i=0;i<2;i++)for(let j=0;j<items.length;j++){
 const before=saved.contestants[i].decisions[j],after=out[i][j];
 if(before.missing>0||typeof before.pass!=='boolean'){if(after.missing===0)filled++;}
 else{assert.deepEqual(after,before,`${model} ${phase} ${before.id}`);preserved++;}
}
const target=addendum?resolve(base,'luna-addendum/noise-0.with-recovered-items.json'):resolve(base,phase,`${model}.replay.json`);
await writeFile(target,JSON.stringify(report,null,2)+'\n');
await writeFile(resolve(generated,'evidence.json'),JSON.stringify({model,phase,providerCalls:0,preserved,filled,choices,rows:ctx.rows,sourceHashes:{call:createHash('sha256').update(call).digest('hex'),run:createHash('sha256').update(run).digest('hex')}},null,2)+'\n');
console.log(JSON.stringify({model,phase,items:items.length,preserved,filled,providerCalls:0}));
