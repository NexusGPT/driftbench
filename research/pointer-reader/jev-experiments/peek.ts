import { loadRuns } from './report';
import { UNITS } from './src/arms';
const run = loadRuns().find((r) => r.runId === process.argv[2])!;
const want = process.argv[3];
for (const u of UNITS.filter((u) => u.label === want).slice(0, Number(process.argv[4] ?? 12))) {
  const p = run.probs[u.g]!;
  console.log(u.g, Object.entries(p).map(([k, v]) => `${k.slice(0, 4)}:${v}`).join(' '), '|', u.text.slice(0, 60));
}
