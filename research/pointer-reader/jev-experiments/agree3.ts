import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { scoreSpans, spansOf } from './src/spans';
const here = new URL('.', import.meta.url).pathname;
type U = { file: string; n: number; id: string; text: string; label: string; spanKey?: string };
const A = JSON.parse(readFileSync(join(here, 'gold3.author.json'), 'utf8')).units as U[];
const rows = readFileSync(join(here, 'annot3-b.tsv'), 'utf8').trim().split('\n').map((l) => l.split('\t'));
const B = new Map(rows.map(([f, n, l, g]) => [`${f}#${n}`, { label: l!, group: g || undefined }]));
const C = ['rule', 'prohibition', 'gate', 'example', 'description', 'none'];
let same = 0; const m: Record<string, Record<string, number>> = {}; const dis: string[] = [];
A.forEach((u, i) => {
  const b = B.get(`${u.file}#${u.n}`); if (!b || !C.includes(b.label)) throw new Error(`missing/invalid ${u.file}#${u.n}`);
  if (b.label === u.label) same++; else dis.push(`${u.file}#${u.n}\tA=${u.label}\tB=${b.label}\t${u.text.slice(0, 100)}`);
  ((m[u.label] ??= {})[b.label] = ((m[u.label] ??= {})[b.label] ?? 0) + 1);
  void i;
});
const N = A.length, po = same / N; let pe = 0;
for (const c of C) pe += (A.filter((u) => u.label === c).length / N) * ([...B.values()].filter((x) => x.label === c).length / N);
console.log(`per-unit label: ${N} units, agree ${same} (${(100 * po).toFixed(1)}%), kappa ${((po - pe) / (1 - pe)).toFixed(3)}`);
console.log('A\\B', C.join('\t')); for (const a of C) console.log(a, C.map((b) => m[a]?.[b] ?? 0).join('\t'));
// spans: group ids are per file
const idx = A.map((_, i) => i);
const spanA = spansOf(A.map((u) => u.label), A.map((u) => (u.spanKey ? `${u.file}:${u.spanKey}` : undefined)), idx);
const spanB = spansOf(A.map((u) => B.get(`${u.file}#${u.n}`)!.label), A.map((u) => { const g = B.get(`${u.file}#${u.n}`)!.group; return g ? `${u.file}:${g}` : undefined; }), idx);
const s = scoreSpans(spanA, spanB);
const multi = (xs: typeof spanA) => xs.filter((x) => x.leaves.length > 1).length;
console.log(`rules: A ${spanA.length} (multi ${multi(spanA)}), B ${spanB.length} (multi ${multi(spanB)})`);
console.log(`span exact (A as gold, B as prediction): P ${(100 * s.exact.p).toFixed(1)} R ${(100 * s.exact.r).toFixed(1)} F1 ${(100 * s.exact.f1).toFixed(1)}; with kind F1 ${(100 * s.exactKind.f1).toFixed(1)}; IoU>=0.5 R ${(100 * s.iou50.r).toFixed(1)} P ${(100 * s.iou50.p).toFixed(1)}; any overlap R ${(100 * s.any.r).toFixed(1)}`);
const gm = spanA.filter((x) => x.leaves.length > 1), pm = spanB.filter((x) => x.leaves.length > 1);
const sm = scoreSpans(gm, pm);
console.log(`multi-unit rules only: exact F1 ${(100 * sm.exact.f1).toFixed(1)} (R ${(100 * sm.exact.r).toFixed(1)}, P ${(100 * sm.exact.p).toFixed(1)})`);
// rule-vs-nonrule agreement per unit
const inst = (l: string) => ['rule', 'prohibition', 'gate'].includes(l);
let ai = 0; A.forEach((u) => { if (inst(u.label) === inst(B.get(`${u.file}#${u.n}`)!.label)) ai++; });
console.log(`instruction vs not agree ${(100 * ai / N).toFixed(1)}%`);
writeFileSync(join(here, 'disagreements3.tsv'), dis.join('\n') + '\n');
// list span disagreements
const keyOf = (x: { leaves: number[] }) => x.leaves.join(',');
const kb = new Set(spanB.map(keyOf)), ka = new Set(spanA.map(keyOf));
const show = (s: { leaves: number[]; kind: string }) => `${A[s.leaves[0]!]!.file}#${A[s.leaves[0]!]!.n}-${A[s.leaves.at(-1)!]!.n} [${s.kind}] ${A[s.leaves[0]!]!.text.slice(0, 60)}`;
const onlyA = spanA.filter((x) => !kb.has(keyOf(x))), onlyB = spanB.filter((x) => !ka.has(keyOf(x)));
const sp: string[] = ['--- spans only in A (' + onlyA.length + ')', ...onlyA.map(show), '--- spans only in B (' + onlyB.length + ')', ...onlyB.map(show)];
writeFileSync(join(here, 'span-disagreements3.txt'), sp.join('\n') + '\n');
console.log('span disagreements: only A', onlyA.length, 'only B', onlyB.length);
