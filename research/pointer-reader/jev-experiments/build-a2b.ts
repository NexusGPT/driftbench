// Annotator A (author) of the harbour set under guide version 2.1: the original author labels (gold2.json labelA) plus the decisions the new defaults change.
// Each edit is a unit whose label the new guide settles differently; the comment gives the default that settles it. Written before reading the labels of the new annotators.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const here = new URL('.', import.meta.url).pathname;
const g2 = JSON.parse(readFileSync(join(here, 'gold2.json'), 'utf8')).units as Array<{ file: string; n: number; labelA: string }>;
const E: Record<string, Record<number, string>> = {
  'dock-notice-helper.md': { 1: 'none' /*D4 name*/, 9: 'prohibition' /*leave out*/, 13: 'prohibition' /*cap*/, 16: 'prohibition' /*cap*/, 21: 'rule' /*D13 output spec*/, 27: 'prohibition' /*no X*/, 28: 'prohibition' /*avoid*/, 34: 'rule' /*D13*/, 35: 'rule' /*D13*/, 71: 'prohibition' /*leave out*/ },
  'lost-property-skill.md': { 1: 'none', 15: 'description', 16: 'description', 17: 'description', 18: 'description', 19: 'description' /*D2 fragments*/, 34: 'prohibition' /*do not*/, 46: 'prohibition' /*never*/ },
  'memory-notes.md': { 22: 'prohibition' /*never*/, 37: 'prohibition' /*no X*/, 55: 'description' /*D9 remember that + fact*/ },
  'night-shift-handover.md': { 23: 'rule', 24: 'rule', 26: 'rule', 27: 'rule', 29: 'rule', 30: 'rule', 32: 'rule', 33: 'rule', 35: 'rule', 36: 'rule' /*D3 instruction table*/, 40: 'gate' /*first ... second*/, 49: 'gate' /*before you leave*/, 56: 'prohibition' /*do not ask*/, 57: 'gate' /*until an event*/ },
  'refund-desk-skill.md': { 1: 'none', 7: 'description' /*D5 use it when*/, 24: 'rule', 25: 'rule', 26: 'rule', 27: 'rule', 28: 'rule', 33: 'rule', 34: 'rule', 36: 'rule', 37: 'rule', 39: 'rule', 40: 'rule' /*D3*/, 30: 'prohibition', 31: 'prohibition', 32: 'prohibition' /*row kind: no promise*/, 45: 'prohibition' /*cap keep to*/, 49: 'example' /*test 2*/, 56: 'prohibition', 58: 'prohibition' },
  'scheduler-reference.md': { 11: 'description', 14: 'description', 17: 'description', 20: 'description' /*D3 reference table names*/, 29: 'rule' /*condition not order*/, 41: 'gate' /*first, then*/, 59: 'gate' /*before*/, 60: 'prohibition' /*never by you*/, 66: 'gate' /*then*/, 83: 'example', 84: 'example', 85: 'example', 86: 'example', 87: 'example' /*D12*/, 94: 'description' },
  'standing-instructions.md': { 8: 'prohibition' /*no X*/, 29: 'description' /*no act asked*/, 42: 'prohibition' /*reader's own conduct*/, 58: 'prohibition' /*ask nothing else*/, 60: 'gate' /*before anything else*/, 73: 'gate' /*once*/, 76: 'prohibition' /*cap under N*/ },
  'tide-tables-skill.md': { 1: 'none' },
};
const out: string[] = []; let changed = 0;
for (const u of g2) { const e = E[u.file]?.[u.n]; if (e && e !== u.labelA) changed++; out.push(`${u.file}\t${u.n}\t${e ?? u.labelA}`); }
for (const [f, m] of Object.entries(E)) for (const n of Object.keys(m)) if (!g2.some((u) => u.file === f && u.n === Number(n))) throw new Error(`no unit ${f}#${n}`);
writeFileSync(join(here, 'annot2b-a.tsv'), out.join('\n') + '\n');
console.log('units', out.length, 'labels changed from the original author labels', changed);
