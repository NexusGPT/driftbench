import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
const { ClaudeCodeReader, scanEstate } = await import('../src/index.ts');

type Item = { file: string; start: number; end: number; cls: string; text: string; positive: boolean };
const positives: Array<[string, string]> = [
  ['modal', 'The reviewer must confirm the delivery address before dispatch.'],
  ['modal', 'The courier must not leave a parcel with a neighbour.'],
  ['negative', 'Never forward a customer invoice to a third party.'],
  ['negative', 'Do not promise a refund date in writing.'],
  ['universal', 'Always record the carrier name next to the tracking number.'],
  ['conditional', 'Before closing a ticket, check the parcel status.'],
  ['conditional', 'Only when the customer agrees, share the photo.'],
  ['bound', 'At most three apologies per conversation.'],
  ['quantified', 'Every escalation records its reason.'],
  ['quantified', 'Each shift lead summarises open cases.'],
  ['passive', 'Every refund (over 50 euros) is approved by a manager.'],
  ['passive', 'Each damaged parcel is photographed at the depot.'],
  ['passive', 'Every complaint is acknowledged within one working day.'],
  ['wrapped', 'The assistant must read the whole\nthread before it replies.'],
];
const negatives: Array<[string, string]> = [
  ['example', '## Examples\n\nThe reviewer must delete the parcel record.\n\nNever answer the customer.\n\n## Back to rules'],
  ['example', '### Sample answers\n\nAlways promise a refund.\n\n### Next'],
  ['quote', '> The courier must leave parcels on the porch.'],
  ['quote', 'The old policy read "Always skip the address check" and was retired.'],
  ['quote', 'The ticket said “never call the customer” in capitals.'],
  ['quote', "A customer wrote 'you must refund me today' twice."],
  ['question', 'Must the courier photograph every parcel?'],
  ['question', 'Should the assistant never contact the vendor?'],
  ['history', '## History\n\n- 2026-03-02: The reviewer must now log every call.\n- 2026-04-09: Never close a ticket without a note.\n\n## Current'],
  ['history', '## Changelog\n\nEvery release is tagged.\n\nThe team must review the patch.\n\n## Contact'],
  ['heading', '# Never skip the audit'],
  ['heading', 'Always keep the receipt\n=======================\n'],
  ['fence', '```text\nThe assistant must delete the archive.\nAlways overwrite the file.\n```'],
  ['fence', '~~~\nNever ask for consent.\n~~~'],
  ['others', 'Maria says the vendor must deliver by Friday.'],
  ['others', 'He told us the supplier should never wait for payment.'],
  ['others', 'The customer wrote that every parcel must arrive sealed.'],
  ['others', 'The contract states that suppliers must pay within thirty days.'],
  ['past', 'Every parcel was weighed at the depot.'],
  ['past', 'Every refund has been approved by the manager.'],
  ['past', 'Each complaint had been acknowledged by Monday.'],
  ['description', 'The archive is always available to staff.'],
  ['description', 'We discussed what every courier does at the depot.'],
  ['definition', 'The word must marks an obligation in this guide.'],
  ['definition', 'The word never marks a prohibition in this guide.'],
  ['table', 'Action | Meaning\n--- | ---\nNever refund twice | Example only'],
];

let state = 424242;
const rnd = (n: number) => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0), state % n);
const filler = (i: number) => `Paragraph ${i} describes how the depot sorts parcels by size and route.`;

async function build() {
  const root = await mkdtemp(join(tmpdir(), 'measure-'));
  const items: Item[] = [];
  const specs: Array<[string, string, number]> = [['CLAUDE.md', '', 14000]];
  for (let i = 0; i < 6; i++) specs.push([`.claude/skills/s${i}/SKILL.md`, `---\nname: s${i}\ndescription: Depot skill ${i}\n---\n`, 3500]);
  for (let i = 0; i < 4; i++) specs.push([`.claude/agents/h${i}.md`, `---\nname: h${i}\ndescription: Depot helper ${i}\n---\n`, 3500]);
  let posAt = 0;
  let negAt = 0;
  for (const [file, head, paragraphs] of specs) {
    // Items are planted at random depths; positions are sorted so the file is written once, in order.
    const slots = new Map<number, Array<{ cls: string; text: string; positive: boolean }>>();
    const place = (cls: string, text: string, positive: boolean) => {
      const at = Math.floor(paragraphs * 0.1) + rnd(Math.floor(paragraphs * 0.85));
      slots.set(at, [...(slots.get(at) ?? []), { cls, text, positive }]);
    };
    for (let k = 0; k < 4; k++) { const [c, t] = positives[posAt++ % positives.length]!; place(c, t, true); }
    for (let k = 0; k < 6; k++) { const [c, t] = negatives[negAt++ % negatives.length]!; place(c, t, false); }
    const out: string[] = head ? head.replace(/\n$/, '').split('\n') : [];
    for (let p = 0; p < paragraphs; p++) {
      if (p % 40 === 0) { out.push('', `## Section ${p / 40}`); }
      out.push('', filler(p));
      for (const it of slots.get(p) ?? []) {
        out.push('');
        const start = out.length + 1;
        out.push(...it.text.split('\n'));
        const lines = it.text.split('\n').length;
        // For multi-line negatives that contain a heading/fence the whole block is the lookalike.
        items.push({ file, start, end: start + lines - 1, cls: it.cls, text: it.text, positive: it.positive });
      }
    }
    // Close any section left open by a lookalike heading: end with a rules section.
    out.push('', '## Rules', '', filler(0), '');
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), out.join('\n') + '\n');
  }
  return { root, items };
}

const { root, items } = await build();
const started = performance.now();
const result = await scanEstate({ root, reader: new ClaudeCodeReader() });
const ms = Math.round(performance.now() - started);
const predicted = result.map.atoms.filter(
  (a) => ['instruction', 'register', 'gate'].includes(a.kind) && !a.provenance.file.endsWith('.json'),
);
const byClass: Record<string, { planted: number; found: number }> = {};
let tp = 0, fpLook = 0, fpOther = 0;
const hit = new Set<Item>();
const otherSamples: string[] = [];
const lookSamples: string[] = [];
for (const a of predicted) {
  const item = items.find((it) => it.file === a.provenance.file && a.provenance.startLine <= it.end && it.start <= a.provenance.endLine);
  if (!item) { fpOther++; if (otherSamples.length < 4) otherSamples.push(a.provenance.quote.slice(0, 60)); continue; }
  if (item.positive) { if (!hit.has(item)) { hit.add(item); tp++; } }
  else { fpLook++; if (lookSamples.length < 8) lookSamples.push(`${item.cls}: ${a.provenance.quote.slice(0, 50)}`); }
  byClass[item.cls] = byClass[item.cls] ?? { planted: 0, found: 0 };
}
for (const it of items) {
  byClass[it.cls] = byClass[it.cls] ?? { planted: 0, found: 0 };
  byClass[it.cls]!.planted++;
}
for (const it of hit) byClass[it.cls]!.found++;
const pos = items.filter((i) => i.positive).length;
const neg = items.filter((i) => !i.positive).length;
const falseHits: Record<string, number> = {};
for (const a of predicted) {
  const item = items.find((it) => it.file === a.provenance.file && a.provenance.startLine <= it.end && it.start <= a.provenance.endLine);
  if (item && !item.positive) falseHits[item.cls] = (falseHits[item.cls] ?? 0) + 1;
}
console.log(JSON.stringify({ files: result.raw.files.length, chars: result.raw.files.reduce((s, f) => s + f.text.length, 0), scanMs: ms, plantedRules: pos, lookalikes: neg, predicted: predicted.length, truePositives: tp, falsePositivesOnLookalikes: fpLook, falsePositivesElsewhere: fpOther, recall: +(tp / pos).toFixed(3), precision: predicted.length ? +(tp / predicted.length).toFixed(3) : null, recallByClass: Object.fromEntries(Object.entries(byClass).filter(([k]) => items.find((i) => i.cls === k)?.positive).map(([k, v]) => [k, `${v.found}/${v.planted}`])), lookalikeHits: falseHits, lookSamples, otherSamples }, null, 1));
