// Usage: JEV_ROUTE=typesafe tsx jev-experiments/run3.ts <spec> ...
//   cand:<run>[:dev|test]   arm g block-level questions      pair:<run>[:dev|test]  arm h pair questions
//   <variant>:<run>[:dev|test]  a per-unit design of phase 2 (base, a-rules, b-decomp, c-para1..3, d-none, d-role) on the span corpus
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { budget, config, loadCassette } from './src/jev';
import { dir, type Ctx } from './src/arms';
import { VARIANTS, runVariant } from './src/p2';
import { runCands, runGVariants, runHVariants, runPairs, SWINS, U3 } from './src/p3';

const scratch = process.env.JEV_SCRATCH || join(dir, 'scratch');
mkdirSync(scratch, { recursive: true });
const replay = process.env.JEV_MODE === 'replay';
const cfg = config(dir, { cassettePath: replay ? join(dir, 'cassette3.jsonl') : join(scratch, 'cassette3.raw.jsonl'), budgetPath: join(scratch, 'budget3.json'), maxCalls: 3000 });
const ctx: Ctx = { cfg, cassette: loadCassette(cfg.cassettePath), conc: Number(process.env.JEV_CONC || 4) };
if (process.argv[2] === 'info') { console.log('windows', SWINS.length, 'leaves', U3.length, 'candidates', SWINS.reduce((a, w) => a + w.cands.length, 0), 'max leaves/window', Math.max(...SWINS.map((w) => w.leaves.length))); process.exit(0); }
if (process.argv[2] === 'show') { const w = SWINS[Number(process.argv[3] ?? 0)]!; console.log(w.state); console.log(w.cands.map((c) => `${c.disp} ${c.kind} leaves ${c.leaves[0]}-${c.leaves.at(-1)} :: ${c.desc}`).join('\n')); process.exit(0); }
for (const spec of process.argv.slice(2)) {
  const [id, run, sub] = spec.split(':');
  const subset = sub ? new Set([sub]) : undefined;
  let line: string;
  if (id === 'cand') { const r = await runCands(ctx, Number(run ?? 1), subset); line = `${r.runId}: ${r.calls.length} calls, missing ${r.missing}/${r.asked}`; }
  else if (id === 'gvar') { const r = await runGVariants(ctx, Number(run ?? 1)); line = `${r.runId}: ${r.calls.length} calls, missing ${r.missing}/${r.asked}`; }
  else if (id === 'hvar') { const r = await runHVariants(ctx, Number(run ?? 1)); line = `${r.runId}: ${r.calls.length} calls, missing ${r.missing}/${r.asked}`; }
  else if (id === 'pair') { const r = await runPairs(ctx, Number(run ?? 1), subset); line = `${r.runId}: ${r.calls.length} calls, missing ${r.missing}/${r.asked}`; }
  else { const v = VARIANTS.find((x) => x.id === id); if (!v) throw new Error(`unknown variant ${id}`); const r = await runVariant(ctx, v, Number(run ?? 1), sub ? U3.filter((u) => u.split === sub) : U3, sub ? `-${sub}` : '', 'results3'); line = `${r.runId}: ${r.calls.length} calls, missing ${r.missing}/${r.asked}`; }
  const b = budget(cfg.budgetPath);
  console.log(`${spec} -> ${line}; calls used ${b.calls} errors ${b.errors} tokens ${b.tokensIn}/${b.tokensOut}`);
}
