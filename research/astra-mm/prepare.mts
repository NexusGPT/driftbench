import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {contestantById} from '/Users/assem/Documents/GitHub/driftbench/.worktrees/codex-mm/examples/judge-benchmarks/src/contestants.ts';
import {CRITERIA} from '/Users/assem/Documents/GitHub/driftbench/.worktrees/codex-mm/examples/judge-benchmarks/src/data.ts';
import {createJevJudge} from '/Users/assem/Documents/GitHub/driftbench/.worktrees/codex-mm/packages/judges/src/clients/system1.ts';
import {pairRequest} from './council-pairs.ts';
const sample=JSON.parse(readFileSync(process.argv[2],'utf8'));
const contestant=contestantById('driftbench');
const tasks:any[]=[];
for(const item of sample){
 for(const provider of ['openai','gemini']) for(const order of ['AB','BA']){
  const prompt=contestant.pair!({question:item.question,a:order==='AB'?item.a:item.b,b:order==='AB'?item.b:item.a,criterion:CRITERIA.mmeval});
  const model=provider==='openai'?'gpt-6-luna':'gemini-3.8-flash';
  const body=provider==='openai'?{model,reasoning_effort:'low',messages:[{role:'system',content:prompt.system},{role:'user',content:prompt.user}]}:{systemInstruction:{parts:[{text:prompt.system}]},contents:[{role:'user',parts:[{text:prompt.user}]}],generationConfig:{thinkingConfig:{thinkingLevel:'low'}}};
  tasks.push({id:item.id,provider,model,order,body});
 }
 for(const frame of [0,1,2]){
  const client=createJevJudge({env:{JEV_URL:'https://api.typesafe.ai/v1/systemone',JEV_API_KEY:'capture-only'},maxRetries:0,fetch:async(url:any,init:any)=>{
   tasks.push({id:item.id,provider:'jev',model:'jev-latest',order:String(frame),body:JSON.parse(init.body)});
   return new Response(JSON.stringify({answers:{verdict:{noul:0.5}}}),{status:200});
  }} as any);
  await client.judge(pairRequest({...item,criterion:CRITERIA.mmeval},frame===1,frame===2?'prefer':'better'));
 }
}
for(const t of tasks)t.key=createHash('sha256').update(JSON.stringify([t.provider,t.model,t.body])).digest('hex');
writeFileSync(process.argv[3],tasks.map(t=>JSON.stringify(t)).join('\n')+'\n');
console.log(JSON.stringify({items:sample.length,tasks:tasks.length}));
