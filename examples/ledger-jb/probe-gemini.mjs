#!/usr/bin/env node
// One missing benchmark request, under its original key. No extra probe dataset.
import {appendFileSync,closeSync,openSync,readFileSync,unlinkSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Journal,hash,readJson,verifyFreeze,REQUIREMENTS} from './src/harness.mjs';
import {createTransport,judgePair} from './src/core-adapter.mjs';
const root=dirname(fileURLToPath(import.meta.url)),repo=resolve(root,'../..'),r=join(root,'results');
const argv=process.argv.slice(2),flag=name=>argv[argv.indexOf(name)+1];
if(!argv.includes('--execute')||!argv.includes('--core-dossier')||!argv.includes('--spend-ledger'))throw new Error('Explicit execute, core dossier and spend ledger required');
const freeze=readJson(join(root,'freeze.json'));
verifyFreeze(root,repo,freeze,readFileSync(flag('--core-dossier'),'utf8'));
const probe=freeze.billingResumption?.probe;if(!probe)throw new Error('Missing frozen probe');
const lock=join(r,'.paid-run.lock'),fd=openSync(lock,'wx');
const journal=new Journal(join(r,'calls.jsonl'),{capUsd:25,billingResumeKeys:freeze.billingResumption.rejectedKeys,appendSpend(row){
  appendFileSync(flag('--spend-ledger'),`| ${row.at} | ledger-jb top-up probe on missing ${row.phase} ${row.itemId} ${row.order} | ${row.model} | 1 call | ${row.costUsd.toFixed(8)} USD${row.costEstimated?' reserved, actual unknown':''} | lane liability ${journal.liability().toFixed(8)} USD |\n`);
}});
const item=readJson(join(root,`data/${probe.phase}.json`)).find(x=>x.id===probe.itemId);
if(!item)throw new Error('Frozen probe item absent');
const transport=await createTransport({model:probe.model,settings:freeze.models[probe.model]});
let result={at:new Date().toISOString(),success:false,originalRejectedKey:probe.key,freezeSha256:hash(readFileSync(join(root,'freeze.json')))};
try{
  await judgePair({item,requirements:REQUIREMENTS,model:probe.model,settings:freeze.models[probe.model],call:async(prompt,{order,attempt=0,schema})=>{
    const key=`${probe.phase}:${probe.model}:${probe.itemId}:${probe.repeat}:ledger:${order}:${attempt}:${hash(JSON.stringify({prompt,schema,settings:(freeze.cacheIdentityModels??freeze.models)[probe.model]}))}`;
    if(key!==probe.key)throw new Error('Probe must be the exact first missing frozen request');
    const response=await journal.transportCall(key,transport.maximumCostUsd(prompt,schema),()=>transport.call(prompt,{schema}),
      {phase:probe.phase,model:probe.model,itemId:probe.itemId,repeat:probe.repeat,contestant:'ledger',order,attempt,ownerTopupProbe:true},
      {maxAttempts:1,quotaBackoffMs:[]});
    result={...result,success:!response.transportFailure&&Boolean(response.text),responseKey:response.key,textLength:response.text?.length??0,costUsd:response.costUsd,costEstimated:response.costEstimated??false};
    throw new Error('PROBE_RECORDED');
  }});
}catch(error){if(error.message!=='PROBE_RECORDED')result.error=error.message;}
finally{
  result.finishedAt=new Date().toISOString();writeFileSync(join(r,'gemini-topup-probe.json'),JSON.stringify(result,null,2)+'\n');closeSync(fd);unlinkSync(lock);
}
console.log(JSON.stringify(result));if(!result.success)process.exitCode=1;
