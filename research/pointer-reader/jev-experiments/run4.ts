// Usage: JEV_ROUTE=typesafe tsx jev-experiments/run4.ts <design>:<pass> ...    or:  show <design> [window] | info
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { budget, config, loadCassette } from './src/jev';
import { dir, type Ctx } from './src/arms';
import { JEV_CASSETTE } from './src/corpus';
import { DESIGNS4, design4, plannedFor, runDesign4, windowsOf } from './src/p4';

const scratch = process.env.JEV_SCRATCH || join(dir, 'scratch');
mkdirSync(scratch, { recursive: true });
const replay = process.env.JEV_MODE === 'replay';
const cfg = config(dir, { cassettePath: replay ? join(dir, `${JEV_CASSETTE}.jsonl`) : join(scratch, `${JEV_CASSETTE}.raw.jsonl`), budgetPath: join(scratch, `budget${JEV_CASSETTE.slice(8)}.json`), maxCalls: 3000 });
const ctx: Ctx = { cfg, cassette: loadCassette(cfg.cassettePath), conc: Number(process.env.JEV_CONC || 1) };
const args = process.argv.slice(2);
if (args[0] === 'info') {
  for (const d of DESIGNS4) { const w = windowsOf(d); const p = plannedFor(d, cfg.model); const toks = p.map((x) => JSON.stringify(x.body).length / 4); console.log(d.id.padEnd(20), 'windows', w.length, 'calls/pass', p.length, 'units/window max', Math.max(...w.map((x) => x.leaves.length)), 'questions/call max', Math.max(...p.map((x) => x.names.size)), '~tokens/call max', Math.round(Math.max(...toks)), '~tokens/pass', Math.round(toks.reduce((a, b) => a + b, 0))); }
  process.exit(0);
}
if (args[0] === 'show') {
  const d = design4(args[1]!); const p = plannedFor(d, cfg.model)[Number(args[2] ?? 0)]!;
  const qs = Object.entries(p.body.questions);
  console.log(p.body.state.slice(0, 6000)); console.log('...'); console.log(JSON.stringify(qs.slice(0, 2), null, 1).slice(0, 3000)); console.log('questions', qs.length, 'body chars', JSON.stringify(p.body).length);
  process.exit(0);
}
for (const spec of args) {
  const [id, pass] = spec.split(':');
  const r = await runDesign4(ctx, design4(id!), Number(pass ?? 1));
  const b = budget(cfg.budgetPath);
  console.log(`${spec} -> ${r.runId}: ${r.calls.length} calls, missing ${r.missing}/${r.asked}, wall ${(r.wallMs / 1000).toFixed(1)} s; calls used ${b.calls} errors ${b.errors} tokens ${b.tokensIn}/${b.tokensOut}`);
}
