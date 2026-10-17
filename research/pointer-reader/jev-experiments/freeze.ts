// Adjudicates the two annotators and freezes the held-out set: gold2.json.
// Rule: where A (author) and B (helper) differ, B stands unless the unit is listed in OVERRIDE (a decision by the
// author, after reading both, using GUIDE.md). Every disagreement is flagged `contested`. No model output was seen.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const here = new URL('.', import.meta.url).pathname;
const A = JSON.parse(readFileSync(join(here, 'gold2.author.json'), 'utf8')).units as Array<{ file: string; n: number; id: string; container: string; text: string; label: string; section: string }>;
const B = new Map(readFileSync(join(here, 'annot-b.tsv'), 'utf8').trim().split('\n').map((l) => l.split('\t')).map(([f, n, l]) => [`${f}#${n}`, l!]));
const OVERRIDE: Record<string, string> = {
  'standing-instructions.md#1': 'description', 'standing-instructions.md#51': 'description', 'standing-instructions.md#60': 'rule',
  'refund-desk-skill.md#49': 'none', 'memory-notes.md#28': 'description', 'memory-notes.md#55': 'rule',
  'scheduler-reference.md#3': 'description', 'scheduler-reference.md#4': 'description', 'scheduler-reference.md#84': 'gate',
  'scheduler-reference.md#86': 'rule', 'scheduler-reference.md#87': 'rule',
  'lost-property-skill.md#15': 'rule', 'lost-property-skill.md#16': 'rule', 'lost-property-skill.md#17': 'rule', 'lost-property-skill.md#18': 'rule', 'lost-property-skill.md#19': 'rule',
};
const DEV = new Set(['standing-instructions.md', 'refund-desk-skill.md', 'tide-tables-skill.md']);
let k = 0;
const units = A.map((u) => {
  const key = `${u.file}#${u.n}`;
  const b = B.get(key)!;
  const label = OVERRIDE[key] ?? b;
  return { file: u.file, n: u.n, id: u.id, container: u.container, text: u.text, section: u.section, label, labelA: u.label, labelB: b, contested: u.label !== b, split: DEV.has(u.file) ? 'dev' : 'test', g: ++k };
});
const body = JSON.stringify({ labels: ['rule', 'prohibition', 'gate', 'example', 'description', 'none'], units }, null, 1) + '\n';
writeFileSync(join(here, 'gold2.json'), body);
const sha = createHash('sha256').update(body).digest('hex');
writeFileSync(join(here, 'gold2.sha256'), sha + '  gold2.json\n');
const c: Record<string, Record<string, number>> = {};
for (const u of units) { (c[u.split] ??= {})[u.label] = ((c[u.split] ??= {})[u.label] ?? 0) + 1; }
console.log(sha, units.length, 'contested', units.filter((u) => u.contested).length, JSON.stringify(c));
console.log('A vs final agree', units.filter((u) => u.labelA === u.label).length, 'B vs final agree', units.filter((u) => u.labelB === u.label).length);
