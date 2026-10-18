/** Resume only missing work, with original item-labelled prompt chains and final answers retained. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {contestantById} from '../judge-benchmarks/src/contestants';
import {CRITERIA} from '../judge-benchmarks/src/data';
const root=process.cwd(),parent=resolve('examples/ledger-verify'),base=resolve(parent,'sonnet'),model='claude-sonnet-5-5';
const read=async(p:string)=>JSON.parse(await readFile(p,'utf8'));
const lines=async(p:string)=>(await readFile(p,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
const runtime=await read(resolve(base,'evidence/runtime-freeze.json'));
const dry=process.argv.includes('--dry-run');
if(!dry)assert.equal((await read(resolve(base,'evidence/native-quota-recovery-state.json'))).status,'complete');
for(const [p,h] of Object.entries(runtime.hashes))assert.equal(createHash('sha256').update(await readFile(p)).digest('hex'),h,p);
const freeze=await read(resolve(base,'evidence/native-quota-continuation.json'));
assert.equal(createHash('sha256').update(await readFile(resolve(parent,'continue-sonnet-quota.ts'))).digest('hex'),freeze.driverSha256);
const requests=await read(resolve(base,'cache/native-quota-recovery/requests.json'));
const source=resolve('examples/judge-benchmarks/src'),generated=resolve(base,'cache/quota-continuation');await mkdir(generated,{recursive:true});
const call=await readFile(resolve(source,'call.ts'),'utf8'),run=await readFile(resolve(source,'run.ts'),'utf8');
const anchor='      const hit = recordings.get(key);';assert.equal(call.split(anchor).length,2);
const replacement=`      const entries=(globalThis as any).__quotaEntries;
      const ownStage=entries.filter((r:any)=>r.item===labels.item&&r.contestant===labels.contestant&&r.order===labels.order);
      const own=ownStage.filter((r:any)=>r.key===key).at(-1);
      if(ownStage.length&&!own)throw new Error('Existing item stage has a different recorded prompt; no paid resubmission allowed: '+labels.item+' '+labels.order);
      const hit=own??recordings.get(key);`;
function imports(text:string,callPath?:string){return text.replace(/from '\.\/([^']+)'/g,(_all,name)=>`from '${callPath&&name==='call'?callPath:resolve(source,name)}'`);}
await writeFile(resolve(generated,'call.ts'),imports(call.replace(anchor,replacement)));
await writeFile(resolve(generated,'run.ts'),imports(run,resolve(generated,'call')));
const {runBenchmark}=await import(pathToFileURL(resolve(generated,'run.ts')).href);
const items=(await read(resolve(base,'evidence/dev.json'))).sort((a:any,b:any)=>a.id.localeCompare(b.id)).slice(0,30);
const phases=[];
for(const phase of ['noise-0','noise-1']){
 const dir=resolve(base,'recordings',runtime.recordingsId,phase),file=resolve(dir,'longjudge-verify',model+'.jsonl');
 const original=await lines(file.replace('.jsonl','.pre-native-quota.jsonl'));
 const saved=await read(resolve(base,phase,model+'.pre-native-quota.json'));
 const hasFinal=new Set(original.filter((r:any)=>r.order==='single'||r.order==='single-review').map((r:any)=>r.contestant+'|'+r.item));
 const finalsAnswered=new Set(original.filter((r:any)=>/^(single|single-review)$/.test(r.order)&&(!r.failure||!requests.some((q:any)=>q.phase===phase&&q.key===r.key))).map((r:any)=>r.contestant+'|'+r.item));
 let supplemental=0,restored=0;
 const entries=[];
 for(const r of original){
  const request=requests.find((q:any)=>q.phase===phase&&q.key===r.key);
  if(!r.failure||!request||dry){entries.push(r);continue;}
  const answer=await read(resolve(base,'cache/native-quota-recovery/answers',phase+'-'+request.fingerprint+'.json'));assert(answer.verify_answered);
  const laterStageExists=r.order==='quoted-extract'&&original.some((x:any)=>x.item===r.item&&x.contestant===r.contestant&&x.order!=='quoted-extract');
  if(!/^(single|single-review)$/.test(r.order)&&(hasFinal.has(r.contestant+'|'+r.item)||laterStageExists)){entries.push(r);supplemental++;continue;}
  const entry={...r,text:answer.is_error?'':answer.result,costUsd:answer.total_cost_usd};delete entry.failure;
  if(answer.is_error)entry.failure=answer.result;
  entries.push(entry);restored++;
 }
 if(!dry){
  // A restart preserves any newly answered continuation stages, never replacing them from the archive.
  const existing=await lines(file);
  for(const r of existing)if(!original.some((o:any)=>o.key===r.key&&o.item===r.item&&o.contestant===r.contestant&&o.order===r.order))entries.push(r);
  await writeFile(file,entries.map(r=>JSON.stringify(r)).join('\n')+'\n');
 }
 (globalThis as any).__quotaEntries=entries;
 process.env.VERIFY_PHASE=phase;process.env.VERIFY_OUTER_TIMEOUT_MS=String(runtime.outerTimeoutMs);
 const report=await runBenchmark({bench:'longjudge-verify',model,contestants:['driftbench-verify-uncertainty-cascade','promptfoo'].map(contestantById),items,criterion:CRITERIA['longjudge-verify'],split:'all',concurrency:2,capUsd:45,includeDecisions:true,replayOnly:dry?'lenient':false,recordingsDir:dir,command:resolve(runtime.command)});
 let preserved=0;
 for(let i=0;i<2;i++)for(let j=0;j<30;j++)if(dry||finalsAnswered.has(report.contestants[i].contestant+'|'+items[j].id)){
  assert.deepEqual(report.contestants[i].decisions[j],saved.contestants[i].decisions[j]);preserved++;
 }
 if(dry){assert.equal(report.newCalls,0);assert.equal(report.newSpendUsd,0);}
 else await writeFile(resolve(base,phase,model+'.json'),JSON.stringify(report,null,2)+'\n');
 const result={phase,restored,supplemental,firstFinalsPreserved:preserved,newCalls:report.newCalls,stopped:report.stopped};phases.push(result);console.log(JSON.stringify(result));
 if(!dry)assert(!report.stopped,report.stopped);
}
await writeFile(resolve(base,'evidence',dry?'native-quota-continuation-dry-run.json':'native-quota-continuation-state.json'),JSON.stringify({at:new Date().toISOString(),status:dry?'offline original replay identical':'complete',phases},null,2)+'\n');
