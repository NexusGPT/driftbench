// Real cascades: the Haiku subset runs (only the units below the Jev head margin cut) against the key and the frozen gold.
// Tokens, wall time and USD come from the recorded runs (cassette4-haiku), not from a model of the share.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { dir } from './src/arms';
import { KEY, keyG, splitOfG, wilson } from './src/key4';
import { FROZEN, PRICE } from './src/dec4';
import { U3 } from './src/p3';
import { headDecisions, HEADS } from './heads4';

const J = headDecisions(HEADS.find((h) => h.id === 'J1')!);
const fmt = (k: number, n: number) => { const w = wilson(k, n); return `${(100 * w.p).toFixed(1)} [${(100 * w.lo).toFixed(1)}, ${(100 * w.hi).toFixed(1)}]`; };
const cas = join(dir, 'cassette4-haiku.jsonl');
const text = existsSync(cas) ? readFileSync(cas, 'utf8') : existsSync(cas + '.gz') ? gunzipSync(readFileSync(cas + '.gz')).toString('utf8') : readFileSync(process.env.HAIKU_RAW ?? '', 'utf8');
const usage = new Map<string, { calls: number; tin: number; tout: number; ms: number[] }>();
for (const l of text.split('\n').filter(Boolean)) { const e = JSON.parse(l); const u = e.response?.usage; const a = usage.get(e.run) ?? { calls: 0, tin: 0, tout: 0, ms: [] }; a.calls++; a.tin += u?.input_tokens ?? 0; a.tout += u?.output_tokens ?? 0; a.ms.push(e.ms); usage.set(e.run, a); }
const out: string[] = ['| Margin cut | Units sent to Haiku | Accuracy on accepted, key [Wilson 95%] | Unsure % (key) | Accuracy on accepted, full adjudicated set | Unsure % (full) | Haiku input / output tokens per 100 units (3 runs) | Haiku wall s per 100 units (3 runs, sequential) | USD per 100 units (Jev head + Haiku) | Haiku share of units: Jev-accepted accuracy (key) |', '|---|---|---|---|---|---|---|---|---|---|'];
for (const tau of [0.67, 0.76]) {
  const runs = [1, 2, 3].map((r) => JSON.parse(readFileSync(join(dir, 'results4', `haiku-subset-${tau}-r${r}.json`), 'utf8')) as { labels: Record<number, string>; wallMs: number });
  const sent = (g: number) => J.get(g)!.conf < tau;
  const final = (g: number): string | null => {
    if (!sent(g)) return J.get(g)!.pred;
    const ls = runs.map((r) => r.labels[g]);
    return ls[0] && ls[0] === ls[1] && ls[1] === ls[2] ? ls[0]! : null;
  };
  const ev = (set: number[], truth: (g: number) => string) => { const acc = set.filter((g) => final(g) !== null); return { k: acc.filter((g) => final(g) === truth(g)).length, n: acc.length, uns: 1 - acc.length / set.length }; };
  const k = ev(keyG, (g) => KEY.get(g)!), f = ev(U3.map((u) => u.g), FROZEN);
  const jacc = keyG.filter((g) => !sent(g)); const jk = jacc.filter((g) => J.get(g)!.pred === KEY.get(g)).length;
  const tin = [1, 2, 3].reduce((a, r) => a + usage.get(`${tau}-${r}`)!.tin, 0), tout = [1, 2, 3].reduce((a, r) => a + usage.get(`${tau}-${r}`)!.tout, 0);
  const wall = runs.reduce((a, r) => a + r.wallMs, 0) / 1000;
  const n = U3.length;
  const usd = (tin * PRICE.haikuIn + tout * PRICE.haikuOut) / n * 100 + 0.0057;
  out.push(`| ${tau} | ${U3.filter((u) => sent(u.g)).length} of ${n} (${(100 * U3.filter((u) => sent(u.g)).length / n).toFixed(0)}%) | ${fmt(k.k, k.n)} | ${(100 * k.uns).toFixed(1)} | ${fmt(f.k, f.n)} | ${(100 * f.uns).toFixed(1)} | ${(tin / n * 100 / 1000).toFixed(1)}k / ${(tout / n * 100 / 1000).toFixed(1)}k | ${(wall / n * 100).toFixed(1)} | ${usd.toFixed(4)} | ${fmt(jk, jacc.length)} (${jacc.length} key units) |`);
}
void splitOfG;
console.log(out.join('\n'));
