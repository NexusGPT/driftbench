// Writes gold5s.json: gold5 in the shape of gold3.json (files with offsets and splits, units with global numbers g, rules) so the phase 4 machinery runs on it with CORPUS=5.
// Split for thresholds: estates A and B are dev, estate C (the channel-tabbed prompt) is test.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const here = new URL('.', import.meta.url).pathname;
const g5 = JSON.parse(readFileSync(join(here, 'gold5.json'), 'utf8')).units as Array<Record<string, unknown> & { file: string; n: number; estate: string; labelAuthor: string; labelOpus: string; agreed: boolean; spanKey?: string; spanAuthor: string | null }>;
const au = JSON.parse(readFileSync(join(here, 'gold5.author.json'), 'utf8')) as { units: Array<{ file: string; n: number; spanKey?: string }>; rules: Array<{ file: string; key: string; kind: string; leafNs: number[]; multi: boolean; aligned: string | null }> };
const spanOf = new Map(au.units.map((u) => [`${u.file}#${u.n}`, u.spanKey ?? null]));
const files: Array<{ file: string; offset: number; leaves: number; split: 'dev' | 'test' }> = [];
const units = g5.map((u, i) => {
  const split = u.estate === 'C' ? 'test' : 'dev';
  if (!files.length || files.at(-1)!.file !== u.file) files.push({ file: u.file, offset: i, leaves: 0, split });
  files.at(-1)!.leaves++;
  return { file: u.file, n: u.n, id: u.id, container: u.container, text: u.text, section: u.section, label: u.labelAuthor, labelA: u.labelAuthor, labelB: u.labelOpus, group: spanOf.get(`${u.file}#${u.n}`) ?? null, contested: !u.agreed, g: i + 1, split };
});
const off = new Map(files.map((f) => [f.file, f.offset]));
const rules = au.rules.map((r) => ({ id: `${r.file}:${r.key}`, file: r.file, kind: r.kind, leafG: r.leafNs.map((n) => off.get(r.file)! + n), multi: r.multi, aligned: r.aligned, contested: false }));
writeFileSync(join(here, 'gold5s.json'), JSON.stringify({ files, units, rules }, null, 1) + '\n');
console.log(files.length, 'files', units.length, 'units', rules.length, 'rules', JSON.stringify(files.map((f) => [f.file, f.offset, f.leaves, f.split]).slice(0, 2)));
