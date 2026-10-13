// Stratified DEV sample OUTSIDE the DEV400 cohort, fixed seed, proportional by class.
// Usage: tsx sample.mts DEV400.json OUT.json N
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const CM = '/Users/assem/Documents/GitHub/driftbench/.worktrees/codex-mm/examples/judge-benchmarks';
const { loadBenchmark, splitOf } = await import(`${CM}/src/data.ts`);
const [dev400Path, out, nArg] = process.argv.slice(2);
const SEED = 'opus-mm-replication-v1';
const used = new Set(JSON.parse(readFileSync(dev400Path!, 'utf8')).map((r: any) => r.id));
const b = await loadBenchmark('mmeval');
const pool = b.items.filter((i: any) => splitOf('mmeval', i.id) === 'dev' && !used.has(i.id));
const groups = [...new Set(pool.map((i: any) => i.group))] as string[];
const N = Number(nArg);
const h = (id: string) => createHash('sha256').update(`${SEED}:${id}`).digest('hex');
const picked: any[] = [];
for (const g of groups) {
  const gi = pool.filter((i: any) => i.group === g).sort((x: any, y: any) => (h(x.id) < h(y.id) ? -1 : 1));
  const q = Math.round((N * gi.length) / pool.length);
  picked.push(...gi.slice(0, q).map((i: any) => ({ id: i.id, group: i.group, language: i.language, question: i.question, a: i.a, b: i.b, label: i.label })));
  console.log(g, gi.length, q);
}
// Interleave classes so a deadline stop keeps the sample stratified.
picked.sort((x, y) => (h(x.id) < h(y.id) ? -1 : 1));
writeFileSync(out!, JSON.stringify(picked));
console.log('pool', pool.length, 'picked', picked.length);
