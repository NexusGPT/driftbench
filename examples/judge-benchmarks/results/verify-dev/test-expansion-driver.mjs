import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile,writeFile,appendFile } from 'node:fs/promises';
import { contestantById } from '../../src/contestants.ts';
import { loadBenchmark,splitOf } from '../../src/data.ts';
import { runBenchmark } from '../../src/run.ts';
import { scorePoints } from '../../src/score.ts';
import { testSample,testMetrics } from '../../src/verify-test-metrics.ts';
const folder='examples/judge-benchmarks/results/verify-dev';
const save=(name,x,options)=>writeFile(`${folder}/${name}.json`,JSON.stringify(x,null,2)+'\n',options);
const freeze=JSON.parse(await readFile(`${folder}/freeze.json`,'utf8'));
for(const [path,hash] of Object.entries(freeze.hashes)) if(createHash('sha256').update(await readFile(path)).digest('hex')!==hash) throw Error(`Frozen artifact changed: ${path}`);
const b=await loadBenchmark('longjudge-verify');const population=b.items.filter(x=>splitOf('longjudge-verify',x.id)==='test');
const byId=new Map(population.map(x=>[x.id,x]));
const audit=JSON.parse(await readFile(`${folder}/test-label-audit.json`,'utf8'));
const corrections=new Map(audit.items.filter(x=>x.verdict==='proved_conflict').map(x=>[x.id,x.audited_correct]));
const base=JSON.parse(await readFile(`${folder}/test-result.json`,'utf8'));
if(base.stopped||base.items!==72)throw Error('Original 72-item pass incomplete');
const record='examples/judge-benchmarks/recordings/longjudge-verify/haiku.jsonl';
const baseline=execFileSync('git',['show',`0fa48a41:${record}`],{encoding:'utf8',maxBuffer:128*1024*1024}).trimEnd().split('\n').length;
const spent=async()=> (await readFile(record,'utf8')).trimEnd().split('\n').slice(baseline).reduce((s,l)=>s+Number(JSON.parse(l).costUsd??0),0);
const deadlineAt=Date.parse('2026-10-13T06:35:00+02:00');
const authorization="Owner doubled every budget: your cap is now twice its old value. Use it to finish more of the verify TEST items before 06:35. Push at 06:40.";
const startedAt=Date.now();let reports=[base];let complete=base;let target=84;let round=0;let slowRate=0;let totalAdded=0;
await save('test-expansion-started',{at:new Date().toISOString(),authorization,capUsd:16,recordedStopUsd:15.5,concurrency:6,deadline:'2026-10-13T06:35:00+02:00',sourceFreeze:freeze.sha,samplingPolicy:'Retain the 72 original ids; measure twelve new items at concurrency six. Further nested seeded cohorts use only measured parallel time/cost, a 20% time margin and 90-second buffer. No accuracy controls selection.'},{flag:'wx'});
function combine(parts){
 const cs=parts.map(x=>x.contestants[0]);const decisions=cs.flatMap(x=>x.decisions??[]);
 if(new Set(decisions.map(x=>x.id)).size!==decisions.length)throw Error('Repeated TEST item');
 return {bench:'longjudge-verify',model:'haiku',items:decisions.length,newSpendUsd:parts.reduce((s,x)=>s+x.newSpendUsd,0),newCalls:parts.reduce((s,x)=>s+x.newCalls,0),replayed:parts.reduce((s,x)=>s+x.replayed,0),failedCalls:parts.reduce((s,x)=>s+x.failedCalls,0),stopped:parts.find(x=>x.stopped)?.stopped,contestants:[{contestant:freeze.contestant,mode:'pointwise',summary:scorePoints(decisions.map(d=>({item:byId.get(d.id),decision:d,missing:d.missing}))),costUsd:cs.reduce((s,x)=>s+x.costUsd,0),calls:cs.reduce((s,x)=>s+x.calls,0),decisions}]};
}
while(target>complete.items && Date.now()<deadlineAt && await spent()<15.5){
 const done=new Set(complete.contestants[0].decisions.map(x=>x.id));
 let selected=testSample(population,target);
 while(target>complete.items && ![...done].every(id=>selected.some(x=>x.id===id)))selected=testSample(population,--target);
 const additional=selected.filter(x=>!done.has(x.id));if(!additional.length)break;
 const before=await spent();round++;const start=Date.now();
 await save(`test-expansion-selection-${round}`,{at:new Date().toISOString(),target,additionalIds:additional.map(x=>x.id),allIds:selected.map(x=>x.id),concurrency:6,authorization,decisionInputs:{slowSecondsPerNewItem:slowRate,remainingSeconds:(deadlineAt-Date.now())/1000,recordedSpend:before},outcomesUsed:false});
 console.log(JSON.stringify({event:'expansion-round-start',round,target,additional:additional.length,at:new Date().toISOString()}));
 const result=await runBenchmark({bench:'longjudge-verify',model:'haiku',contestants:[contestantById(freeze.contestant)],items:additional,criterion:b.criterion,split:'all',concurrency:6,capUsd:15.5-before,deadlineAt,includeDecisions:true});
 const seconds=(Date.now()-start)/1000;await save(`test-expansion-round-${round}`,{...result,elapsedSeconds:seconds});reports.push(result);
 const combined=combine(reports);await save('test-expanded-result',combined);
 if(result.stopped){console.log(JSON.stringify({event:'expansion-stopped',reason:result.stopped}));break;}
 complete=combined;totalAdded+=additional.length;slowRate=Math.max(slowRate,seconds/additional.length);
 await save('test-expanded-complete-result',complete);
 console.log(JSON.stringify({event:'expansion-round-complete',round,items:complete.items,seconds,slowRate,at:new Date().toISOString()}));
 const remaining=Math.max(0,(deadlineAt-Date.now())/1000-90);
 const waves=Math.floor(remaining/(slowRate*6*1.2));
 const available=Math.floor((15.5-await spent())/Math.max(result.newSpendUsd/additional.length*1.5,0.00001));
 target=Math.min(221,complete.items+6*waves,complete.items+available);
 if(complete.items===221)break;
}
const last=combine(reports);const c=complete.contestants[0];const ds=c.decisions;
const metrics={at:new Date().toISOString(),sourceFreeze:freeze.sha,authorization,originalCompleteItems:72,completeItems:complete.items,attemptedItems:last.items,stopped:last.stopped,judgmentsReturned:ds.filter(x=>!x.missing).length,binaryVerdicts:ds.filter(x=>x.pass!==undefined).length,population:221,official:testMetrics(population,ds,new Map()),audited:testMetrics(population,ds,corrections),costPer100Usd:c.costUsd*100/complete.items,totalNewTestSpendUsd:last.newSpendUsd,additionalNewSpendUsd:last.newSpendUsd-base.newSpendUsd,additionalNewCalls:last.newCalls-base.newCalls,taskRecordedSpendUsd:await spent(),concurrency:6,expansionElapsedSeconds:(Date.now()-startedAt)/1000,rounds:round,partialCaveat:last.stopped?'The final attempted expansion is incomplete. Population intervals describe only the last complete nested cohort; incomplete additional items are not a random sample.':undefined};
await save('test-expanded-metrics',metrics);console.log(JSON.stringify(metrics,null,2));
if(process.env.VERIFY_SPEND_LEDGER)await appendFile(process.env.VERIFY_SPEND_LEDGER,`| ${new Date().toLocaleTimeString('en-GB',{timeZone:'Europe/Brussels',hour:'2-digit',minute:'2-digit'})} | codex/verify-judge authorized TEST expansion: complete ${complete.items}/221, attempted ${last.items}; frozen judge, concurrency 6 | haiku | ${metrics.additionalNewCalls} | 16 task cap | ${metrics.additionalNewSpendUsd.toFixed(7)} | task ${metrics.taskRecordedSpendUsd.toFixed(7)}; original 72 fees counted earlier |\n`);
