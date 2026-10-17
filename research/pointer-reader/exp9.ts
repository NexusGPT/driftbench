import { readFileSync } from 'node:fs';
import { cut, type Unit } from './src/cut';
import { entriesOf, norm, reanchor, type Entry, type Options } from './src/ledger';

const R = process.argv[2]!;
const names = [
  'docs/estate.md', 'docs/estate-document-roles.md', 'docs/estate-pointer-reader.md', 'docs/validators.md',
  'examples/estates/fixture/CLAUDE.md', 'examples/estates/fixture/.claude/skills/invoice-reconcile/SKILL.md',
  'examples/estates/fixture/.claude/skills/shipment-tracker/SKILL.md', 'examples/estates/fixture/.claude/skills/supplier-email/SKILL.md',
  'examples/estates/fixture/.claude/agents/ledger-auditor.md', 'examples/estates/fixture/.claude/agents/inbox-triager.md',
  'README.md', 'docs/getting-started.md',
];
const base = new Map<string, string>();
for (const n of names) {
  try { base.set(n, readFileSync(`${R}/${n}`, 'utf8')); } catch { /* absent */ }
}
let seed = 17;
const rnd = (n: number) => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0), seed % n);
const pick = <T,>(a: T[]) => a[rnd(a.length)]!;

const cache = new Map<string, Unit[]>();
const cutCached = (text: string) => { let u = cache.get(text); if (!u) { u = cut(text).units; cache.set(text, u); } return u; };
const cutAll = (files: Map<string, string>) => [...files].map(([path, text]) => ({ path, units: cutCached(text) }));
const pool = [
  'The depot keeps a separate ledger for every season.', 'Archive the signed form after the second review.',
  'Tell the courier which dock opens first on Mondays.', 'Weigh each crate before it leaves the warehouse floor.',
  'A reader may renew a loan twice without a fee.', 'Send the final totals to the office before noon.',
];
const eligible = (u: Unit, kind: 'sentence' | 'list_item' | 'any') =>
  (u.container === 'sentence' || u.container === 'list_item') && (kind === 'any' || u.container === kind) &&
  u.text.split(/\s+/).length >= 7 && u.text.length < 400 && !/[`|<>\[\]]/.test(u.text) && !/^\s*\*\*/.test(u.text);

type Edit = { files: Map<string, string>; expect: { event: string[]; toText?: string[] | 'any-same-fp' } };
function splice(src: string, start: number, end: number, rep: string) { return src.slice(0, start) + rep + src.slice(end); }

const classes: Record<string, () => (Edit & { target: { path: string; unit: Unit } }) | undefined> = {
  reflow: () => {
    const path = pick([...base.keys()]); const units = cutCached(base.get(path)!).filter((u) => eligible(u, 'sentence'));
    if (!units.length) return;
    const u = pick(units); const words = u.text.split(' ');
    const wrapped = words.map((w, i) => (i > 0 && i % 4 === 0 ? `\n${w}` : (i > 0 ? ` ${w}` : w))).join('');
    const files = new Map(base); files.set(path, splice(base.get(path)!, u.start, u.end, wrapped));
    return { files, expect: { event: ['unchanged'] }, target: { path, unit: u } };
  },
  'small-reword': () => {
    const path = pick([...base.keys()]); const units = cutCached(base.get(path)!).filter((u) => eligible(u, 'any'));
    if (!units.length) return;
    const u = pick(units); const words = u.text.split(' ');
    const i = 1 + rnd(words.length - 2);
    words.splice(i, 1, words[i] === 'the' ? 'a' : 'the');
    if (rnd(2)) words.splice(i + 1, 0, 'usually');
    const text = words.join(' ');
    const files = new Map(base); files.set(path, splice(base.get(path)!, u.start, u.end, text));
    return { files, expect: { event: ['changed'], toText: [text] }, target: { path, unit: u } };
  },
  'large-reword': () => {
    const path = pick([...base.keys()]); const units = cutCached(base.get(path)!).filter((u) => eligible(u, 'any'));
    if (!units.length) return;
    const u = pick(units); const text = pick(pool);
    const files = new Map(base); files.set(path, splice(base.get(path)!, u.start, u.end, text));
    return { files, expect: { event: ['deleted'] }, target: { path, unit: u } };
  },
  'move-in-file': () => {
    const path = pick([...base.keys()]); const units = cutCached(base.get(path)!);
    const items = units.filter((u) => eligible(u, 'list_item'));
    if (items.length < 4) return;
    const u = pick(items); const dest = items[(items.indexOf(u) + 2 + rnd(items.length - 3)) % items.length]!;
    if (dest === u || Math.abs(dest.start - u.start) < 5) return;
    let src = base.get(path)!; const line = src.slice(u.start, u.end);
    // remove the item's own text, keep the marker; then place a copy as new text of the destination's following item
    const lineStart = src.lastIndexOf('\n', u.start) + 1; const lineEnd = src.indexOf('\n', u.end); const full = src.slice(lineStart, lineEnd < 0 ? src.length : lineEnd + 1);
    const marker = src.slice(lineStart, u.start);
    if (!/^\s*(?:[-*+]|\d+[.)])\s+$/.test(marker)) return;
    const destLineEnd = src.indexOf('\n', dest.end); if (destLineEnd < 0) return;
    const insertAt = destLineEnd + 1;
    if (insertAt > lineStart && insertAt < lineStart + full.length) return;
    const ins = `${marker}${line}\n`;
    if (insertAt > lineStart) { src = src.slice(0, insertAt) + ins + src.slice(insertAt); src = src.slice(0, lineStart) + src.slice(lineStart + full.length); }
    else { src = src.slice(0, lineStart) + src.slice(lineStart + full.length); src = src.slice(0, insertAt) + ins + src.slice(insertAt); }
    const files = new Map(base); files.set(path, src);
    return { files, expect: { event: ['moved', 'unchanged'], toText: 'any-same-fp' }, target: { path, unit: u } };
  },
  'move-across-files': () => {
    const paths = [...base.keys()]; const path = pick(paths); const other = pick(paths.filter((p) => p !== path));
    const units = cutCached(base.get(path)!).filter((u) => eligible(u, 'list_item'));
    if (!units.length) return;
    const u = pick(units); const src = base.get(path)!;
    const lineStart = src.lastIndexOf('\n', u.start) + 1; const lineEnd = src.indexOf('\n', u.end);
    const marker = src.slice(lineStart, u.start); if (!/^\s*(?:[-*+]|\d+[.)])\s+$/.test(marker)) return;
    const files = new Map(base);
    files.set(path, src.slice(0, lineStart) + src.slice(lineEnd < 0 ? src.length : lineEnd + 1));
    files.set(other, `${base.get(other)!.trimEnd()}\n\n- ${u.text}\n`);
    return { files, expect: { event: ['moved'], toText: [u.text] }, target: { path, unit: u } };
  },
  split: () => {
    const path = pick([...base.keys()]); const units = cutCached(base.get(path)!).filter((u) => eligible(u, 'sentence') && /, (?:and|but) [a-z]/.test(u.text));
    if (!units.length) return;
    const u = pick(units); const m = /, (and|but) ([a-z])/.exec(u.text)!;
    const a = u.text.slice(0, m.index) + '.'; const b = `${m[2]!.toUpperCase()}${u.text.slice(m.index + m[0].length)}`;
    const files = new Map(base); files.set(path, splice(base.get(path)!, u.start, u.end, `${a} ${b}`));
    return { files, expect: { event: ['split'], toText: [a, b] }, target: { path, unit: u } };
  },
  merge: () => {
    const path = pick([...base.keys()]); const units = cutCached(base.get(path)!);
    const pairs: Array<[Unit, Unit]> = [];
    for (let i = 0; i + 1 < units.length; i++) { const a = units[i]!, b = units[i + 1]!; if (eligible(a, 'sentence') && eligible(b, 'sentence') && /^\s{1,2}$/.test(base.get(path)!.slice(a.end, b.start)) && /^[A-Z]/.test(b.text) && a.text.endsWith('.')) pairs.push([a, b]); }
    if (!pairs.length) return;
    const [a, b] = pick(pairs); const joined = `${a.text.slice(0, -1)}, and ${b.text[0]!.toLowerCase()}${b.text.slice(1)}`;
    const files = new Map(base); files.set(path, splice(base.get(path)!, a.start, b.end, joined));
    return { files, expect: { event: ['merged'], toText: [joined] }, target: { path, unit: a } };
  },
  delete: () => {
    const path = pick([...base.keys()]); const units = cutCached(base.get(path)!).filter((u) => eligible(u, 'sentence'));
    if (!units.length) return;
    const u = pick(units); const files = new Map(base);
    files.set(path, splice(base.get(path)!, u.start, u.end + 1, ''));
    return { files, expect: { event: ['deleted'] }, target: { path, unit: u } };
  },
  'duplicate-boilerplate': () => {
    const paths = [...base.keys()]; const path = pick(paths); const units = cutCached(base.get(path)!).filter((u) => eligible(u, 'sentence'));
    if (!units.length) return;
    const u = pick(units); const others = paths.filter((p) => p !== path).slice(0, 2);
    // the old state already holds the sentence in two other files; the edit deletes the original only
    const oldFiles = new Map(base); for (const o of others) oldFiles.set(o, `${base.get(o)!.trimEnd()}\n\n${u.text}\n`);
    const files = new Map(oldFiles); files.set(path, splice(base.get(path)!, u.start, u.end + 1, ''));
    return { files, expect: { event: ['deleted'] }, target: { path, unit: u }, oldFiles } as never;
  },
};

type Row = { cls: string; ok: boolean; wrong: boolean; falseDelete: boolean; event: string };
function run(opts: Options, trials: number): Row[] {
  seed = 17;
  const rows: Row[] = [];
  for (const [cls, make] of Object.entries(classes)) {
    let done = 0, tries = 0;
    while (done < trials && tries++ < trials * 40) {
      const e = make() as (Edit & { target: { path: string; unit: Unit }; oldFiles?: Map<string, string> }) | undefined;
      if (!e) continue;
      const oldFiles = e.oldFiles ?? base;
      const oldC = cutAll(oldFiles), newC = cutAll(e.files);
      const oldE = entriesOf(oldC), newE = entriesOf(newC);
      const targetOld = oldE.filter((x) => x.path === e.target.path).find((x) => x.fp === e.target.unit.fp);
      if (!targetOld) continue;
      // skip when the target text occurs more than once in its file (identity would be ambiguous by construction)
      if (oldE.filter((x) => x.path === e.target.path && x.fp === e.target.unit.fp).length > 1) continue;
      const res = reanchor(oldE, newE, opts);
      const r = res.get(targetOld.id)!;
      const want = e.expect;
      let ok = want.event.includes(r.event);
      let wrong = false;
      if (ok && want.toText) {
        const tos = (r.to ?? []).map((t) => t.text);
        if (want.toText === 'any-same-fp') ok = (r.to ?? []).every((t) => t.fp === targetOld.fp);
        else ok = want.toText.every((w) => tos.some((t) => norm(t).startsWith(norm(w).slice(0, 40)) || norm(w).startsWith(norm(t).slice(0, 40))));
      }
      if (!ok && r.event !== 'deleted' && want.event[0] !== 'deleted') wrong = true;
      if (!ok && r.event !== 'deleted' && want.event[0] === 'deleted') wrong = true;
      rows.push({ cls, ok, wrong, falseDelete: !ok && r.event === 'deleted' && want.event[0] !== 'deleted', event: r.event });
      done++;
    }
  }
  return rows;
}
const summarize = (rows: Row[]) => {
  const by: Record<string, { n: number; ok: number }> = {};
  for (const r of rows) { by[r.cls] ??= { n: 0, ok: 0 }; by[r.cls]!.n++; if (r.ok) by[r.cls]!.ok++; }
  return { accuracy: +(rows.filter((r) => r.ok).length / rows.length).toFixed(3), wrongAnchors: rows.filter((r) => r.wrong).length, falseDeletes: rows.filter((r) => r.falseDelete).length, n: rows.length, byClass: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, `${v.ok}/${v.n}`])) };
};
console.log('files', base.size);
const trials = Number(process.env.TRIALS ?? 50);
console.log('FULL    0.45', JSON.stringify(summarize(run({ threshold: 0.45, floor: 12, ladder: 'full' }, trials))));
console.log('FULL+floor0.4', JSON.stringify(summarize(run({ threshold: 0.45, floor: 12, ladder: 'full', textFloor: 0.4 }, trials))));
console.log('DIFFONLY    ', JSON.stringify(summarize(run({ threshold: 0.45, floor: 12, ladder: 'diff-only' }, trials))));
for (const f of [0.3, 0.5]) {
  const s = summarize(run({ threshold: 0.45, floor: 12, ladder: 'full', textFloor: f }, trials));
  console.log('textFloor', f, JSON.stringify({ accuracy: s.accuracy, wrongAnchors: s.wrongAnchors, falseDeletes: s.falseDeletes, byClass: s.byClass }));
}
for (const t of [0.3, 0.6, 0.7]) {
  const s = summarize(run({ threshold: t, floor: 12, ladder: 'full', textFloor: 0.4 }, trials));
  console.log('threshold', t, 'with floor 0.4', JSON.stringify({ accuracy: s.accuracy, wrongAnchors: s.wrongAnchors, falseDeletes: s.falseDeletes }));
}
