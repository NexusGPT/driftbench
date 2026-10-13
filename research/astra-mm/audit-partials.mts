import {readFileSync,writeFileSync} from 'node:fs';
import {directItem} from './frozen-source/examples/judge-benchmarks/experiments/mm-cascade.ts';
import {voteChat} from './frozen-source/examples/judge-benchmarks/experiments/mm-vote3.ts';
import {promptKey,Recordings} from './frozen-source/examples/judge-benchmarks/src/call.ts';
const root='research/astra-mm/data';
const recordings=await new Recordings(`${root}/haiku.jsonl`).load();
const sample=JSON.parse(readFileSync(`${root}/dev.json`,'utf8'));
const checkpoint=JSON.parse(readFileSync(`${root}/checkpoint.json`,'utf8'));
const output=[];
for(const id of checkpoint.likelyInterruptedBaseItemIds){
 const item=sample.find((r:any)=>r.id===id);const replayed:any[]=[];let firstMissing:any;
 const ask=async(prompt:any,stage:string)=>{
  const key=promptKey('haiku',prompt);const hit=recordings.get(key);
  if(!hit){firstMissing={key,stage};throw Error('offline cache miss');}
  replayed.push({key,stage});return hit;
 };
 try{await(item.group==='chat'?voteChat(item,ask):directItem(item,ask));}catch(e){if(!firstMissing)throw e;}
 output.push({id,replayed,firstMissing});
}
writeFileSync(`${root}/resume-partial-audit.json`,JSON.stringify({time:new Date().toISOString(),modelCalls:0,items:output},null,2)+'\n');
console.log(JSON.stringify(output));
