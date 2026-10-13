import { readFile,writeFile,readdir,mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { machineDecision,executionBlocks,constraintBlocks,pairedExact } from './core';
import { readRecordingRows } from './recording-files';
const root=resolve('examples/judge-benchmarks/astra-rb'),cache=resolve('.cache/astra-rb');
const inputs=JSON.parse(await readFile(cache+'/dev-inputs.json','utf8'));
const base=JSON.parse(await readFile(root+'/baseline-dev.json','utf8'));
const frozen=JSON.parse(await readFile(root+'/frozen-design.json','utf8'));
const ties=new Set(JSON.parse(await readFile(root+'/excluded-ties.json','utf8')));
const evidence:any={};
for(const f of await readdir(cache+'/evidence')){const row=JSON.parse(await readFile(cache+'/evidence/'+f,'utf8'));evidence[row.id]=row;}
const recordings=await readRecordingRows(root+'/recordings/haiku.jsonl');
const measuredCost=recordings.reduce((s,r)=>s+r.costUsd,0);
const codeIds=new Set(inputs.filter((x:any)=>['code','mbpp'].includes(x.group)).map((x:any)=>x.id));
const variants:any[]=[];
const plans:any={};
function wilson(correct:number,n:number){
 if(!n)return null;
 const z=1.959963984540054,p=correct/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,h=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;
 return [c-h,c+h];
}
for(const f of await readdir(cache+'/plans')){const row=JSON.parse(await readFile(cache+'/plans/'+f,'utf8'));plans[row.id]=row;}
for(const mode of ['execution','constraints','combined']){
 const used=new Set<string>();
 for(const [id,p] of Object.entries(plans) as [string,any][]){
  const e=evidence[id];
  if(mode!=='execution'||(p.plan.execution&&p.plan.checks?.length>0))used.add(p.key);
  if(mode!=='constraints'&&p.questionOnly?.key)used.add(p.questionOnly.key);
  if(!e)continue;
  const needsC1=mode!=='execution'&&p.plan.checks?.length>0;
  const needsC2=mode!=='constraints'&&!!p.plan.execution;
  if((needsC1||needsC2)&&e.contractAudit?.key)used.add(e.contractAudit.key);
  if(needsC2)for(const key of e.callKeys??[]){
    const r=recordings.find(r=>r.key===key);
    if(r?.contestant?.startsWith('astra-adapter')||r?.contestant?.startsWith('astra-binding-audit'))used.add(key);
  }
 }
 const reproductionCost=recordings.filter(r=>used.has(r.key)).reduce((s,r)=>s+r.costUsd,0);
 const rows=base.details.map((b:any)=>{
  const e=evidence[b.id];
  const blocks=ties.has(b.id)||!e?[]:[...(mode==='constraints'?[]:executionBlocks(e)),...(mode==='execution'?[]:constraintBlocks(e))];
  const machine=machineDecision(blocks);
  const before=b.games.filter((x:string)=>x===b.label).length/b.games.length;
  const after=machine===null?before:Number(machine===b.label);
  return {id:b.id,group:b.group,label:b.label,baseline:b.games[0],decision:machine??b.games[0],machine,before,after,blocks};
 });
 const summary=(xs:any[])=>({n:xs.length,baselineCorrect:xs.reduce((s,r)=>s+r.before,0),correct:xs.reduce((s,r)=>s+r.after,0),
  baselineAccuracy:xs.reduce((s,r)=>s+r.before,0)/xs.length,accuracy:xs.reduce((s,r)=>s+r.after,0)/xs.length,
  wilson95:wilson(xs.reduce((s,r)=>s+r.after,0),xs.length),
  fixes:xs.filter(r=>r.after>r.before).map(r=>r.id),breaks:xs.filter(r=>r.after<r.before).map(r=>r.id)});
 const all=summary(rows),code=summary(rows.filter((r:any)=>codeIds.has(r.id))),decided=summary(rows.filter((r:any)=>r.machine!==null));
 const delta=100*(all.accuracy-all.baselineAccuracy);
 const domains=Object.fromEntries([...new Set(rows.map((r:any)=>r.group))].sort().map(group=>[group,summary(rows.filter((r:any)=>r.group===group))]));
 variants.push({mode,overall:all,code,decided,domains,deltaPoints:delta,pairedExact:pairedExact(all.fixes.length,all.breaks.length),
 usedRecordingKeys:[...used].sort(),reproductionCostUsd:reproductionCost,extraUsdPer100:reproductionCost/inputs.length*100,totalUsdPer100:frozen.usdPer100+reproductionCost/inputs.length*100,
 featureGate:code.fixes.length>=4&&code.breaks.length===0&&reproductionCost/inputs.length*100<0.07,
 testGate:delta>=3,rows});
}
const coverage=inputs.map((r:any)=>{
 const e=evidence[r.id],p=plans[r.id];
 return {id:r.id,group:r.group,excluded:ties.has(r.id),routed:!!p,complete:!p||!!e,
 status:ties.has(r.id)?'council_owned_tie':e?.status??(p?'pending':'no_countable_route'),
  checks:e?.checks.filter((x:any)=>!x.validationRejected).length??0,executionRequested:!!p?.plan?.execution,
 nullReason:p?.questionOnly?.reason??p?.recovery?.reason??null,
 executionAbstention:e?.executionAbstention??null,
 sides:e?.execution?.map((x:any)=>({side:x.side,status:x.status,inputs:x.results?.length??0,
  pass:x.results?.filter((r:any)=>r.verdict==='pass').length??0,fail:x.results?.filter((r:any)=>r.verdict==='fail').length??0,
  unknown:x.results?.filter((r:any)=>r.verdict==='unknown').length??0}))??[]};
});
const result={measuredAt:new Date().toISOString(),frozenCommit:frozen.commit,
 complete:coverage.every((x:any)=>x.complete),devItems:inputs.length,excludedTies:ties.size,
 codePairs:codeIds.size,codeTieExclusions:coverage.filter((x:any)=>x.excluded&&codeIds.has(x.id)).length,
 generatedPlans:Object.keys(plans).length,completedEvidence:Object.keys(evidence).length,
 executionCoverage:{
  contracts:coverage.filter((x:any)=>x.executionRequested).length,
  bothExecuted:coverage.filter((x:any)=>x.sides.length===2&&x.sides.every((s:any)=>s.status==='executed')).length,
  atLeastOneExecuted:coverage.filter((x:any)=>x.sides.some((s:any)=>s.status==='executed')).length,
  observedCases:coverage.reduce((sum:number,x:any)=>sum+x.sides.reduce((s:number,y:any)=>s+y.inputs,0),0),
  rejectedInputs:Object.values(evidence).reduce((sum:number,e:any)=>sum+(e.preflight?.output?.rejected?.length??0),0),
 },
 cost:{recordedCalls:recordings.length,successfulUsd:measuredCost,extraPer100:measuredCost/inputs.length*100,
 totalPer100:frozen.usdPer100+measuredCost/inputs.length*100,accounting:'All recorded question generators, audits, adaptations, repairs, including unsuccessful prototypes; frozen judge cost added conservatively.'},
 variants,coverage,
 decisionHash:createHash('sha256').update(JSON.stringify(variants.map(v=>v.rows.map((r:any)=>[r.id,r.decision])))).digest('hex')};
await mkdir(root+'/results',{recursive:true});
await writeFile(root+'/results/dev.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({...result,coverage:undefined,variants:variants.map(v=>({...v,usedRecordingKeys:undefined,rows:undefined}))},null,2));
