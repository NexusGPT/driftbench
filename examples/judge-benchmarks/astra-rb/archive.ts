import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
const out='examples/judge-benchmarks/astra-rb/results';
await mkdir(out+'/evidence',{recursive:true});
const plans=[];
const safe=(x:any)=>JSON.stringify(x,null,2).replaceAll(resolve('.'),'<worktree>').replaceAll(homedir(),'<home>');
for(const f of (await readdir('.cache/astra-rb/plans')).sort()){
 const p=JSON.parse(await readFile('.cache/astra-rb/plans/'+f,'utf8'));
 plans.push(p);
 const e=JSON.parse(await readFile('.cache/astra-rb/evidence/'+f,'utf8'));
 await writeFile(out+'/evidence/'+f,safe(e)+'\n');
}
await writeFile(out+'/plans.json',safe(plans)+'\n');
const inputs=JSON.parse(await readFile('.cache/astra-rb/dev-inputs.json','utf8'));
const manifest=inputs.map((r:any)=>({id:r.id,group:r.group,questionSha256:createHash('sha256').update(r.question).digest('hex'),aSha256:createHash('sha256').update(r.a).digest('hex'),bSha256:createHash('sha256').update(r.b).digest('hex')}));
await writeFile(out+'/input-hashes.json',JSON.stringify(manifest,null,2)+'\n');
for(const name of ['probe.jsonl','runtime-probe.jsonl','probe-pythonextras.json','runtime-manifest.json','dotnet-probe.json']){
 try{await writeFile(out+'/'+name,(await readFile('.cache/astra-rb/'+name,'utf8')).replaceAll(resolve('.'),'<worktree>').replaceAll(homedir(),'<home>'));}catch(e){if((e as any).code!=='ENOENT')throw e;}
}
await writeFile(out+'/runtime-node-package.json',await readFile('.cache/astra-rb/package.json','utf8'));
console.log(JSON.stringify({plans:plans.length,inputs:manifest.length}));
