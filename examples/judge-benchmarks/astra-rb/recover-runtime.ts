import { readFile,writeFile,appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createCaller, Recordings } from './call';
import { readRecordingRows } from './recording-files';
import { jsonObjects } from './json';
import { EXECUTION_RECOVERY } from './prompts';
const root=resolve('examples/judge-benchmarks/astra-rb'),cache=resolve('.cache/astra-rb');
const all=JSON.parse(await readFile(cache+'/dev-inputs.json','utf8'));
const ties=new Set(JSON.parse(await readFile(root+'/excluded-ties.json','utf8')));
const file=root+'/recordings/haiku.jsonl';
const spent=(await readRecordingRows(file)).reduce((s,r)=>s+r.costUsd,0);
const caller=createCaller(await new Recordings(file).load(),{model:'haiku',timeoutMs:100000,maxCallUsd:0.05},
{capUsd:11.6-spent,deadlineMs:Date.parse('2026-10-13T04:35:00Z')});
const runtimePrompt=EXECUTION_RECOVERY+"\nRuntime availability correction, empirically verified: Python numpy/scipy/pandas/fastapi/pydantic/pytest/lxml; Node linkedom/jsdom/Vue2.7/React18/jquery3/moment2/TypeScript; C/C++/Java17/Go/.NET8 C#. ASP.NET Core shared framework available offline. Unity, DevExpress, Salesforce remote services and R remain unavailable. Do not abstain for an installed dependency. No labels or candidates are available.";
const todo:any[]=[];
for(const r of all){
 if(ties.has(r.id)||!['code','mbpp'].includes(r.group))continue;
 const prior=JSON.parse(await readFile(cache+'/plans/'+r.id+'.json','utf8'));
 if(!prior.plan?.execution && /\.NET|C#|pandas|pydantic|fastapi|react|vue|sequelize|typescript compiler/i.test(prior.recovery?.reason??''))todo.push({r,prior});
}
let cursor=0,done=0;
async function worker(){
 while(cursor<todo.length){
  const {r,prior}=todo[cursor++]!;
  const entry=await caller.call({system:runtimePrompt,user:JSON.stringify({question:r.question,rubric:r.criterion})},
   {bench:'rubricbench',contestant:'astra-runtime-recovery-v3',item:r.id});
  const value:any=jsonObjects(entry.text).find(x=>'execution'in x)??{execution:null,reason:'Unparsed recovery'};
  const result={...prior,runtimeRecovery:{key:entry.key,costUsd:entry.costUsd,...value},plan:{checks:prior.plan?.checks??[],execution:value.execution}};
  await writeFile(cache+'/plans/'+r.id+'.json',JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({id:r.id,done:++done,total:todo.length,execution:!!value.execution,reason:value.reason,spent:caller.spent()}));
 }
}
try{await Promise.all([worker(),worker()]);}
finally{
 await appendFile('/private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad/spend-ledger.md',
 '| '+new Date().toISOString()+' | research/astra-rb-exec runtime-coverage recovery, no labels, 2 calls maximum | haiku | '+caller.calls()+' | 12.00 task cap | '+caller.spent().toFixed(8)+' | cumulative '+(spent+caller.spent()).toFixed(8)+' |\n');
}
