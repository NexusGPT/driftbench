/** Offline instrumentation copy: obtain request fingerprints and consuming item labels, never call a model. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { contestantById } from '../judge-benchmarks/src/contestants';
import { CRITERIA } from '../judge-benchmarks/src/data';
const base=resolve('examples/ledger-verify'),source=resolve('examples/judge-benchmarks/src');
const generated=resolve(base,'cache/attribution');await mkdir(generated,{recursive:true});
const runtime=JSON.parse(await readFile(resolve(base,'evidence/runtime-freeze.json'),'utf8'));
const initial=JSON.parse(await readFile(resolve(base,'evidence/pilot-runtime-freeze.json'),'utf8'));
const cores=[...new Set([runtime.coreSha,initial.coreSha])];
const originalCall=await readFile(resolve(source,'call.ts'),'utf8');
const originalRun=await readFile(resolve(source,'run.ts'),'utf8');
const anchor='      const key = promptKey(options.model, prompt);';
assert.equal(originalCall.split(anchor).length,2);
const instrumentation=`${anchor}
      const trace=(globalThis as any).__verifyTrace;
      if(trace) for(const core of trace.cores){
        const fingerprint=createHash('sha256').update(JSON.stringify({core,model:options.model,system:prompt.system,user:prompt.user,schema:trace.schemaFor(prompt.system),reasoning:options.model==='haiku'?null:'medium'})).digest('hex');
        trace.rows.push({phase:trace.phase,model:options.model,key,fingerprint,...labels});
      }`;
function imports(text:string,callPath?:string){return text.replace(/from '\.\/([^']+)'/g,(_all,name)=>`from '${callPath&&name==='call'?callPath:resolve(source,name)}'`);}
await writeFile(resolve(generated,'call.ts'),imports(originalCall.replace(anchor,instrumentation)));
await writeFile(resolve(generated,'run.ts'),imports(originalRun,resolve(generated,'call')));
const {runBenchmark}=await import(pathToFileURL(resolve(generated,'run.ts')).href);
const {schemaFor}=await import('./schemas');
const trace={cores,rows:[] as any[],schemaFor,phase:''};(globalThis as any).__verifyTrace=trace;
const phases=process.argv.includes('--all')?['pilot','validity','noise-0','noise-1','noise-2','results']:['pilot'];
let decisions=0;
for(const model of ['haiku','gpt-6-luna','gemini-3.8-flash'])for(const phase of phases){
  let saved:any;
  try{saved=JSON.parse(await readFile(resolve(base,phase,`${model}.json`),'utf8'));}catch(e:any){if(e.code==='ENOENT')continue;throw e;}
  const poolName=phase==='validity'?'validity-items':phase==='results'?'pool':'dev';
  let items=JSON.parse(await readFile(resolve(base,'evidence',`${poolName}.json`),'utf8'));
  if(poolName==='dev')items=items.sort((a:any,b:any)=>a.id.localeCompare(b.id)).slice(0,phase==='pilot'?20:30);
  trace.phase=phase==='results'?'test':phase;
  const report=await runBenchmark({bench:'longjudge-verify',model,contestants:['driftbench-verify-uncertainty-cascade','promptfoo'].map(contestantById),items,criterion:CRITERIA['longjudge-verify'],split:'all',concurrency:1,includeDecisions:true,replayOnly:'lenient',recordingsDir:resolve(base,'recordings',phase==='pilot'?runtime.pilotRecordingsId:(runtime.recordingsId??runtime.id),trace.phase),command:'/no-paid-command'});
  assert.equal(report.newCalls,0);assert.equal(report.newSpendUsd,0);decisions+=items.length*2;
}
const target=resolve(base,'evidence/request-attribution.json');
await writeFile(target,JSON.stringify({at:new Date().toISOString(),sourceHashes:{call:createHash('sha256').update(originalCall).digest('hex'),run:createHash('sha256').update(originalRun).digest('hex')},instrumentation:'A copied caller logs its existing prompt key, frozen transport fingerprint and caller labels before a replay lookup. No prompt, parser or product code is modified.',newModelCalls:0,decisions,rows:trace.rows},null,2)+'\n');
console.log(JSON.stringify({requestLabels:trace.rows.length,decisions,newModelCalls:0,target}));
