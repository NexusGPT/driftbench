/** Keep first completed product verdicts when upstream transport recovery creates new downstream keys. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {scorePoints} from '../judge-benchmarks/src/score';
const base='examples/ledger-verify/lite';
const path=`${base}/noise-0/gemini-3.5-flash-lite.json`;
const original=JSON.parse(await readFile(path.replace('.json','.pre-network-recovery.json'),'utf8'));
const continuation=JSON.parse(await readFile(path,'utf8'));
await writeFile(path.replace('.json','.post-network-continuation.json'),JSON.stringify(continuation,null,2)+'\n',{flag:'wx'});
const items=new Map(JSON.parse(await readFile(`${base}/evidence/dev.json`,'utf8')).map((x:any)=>[x.id,x]));
const kept:any[]=[];
for(const c of continuation.contestants){
 const prior=original.contestants.find((o:any)=>o.contestant===c.contestant);
 c.decisions=c.decisions.map((d:any)=>{
  const first=prior.decisions.find((o:any)=>o.id===d.id&&o.pass!==undefined&&!o.missing);
  if(!first)return d;
  kept.push({contestant:c.contestant,id:d.id,original:first,continuation:d,changed:JSON.stringify(first)!==JSON.stringify(d)});
  return first;
 });
 c.summary=scorePoints(c.decisions.map((d:any)=>({item:items.get(d.id),decision:d,missing:d.missing})));
}
assert.equal(kept.length,6);
continuation.firstCompletedVerdictPolicy='Six original completed noise-0 verdicts retained. All later downstream answers are archived and billed, but do not replace a returned product verdict.';
await writeFile(path,JSON.stringify(continuation,null,2)+'\n');
await writeFile(`${base}/evidence/first-final-preservation.json`,JSON.stringify({at:new Date().toISOString(),reason:'Owner missing-only rule; never choose between returned answers by outcome',kept,providerCalls:0,originalReport:'noise-0/gemini-3.5-flash-lite.pre-network-recovery.json',continuationReport:'noise-0/gemini-3.5-flash-lite.post-network-continuation.json'},null,2)+'\n');
console.log(JSON.stringify({firstFinalsPreserved:kept.length,changedContinuationFinals:kept.filter(x=>x.changed).length,providerCalls:0}));
