import { readdir, readFile,writeFile,mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { sandboxRun } from './sandbox';
const root=resolve('examples/judge-benchmarks/astra-rb');
const cache=resolve('.cache/astra-rb');
const script=await readFile(root+'/preflight.py','utf8');
await mkdir(cache+'/preflight',{recursive:true});
const names=(await readdir(cache+'/plans')).sort();
let cursor=0,done=0;
async function worker(){
  while(cursor<names.length){
    const name=names[cursor++];
    const row=JSON.parse(await readFile(cache+'/plans/'+name,'utf8'));
    if(!row.plan)continue;
    const planHash=createHash('sha256').update(JSON.stringify([row.plan,script])).digest('hex');
    try {const cached=JSON.parse(await readFile(cache+'/preflight/'+name,'utf8'));if(cached.planHash===planHash)continue;}catch{}
    let result:any;
    if(!row.plan.execution && row.plan.checks.length===0)result={output:{inputs:[],checks:[]},status:'no_machine_contract'};
    else result=await sandboxRun({'plan.json':JSON.stringify(row.plan),'preflight.py':script},'python3 -I preflight.py',25000,1048576);
    await writeFile(cache+'/preflight/'+name,JSON.stringify({...result,planHash},null,2)+'\n');
    console.log(JSON.stringify({id:row.id,done:++done,total:names.length,inputs:result.output?.inputs?.length}));
  }
}
await Promise.all([worker(),worker(),worker(),worker()]);
