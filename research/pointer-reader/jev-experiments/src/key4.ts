// The answer key without Haiku: the units on which annotator A (author tags) and annotator C (Opus) give the same label.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dir } from './arms';
import { U3 } from './p3';
import { C5 } from './corpus';

const readTsv = (f: string) => new Map(readFileSync(join(dir, f), 'utf8').trim().split('\n').map((l) => l.split('\t')).map(([file, n, label, group]) => [`${file}#${n}`, { label: label!, group: group || undefined }]));
const k = (u: { file: string; n: number }) => `${u.file}#${u.n}`;
const g5 = C5 ? (JSON.parse(readFileSync(join(dir, 'gold5.json'), 'utf8')).units as Array<{ file: string; n: number; labelAuthor: string; labelOpus: string }>) : [];
const m5 = new Map(g5.map((u) => [k(u), u]));
const Cm = C5 ? undefined : readTsv('annot3-c.tsv'), Bm = C5 ? undefined : readTsv('annot3-b.tsv');
const Aunits = C5 ? [] : (JSON.parse(readFileSync(join(dir, 'gold3.author.json'), 'utf8')).units as Array<{ file: string; n: number; label: string }>);
export const LAB_A = new Map(U3.map((u, i) => [u.g, C5 ? m5.get(k(u))!.labelAuthor : Aunits[i]!.label]));
export const LAB_C = new Map(U3.map((u) => [u.g, C5 ? m5.get(k(u))!.labelOpus : Cm!.get(k(u))!.label]));
export const LAB_B = new Map(U3.map((u) => [u.g, C5 ? m5.get(k(u))!.labelOpus : Bm!.get(k(u))!.label]));
export const LAB_FROZEN = new Map(U3.map((u) => [u.g, u.label]));
/** the key: g -> label, for units where A = C */
export const KEY = new Map(U3.filter((u) => LAB_A.get(u.g) === LAB_C.get(u.g)).map((u) => [u.g, LAB_A.get(u.g)!]));
export const splitOfG = (g: number) => U3[g - 1]!.split;
export const keyG = U3.filter((u) => KEY.has(u.g)).map((u) => u.g);

/** Wilson score interval for k successes in n trials, z = 1.96 */
export function wilson(k: number, n: number, z = 1.96): { p: number; lo: number; hi: number } {
  if (n === 0) return { p: NaN, lo: NaN, hi: NaN };
  const p = k / n, z2 = z * z;
  const den = 1 + z2 / n, centre = (p + z2 / (2 * n)) / den, half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / den;
  return { p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}
export const fmtAcc = (k: number, n: number) => { const w = wilson(k, n); return `${(100 * w.p).toFixed(1)} [${(100 * w.lo).toFixed(1)}, ${(100 * w.hi).toFixed(1)}]`; };
