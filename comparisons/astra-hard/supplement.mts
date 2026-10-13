import { readFileSync, writeFileSync } from 'node:fs';
import { bootstrapCI, mcnemar, wilson } from '../../packages/stats/src/index.ts';

const file = process.argv[2] ?? 'comparisons/astra-hard/scores.json';
const scores = JSON.parse(readFileSync(file, 'utf8'));
const seed = Number.parseInt('9c1c2ff8', 16);
const output: Record<string, unknown> = {};
for (const row of ['promptfoo-rubric', 'langfuse-reference']) {
  const cases = scores.rows.filter((r: any) => r.row === row);
  const ours = cases.map((r: any) => Number(r.ours.correct));
  const peer = cases.map((r: any) => Number(r.peer.correct));
  const clusters = cases.map((r: any) => r.family);
  const options = { clusters, seed, iterations: 20_000, alpha: 0.05, method: 'percentile' as const };
  const summary = scores.summary[row];
  output[row] = {
    exact_mcnemar_two_sided: mcnemar(summary.ours_only_correct, summary.peer_only_correct, { exact: true }),
    ours_wilson95: wilson(summary.ours.correct, cases.length),
    peer_wilson95: wilson(summary.peer.correct, cases.length),
    ours_family_bootstrap95: bootstrapCI(ours, options),
    peer_family_bootstrap95: bootstrapCI(peer, options),
    paired_difference_family_bootstrap95: bootstrapCI(ours.map((x: number, i: number) => x - peer[i]), options),
  };
}
const target = file.replace(/scores\.json$/, 'supplement.json');
writeFileSync(target, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Wrote ${target}: exact two-sided McNemar and 20,000 whole-family bootstrap draws.`);
