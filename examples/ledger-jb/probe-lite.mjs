#!/usr/bin/env node
// Exactly one first-pilot request. Its answered response is reused by the full cell.
import {appendFileSync,closeSync,openSync,readFileSync,unlinkSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Journal,hash,readJson,verifyFreeze,REQUIREMENTS} from './src/harness.mjs';
import {createTransport,judgePair} from './src/core-adapter.mjs';
const root=dirname(fileURLToPath(import.meta.url)),repo=resolve(root,'../..'),r=join(root,'results');
const argv=process.argv.slice(2),flag=name=>argv[argv.indexOf(name)+1];
if(!argv.includes('--execute')||!argv.includes('--core-dossier')||!argv.includes('--spend-ledger'))throw new Error('Explicit execute, core dossier and spend ledger required');
const freeze=readJson(join(root,'freeze.json')),model='gemini-3.5-flash-lite';
verifyFreeze(root,repo,freeze,readFileSync(flag('--core-dossier'),'utf8'));
if(!freeze.additionalCells?.[model]||freeze.modelCapsUsd?.[model]!==6)throw new Error('Missing frozen new-cell authorization and cap');
if(Date.now()>=Date.parse(freeze.modelLastCallCutoff?.[model]??freeze.lastCallCutoff))throw new Error('Frozen last-call cutoff reached');
const lock=join(r,'.paid-run.lock'),fd=openSync(lock,'wx');
const journal=new Journal(join(r,'calls.jsonl'),{capUsd:25,modelCapsUsd:freeze.modelCapsUsd,billingResumeKeys:freeze.billingResumption.rejectedKeys,appendSpend(row){
  appendFileSync(flag('--spend-ledger'),`| ${row.at} | ledger-jb new-cell first-pilot probe | ${row.model} | 1 call | ${row.costUsd.toFixed(8)} USD${row.costEstimated?' reserved, actual unknown':''} | cell liability ${journal.liability(model).toFixed(8)} of 6 USD |\n`);
}});
const item=readJson(join(root,'data/pilot.json'))[0],transport=await createTransport({model,settings:freeze.models[model]});
let result={at:new Date().toISOString(),model,reasoningRequested:freeze.models[model].reasoning,success:false,freezeSha256:hash(readFileSync(join(root,'freeze.json')))};
try{
  await judgePair({item,requirements:REQUIREMENTS,model,settings:freeze.models[model],call:async(prompt,{order,attempt=0,schema})=>{
    if(order!=='AB'||attempt!==0)throw new Error('Probe must issue only the first pilot read');
    const key=`pilot:${model}:${item.id}:0:ledger:${order}:${attempt}:${hash(JSON.stringify({prompt,schema,settings:(freeze.cacheIdentityModels??freeze.models)[model]}))}`;
    const response=await journal.transportCall(key,transport.maximumCostUsd(prompt,schema),()=>transport.call(prompt,{schema}),
      {phase:'pilot',model,itemId:item.id,repeat:0,contestant:'ledger',order,attempt,newCellProbe:true},{maxAttempts:1,quotaBackoffMs:[]});
    result={...result,success:!response.transportFailure&&Boolean(response.text),responseKey:response.key,textLength:response.text?.length??0,costUsd:response.costUsd,costEstimated:response.costEstimated??false,error:response.error??null,reasoningApplied:!response.transportFailure?freeze.models[model].reasoning:null};
    throw new Error('PROBE_RECORDED');
  }});
}catch(error){if(error.message!=='PROBE_RECORDED')result.error=error.message;}
finally{
  result.finishedAt=new Date().toISOString();writeFileSync(join(r,'gemini-lite-probe.json'),JSON.stringify(result,null,2)+'\n');closeSync(fd);unlinkSync(lock);
}
console.log(JSON.stringify(result));if(!result.success)process.exitCode=1;
