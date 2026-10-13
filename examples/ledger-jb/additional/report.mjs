import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {hash,readJson,readJsonl,jobs} from '../src/harness.mjs';
import {compare,cheaters,noiseFloor,kappa,officialCorrect,validity} from '../src/statistics.mjs';

export const PHASES=['pilot','fixtures','noise','validity','test'];
export function cellJobs(data,phase,model){
  // The same sealed job sequence, with only the new model identity substituted.
  return jobs(data,phase,'gpt-6-luna').map(job=>({...job,model,key:job.key.replace(':gpt-6-luna:',`:${model}:`)}));
}
export function project(data,model,finishes,decisions=[]){
  const all=PHASES.flatMap(phase=>cellJobs(data,phase,model)),parts={};
  for(const contestant of ['ledger','promptfoo']){
    const sample=finishes.filter(x=>x.contestant===contestant),count=all.filter(x=>x.contestant===contestant).length;
    const observed=decisions.filter(x=>x.contestant===contestant);
    // Five requests cannot estimate rare repair/canonical reads. Predeclare modest overhead;
    // after the complete pilot, use its actual reads per decision when that is greater.
    const expectedReads=contestant==='ledger'?Math.max(2.2*1.02,observed.length>=20?sample.length/observed.length:0):2;
    const mean=sample.length?sample.reduce((n,x)=>n+x.costUsd,0)/sample.length:null;
    parts[contestant]={sampleRequests:sample.length,sampleUsd:sample.reduce((n,x)=>n+x.costUsd,0),meanRequestUsd:mean,
      plannedDecisions:count,expectedReadsPerDecision:expectedReads,projectedRequests:count*expectedReads,projectedUsd:mean===null?null:mean*count*expectedReads};
  }
  return {model,at:new Date().toISOString(),basisRequests:finishes.length,parts,capUsd:25,
    projectedUsd:Object.values(parts).every(x=>x.projectedUsd!==null)?Object.values(parts).reduce((n,x)=>n+x.projectedUsd,0):null,
    method:'Mean measured request cost per contestant times all planned decisions; ledger starts at 2.2 reads plus 2% schema re-asks, then uses a larger observed pilot rate. Small-sample projection, not a guarantee. Hard reservation cap remains authoritative.'};
}
export function report(root,cell,model){
  const data=Object.fromEntries(['pool','dev','fixtures','pilot','noise','validity'].map(name=>[name,readJson(join(root,`data/${name}.json`))]));
  const phases=Object.fromEntries(PHASES.map(p=>[p,readJsonl(join(cell,`decisions-${p}.jsonl`))]));
  const calls=readJsonl(join(cell,'calls.jsonl')),starts=calls.filter(x=>x.type==='start'),finishes=calls.filter(x=>x.type==='finish');
  const completed=new Map(finishes.map(x=>[x.key,x])),pending=starts.filter(x=>!completed.has(x.key));
  const summary=compare(data.pool,phases.test.filter(x=>x.contestant==='ledger'),phases.test.filter(x=>x.contestant==='promptfoo'));
  summary.holmStatus='Additional model cell; multiplicity family assignment belongs to the parent comparison. Original 18-cell family unchanged.';
  delete summary.conservative18CellBound;
  const fixtures=Object.fromEntries([...new Set(data.fixtures.map(x=>x.group))].map(group=>{
    const items=data.fixtures.filter(x=>x.group===group),rows=phases.fixtures.filter(x=>x.group===group),expected=items.length*3;
    const correct=rows.filter(x=>x.games.every(g=>g===x.label)&&!x.graderErrors).length;
    const complete=rows.length===expected&&new Set(rows.map(x=>`${x.itemId}:${x.repeat}`)).size===expected;
    const agreement=complete?kappa(rows.map(x=>x.label),rows.map(x=>x.games[0]===x.games[1]?x.games[0]:null)):null;
    return [group,{expected,measured:rows.length,correct,kappa:agreement,complete,earned:complete&&correct===expected&&agreement>=.8}];
  }));
  const noise=Object.fromEntries(['ledger','promptfoo'].map(c=>[c,noiseFloor(data.noise,phases.noise.filter(x=>x.contestant===c))]));
  const checks=validity(data.validity,phases.validity),prepItems=[...data.fixtures,...data.pilot,...data.noise];
  const prepRows=[...phases.fixtures,...phases.pilot,...phases.noise].filter(x=>x.contestant==='ledger'&&x.repeat===0);
  const prepCheaters=cheaters(prepItems),prepAccuracy=prepRows.length===prepItems.length?prepRows.reduce((n,x)=>n+officialCorrect(x.games,x.label),0)/prepRows.length:null;
  const cheaterGate=prepAccuracy!==null&&Object.values(prepCheaters).every(x=>x.estimate<=.5||prepAccuracy-x.estimate>=.1);
  const readiness={pilotComplete:phases.pilot.length===cellJobs(data,'pilot',model).length,fixturesComplete:Object.values(fixtures).every(x=>x.complete),
    noiseComplete:Object.values(noise).every(x=>x.completed===data.noise.length),validityPassed:Object.values(checks).every(x=>x.passed)&&cheaterGate};
  const cost={},itemsLost={};
  for(const c of ['ledger','promptfoo']){
    const paid=finishes.filter(x=>x.contestant===c),test=paid.filter(x=>x.phase==='test'),rows=phases.test.filter(x=>x.contestant===c);
    const sum=xs=>xs.reduce((n,x)=>n+x.costUsd,0);
    cost[c]={testUsd:sum(test),allPhasesUsd:sum(paid),testRequests:test.length,allRequests:paid.length,
      unknownCostHoldsUsd:sum(paid.filter(x=>x.costEstimated)),tokens:paid.reduce((u,x)=>{for(const key of ['input','output','cached','cacheWrite','reasoning'])u[key]+=(x.usage?.[key]??0);return u;},{input:0,output:0,cached:0,cacheWrite:0,reasoning:0})};
    const capIds=new Set(test.filter(x=>x.tokenCapHit).map(x=>x.itemId));
    itemsLost[c]={missing:data.pool.length-rows.length,unparsedOrError:rows.filter(x=>x.graderErrors||x.games.some(g=>g===null)).map(x=>x.itemId),
      tokenCapAffected:[...capIds],lostWithTokenCap:rows.filter(x=>capIds.has(x.itemId)&&(x.graderErrors||x.games.some(g=>g===null))).map(x=>x.itemId),
      ties:rows.filter(x=>x.games.every(g=>g==='tie')).map(x=>x.itemId)};
  }
  const measuredUsd=finishes.filter(x=>!x.costEstimated).reduce((n,x)=>n+x.costUsd,0),holdsUsd=finishes.filter(x=>x.costEstimated).reduce((n,x)=>n+x.costUsd,0);
  const result={model,at:new Date().toISOString(),freezeSha256:hash(readFileSync(join(cell,'freeze.json'))),status:summary.n===data.pool.length?'MEASURED':summary.n?'PARTIAL':'NOT_RUN',
    ...summary,readiness,fixtures,noise,checks,cheaterGate,prepAccuracy,prepCheaters,cost,itemsLost,
    schemaReasks:{all:finishes.filter(x=>x.attempt===1&&x.transportAttempt===1).length,test:finishes.filter(x=>x.phase==='test'&&x.attempt===1&&x.transportAttempt===1).length},
    budget:{capUsd:25,measuredUsd,holdsUsd,pending:pending.length,pendingReserveUsd:pending.reduce((n,x)=>n+x.reserveUsd,0),liabilityUsd:measuredUsd+holdsUsd+pending.reduce((n,x)=>n+x.reserveUsd,0)},
    requests:finishes.length,modelActual:[...new Set(finishes.map(x=>x.modelActual).filter(Boolean))],
    transportFailures:finishes.filter(x=>x.transportFailure).length,tokenCapCalls:finishes.filter(x=>x.tokenCapHit).length,
    powerRegistration:readJson(join(root,'data/seal.json')).powerRegistration,
    verdict:summary.n!==data.pool.length?'NOT_COMPLETE':summary.losses>summary.wins&&summary.p<.05?'LOSS':'TIE_ONLY_PREREGISTERED'};
  writeFileSync(join(cell,'report.json'),JSON.stringify(result,null,2)+'\n');return result;
}
