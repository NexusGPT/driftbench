// Stratified MM-Eval TEST sample OUTSIDE the 950-item frozen test sample, fixed seed, proportional by class,
// interleaved in seeded hash order. Usage: tsx test-sample.mts OUT.json N
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const CM = '/Users/assem/Documents/GitHub/driftbench/.worktrees/codex-mm/examples/judge-benchmarks';
const { loadBenchmark, splitOf } = await import(`${CM}/src/data.ts`);
const [out, nArg] = process.argv.slice(2);
const SEED = 'opus-mm-fresh-test-v1';
const s950 = JSON.parse(readFileSync(`${CM}/experiments/mm-results/test-sample-frozen-items.json`, 'utf8'));
const used = new Set(s950.items.map((i: any) => (typeof i === 'string' ? i : i.id)));
const b = await loadBenchmark('mmeval');
const pool = b.items.filter((i: any) => splitOf('mmeval', i.id) === 'test' && !used.has(i.id));
const N = Number(nArg);
const h = (id: string) => createHash('sha256').update(`${SEED}:${id}`).digest('hex');
const groups = [...new Set(pool.map((i: any) => i.group))] as string[];
const picked: any[] = [];
for (const g of groups) {
  const gi = pool.filter((i: any) => i.group === g).sort((x: any, y: any) => (h(x.id) < h(y.id) ? -1 : 1));
  const q = Math.round((N * gi.length) / pool.length);
  picked.push(...gi.slice(0, q).map((i: any) => ({ id: i.id, group: i.group, language: i.language, question: i.question, a: i.a, b: i.b, label: i.label })));
  console.log(g, gi.length, q);
}
picked.sort((x, y) => (h(x.id) < h(y.id) ? -1 : 1));
writeFileSync(out!, JSON.stringify(picked));
console.log('excluded', used.size, 'pool', pool.length, 'picked', picked.length);
