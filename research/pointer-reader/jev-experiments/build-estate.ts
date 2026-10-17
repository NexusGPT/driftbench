// Builds the planted estate: reads estate-src/*.src (units written by hand with their gold label), writes
// estate/*.md, cuts them with the prototype cutter, checks that every cut unit equals the unit the author
// wrote (text and order), mints ledger ids with the prototype ledger, and writes gold.json.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cut } from '../src/cut';
import { entriesOf } from '../src/ledger';

const here = new URL('.', import.meta.url).pathname;
export const LABELS = ['rule', 'prohibition', 'gate', 'example', 'description'] as const;
const ALL = new Set<string>([...LABELS, 'none']);

type Planted = { label: string; text: string; tag?: string; kind: 'h' | 's' | 'l' | 't' | 'f' };
const files = readdirSync(join(here, 'estate-src')).filter((f) => f.endsWith('.src')).sort();
mkdirSync(join(here, 'estate'), { recursive: true });

const gold: Array<{ file: string; n: number; id: string; container: string; text: string; label: string; tag?: string; section: string }> = [];
const allCtx: Array<{ path: string; units: ReturnType<typeof cut>['units'] }> = [];
const digests: Record<string, string> = {};
let problems = 0;

for (const f of files) {
  const planted: Planted[] = [];
  const out: string[] = [];
  let fm = '';
  let prev = '';
  let tableRows = 0;
  const lines = readFileSync(join(here, 'estate-src', f), 'utf8').split('\n').filter((l) => l.trim());
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(para.join(' '), '');
    para = [];
  };
  for (const line of lines) {
    if (line.startsWith('@fm ')) {
      const [key, label, ...text] = line.slice(4).split(' | ');
      fm = `---\n${key}: ${text.join(' | ')}\n---\n`;
      planted.push({ label: label!, text: text.join(' | '), kind: 'f' });
      continue;
    }
    if (line.startsWith('#')) {
      flush();
      if (prev === 't') out.push('');
      out.push(line, '');
      planted.push({ label: 'none', text: line.replace(/^#+\s*/, ''), kind: 'h' });
      prev = 'h';
      continue;
    }
    const m = /^([slt])\s+(.*)$/.exec(line);
    if (!m) throw new Error(`${f}: bad line ${line}`);
    const kind = m[1] as 's' | 'l' | 't';
    if (kind === 't') {
      flush();
      const parts = m[2]!.split(' | ');
      const cells: string[] = [];
      for (let i = 0; i < parts.length; i += 2) {
        let label = parts[i]!;
        const tm = /^(\w+)\{(\w+)\}$/.exec(label);
        const tag = tm?.[2];
        if (tm) label = tm[1]!;
        if (!ALL.has(label)) throw new Error(`${f}: bad label ${label}`);
        planted.push({ label, text: parts[i + 1]!, kind: 't', ...(tag ? { tag } : {}) });
        cells.push(parts[i + 1]!);
      }
      out.push(`| ${cells.join(' | ')} |`);
      if (tableRows === 0) out.push(`|${cells.map(() => '---').join('|')}|`);
      tableRows++;
      prev = 't';
      continue;
    }
    if (prev === 't') out.push('');
    tableRows = 0;
    const lm = /^(\w+)(?:\{(\w+)\})?\s*\|\s*(.*)$/.exec(m[2]!);
    if (!lm || !ALL.has(lm[1]!)) throw new Error(`${f}: bad unit line ${line}`);
    const p: Planted = { label: lm[1]!, text: lm[3]!, kind, ...(lm[2] ? { tag: lm[2] } : {}) };
    planted.push(p);
    if (kind === 's') {
      if (prev !== 's') flush();
      para.push(p.text);
    } else {
      flush();
      if (prev !== 'l') {
        if (out.at(-1) !== '') out.push('');
      }
      out.push(`- ${p.text}`);
    }
    if (prev === 't' || (kind === 's' && prev !== 's')) {
      /* paragraph start */
    }
    prev = kind;
    // blank line after the last list item is added by the next flush or heading
    if (kind === 'l') {
      const next = lines[lines.indexOf(line) + 1] ?? '';
      if (!/^l\s/.test(next)) out.push('');
    }
  }
  flush();
  const md = fm + '\n' + out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  writeFileSync(join(here, 'estate', f.replace('.src', '.md')), md);
  const { units, digest } = cut(md);
  digests[f.replace('.src', '.md')] = digest;
  const opaque = units.filter((u) => u.container === 'opaque');
  if (opaque.length) { console.error(`${f}: opaque units ${opaque.length}`); problems++; }
  if (units.length !== planted.length) {
    problems++;
    console.error(`${f}: cut ${units.length} units, planted ${planted.length}`);
    const n = Math.max(units.length, planted.length);
    for (let i = 0; i < n; i++) {
      const a = units[i]?.text.replace(/^#+\s*/, '') ?? '<none>', b = planted[i]?.text ?? '<none>';
      if (a !== b) { console.error(`  first diff at ${i}:\n   cut     ${a}\n   planted ${b}`); break; }
    }
    continue;
  }
  const ents = entriesOf([{ path: f.replace('.src', '.md'), units }], 'planted-bakery');
  for (let i = 0; i < units.length; i++) {
    const u = units[i]!;
    const text = u.text.replace(/^#+\s*/, '');
    if (text !== planted[i]!.text) {
      problems++;
      console.error(`${f}: unit ${i + 1} differs\n  cut     ${text}\n  planted ${planted[i]!.text}`);
    }
    gold.push({
      file: f.replace('.src', '.md'), n: i + 1, id: ents[i]!.id, container: u.container, text: planted[i]!.text,
      label: planted[i]!.label, ...(planted[i]!.tag ? { tag: planted[i]!.tag } : {}), section: u.path.join(' > '),
    });
  }
  allCtx.push({ path: f.replace('.src', '.md'), units });
}
if (problems) { console.error(`${problems} problem(s)`); process.exit(1); }
const ids = new Set(gold.map((g) => g.id));
if (ids.size !== gold.length) { console.error('duplicate ledger ids'); process.exit(1); }
const blocksSrc = JSON.parse(readFileSync(join(here, 'blocks-src.json'), 'utf8')) as Array<{ id: string; name: string; description: string; tags: string[] }>;
const byTag = new Map(gold.filter((g) => g.tag).map((g) => [g.tag!, g]));
const blocks = blocksSrc.map((b) => ({
  id: b.id, name: b.name, description: b.description,
  units: b.tags.map((t) => { const g = byTag.get(t); if (!g) throw new Error(`block ${b.id}: unknown tag ${t}`); return g.id; }),
}));
writeFileSync(join(here, 'gold.json'), JSON.stringify({ estateKey: 'planted-bakery', cutDigests: digests, units: gold, blocks }, null, 1) + '\n');
const counts: Record<string, number> = {};
for (const g of gold) counts[g.label] = (counts[g.label] ?? 0) + 1;
console.log(`units ${gold.length} in ${files.length} files`, counts);
