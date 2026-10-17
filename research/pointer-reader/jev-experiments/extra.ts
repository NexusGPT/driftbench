// Extra facts for RESULTS.md: gold v1 vs v2, returned models, failed requests, cap probes, wall times, confusion of the best arm.
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dir, UNITS } from './src/arms';
import { CLASSES, goldLabels, loadRuns, mean, pct, predictions, score } from './report';

const runs = loadRuns();
const v1 = JSON.parse(readFileSync(join(dir, 'gold.v1.json'), 'utf8')).units as Array<{ id: string; label: string }>;
const v1by = new Map(v1.map((u) => [u.id, u.label]));
const goldV1 = UNITS.map((u) => v1by.get(u.id)!);
console.log('units whose gold label differs between v1 and v2:', UNITS.filter((u, i) => goldV1[i] !== u.label).length);
for (const id of ['a1a-w20-defs2', 'a1a-w20', 'a3-q150']) {
  const rs = runs.filter((r) => r.runId.replace(/-r\d+$/, '') === id);
  console.log(id, 'acc vs v2 gold', pct(mean(rs.map((r) => score(predictions(r, 0.5), goldLabels).acc))), 'vs v1 gold', pct(mean(rs.map((r) => score(predictions(r, 0.5), goldV1).acc))));
}
const lines = gunzipSync(readFileSync(join(dir, 'cassette.jsonl.gz'))).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const models = new Map<string, number>();
for (const e of lines) if (e.status === 200) models.set(e.response.model, (models.get(e.response.model) ?? 0) + 1);
console.log('returned models', Object.fromEntries(models));
console.log('requests in cassette', lines.length, 'ok', lines.filter((e) => e.status === 200).length, 'failed', lines.filter((e) => e.status !== 200).map((e) => `${e.run}:${e.status}:${JSON.stringify(e.response).slice(0, 80)}`));
const cap = lines.filter((e) => /^cap/.test(e.run)).map((e) => ({ run: e.run, q: Object.keys(e.request.questions).length, status: e.status, in: e.response.usage?.input_tokens, out: e.response.usage?.output_tokens, ms: e.ms, bytes: JSON.stringify(e.request).length }));
console.table(cap.sort((a, b) => a.run.replace(/-q.*/, '').localeCompare(b.run.replace(/-q.*/, '')) || a.q - b.q));
const wall = (id: string) => runs.filter((r) => r.runId.replace(/-r\d+$/, '') === id).map((r) => r.wallMs);
for (const id of ['a1a-w20-defs2', 'a1b-single', 'a3-q25', 'a3-q150', 'a3-q250', 'a3-q1250', 'a4-tree']) console.log('wall ms', id, wall(id).join(','));
const best = runs.find((r) => r.runId === 'a3-q150-r1')!;
const pred = predictions(best, 0.5);
console.log('confusion a3-q150-r1 (rows gold, cols predicted)', ['gold', ...CLASSES].join('\t'));
for (const g of CLASSES) console.log(g, CLASSES.map((p) => goldLabels.filter((x, i) => x === g && pred[i] === p).length).join('\t'));
