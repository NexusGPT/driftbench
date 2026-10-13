import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url)),r=join(root,'results');
const read=p=>existsSync(p)?readFileSync(p,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
const calls=read(join(r,'calls.jsonl'));
const models=Object.keys(JSON.parse(readFileSync(join(root,'freeze.json'),'utf8')).models);
const output={asOf:new Date().toISOString(),definition:'Schema re-ask is the frozen core ledger.reask after malformed output. It is distinct from a transport retry of a request with no returned answer.',models:{}};
for(const model of models){
  const phases={};
  for(const phase of ['pilot','fixtures','noise','validity','test']){
    const rows=read(join(r,`decisions-${phase}-${model}.jsonl`));
    const starts=calls.filter(x=>x.type==='start'&&x.model===model&&x.phase===phase);
    phases[phase]={
      ledgerPairs:rows.filter(x=>x.contestant==='ledger').length,
      coreReaskInvocations:rows.reduce((sum,x)=>sum+(x.reads??[]).reduce((a,y)=>a+(y.parseSteps??[]).filter(z=>z.ruleId==='ledger.reask').length,0),0),
      paidSchemaReaskReads:starts.filter(x=>x.contestant==='ledger'&&x.attempt===1&&(x.transportAttempt??1)===1).length,
      transportRetryAttempts:starts.filter(x=>(x.transportAttempt??1)>1).length,
      transportExhaustedReasksSuppressed:rows.reduce((sum,x)=>sum+(x.transportExhaustedReasksSuppressed??0),0),
      suppressedReasks:rows.reduce((sum,x)=>sum+(x.suppressedReasks??0),0),
      repairedAttempts:rows.reduce((sum,x)=>sum+(x.repairedAttempts??0),0),
    };
  }
  output.models[model]={phases,totals:Object.fromEntries(Object.keys(phases.pilot).map(k=>[k,Object.values(phases).reduce((sum,x)=>sum+x[k],0)]))};
}
writeFileSync(join(r,'reask-counts.json'),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(output));
