// Runs the frozen MM design (codex/mm-judge 92d6e72, contract c576): native direct for every subset,
// chat-only three-sample vote. Imports that code read only; new calls append to a recordings COPY.
// Usage: tsx frozen-arm.mts SAMPLE.json OUT.jsonl RECORDINGS_COPY.jsonl CAP_USD DEADLINE_ISO
import { appendFile, readFile, open, unlink, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
const CM = '/Users/assem/Documents/GitHub/driftbench/.worktrees/astra-mm/research/astra-mm/frozen-source/examples/judge-benchmarks';
const { createCaller, Recordings, ProviderRefused, promptKey } = await import(`${CM}/src/call.ts`);
const { directItem } = await import(`${CM}/experiments/mm-cascade.ts`);
const { voteChat } = await import(`${CM}/experiments/mm-vote3.ts`);
const [samplePath, out, recPath, capArg, deadlineArg] = process.argv.slice(2);
const sample = JSON.parse(await readFile(samplePath!, 'utf8'));
const deadline = Date.parse(deadlineArg!);
const done = new Set<string>();
if (existsSync(out!)) for (const l of (await readFile(out!, 'utf8')).split('\n')) if (l.trim()) done.add(JSON.parse(l).id);
const recordings = await new Recordings(recPath!).load();
const refusalPath=recPath!.replace(/-haiku\.jsonl$/, '-refusals.jsonl');
const refusals=new Map<string,any>();
if(refusalPath!==recPath && existsSync(refusalPath)) for(const l of (await readFile(refusalPath,'utf8')).split('\n')) if(l.trim()){const r=JSON.parse(l);refusals.set(r.key,r);}
const receiptRows=existsSync(recPath!)?(await readFile(recPath!,'utf8')).split('\n').filter(Boolean).map(l=>JSON.parse(l)):[];
const already=receiptRows.reduce((v,r)=>v+r.costUsd,0)+[...refusals.values()].reduce((v,r)=>v+r.costUsd,0);
const caller = createCaller(recordings, { model: 'haiku', maxCallUsd: 0.05 }, { capUsd: Number(capArg)-already });
const inflight=new Map<string,Promise<any>>();
async function syncFile(path:string){const f=await open(path,'a');try{await f.sync();}finally{await f.close();}}

let fresh = 0, freshUsd = 0, replays = 0, next = 0, stop = false;
process.on('SIGTERM',()=>{stop=true;});process.on('SIGINT',()=>{stop=true;});
const slotDir='/Users/assem/Documents/GitHub/driftbench/.worktrees/astra-mm/research/astra-mm/tmp/call-slots';
await mkdir(slotDir,{recursive:true});
async function acquireSlot(){
 while(true){
  for(let i=0;i<4;i++){
   const path=`${slotDir}/${i}`;
   try{const f=await open(path,'wx');await f.writeFile(JSON.stringify({pid:process.pid,provider:'haiku',time:new Date().toISOString()}));await f.close();return async()=>{await unlink(path);};}
   catch(e:any){if(e.code!=='EEXIST')throw e;}
  }
  await new Promise(r=>setTimeout(r,100));
 }
}

const workers = Number(process.env.WORKERS ?? 1);
await Promise.all(Array.from({ length: workers }, async () => {
while (!stop && next < sample.length) {
  const item = sample[next++];
  if (done.has(item.id)) continue;
  if (Date.now() >= deadline) { console.log('deadline reached'); stop = true; break; }
  const ask = async (prompt: any, stage: string) => {
    if (Date.now() >= deadline) throw new Error('deadline reached');
    const key=promptKey('haiku',prompt);
    const refusal=refusals.get(key);if(refusal)throw new ProviderRefused('cached provider refusal',refusal.costUsd);
    const hit=recordings.get(key);
    if(hit){replays++;return hit;}
    if(inflight.has(key)){replays++;return await inflight.get(key);}
    const request=(async()=>{
      const release=await acquireSlot();
      try{
        const r=await caller.call(prompt,{bench:'mmeval',contestant:'opus-mm-frozen-replica',item:item.id,order:stage});
        await syncFile(recPath!);fresh++;freshUsd+=r.costUsd;return r;
      }catch(e:any){
        if(e instanceof ProviderRefused && refusalPath!==recPath){
          const r={key,item:item.id,order:stage,costUsd:e.costUsd,providerRefused:true};
          await appendFile(refusalPath,JSON.stringify(r)+'\n');await syncFile(refusalPath);refusals.set(key,r);freshUsd+=e.costUsd;
        }
        throw e;
      }finally{await release();}
    })();
    inflight.set(key,request);try{return await request;}finally{inflight.delete(key);}
  };
  let games: string[], refused = false;
  try {
    games = item.group === 'chat' ? (await voteChat(item, ask)).games : (await directItem(item, ask)).games;
  } catch (e: any) {
    if (e instanceof ProviderRefused) { refused = true; games = ['tie', 'tie']; }
    else { console.log('stop:', String(e?.message ?? e).slice(0, 200)); stop = true; break; }
  }
  await appendFile(out!, JSON.stringify({ id: item.id, group: item.group, label: item.label, games, providerRefused: refused }) + '\n');
  await syncFile(out!);
  if ((fresh + replays) % 20 < 3) console.log(`fresh ${fresh} calls ${freshUsd.toFixed(4)} USD, replays ${replays}`);
}
}));
console.log(`done: fresh ${fresh} calls, ${freshUsd.toFixed(5)} USD, replays ${replays}`);
