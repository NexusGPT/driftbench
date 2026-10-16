import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { AtomBuilder, ClaudeCodeReader, codeAtoms, proseCandidates } from '../src/index.ts';
import { buildCorpus } from '../test/scan/prose-corpus.ts';
import { buildHeldOutCorpus } from '../test/scan/prose-corpus-heldout.ts';

const items = process.env.HELDOUT ? buildHeldOutCorpus() : buildCorpus();
const root = await mkdtemp(join(tmpdir(), 'corpus-'));
const main: string[] = [];
const spans: Array<{ item: (typeof items)[number]; start: number; end: number }> = [];
let line = 1;
const push = (text: string) => { const parts = text.split('\n'); main.push(...parts); line += parts.length; };
for (let i = 0; i < items.length; i++) {
  const item = items[i]!;
  if (item.files) {
    for (const [path, text] of Object.entries(item.files)) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), text); }
    continue;
  }
  push(''); push(`Filler paragraph ${i} describes how the depot sorts parcels by size.`); push('');
  const parts = item.text.split('\n');
  spans.push({ item, start: line, end: line + parts.length - 1 });
  push(item.text);
}
await mkdir(join(root, '.claude/skills/depot/references'), { recursive: true });
await writeFile(join(root, '.claude/skills/depot/SKILL.md'), '---\nname: ledger\ndescription: Ledger work\n---\nSee references.\n');
await writeFile(join(root, '.claude/skills/depot/references/guide.md'), '# Guide\n\nAlways close the stream.\n');
await writeFile(join(root, 'CLAUDE.md'), main.join('\n') + '\n');
const raw = await new ClaudeCodeReader().read(root);
const builder = new AtomBuilder(new Map(raw.files.map((f) => [f.path, f])));
codeAtoms(raw, builder);
const t = performance.now();
const atoms = proseCandidates(raw, builder);
const ms = Math.round(performance.now() - t);
const stat: Record<string, { n: number; hit: number; partialHit: number; samples: string[] }> = {};
const s = (c: string) => (stat[c] ??= { n: 0, hit: 0, partialHit: 0, samples: [] });
for (const { item, start, end } of spans) {
  const hits = atoms.filter((a) => a.provenance.file === 'CLAUDE.md' && a.provenance.startLine <= end && start <= a.provenance.endLine);
  const e = s(item.cls); e.n++;
  if (hits.length) { e.hit++; if (hits.some((h) => h.fields?.partial)) e.partialHit++; }
  const bad = item.positive ? !hits.length : hits.length > 0;
  if (bad && e.samples.length < (process.env.SAMPLES ? Number(process.env.SAMPLES) : 3)) e.samples.push(item.text.replace(/\n/g, '⏎').slice(0, 80));
}
for (const item of items) {
  if (!item.path) continue;
  const e = s('vendored'); e.n++;
  if (atoms.some((a) => a.provenance.file === item.path)) { e.hit++; e.samples.push(item.path); }
}
const e = s('control'); e.n = 1; e.hit = atoms.some((a) => a.provenance.file.endsWith('references/guide.md')) ? 1 : 0;
const pos = new Set(['imperative','output-style','only-when','modal-never-before','habit-in-rules-section','control']);
let tp = 0, np = 0, fp = 0, nn = 0;
for (const [c, v] of Object.entries(stat)) {
  const ok = pos.has(c);
  const label = c === 'fragment' ? 'fragment(found/partial-flagged)' : c;
  console.log(label.padEnd(34), ok ? `recall ${v.hit}/${v.n}` : c === 'fragment' ? `found ${v.hit}/${v.n}, flagged partial ${v.partialHit}` : `false proposals ${v.hit}/${v.n}`, v.samples.length ? ' e.g. ' + v.samples.join(' || ') : '');
  if (ok) { tp += v.hit; np += v.n } else if (c !== 'fragment') { fp += v.hit; nn += v.n }
}
console.log(`TOTAL positives found ${tp}/${np} (${(tp / np).toFixed(3)}); lookalike false proposals ${fp}/${nn}; precision ${(tp / (tp + fp)).toFixed(3)}; pass ms ${ms}`);
import { readFileSync } from 'node:fs';
if (process.env.HEAD) {
  const fileLines = readFileSync(join(root, 'CLAUDE.md'), 'utf8').split('\n');
  for (const { item, start, end } of spans) {
    if (item.cls !== process.env.HEAD) continue;
    const hits = atoms.filter((a) => a.provenance.file === 'CLAUDE.md' && a.provenance.startLine <= end && start <= a.provenance.endLine);
    if (!hits.length) continue;
    let h = start; while (h > 0 && !/^#{1,6}\s/.test(fileLines[h - 1]!)) h--;
    console.log('FP', JSON.stringify(item.text.slice(0, 60)), 'heading:', fileLines[h - 1]);
  }
}
