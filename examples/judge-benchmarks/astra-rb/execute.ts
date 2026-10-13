import { readFile,writeFile,mkdir,readdir,appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createCaller, Recordings, CallFailed, SpendCapReached, promptKey } from './call';
import { readRecordingRows } from './recording-files';
import { jsonObjects } from './json';
import { AUDIT, ADAPTER, BINDING_AUDIT } from './prompts';
import { sandboxRun } from './sandbox';
import { equivalent } from './core';

const root=resolve('examples/judge-benchmarks/astra-rb');
const cache=resolve('.cache/astra-rb');
const all=JSON.parse(await readFile(cache+'/dev-inputs.json','utf8'));
const byId=new Map(all.map((x:any)=>[x.id,x]));
const file=root+'/recordings/haiku.jsonl';
const spent=(await readRecordingRows(file)).reduce((s,r)=>s+r.costUsd,0);
const caller=createCaller(await new Recordings(file).load(),{model:'haiku',timeoutMs:100000,maxCallUsd:0.05},
 {capUsd:11.6-spent,deadlineMs:Date.parse('2026-10-13T04:35:00Z')});
const ledger='/private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad/spend-ledger.md';
const checksScript=await readFile(root+'/checks.py','utf8');
const preflightScript=await readFile(root+'/preflight.py','utf8');
const ties=new Set(JSON.parse(await readFile(root+'/excluded-ties.json','utf8')));
await mkdir(cache+'/evidence',{recursive:true});
await mkdir(cache+'/preflight',{recursive:true});
const names=(await readdir(cache+'/plans')).sort();
const retryInfrastructure=process.argv.includes('--retry-infrastructure');
const retrySchema=process.argv.includes('--retry-schema');
const repairObservations=process.argv.includes('--repair-observations');
const retryFolder=repairObservations?'third-pass':retrySchema?'second-pass':'first-pass';
if(retryInfrastructure||retrySchema||repairObservations)await mkdir(cache+'/'+retryFolder,{recursive:true});
let cursor=0,done=0;
const callKeys=new Map<string,Set<string>>();
const sha=(x:string)=>createHash('sha256').update(x).digest('hex');
async function ask(system:string,input:any,item:string,stage:string){
 const prompt={system,user:JSON.stringify(input)};
 let r;
 try{r=await caller.call(prompt,{bench:'rubricbench',contestant:stage,item});}
 catch(error){
  if(!(error instanceof CallFailed)&&!(error instanceof SpendCapReached))throw error;
  return {key:promptKey('haiku',prompt),costUsd:0,value:null,error:String(error),costUnreported:true};
 }
 callKeys.set(item,new Set([...(callKeys.get(item)??[]),r.key]));
 return {key:r.key,costUsd:r.costUsd,value:jsonObjects(r.text).find(o=>'valid'in o||'runnable'in o)??null};
}
function blocks(text:string){
 return [...text.matchAll(/(?:^|\n)[ \t]*\x60\x60\x60([^\n]*)\n([\s\S]*?)(?:\n[ \t]*\x60\x60\x60)/g)].map((m,i)=>({index:i,language:m[1]!.trim(),code:m[2]!}));
}
function schema(value:any):any{
 if(value===null)return {type:'null'};
 if(Array.isArray(value)){
  const items=[...new Map(value.map(x=>{const s=schema(x);return [JSON.stringify(s),s];})).values()];
  return {type:'array',items:items.length===0?{}:items.length===1?items[0]:{anyOf:items}};
 }
 if(typeof value==='object')return {type:'object',properties:Object.fromEntries(Object.entries(value).map(([k,v])=>[k,schema(v)]))};
 return {type:typeof value};
}
async function bindAndRun(r:any,side:string,execution:any,inputs:any[]){
 const candidate=r[side];
 const snippets=blocks(candidate);
 if(snippets.length===0)return {status:'no_executable_snippet',side};
 const outputSchemas=[...new Map(inputs.filter(x=>'expected'in x).map(x=>{const s=schema(x.expected);return [JSON.stringify(s),s];})).values()];
 const contract={description:execution.description,input_contract:execution.input_contract,output_schema:{anyOf:outputSchemas}};
 let previous:any;
 for(let attempt=0;attempt<2;attempt++){
  const req={question:r.question,candidate,blocks:snippets,contract,
   inputs_preview:inputs.slice(0,3).map(({id,input})=>({id,input})),input_count:inputs.length,
   ...(previous?{repair_adapter_only:previous}:{} )};
  const a=await ask(ADAPTER,req,r.id,'astra-adapter-v1-'+sha(candidate).slice(0,12));
  const binding:any=a.value;
  if(!binding?.runnable)return {status:'unsupported_candidate',side,adapter:a,attempt};
  const files=binding.files;
  if(!files||typeof files!=='object'||Object.values(files).some(x=>typeof x!=='string')||
    !Array.isArray(binding.uses)||binding.uses.length===0||binding.uses.some((i:any)=>!Number.isInteger(i)||!snippets[i])){
      previous={reason:'Invalid schema. Supply files and used block indices.'};continue;
  }
  const concatenated=Object.values(files).join('\n');
  if(binding.uses.some((i:number)=>!concatenated.includes('block-'+i+'.txt'))){
    previous={reason:'Read the verbatim block file for every used index.'};continue;
  }
  const audit=await ask(BINDING_AUDIT,{...req,adapter:binding},r.id,'astra-binding-audit-v1-'+sha(candidate).slice(0,12));
  if(audit.value?.valid!==true){
    if(attempt===0){previous={adapter:binding,reason:audit.value?.reasons??'Adapter validation failed'};continue;}
    return {status:'invalid_adapter',side,adapter:a,audit};
  }
  const frozenFiles:Record<string,string>={...files,'inputs.json':JSON.stringify(inputs.map(({id,input})=>({id,input})))};
  for(const s of snippets)frozenFiles['block-'+s.index+'.txt']=s.code;
  const run=await sandboxRun(frozenFiles,binding.command);
  if(run.record.exitCode!==0||run.record.truncated||run.output?.harness_error||!Array.isArray(run.output?.results)){
    if(attempt===0){
      previous={adapter:binding,reason:'Harness produced no complete observation. Fix wrapper infrastructure only. Never repair the candidate.',
       stdout:run.record.stdout,stderr:run.record.stderr,exitCode:run.record.exitCode};continue;
    }
    return {status:'harness_failed',side,adapter:a,audit,run};
  }
  const raw=run.output.results as any[];
  const validShape=raw.length===inputs.length && inputs.every(i=>raw.filter(x=>x.id===i.id).length===1)&&raw.every(x=>('actual'in x)!==('error'in x));
  if(!validShape){
   if(attempt===0){previous={adapter:binding,reason:'Output requires exactly one actual or error for every input id.',output:run.output};continue;}
   return {status:'incomplete_observation',side,adapter:a,audit,run};
  }
  const results=inputs.map(i=>{
   const got=raw.find(x=>x.id===i.id)!;
   // A missing package, denied operation or unresolved wrapper context cannot become a failure.
   const infrastructure=typeof got.error==='string'&&/ModuleNotFound|ImportError|Cannot find module|PermissionError|Operation not permitted|No such file|is not defined|not found|not installed|ECONN|ENOTFOUND|not implemented|reading ['"]React['"]|harness/i.test(got.error);
   return {...i,...got,verdict:infrastructure||!('expected'in i)?'unknown':('error'in got||!equivalent(got.actual,i.expected))?'fail':'pass'};
  });
  return {status:'executed',side,adapter:a,audit,run,results};
 }
 return {status:'invalid_adapter',side,reason:previous};
}
async function worker(){
 while(cursor<names.length){
  const name=names[cursor++]!;
  const id=name.replace('.json','');
  if(ties.has(id))throw new Error('Tie accidentally entered execution queue');
  let prior:any;
  try{prior=JSON.parse(await readFile(cache+'/evidence/'+name,'utf8'));}catch{}
  if(prior){
   if(!(retryInfrastructure||retrySchema||repairObservations)||!prior.questionPlanKey)continue;
   if(retryInfrastructure&&prior.protocolVersion===2)continue;
   if(retrySchema&&prior.protocolVersion===3)continue;
   if(repairObservations&&prior.protocolVersion===4)continue;
   try{await writeFile(cache+'/'+retryFolder+'/'+name,JSON.stringify(prior,null,2)+'\n',{flag:'wx'});}catch(error){if((error as any).code!=='EEXIST')throw error;}
  }
  const r:any=byId.get(id);
  const planRow=JSON.parse(await readFile(cache+'/plans/'+name,'utf8'));
  const plan=planRow.plan;
  if(!plan)continue;
  const evidence:any={id,protocolVersion:repairObservations?4:3,planKey:planRow.key,questionPlanKey:planRow.questionOnly?.key,at:new Date().toISOString(),checks:[],execution:[]};
  if(!plan.execution&&plan.checks.length===0){
    evidence.status='no_machine_contract';
  }else{
    let preflight;
    try{preflight=JSON.parse(await readFile(cache+'/preflight/'+name,'utf8'));if(preflight.planHash!==sha(JSON.stringify([plan,preflightScript])))throw new Error('stale preflight');}
    catch{
     preflight={...await sandboxRun({'plan.json':JSON.stringify(plan),'preflight.py':preflightScript},'python3 -I preflight.py',25000,1048576),planHash:sha(JSON.stringify([plan,preflightScript]))};
     await writeFile(cache+'/preflight/'+name,JSON.stringify(preflight,null,2)+'\n');
    }
    evidence.preflight=preflight;
    if(!preflight.output||preflight.record?.exitCode!==0){
      evidence.status='preflight_failed';
    }else{
      const audit=await ask(AUDIT,{question:r.question,rubric:r.criterion,plan,observed:preflight.output},id,'astra-contract-audit-v1');
      evidence.contractAudit=audit;
      const invalid:any=audit.value?.invalid_checks??[];
      const checks=plan.checks.map((c:any,index:number)=>({...c,index})).filter((c:any)=>{
       const measured=preflight.output.checks.find((x:any)=>x.index===c.index);
       return audit.value?.valid===true && !invalid.includes(c.index)&&measured?.valid===true&&
       typeof c.source_quote==='string'&&(r.question.includes(c.source_quote)||r.criterion.includes(c.source_quote));
      });
      if(checks.length){
       const run=await sandboxRun({'checks.py':checksScript,'checks.json':JSON.stringify({checks,a:r.a,b:r.b})},'python3 -I checks.py');
       evidence.checkRun=run;
       if(run.record.exitCode===0&&!run.record.truncated&&Array.isArray(run.output?.results))evidence.checks=run.output.results;
      }
      const inputs=preflight.output.inputs;
      if(plan.execution && audit.value?.execution_valid===true && !preflight.output.execution_error &&
       inputs?.length>0 && !preflight.output.examples.some((x:any)=>x.pass===false)){
       // Stable, label-free presentation. Only two workers call the model, at most one call per worker.
       for(const side of (sha(r.a)<sha(r.b)?['a','b']:['b','a'])){
         const previous=prior?.execution?.find((x:any)=>x.side===side);
         const retained=repairObservations&&previous&&(previous.status==='no_executable_snippet'||
           (previous.status==='executed'&&previous.results.every((x:any)=>x.verdict!=='unknown')));
         evidence.execution.push(retained?{...previous,retainedObservation:true}:await bindAndRun(r,side,plan.execution,inputs));
         if(retained)for(const key of prior.callKeys??[])callKeys.set(id,new Set([...(callKeys.get(id)??[]),key]));
       }
      }else if(plan.execution)evidence.executionAbstention='invalid_contract_or_reference';
      evidence.status='evaluated';
    }
  }
  evidence.priorCallKeys=prior?.callKeys??[];
  evidence.callKeys=[...(callKeys.get(id)??[])];
  await writeFile(cache+'/evidence/'+name,JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify({id,done:++done,total:names.length,status:evidence.status,checks:evidence.checks.length,execution:evidence.execution.map((x:any)=>x.status),spent:caller.spent()}));
 }
}
const concurrency=Math.max(1,Math.min(6,Number(process.env.ASTRA_RB_CONCURRENCY??6)));
try{await Promise.all(Array.from({length:concurrency},()=>worker()));}
finally{
 await appendFile(ledger,'| '+new Date().toISOString()+' | research/astra-rb-exec validated machine checks and both code answers, DEV, 6 model calls maximum | haiku | '+caller.calls()+' | 12.00 task cap | '+caller.spent().toFixed(8)+' | cumulative '+(spent+caller.spent()).toFixed(8)+' |\n');
}
