// Annotator C (Opus) against A (author tags), B (Haiku) and the frozen gold3, per unit and per span. Defines the answer key without Haiku: units where A and C give the same label.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { scoreSpans, spansOf } from './src/spans';
import { U3, RULES3 } from './src/p3';
import { MULTI_G } from './src/lib3';
const here = new URL('.', import.meta.url).pathname;
const C6 = ['rule', 'prohibition', 'gate', 'example', 'description', 'none'];
const readTsv = (f: string) => new Map(readFileSync(join(here, f), 'utf8').trim().split('\n').map((l) => l.split('\t')).map(([file, n, label, group]) => [`${file}#${n}`, { label: label!, group: group || undefined }]));
const B = readTsv('annot3-b.tsv'), Cc = readTsv('annot3-c.tsv');
const A = JSON.parse(readFileSync(join(here, 'gold3.author.json'), 'utf8')).units as Array<{ file: string; n: number; label: string; spanKey?: string; text: string }>;
const key = (u: { file: string; n: number }) => `${u.file}#${u.n}`;
for (const u of U3) if (!Cc.has(key(u))) throw new Error(`C is missing ${key(u)}`);
const lab = { A: A.map((u) => u.label), B: U3.map((u) => B.get(key(u))!.label), C: U3.map((u) => Cc.get(key(u))!.label), G: U3.map((u) => u.label) };
const grp = { A: A.map((u) => (u.spanKey ? `${u.file}:${u.spanKey}` : undefined)), B: U3.map((u) => { const g = B.get(key(u))!.group; return g ? `${u.file}:${g}` : undefined; }), C: U3.map((u) => { const g = Cc.get(key(u))!.group; return g ? `${u.file}:${g}` : undefined; }) };
const N = U3.length;
function kappa(x: string[], y: string[]) {
  const po = x.filter((v, i) => v === y[i]).length / N; let pe = 0;
  for (const c of C6) pe += (x.filter((v) => v === c).length / N) * (y.filter((v) => v === c).length / N);
  return { po, k: (po - pe) / (1 - pe) };
}
const isI = (l: string) => ['rule', 'prohibition', 'gate'].includes(l);
const out: string[] = [];
const P = (s = '') => out.push(s);
P('| Pair | Units | Same label | Agreement % | Cohen kappa | Instruction vs not, agree % | Exact-span F1 (first as gold) | IoU>=0.5 recall % |'); P('|---|---|---|---|---|---|---|---|');
const idx = U3.map((u) => u.g);
const spansFor = (l: string[], g: Array<string | undefined>) => spansOf(l, g, idx);
const spA = spansFor(lab.A, grp.A), spB = spansFor(lab.B, grp.B), spC = spansFor(lab.C, grp.C);
const spG = RULES3.map((r) => ({ leaves: r.leafG, kind: r.kind }));
const pairs: Array<[string, string[], string[], typeof spA, typeof spA]> = [['A vs C', lab.A, lab.C, spA, spC], ['A vs B', lab.A, lab.B, spA, spB], ['B vs C', lab.B, lab.C, spB, spC], ['frozen gold3 vs C', lab.G, lab.C, spG, spC], ['frozen gold3 vs A', lab.G, lab.A, spG, spA]];
for (const [name, x, y, sx, sy] of pairs) {
  const same = x.filter((v, i) => v === y[i]).length; const { po, k } = kappa(x, y);
  const ia = x.filter((v, i) => isI(v) === isI(y[i]!)).length;
  const s = scoreSpans(sx, sy);
  P(`| ${name} | ${N} | ${same} | ${(100 * po).toFixed(1)} | ${k.toFixed(3)} | ${(100 * ia / N).toFixed(1)} | ${(100 * s.exact.f1).toFixed(1)} | ${(100 * s.iou50.r).toFixed(1)} |`);
}
P();
P(`Rules: A ${spA.length} (multi-unit ${spA.filter((s) => s.leaves.length > 1).length}), B ${spB.length} (${spB.filter((s) => s.leaves.length > 1).length}), C ${spC.length} (${spC.filter((s) => s.leaves.length > 1).length}), frozen gold ${spG.length} (${spG.filter((s) => s.leaves.length > 1).length}).`);
// answer key without Haiku
const inAC = U3.map((_, i) => lab.A[i] === lab.C[i]);
const inABC = U3.map((_, i) => lab.A[i] === lab.C[i] && lab.A[i] === lab.B[i]);
const inGC = U3.map((_, i) => lab.G[i] === lab.C[i]);
P();
P('| Answer key | Units | Dev (3 files) | Test (6 files) | Outside multi-unit rules | Inside multi-unit rules |'); P('|---|---|---|---|---|---|');
const cnt = (m: boolean[]) => { const n = m.filter(Boolean).length; return [n, U3.filter((u, i) => m[i] && u.split === 'dev').length, U3.filter((u, i) => m[i] && u.split === 'test').length, U3.filter((u, i) => m[i] && !MULTI_G.has(u.g)).length, U3.filter((u, i) => m[i] && MULTI_G.has(u.g)).length]; };
for (const [name, m] of [['A = C (answer key without Haiku)', inAC], ['A = B = C', inABC], ['frozen gold3 = C', inGC], ['all units', U3.map(() => true)]] as const) { const c = cnt(m); P(`| ${name} | ${c[0]} | ${c[1]} | ${c[2]} | ${c[3]} | ${c[4]} |`); }
// agreed rules: spans that A and C produce identically
const kA = new Set(spA.map((s) => s.leaves.join(',') + '|' + s.kind)), kC = new Set(spC.map((s) => s.leaves.join(',') + '|' + s.kind));
const agreedRules = spA.filter((s) => kC.has(s.leaves.join(',') + '|' + s.kind));
P();
P(`Rules that A and C produce identically (same units, same kind): ${agreedRules.length} of A's ${spA.length} and C's ${spC.length}; multi-unit ${agreedRules.filter((s) => s.leaves.length > 1).length}.`);
writeFileSync(join(here, 'answer-key-ac.json'), JSON.stringify({ note: 'units where annotator A (author) and annotator C (Opus) give the same label; agreed rules = spans produced identically by A and C', units: U3.filter((_, i) => inAC[i]).map((u) => ({ g: u.g, file: u.file, n: u.n, id: u.id, label: u.label === lab.A[u.g - 1] ? lab.A[u.g - 1] : lab.A[u.g - 1], split: u.split })), agreedRules: agreedRules.map((s) => ({ leaves: s.leaves, kind: s.kind })) }, null, 1) + '\n');
const dis = U3.filter((_, i) => !inAC[i]).map((u) => `${key(u)}\tA=${lab.A[u.g - 1]}\tC=${lab.C[u.g - 1]}\tB=${lab.B[u.g - 1]}\tfrozen=${u.label}\t${u.text.slice(0, 100)}`);
writeFileSync(join(here, 'disagreements-ac.tsv'), dis.join('\n') + '\n');
void kA;
// confusion A vs C
const m: Record<string, Record<string, number>> = {};
U3.forEach((u, i) => { ((m[lab.A[i]!] ??= {})[lab.C[i]!] = ((m[lab.A[i]!] ??= {})[lab.C[i]!] ?? 0) + 1); });
P(); P('A (rows) against C (columns):'); P(); P('| A \\ C | ' + C6.join(' | ') + ' |'); P('|---|' + C6.map(() => '---').join('|') + '|');
for (const a of C6) P(`| ${a} | ${C6.map((c) => m[a]?.[c] ?? 0).join(' | ')} |`);
console.log(out.join('\n'));
