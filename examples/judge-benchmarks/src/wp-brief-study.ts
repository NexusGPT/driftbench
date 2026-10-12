import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCaller, Recordings } from './call';
import { loadBenchmark, type PairItem, splitOf } from './data';
import { deriveWritingBrief, parseWritingBrief, type WritingBrief } from './wp-decomposed';

// Request-only preparation does not execute the pending pairwise/rubric contract.
const arg = (s: string) => {
  const i = process.argv.indexOf(`--${s}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
if (arg('split') !== 'dev' || Number(arg('concurrency')) !== 1)
  throw new Error('Require --split dev --concurrency 1');
const cap = Number(arg('cap-usd')),
  out = arg('out');
if (!(cap > 0 && cap <= 8) || !out) throw new Error('Require --cap-usd in (0,8] and --out');
const bench = await loadBenchmark('longjudge-wp');
const items = bench.items.filter(
  (i): i is PairItem => i.kind === 'pair' && splitOf(bench.id, i.id) === 'dev',
);
const prompts = [...new Map(items.map((i) => [i.question, { id: i.id, question: i.question }])).values()];
const recordings = await new Recordings(
  fileURLToPath(new URL('../recordings/longjudge-wp/haiku.jsonl', import.meta.url)),
).load();
const caller = createCaller(
  recordings,
  { model: 'haiku', maxCallUsd: 0.1 },
  { capUsd: Math.max(0, cap - 0.1), replayOnly: process.argv.includes('--replay-only') },
);
const results: { id: string; question: string; brief: WritingBrief | undefined; costUsd: number }[] = [];
let stopped: string | undefined;
for (const item of prompts) {
  let costUsd = 0;
  try {
    if (Date.now() >= Date.parse('2026-10-13T04:55:00Z')) throw new Error('Authorized deadline reached');
    const p = deriveWritingBrief(item.question);
    const first = await caller.call(p, {
      bench: bench.id,
      contestant: 'driftbench-wp-decomposed',
      item: item.id,
      order: 'derive-request-only',
    });
    costUsd += first.costUsd;
    let brief = parseWritingBrief(first.text, item.question);
    if (!brief) {
      const repair = await caller.call(
        {
          ...p,
          user: `${p.user}\nThe previous response failed validation. Return the exact schema, and sourceQuote strings copied exactly from the request.`,
        },
        { bench: bench.id, contestant: 'driftbench-wp-decomposed', item: item.id, order: 'repair-brief' },
      );
      costUsd += repair.costUsd;
      brief = parseWritingBrief(repair.text, item.question);
    }
    results.push({ ...item, brief, costUsd });
    if (!brief) throw new Error('Request criteria invalid after repair');
    await mkdir(dirname(out), { recursive: true });
    await writeFile(
      out,
      JSON.stringify(
        {
          kind: 'request-only setup, no DEV accuracy',
          target: prompts.length,
          completed: results.length,
          newSpendUsd: caller.spent(),
          newCalls: caller.calls(),
          results,
        },
        null,
        2,
      ) + '\n',
    );
    process.stderr.write(
      `Briefs ${results.length}/${prompts.length}, new spend $${caller.spent().toFixed(4)}\n`,
    );
  } catch (e) {
    stopped = e instanceof Error ? e.message : String(e);
    break;
  }
}
const report = {
  kind: 'request-only setup, no DEV accuracy',
  target: prompts.length,
  completed: results.length,
  newSpendUsd: caller.spent(),
  newCalls: caller.calls(),
  replayed: caller.replayed(),
  stopped,
  results,
};
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(report, null, 2) + '\n');
const ledger = arg('ledger');
if (ledger)
  await appendFile(
    ledger,
    `| ${new Date().toISOString().slice(11, 16)} UTC | codex/wp-judge request-only criteria, dev ${results.length}/${prompts.length} prompts, concurrency 1, cap ${cap} | haiku | ${caller.calls()} | ${cap.toFixed(2)} | ${caller.spent().toFixed(4)} | +${caller.spent().toFixed(4)} |\n`,
  );
console.log(JSON.stringify({ ...report, results: undefined }, null, 2));
if (stopped) process.exitCode = 1;
