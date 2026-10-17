// Adjudicates the harbour set under guide 2.1 and freezes gold2b.json.
// Annotators: A' (author, guide 2.1), B'1 (fresh Haiku annotator, guide 2.0), B'2 (fresh Haiku annotator, guide 2.1).
// Rule: the label at least two of the three give; if all three differ, the author's A' label. No model labeller output (Jev, labeller Haiku runs) was seen.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const here = new URL('.', import.meta.url).pathname;
const g2 = JSON.parse(readFileSync(join(here, 'gold2.json'), 'utf8')).units as Array<Record<string, unknown> & { file: string; n: number; label: string }>;
const rd = (f: string) => new Map(readFileSync(join(here, f), 'utf8').trim().split('\n').map((l) => l.split('\t')).map(([f2, n, l]) => [`${f2}#${n}`, l!]));
const A = rd('annot2b-a.tsv'), B1 = rd('annot2b-b1.tsv'), B2 = rd('annot2b-b2.tsv');
let tie3 = 0;
const units = g2.map((u) => {
  const k = `${u.file}#${u.n}`; const a = A.get(k)!, b1 = B1.get(k)!, b2 = B2.get(k)!;
  let label = a;
  if (b1 === b2) label = b1; else if (a === b1 || a === b2) label = a; else tie3++;
  return { ...u, label, labelOld: u.label, labelA: a, labelB: b2, labelB1: b1, contested: a !== b2 };
});
const body = JSON.stringify({ labels: ['rule', 'prohibition', 'gate', 'example', 'description', 'none'], units }, null, 1) + '\n';
writeFileSync(join(here, 'gold2b.json'), body);
const sha = createHash('sha256').update(body).digest('hex');
writeFileSync(join(here, 'gold2b.sha256'), sha + '  gold2b.json\n');
const n = units.length;
console.log(sha, n, 'contested (A vs B2)', units.filter((u) => u.contested).length, 'three-way splits', tie3);
console.log('final vs old gold2 label agree', units.filter((u) => u.label === u.labelOld).length);
console.log('final vs A', units.filter((u) => u.label === u.labelA).length, 'vs B2', units.filter((u) => u.label === u.labelB).length, 'vs B1', units.filter((u) => u.label === u.labelB1).length);
const c: Record<string, number> = {}; for (const u of units) c[u.label] = (c[u.label] ?? 0) + 1; console.log(JSON.stringify(c));
