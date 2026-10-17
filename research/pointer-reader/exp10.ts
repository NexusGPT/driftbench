import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cut, fingerprint } from './src/cut';

const R = process.argv[2]!;
const names = [
  'docs/estate.md',
  'docs/validators.md',
  'docs/estate-document-roles.md',
  'examples/estates/fixture/CLAUDE.md',
  'examples/estates/fixture/.claude/skills/invoice-reconcile/SKILL.md',
  'examples/estates/fixture/.claude/skills/shipment-tracker/SKILL.md',
  'examples/estates/fixture/.claude/skills/supplier-email/SKILL.md',
  'examples/estates/fixture/.claude/agents/ledger-auditor.md',
  'README.md',
];
const sha = (t: string) => createHash('sha256').update(t).digest('hex').slice(0, 16);
// Three normalisers: A is the design (case and emphasis kept), B folds case, C folds case and strips emphasis.
const norm = (t: string) => t.normalize('NFC').replace(/\s+/g, ' ').trim();
const A = (t: string) => fingerprint(t);
const B = (t: string) => sha(norm(t).toLowerCase());
const C = (t: string) => sha(norm(t).toLowerCase().replace(/[*_`]/g, ''));

const rules: string[] = [];
for (const n of names) {
  let text = '';
  try {
    text = readFileSync(`${R}/${n}`, 'utf8');
  } catch {
    continue;
  }
  for (const u of cut(text).units)
    if ((u.container === 'sentence' || u.container === 'list_item') && u.text.length > 30 && u.text.length < 300 && !/[`|<>]/.test(u.text) && /\b(must|never|always|do not|should|only|before|after|at most|every)\b/i.test(u.text))
      rules.push(u.text);
}
const uniq = [...new Set(rules)];
let seed = 99;
const rnd = (n: number) => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0), seed % n);
const sample: string[] = [];
while (sample.length < 200 && uniq.length) sample.push(uniq.splice(rnd(uniq.length), 1)[0]!);

// Mutations are applied to the unit text; the fingerprint of the edited text is compared with the original's.
const cosmetic: Record<string, (t: string) => string> = {
  rewrap: (t) => t.split(' ').map((w, i) => (i > 0 && i % 5 === 0 ? `\n${w}` : i ? ` ${w}` : w)).join(''),
  'double-space': (t) => t.replace(/ /g, '  '),
  'trailing-space': (t) => `${t}   `,
  crlf: (t) => t.replace(/ /g, '\r\n'),
  'tabs-for-spaces': (t) => t.replace(/ /g, '\t'),
};
const semantic: Record<string, (t: string) => string | undefined> = {
  negate: (t) => (/\bnever\b/i.test(t) ? t.replace(/\bnever\b/i, 'always') : /\balways\b/i.test(t) ? t.replace(/\balways\b/i, 'never') : /\bmust\b/.test(t) ? t.replace(/\bmust\b/, 'must not') : undefined),
  'must-to-should': (t) => (/\bmust\b/.test(t) ? t.replace(/\bmust\b/, 'should') : undefined),
  number: (t) => (/\d/.test(t) ? t.replace(/\d+/, (d) => String(Number(d) + 1)) : undefined),
  'before-after': (t) => (/\bbefore\b/.test(t) ? t.replace(/\bbefore\b/, 'after') : /\bafter\b/.test(t) ? t.replace(/\bafter\b/, 'before') : undefined),
  'add-only': (t) => t.replace(/^(\S+)/, '$1 only'),
  capitalise: (t) => (/\b(?:must|never|always|not)\b/.test(t) ? t.replace(/\b(must|never|always|not)\b/, (m) => m.toUpperCase()) : undefined),
  'drop-emphasis': (t) => (/\*\*|__/.test(t) ? t.replace(/\*\*|__/g, '') : undefined),
  'swap-two-words': (t) => {
    const w = t.split(' ');
    if (w.length < 6) return undefined;
    [w[2], w[3]] = [w[3]!, w[2]!];
    return w.join(' ');
  },
};

const fps = { A, B, C };
console.log(`rules sampled: ${sample.length}`);
console.log('cosmetic edits that wrongly change the fingerprint (suspect rate):');
for (const [k, f] of Object.entries(fps)) {
  let n = 0, flagged = 0;
  const by: Record<string, number> = {};
  for (const t of sample) for (const [name, edit] of Object.entries(cosmetic)) {
    n++;
    if (f(t) !== f(edit(t))) { flagged++; by[name] = (by[name] ?? 0) + 1; }
  }
  console.log(`  normaliser ${k}: ${flagged}/${n} flagged`, JSON.stringify(by));
}
// Composed cosmetic through the real cutter: a bullet swap and a CRLF file.
let swapFlag = 0, swapN = 0;
for (const t of sample.slice(0, 100)) {
  const a = cut(`- ${t}\n`).units.find((u) => u.container === 'list_item');
  const b = cut(`* ${t}\n`).units.find((u) => u.container === 'list_item');
  const c = cut(`1. ${t.replace(/ /g, ' ')}\r\n`).units.find((u) => u.container === 'list_item');
  swapN += 2;
  if (a && b && a.fp !== b.fp) swapFlag++;
  if (a && c && a.fp !== c.fp) swapFlag++;
}
console.log(`  bullet swap (- to *) and numbering (1.) through the cutter: ${swapFlag}/${swapN} flagged`);
console.log('semantic edits that wrongly keep the fingerprint (miss rate):');
for (const [k, f] of Object.entries(fps)) {
  let n = 0, missed = 0;
  const by: Record<string, string> = {};
  const per: Record<string, { n: number; miss: number }> = {};
  for (const t of sample) for (const [name, edit] of Object.entries(semantic)) {
    const e = edit(t);
    if (e === undefined || e === t) continue;
    n++;
    per[name] ??= { n: 0, miss: 0 };
    per[name]!.n++;
    if (f(t) === f(e)) { missed++; per[name]!.miss++; }
  }
  for (const [name, v] of Object.entries(per)) if (v.miss) by[name] = `${v.miss}/${v.n}`;
  console.log(`  normaliser ${k}: ${missed}/${n} missed`, JSON.stringify(by));
}
