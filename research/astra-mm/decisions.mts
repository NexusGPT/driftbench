// Score only completed cohorts. All provider parsers and pair-order rules are the source harness's.
import {readFileSync,writeFileSync} from 'node:fs';
import {contestantById} from '/Users/assem/Documents/GitHub/driftbench/.worktrees/codex-mm/examples/judge-benchmarks/src/contestants.ts';
import {outcomeFromProbability} from '/Users/assem/Documents/GitHub/driftbench/.worktrees/codex-mm/packages/judges/src/contract.ts';
const root='research/astra-mm/data',prefix=process.argv[2]??'dev';
const rows=(file:string)=>readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));
const sample=JSON.parse(readFileSync(`${root}/${prefix}.json`,'utf8'));
const base=new Map(rows(`${root}/${prefix==='dev'?'base':prefix+'-base'}.jsonl`).map(r=>[r.id,r]));
const calls=rows(`${root}/${prefix}-calls.jsonl`);
const by=new Map(calls.map(r=>[`${r.id}:${r.provider}:${r.order}`,r]));
const parse=contestantById('driftbench').parsePair!;
const flip=(s:string)=>s==='A'?'B':s==='B'?'A':'tie';
export const majority=(ss:string[],threshold?:number)=>{
 const a=ss.filter(s=>s==='A').length,b=ss.filter(s=>s==='B').length;
 return threshold===undefined?(a>b?'A':b>a?'B':'tie'):(a>=threshold?'A':b>=threshold?'B':'tie');
};
const text=(r:any)=>r.provider==='openai'?(r.payload.choices?.[0]?.message?.content??''):(r.payload.candidates?.[0]?.content?.parts??[]).filter((p:any)=>!p.thought).map((p:any)=>p.text??'').join('');
const sc=(g:string[],label:string,refused=false)=>refused?0:g.reduce((v,x)=>v+(x===label?1:x==='tie'?.5:0),0)/g.length;
const out:any[]=[];
for(const item of sample){
 const f:any=base.get(item.id);if(!f)throw Error(`Missing base ${item.id}`);
 const escalate=f.providerRefused||!(f.games.length===2&&f.games[0]===f.games[1]&&['A','B'].includes(f.games[0]));
 let games=f.games,refused=f.providerRefused,seats:any={};
 if(escalate){
  for(const p of ['openai','gemini','jev']){
   const orders=p==='jev'?['0','1','2']:['AB','BA'];
   const votes=orders.map(order=>{
    const r=by.get(`${item.id}:${p}:${order}`);if(!r)throw Error(`Missing ${item.id} ${p} ${order}`);
    let vote:string;
    if(p==='jev'){
     const n=r.payload.answers?.verdict?.noul;
     const o=typeof n==='number'?outcomeFromProbability(n):'inconclusive';
     vote=o==='pass'?'A':o==='fail'?'B':'tie';
    }else vote=parse(text(r));
    return order==='BA'||order==='1'?flip(vote):vote;
   });
   seats[p]={games:votes,vote:majority(votes,p==='jev'?2:undefined)};
  }
  const c=majority(Object.values(seats).map((r:any)=>r.vote),2);
  if(c!=='tie'){games=[c,c];refused=false;}
 }
 out.push({id:item.id,group:item.group,language:item.language,label:item.label,baseGames:f.games,baseRefused:f.providerRefused,escalated:escalate,seats,games,providerRefused:refused,base:sc(f.games,item.label,f.providerRefused),cascade:sc(games,item.label,refused)});
}
writeFileSync(`${root}/${prefix}-decisions.jsonl`,out.map(r=>JSON.stringify(r)).join('\n')+'\n');
console.log(JSON.stringify({items:out.length,escalated:out.filter(r=>r.escalated).length}));
