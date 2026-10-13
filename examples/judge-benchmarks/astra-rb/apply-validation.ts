import {readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const rules=JSON.parse(await readFile('examples/judge-benchmarks/astra-rb/results/check-validation.json','utf8'));
let rejected=0;
for(const f of await readdir('.cache/astra-rb/evidence')){
 const path='.cache/astra-rb/evidence/'+f;
 const e=JSON.parse(await readFile(path,'utf8'));
 const p=JSON.parse(await readFile('.cache/astra-rb/plans/'+f,'utf8'));
 // Blind source review: the instruction requests one array but does not fix
 // output dimensionality. A generated 2D-only oracle cannot be a final gate.
 if(p.plan?.execution?.description?.includes('the candidate must return one 2D array made by vertically stacking')){
  e.executionRejected='Instruction does not specify output dimensionality or stacking axis; the generated 2D-only oracle adds an unrequested requirement.';
  e.executionAbstention='oracle_shape_underspecified';
 }
 // Standard browser APIs absent in the selected emulator are infrastructure
 // failures. Preserve observations, but never turn these into candidate failures.
 if(JSON.stringify(e.execution??[]).includes("Cannot read properties of undefined (reading 'job-title')") && JSON.stringify(e).includes('linkedom')){
  e.executionRejected='The linkedom emulator lacks standard HTMLFormElement.elements; a fictional jsdom control verifies the required API.';
  e.executionAbstention='browser_emulator_api_gap';
 }
 for(const c of e.checks){
  c.programHash=createHash('sha256').update(p.plan.checks[c.index].python).digest('hex');
  const rejection=rules.find((x:any)=>x.programHash===c.programHash&&!x.valid);
  if(rejection){c.validationRejected=rejection.fixture.reason;rejected++;}
 }
 await writeFile(path,JSON.stringify(e,null,2)+'\n');
}
console.log(JSON.stringify({rejected}));
