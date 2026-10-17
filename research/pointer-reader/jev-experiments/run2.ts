// Usage: JEV_ROUTE=typesafe tsx jev-experiments/run2.ts <variant>:<run>[:dev|test] ...
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { budget, config, loadCassette } from './src/jev';
import { dir, type Ctx } from './src/arms';
import { runVariant, U, VARIANTS } from './src/p2';

const scratch = process.env.JEV_SCRATCH || join(dir, 'scratch');
mkdirSync(scratch, { recursive: true });
const replay = process.env.JEV_MODE === 'replay';
const cfg = config(dir, { cassettePath: replay ? join(dir, 'cassette2.jsonl') : join(scratch, 'cassette2.raw.jsonl'), budgetPath: join(scratch, 'budget2.json'), maxCalls: 3000 });
const ctx: Ctx = { cfg, cassette: loadCassette(cfg.cassettePath), conc: Number(process.env.JEV_CONC || 4) };
for (const spec of process.argv.slice(2)) {
  const [id, run, sub] = spec.split(':');
  const v = VARIANTS.find((x) => x.id === id);
  if (!v) throw new Error(`unknown variant ${id}`);
  const subset = sub ? U.filter((u) => u.split === sub) : U;
  const r = await runVariant(ctx, v, Number(run ?? 1), subset, sub ? `-${sub}` : '');
  const b = budget(cfg.budgetPath);
  console.log(`${spec} -> ${r.runId}: ${r.calls.length} calls, missing ${r.missing}/${r.asked}, calls used ${b.calls} errors ${b.errors} tokens ${b.tokensIn}/${b.tokensOut}`);
}
