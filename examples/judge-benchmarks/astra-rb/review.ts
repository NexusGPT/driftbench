import {readFile,readdir,writeFile} from 'node:fs/promises';
import {machineDecision,executionBlocks,constraintBlocks} from './core';
const inputs=JSON.parse(await readFile('.cache/astra-rb/dev-inputs.json','utf8'));
const reviewed=[];
for(const f of await readdir('.cache/astra-rb/evidence')){
 const e=JSON.parse(await readFile('.cache/astra-rb/evidence/'+f,'utf8'));
 const eb=executionBlocks(e),cb=constraintBlocks(e);
 if(!machineDecision(eb)&&!machineDecision(cb))continue;
 const input=inputs.find((x:any)=>x.id===e.id);
 const p=JSON.parse(await readFile('.cache/astra-rb/plans/'+f,'utf8'));
 const row={id:e.id,question:input.question,criterion:input.criterion,a:input.a,b:input.b,
   executionDecision:machineDecision(eb),constraintDecision:machineDecision(cb),executionBlocks:eb,constraintBlocks:cb,
   plan:p.plan,contractAudit:e.contractAudit,execution:e.execution};
 reviewed.push(row);
}
await writeFile('.cache/astra-rb/separations-no-labels.json',JSON.stringify(reviewed,null,2)+'\n');
console.log(JSON.stringify(reviewed.map(r=>({id:r.id,execution:r.executionDecision,constraints:r.constraintDecision}))));
