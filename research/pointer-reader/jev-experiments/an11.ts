import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dir } from './src/arms';
import { U3 } from './src/p3';
import { evalSplit, idx3, pct } from './src/lib3';
import { spansOf } from './src/spans';
const rows = readFileSync(join(dir, 'annot3-b.tsv'), 'utf8').trim().split('\n').map((l) => l.split('\t'));
const B = new Map(rows.map(([f, n, l, g]) => [`${f}#${n}`, { label: l!, group: g || undefined }]));
const A = JSON.parse(readFileSync(join(dir, 'gold3.author.json'), 'utf8')).units as Array<{ file: string; n: number; label: string; spanKey?: string }>;
const labB = U3.map((u) => B.get(`${u.file}#${u.n}`)!.label), grB = U3.map((u) => { const g = B.get(`${u.file}#${u.n}`)!.group; return g ? `${u.file}:${g}` : undefined; });
const labA = A.map((u) => u.label), grA = A.map((u) => (u.spanKey ? `${u.file}:${u.spanKey}` : undefined));
for (const [name, lab, gr] of [['annotator A (author tags) against the frozen gold', labA, grA], ['annotator B (fresh Haiku) against the frozen gold', labB, grB]] as const) {
  const sp = spansOf(lab as string[], gr as Array<string | undefined>, idx3);
  for (const s of ['dev', 'test', 'all'] as const) { const r = evalSplit(sp, lab as string[], s); console.log(name.padEnd(52), s.padEnd(5), `per-unit acc ${pct(r.acc)} (outside ${pct(r.accNonMulti)}, inside ${pct(r.accMulti)}) exact P ${pct(r.exactP)} R ${pct(r.exactR)} F1 ${pct(r.exactF1)} IoU.5 P ${pct(r.iou50P)} R ${pct(r.iou50R)} anyR ${pct(r.anyR)} multi exactR ${pct(r.multiExactR)} single exactR ${pct(r.singleExactR)}`); }
}
