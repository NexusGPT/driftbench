import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createCaller, Recordings } from './call';
import { readRecordingRows } from './recording-files';
import { jsonObjects } from './json';
import { PLAN } from './prompts';

const root = resolve('examples/judge-benchmarks/astra-rb');
const cache = resolve('.cache/astra-rb');
const ledger = '/private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad/spend-ledger.md';
const all = JSON.parse(await readFile(cache+'/dev-inputs.json', 'utf8'));
const ties = new Set(JSON.parse(await readFile(root+'/excluded-ties.json', 'utf8')));
const file = root+'/recordings/haiku.jsonl';
const spent = (await readRecordingRows(file)).reduce((s,r)=>s+r.costUsd,0);
const caller = createCaller(await new Recordings(file).load(), {model:'haiku', timeoutMs:100000, maxCallUsd:0.05},
 {capUsd:11.6-spent, deadlineMs: Date.parse('2026-10-13T04:35:00Z')});
const routed = all.filter((r:any)=>!ties.has(r.id) && (['code','mbpp'].includes(r.group) ||
  /\b(word|sentence|paragraph|keyword|letters?|characters?|exactly|at least|at most|no more|fewer|numbered|bullet|JSON|code block|lowercase|uppercase|capitalize|punctuation|begin|start|end|contain|mention|include|format|length|without)\b/i.test(r.question+'\n'+r.criterion)));
await mkdir(cache+'/plans',{recursive:true});
let cursor=0,done=0;
async function worker(){
 while(cursor<routed.length){
  const r=routed[cursor++];
  const result=await caller.call({system:PLAN,user:JSON.stringify({question:r.question,rubric:r.criterion,code_requested:['code','mbpp'].includes(r.group)})},
  {bench:'rubricbench',contestant:'astra-plan-v1',item:r.id});
  const plan:any=jsonObjects(result.text).find(x=>Array.isArray(x.checks)&&'execution'in x);
  await writeFile(cache+'/plans/'+r.id+'.json',JSON.stringify({id:r.id,key:result.key,costUsd:result.costUsd,plan:plan??null},null,2)+'\n');
  console.log(JSON.stringify({id:r.id,done:++done,total:routed.length,checks:plan?.checks?.length,execution:!!plan?.execution,spent:caller.spent()}));
 }
}
try{await Promise.all([worker(),worker()]);}
finally{
 await appendFile(ledger,'| '+new Date().toISOString()+' | research/astra-rb-exec question-only generators, DEV, excluded 55 ties, 2 calls maximum | haiku | '+caller.calls()+' | 12.00 task cap | '+caller.spent().toFixed(8)+' | cumulative '+(spent+caller.spent()).toFixed(8)+'; own worktree |\n');
}
