// Replays base receipts offline to identify the exact prompt keys and recorded inference costs used.
import {readFileSync,writeFileSync} from 'node:fs';
import {directItem} from './frozen-source/examples/judge-benchmarks/experiments/mm-cascade.ts';
import {voteChat} from './frozen-source/examples/judge-benchmarks/experiments/mm-vote3.ts';
import {promptKey,Recordings} from './frozen-source/examples/judge-benchmarks/src/call.ts';
const root='research/astra-mm/data';
const sample=JSON.parse(readFileSync(`${root}/dev.json`,'utf8'));
const rows=(p:string)=>readFileSync(p,'utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));
const base=new Map(rows(`${root}/base.jsonl`).map(r=>[r.id,r]));
const rec=await new Recordings(`${root}/haiku.jsonl`).load();
const out=[];
for(const item of sample){
 const f:any=base.get(item.id);if(!f)throw Error(`Missing base ${item.id}`);
 const used:any[]=[];let missing:any=null,result:any;
 const ask=async(prompt:any,stage:string)=>{
  const key=promptKey('haiku',prompt),r=rec.get(key);
  if(!r){missing={key,stage};throw Error('offline cache miss');}
  used.push({key,stage,costUsd:r.costUsd});return r;
 };
 try{result=await(item.group==='chat'?voteChat(item,ask):directItem(item,ask));}catch(e){if(!missing)throw e;}
 if(!f.providerRefused){if(missing)throw Error(`Unrefused base cache miss ${item.id} ${JSON.stringify(missing)}`);if(JSON.stringify(result.games)!==JSON.stringify(f.games))throw Error(`Replay mismatch ${item.id}`);}
 out.push({id:item.id,group:item.group,used,providerRefused:f.providerRefused,missing,games:f.games});
}
writeFileSync(`${root}/base-replay-audit.json`,JSON.stringify(out)+'\n');
console.log(JSON.stringify({items:out.length,validated:out.filter(r=>!r.providerRefused).length,providerRefusals:out.filter(r=>r.providerRefused).length,missingReceipt:out.filter(r=>r.missing).length}));
