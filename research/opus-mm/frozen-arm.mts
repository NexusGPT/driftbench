// Runs the frozen MM design (codex/mm-judge 92d6e72, contract c576): native direct for every subset,
// chat-only three-sample vote. Imports that code read only; new calls append to a recordings COPY.
// Usage: tsx frozen-arm.mts SAMPLE.json OUT.jsonl RECORDINGS_COPY.jsonl CAP_USD DEADLINE_ISO
import { appendFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
const CM = '/Users/assem/Documents/GitHub/driftbench/.worktrees/codex-mm/examples/judge-benchmarks';
const { createCaller, Recordings, ProviderRefused, promptKey } = await import(`${CM}/src/call.ts`);
const { directItem } = await import(`${CM}/experiments/mm-cascade.ts`);
const { voteChat } = await import(`${CM}/experiments/mm-vote3.ts`);
const [samplePath, out, recPath, capArg, deadlineArg] = process.argv.slice(2);
const sample = JSON.parse(await readFile(samplePath!, 'utf8'));
const deadline = Date.parse(deadlineArg!);
const done = new Set<string>();
if (existsSync(out!)) for (const l of (await readFile(out!, 'utf8')).split('\n')) if (l.trim()) done.add(JSON.parse(l).id);
const recordings = await new Recordings(recPath!).load();
const caller = createCaller(recordings, { model: 'haiku', maxCallUsd: 0.05 }, { capUsd: Number(capArg) });
let fresh = 0, freshUsd = 0, replays = 0;
for (const item of sample) {
  if (done.has(item.id)) continue;
  if (Date.now() >= deadline) { console.log('deadline reached'); break; }
  const ask = async (prompt: any, stage: string) => {
    if (Date.now() >= deadline) throw new Error('deadline reached');
    const hit = recordings.get(promptKey('haiku', prompt));
    const r = await caller.call(prompt, { bench: 'mmeval', contestant: 'opus-mm-frozen-replica', item: item.id, order: stage });
    if (hit) replays++; else { fresh++; freshUsd += r.costUsd; }
    return r;
  };
  let games: string[], refused = false;
  try {
    games = item.group === 'chat' ? (await voteChat(item, ask)).games : (await directItem(item, ask)).games;
  } catch (e: any) {
    if (e instanceof ProviderRefused) { refused = true; games = ['tie', 'tie']; }
    else { console.log('stop:', String(e?.message ?? e).slice(0, 200)); break; }
  }
  await appendFile(out!, JSON.stringify({ id: item.id, group: item.group, label: item.label, games, providerRefused: refused }) + '\n');
  if ((fresh + replays) % 20 < 3) console.log(`items ${done.size}+, fresh ${fresh} calls ${freshUsd.toFixed(4)} USD, replays ${replays}`);
}
console.log(`done: fresh ${fresh} calls, ${freshUsd.toFixed(5)} USD, replays ${replays}`);
