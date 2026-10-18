/** One-time recovery bookkeeping for two exhausted native pilot transports, without calls. */
import assert from 'node:assert/strict';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { contestantById } from '../judge-benchmarks/src/contestants';
import { promptKey } from '../judge-benchmarks/src/call';
const base='examples/ledger-verify';
const path=`${base}/recordings/b4e4305a2426e0bb7589/pilot/longjudge-verify/haiku.jsonl`;
const rows=(await readFile(path,'utf8')).trim().split('\n').map(s=>JSON.parse(s));
const items=JSON.parse(await readFile(`${base}/evidence/dev.json`,'utf8'));
const contestant=contestantById('driftbench-verify-uncertainty-cascade');
const failures=[
  {item:'1548f1e34026a5988f77c35cbc1e2528_c39553e7f10dd1483084dd94954eb1ec',order:'blind-direct-program',receipt:'6ab5b67b-9b3f-4827-aa2d-fbe47b370693'},
  {item:'251325e4d8bd19d38d1481ec5bb6b952_b0e0faf620816637683d6cefbc8d905d',order:'program',receipt:'54a2039c-e91b-4fd8-95c4-d77da5e16bb1'},
];
const errors=(await readFile(`${base}/receipts/errors.jsonl`,'utf8')).trim().split('\n').map(s=>JSON.parse(s));
const evidence=[];
for (const entry of failures) {
  const error=errors.find(r=>r.id===entry.receipt);assert.equal(error.model,'haiku');
  const item=items.find((r:any)=>r.id===entry.item);assert(item);
  let prompt;
  if(entry.order==='blind-direct-program') prompt=contestant.referencePaths!.find(r=>r.name==='direct-program')!.prompt(item.question);
  else {
    const extractor=contestant.responseExtractor!;
    let response=extractor.local(item.question,item.response);
    if(response===undefined){
      const extracted=rows.find(r=>r.item===entry.item&&r.order==='quoted-extract');assert(extracted);
      response=extractor.parse(extracted.text,item.response);
    }
    if(response===undefined||!response.trim()) response=extractor.fallback!(item.question,item.response);
    prompt=contestant.codeCheck!.write(item.question,contestant.codeCheck!.targeted?response:undefined);
  }
  const key=promptKey('haiku',prompt),prior=rows.find(r=>r.key===key);
  const failure=`Transport missing: exhausted 300-second pilot recovery; ${error.message}; receipt ${entry.receipt}`;
  if(prior)assert.equal(prior.failure,failure);
  else await appendFile(path,JSON.stringify({key,model:'haiku',text:'',costUsd:0,bench:'longjudge-verify',contestant:contestant.id,item:entry.item,order:entry.order,failure})+'\n');
  evidence.push({...entry,key,failure,derivation:'Frozen prompt function and cached extraction; next unrecorded step of the interrupted item'});
}
await writeFile(`${base}/evidence/exhausted-pilot-transports.json`,JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify({terminalTransportRecords:evidence.length,providerCalls:0}));
