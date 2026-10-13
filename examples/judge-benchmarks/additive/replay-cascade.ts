import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { contestantById } from '../../../../codex-verify/examples/judge-benchmarks/src/contestants';
import { runBenchmark } from '../../../../codex-verify/examples/judge-benchmarks/src/run';
import { CRITERIA } from '../../../../codex-verify/examples/judge-benchmarks/src/data';
const here=dirname(fileURLToPath(import.meta.url));
const items=JSON.parse(await readFile(join(here,'verify-dev-items.json'),'utf8'));
const frozen=JSON.parse(await readFile(join(here,'driftbench-verify-uncertainty-cascade.json'),'utf8')).contestants[0];
const original=contestantById('driftbench-verify-uncertainty-cascade');
const rows=[];
for (const item of items) {
  let uncertainty: boolean | null=null; let texts: string[]=[]; let initial: unknown;
  const contestant={...original, postPoint:{...original.postPoint!,when:(decision:any,t:readonly string[])=>{
    uncertainty=original.postPoint!.when(decision,t);texts=[...t];initial=decision;return uncertainty;
  }}};
  const report=await runBenchmark({bench:'longjudge-verify',model:'haiku',contestants:[contestant],items:[item],criterion:CRITERIA['longjudge-verify'],split:'dev',concurrency:1,replayOnly:true,recordingsDir:join(here,'recordings'),includeDecisions:true});
  const actual=report.contestants[0]?.decisions?.[0]?.pass;
  const expected=frozen.decisions.find((d:any)=>d.id===item.id).pass;
  if(actual!==expected || report.newCalls!==0 || report.failedCalls!==0) throw new Error(`Frozen replay mismatch ${item.id}`);
  rows.push({id:item.id,uncertainty,initial,texts,pass:actual,costUsd:report.contestants[0].costUsd,replayed:report.replayed});
}
await writeFile(join(here,'cascade-gates-dev.json'),JSON.stringify({rows,matched:rows.length,newCalls:0},null,2)+'\n');
console.log(`Exact frozen replay: ${rows.length}/95, zero fresh calls.`);
