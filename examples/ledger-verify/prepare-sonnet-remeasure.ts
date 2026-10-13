/** Obtain five representative DEV requests without making a provider call. */
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {contestantById} from '../judge-benchmarks/src/contestants';
import {CRITERIA} from '../judge-benchmarks/src/data';
const base=resolve('examples/ledger-verify'),src=resolve('examples/judge-benchmarks/src'),dest=resolve(base,'cache/new-cost-sample');
await mkdir(dest,{recursive:true});
const requests:any[]=[];(globalThis as any).__sample=(key:any,prompt:any,labels:any)=>requests.push({key,prompt,labels});
const call=await readFile(resolve(src,'call.ts'),'utf8'),run=await readFile(resolve(src,'run.ts'),'utf8');
const anchor='      const key = promptKey(options.model, prompt);';assert.equal(call.split(anchor).length,2);
function imports(s:string,cp?:string){return s.replace(/from '\.\/([^']+)'/g,(_a,n)=>`from '${cp&&n==='call'?cp:resolve(src,n)}'`);}
await writeFile(resolve(dest,'call.ts'),imports(call.replace(anchor,anchor+'\n      (globalThis as any).__sample(key,prompt,labels);')));
await writeFile(resolve(dest,'run.ts'),imports(run,resolve(dest,'call')));
const {runBenchmark}=await import(pathToFileURL(resolve(dest,'run.ts')).href);
const runtime=JSON.parse(await readFile(resolve(base,'evidence/runtime-freeze.json'),'utf8'));
const items=JSON.parse(await readFile(resolve(base,'evidence/dev.json'),'utf8')).sort((a:any,b:any)=>a.id.localeCompare(b.id)).slice(0,20);
const report=await runBenchmark({bench:'longjudge-verify',model:'haiku',contestants:['driftbench-verify-uncertainty-cascade','promptfoo'].map(contestantById),items,criterion:CRITERIA['longjudge-verify'],split:'all',concurrency:1,includeDecisions:true,replayOnly:'lenient',recordingsDir:resolve(base,'recordings',runtime.pilotRecordingsId,'pilot'),command:'/no-provider-command'});
assert.equal(report.newCalls,0);
const answered=JSON.parse(await readFile(resolve(base,'evidence/new-model-cost-sample.json'),'utf8')).requests;
const excluded=new Set(answered.map((r:any)=>JSON.stringify(r.prompt)));
const unique=requests.filter((r:any,i:number)=>!excluded.has(JSON.stringify(r.prompt))&&requests.findIndex(x=>JSON.stringify(x.prompt)===JSON.stringify(r.prompt))===i);
console.log(JSON.stringify(unique.slice(0,20).map(r=>r.labels)));
const chosen=['program','blind-direct-program','single'].map(order=>unique.find(r=>r.labels.contestant==='driftbench-verify-uncertainty-cascade'&&r.labels.order===order));
chosen.push(...unique.filter(r=>r.labels.contestant==='promptfoo'&&r.labels.order==='single').slice(0,2));
assert.equal(chosen.length,5);assert(chosen.every(Boolean));assert.equal(new Set(chosen.map(r=>JSON.stringify(r.prompt))).size,5);
await writeFile(resolve(base,'sonnet/evidence/cache-off-cost-selection.json'),JSON.stringify({sourceModel:'haiku',sourcePhase:'pilot',selection:'Next unanswered DEV request for each of the original three cascade stages, then next two unanswered promptfoo requests; initial five answered prompts excluded',newProviderCalls:0,requests:chosen},null,2)+'\n');
