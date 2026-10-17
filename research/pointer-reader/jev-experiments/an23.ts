// Haiku with thinking switched off, at low effort, and by default (phase 3 runs): accuracy on the A=C key, unsure share, tokens, time and USD per 100 units.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dir } from './src/arms';
import { KEY, keyG, wilson } from './src/key4';
import { U3 } from './src/p3';
import { L6 } from './src/p4';
import { quantile, PRICE } from './src/dec4';
type Run = { labels: Record<number, string> };
const load = (p: (r: number) => string) => [1, 2, 3].map((r) => JSON.parse(readFileSync(join(dir, p(r)), 'utf8')) as Run);
const raw = (f: string) => readFileSync(process.env.THINK_RAW ?? join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { run: string; ms: number; response: { usage?: { input_tokens: number; output_tokens: number } } });
const fmt = (k: number, n: number) => { const w = wilson(k, n); return `${(100 * w.p).toFixed(1)} [${(100 * w.lo).toFixed(1)}, ${(100 * w.hi).toFixed(1)}]`; };
const N = U3.length;
const think = raw('cassette4-haiku-think.raw.jsonl');
const base = JSON.parse('[]');
void base;
const defaultRuns = load((r) => `results3/haiku-r${r}.json`);
const variants: Array<{ name: string; runs: Run[]; calls: Array<{ ms: number; tin: number; tout: number }> }> = [
  { name: 'default (adaptive thinking), phase 3 runs', runs: defaultRuns, calls: [] },
  { name: 'thinking disabled', runs: load((r) => `results4/haiku-nothink-r${r}.json`), calls: think.filter((e) => e.run.startsWith('nothink')).map((e) => ({ ms: e.ms, tin: e.response.usage?.input_tokens ?? 0, tout: e.response.usage?.output_tokens ?? 0 })) },
  { name: 'effort low', runs: load((r) => `results4/haiku-low-r${r}.json`), calls: think.filter((e) => e.run.startsWith('low')).map((e) => ({ ms: e.ms, tin: e.response.usage?.input_tokens ?? 0, tout: e.response.usage?.output_tokens ?? 0 })) },
];
// default-thinking efficiency from the phase 3 cassette
{
  const c3 = JSON.parse(JSON.stringify(variants[0]));
  void c3;
}
import { gunzipSync } from 'node:zlib';
const c3 = gunzipSync(readFileSync(join(dir, 'cassette3-haiku.jsonl.gz'))).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { run: string; ms: number; response: { usage?: { input_tokens: number; output_tokens: number } } });
variants[0]!.calls = c3.filter((e) => ['1', '2', '3'].includes(e.run)).map((e) => ({ ms: e.ms, tin: e.response.usage?.input_tokens ?? 0, tout: e.response.usage?.output_tokens ?? 0 }));
const out = ['| Haiku setting | Missing unit answers (3 runs) | One run, key accuracy % [Wilson 95%] (runs 1 / 2 / 3, missing = wrong) | Majority of 3, key | Unanimous: accepted share, accuracy | Calls per 3 runs per 100 units | Input / output tokens (3 runs) per 100 units | Median / p90 s per call | Seconds per 100 units (3 runs) | USD per 100 units (3 runs) |', '|---|---|---|---|---|---|---|---|---|---|'];
for (const v of variants) {
  const miss = v.runs.reduce((a, r) => a + U3.filter((u) => !L6.includes(r.labels[u.g] as never)).length, 0);
  const one = v.runs.map((r) => fmt(keyG.filter((g) => r.labels[g] === KEY.get(g)).length, keyG.length));
  const votes = (g: number) => { const c: Record<string, number> = {}; for (const r of v.runs) if (r.labels[g]) c[r.labels[g]!] = (c[r.labels[g]!] ?? 0) + 1; return Object.entries(c).sort((a, b) => b[1] - a[1]); };
  const maj = keyG.filter((g) => votes(g)[0]?.[0] === KEY.get(g)).length;
  const un = keyG.filter((g) => votes(g)[0]?.[1] === 3);
  const unOk = un.filter((g) => votes(g)[0]![0] === KEY.get(g)).length;
  const tin = v.calls.reduce((a, c) => a + c.tin, 0), tout = v.calls.reduce((a, c) => a + c.tout, 0), ms = v.calls.map((c) => c.ms);
  out.push(`| ${v.name} | ${miss} | ${one.join(' / ')} | ${fmt(maj, keyG.length)} | ${(100 * un.length / keyG.length).toFixed(1)}%, ${fmt(unOk, un.length)} | ${(v.calls.length / N * 100).toFixed(1)} | ${(tin / N * 100 / 1000).toFixed(1)}k / ${(tout / N * 100 / 1000).toFixed(1)}k | ${(quantile(ms, 0.5) / 1000).toFixed(1)} / ${(quantile(ms, 0.9) / 1000).toFixed(1)} | ${(ms.reduce((a, b) => a + b, 0) / 1000 / N * 100).toFixed(1)} | ${((tin * PRICE.haikuIn + tout * PRICE.haikuOut) / N * 100).toFixed(4)} |`);
}
console.log(out.join('\n'));
