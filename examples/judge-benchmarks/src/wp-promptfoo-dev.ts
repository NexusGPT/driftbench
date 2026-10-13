import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createCaller, Recordings, promptKey } from './call';
import { contestantById, type PairDecision, type Prompt } from './contestants';
import { loadBenchmark, splitOf, type PairItem } from './data';
import { majorityPair } from './run';
import { pairGames, scorePairs } from './score';
import { writingRowKey } from './wp-study';

const template = await readFile(new URL('./wp-promptfoo-port/select-best.njk', import.meta.url), 'utf8');
const upstream = contestantById('promptfoo');

/** Verbatim upstream wording, with the same two-output expansion as the benchmark adapter. */
export function promptfooWriting(question: string, a: string, b: string, criterion: string): Prompt {
  const loop = '{% for output in outputs %}\n<Text index="{{ loop.index0 }}">\n{{ output }}\n</Text>\n{% endfor %}';
  if (!template.includes(loop)) throw new Error('Unexpected upstream template');
  return {
    system: template.replace(loop, '<Text index="0">\n{{a}}\n</Text>\n\n<Text index="1">\n{{b}}\n</Text>')
      .replace('{{criteria}}', `${criterion} The question: ${question}`)
      .replace('{{a}}', a).replace('{{b}}', b),
    user: 'Output the index now.',
  };
}

const flip = (d: PairDecision): PairDecision => d === 'A' ? 'B' : d === 'B' ? 'A' : 'tie';
const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i+1]; };
type Measured = { rowKey: string; id: string; group: string; label: 'A' | 'B'; missing: number; games: PairDecision[]; costUsd: number };

async function main() {
  if (arg('split') !== 'dev') throw new Error('Only DEV is authorized for this round');
  const cap = Number(arg('cap-usd'));
  if (!(cap > 0.1 && cap <= 1.5)) throw new Error('Invocation cap must be between 0.1 and 1.5 USD');
  const out = arg('out');
  if (!out) throw new Error('--out required');
  const bench = await loadBenchmark('longjudge-wp');
  const items = bench.items.filter((i): i is PairItem => i.kind === 'pair' && splitOf(bench.id, i.id) === 'dev');
  if (items.length !== 90) throw new Error('Unexpected DEV population');
  const recordings = await new Recordings(fileURLToPath(new URL('../recordings/longjudge-wp/haiku.jsonl', import.meta.url))).load();
  const caller = createCaller(recordings, {model:'haiku',maxCallUsd:0.1}, {capUsd:cap-0.1,replayOnly:process.argv.includes('--replay-only')});
  const baseRows: Measured[] = [], pooledRows: (Measured & {orderMajorities: PairDecision[]; ballots: PairDecision[][]; raw: string[][]; keys: string[][]})[] = [];
  let totalBaseCost=0, totalPooledCost=0;
  for (const item of items) {
    const prompts = [promptfooWriting(item.question,item.a,item.b,bench.criterion),promptfooWriting(item.question,item.b,item.a,bench.criterion)];
    for (let i=0;i<2;i++) {
      const expected=upstream.pair?.({question:item.question,a:i===0?item.a:item.b,b:i===0?item.b:item.a,criterion:bench.criterion});
      if (JSON.stringify(prompts[i])!==JSON.stringify(expected)) throw new Error('Port differs from default benchmark prompt');
    }
    const raw: string[][] = [[],[]], ballots: PairDecision[][] = [[],[]], keys: string[][]=[[],[]];
    let baseCost=0, pooledCost=0;
    for(let order=0;order<2;order++) for(let sample=0;sample<3;sample++) {
      if(Date.now()>Date.parse('2026-10-13T04:50:00Z')) throw new Error('Deadline reached');
      const original=prompts[order]!;
      const p=sample===0?original:{...original,user:`${original.user}\n\n(Independent judgement ${sample+1} of 3.)`};
      const r=await caller.call(p,{bench:bench.id,contestant:'wp-promptfoo-pooled3-dev',item:item.id,order:`${order===0?'AB':'BA'}#${sample+1}`});
      raw[order]!.push(r.text);keys[order]!.push(promptKey('haiku',p));ballots[order]!.push(upstream.parsePair?.(r.text)??'tie');
      pooledCost+=r.costUsd;if(sample===0)baseCost+=r.costUsd;
    }
    const games=pairGames(ballots[0]![0]!,ballots[1]![0]!);
    const normalized=[...ballots[0]!,...ballots[1]!.map(flip)];
    const pooled=majorityPair(normalized);
    const meta={rowKey:writingRowKey(item),id:item.id,group:item.group,label:item.label,missing:normalized.filter(x=>x==='tie').length};
    baseRows.push({...meta,missing:games.filter(x=>x==='tie').length,games,costUsd:baseCost});
    pooledRows.push({...meta,games:[pooled,pooled],orderMajorities:pairGames(majorityPair(ballots[0]!),majorityPair(ballots[1]!)),ballots,raw,keys,costUsd:pooledCost});
    totalBaseCost+=baseCost;totalPooledCost+=pooledCost;
    if(baseRows.length%10===0) console.error(`promptfoo DEV ${baseRows.length}/90; new spend $${caller.spent().toFixed(4)}`);
    await writeFile(`${out}.progress.json`,JSON.stringify({completed:baseRows.length,newCalls:caller.calls(),newSpendUsd:caller.spent()})+'\n');
  }
  const summarize=(rows: typeof baseRows,costUsd:number)=>({summary:scorePairs(bench.id,rows.map(r=>({item:items.find(i=>writingRowKey(i)===r.rowKey)!,games:r.games,missing:r.missing}))),perOrder:[0,1].map(i=>({correct:rows.filter(r=>r.games[i]===r.label).length,n:rows.length})),costPer100:costUsd/items.length*100,costUsd,results:rows});
  const result={split:'dev',items:90,complete:true,templateVerifiedAgainstDefault:true,base:summarize(baseRows,totalBaseCost),pooled:summarize(pooledRows,totalPooledCost),newCalls:caller.calls(),newSpendUsd:caller.spent(),replayed:caller.replayed()};
  await writeFile(out,JSON.stringify(result,null,2)+'\n');
  if(arg('ledger')) await appendFile(arg('ledger')!,`| ${new Date().toISOString()} | codex/wp-judge promptfoo verbatim plus pooled-three-per-order DEV only, 90 pairs; no TEST | haiku | ${caller.calls()} | ${cap.toFixed(2)} | ${caller.spent().toFixed(8)} | +${caller.spent().toFixed(8)} |\n`);
  console.log(JSON.stringify({...result,base:{...result.base,results:undefined},pooled:{...result.pooled,results:undefined}},null,2));
}
if(process.argv[1]===fileURLToPath(import.meta.url)) await main();
