// Usage: tsx jev-experiments/xhead.ts   Trains the J* head on the keyed units of the span corpus (feat-3.json) and applies it to every unit of the growth corpus (feat-5.json).
// Writes heads5/Jx.json in the format of the cached heads. No unit of the growth corpus is used in training.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { predictVec, train } from './src/stack';
const dir = new URL('.', import.meta.url).pathname;
const L6 = ['rule', 'prohibition', 'gate', 'example', 'description', 'none'];
type Row = { g: number; key: string | null; x: number[] };
const A = JSON.parse(readFileSync(join(dir, 'feat-3.json'), 'utf8')) as Row[], B = JSON.parse(readFileSync(join(dir, 'feat-5.json'), 'utf8')) as Row[];
const tr = A.filter((r) => r.key);
const m = train(tr.map((r) => r.x), tr.map((r) => L6.indexOf(r.key!)), 0.1, 600);
const out = B.map((r) => { const v = predictVec(m, r.x) as unknown as Record<string, number>; const vec = L6.map((l) => v[l]!); const s = [...vec].sort((a, b) => b - a); return [r.g, { pred: L6[vec.indexOf(s[0]!)], conf: s[0]! - s[1]!, vec }]; });
mkdirSync(join(dir, 'heads5'), { recursive: true });
writeFileSync(join(dir, 'heads5', 'Jx.json'), JSON.stringify(out));
console.log('trained on', tr.length, 'keyed span-corpus units; applied to', B.length);
