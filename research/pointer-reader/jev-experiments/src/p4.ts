// Phase 4: Jev's native `choice` question type on the span corpus (gold3 units), flat and structured windows,
// definitions inside the question or once in the state, a two-level design (instruction or not, then the kind), and the typed executor.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chunk, dir, type CallRec, type Ctx } from './arms';
import { ask, type JevBody, type Question } from './jev';
import { DEF_V2 } from './p2';
import { FILES3, TREES3, U3, offsetOf, type L3 } from './p3';
import type { TNode } from './tree';

export const L6 = ['rule', 'prohibition', 'gate', 'example', 'description', 'none'] as const;
export type Label6 = (typeof L6)[number];

// ---- the three wordings of the six definitions ----
const NONE1 = 'a heading, a bold label, a table header cell, a greeting, a thanks or a sign-off: it says nothing about the work';
export const DEF6: Record<1 | 2 | 3, Record<Label6, string>> = {
  1: { ...DEF_V2, none: NONE1 },
  2: {
    rule: 'a line that asks the reader to carry out an act, with no ban in it and no "before" or "after" ordering',
    prohibition: 'a line that bans an act: the reader must not do it',
    gate: 'a line that fixes the order of two acts: one comes first, the other after',
    example: 'a line that gives a sample, a story or a case, not an order',
    description: 'a line that only says how things are or work, and asks nothing of the reader',
    none: 'a title, a label, a table header, a greeting or a sign-off: filler with no content about the work',
  },
  3: {
    rule: 'a unit whose point is an act the reader should perform (not a ban, not an ordering of acts)',
    prohibition: 'a unit whose point is an act the reader must refrain from',
    gate: 'a unit whose point is that an act must wait for another act, or follow it',
    example: 'a unit that illustrates with a concrete case or sample text',
    description: 'a unit that informs the reader about facts, reasons or tools without telling them what to do',
    none: 'a unit that is only a heading, a label, a header cell, a greeting, thanks or a sign-off',
  },
};
const guideText = (() => {
  const g = readFileSync(join(dir, 'GUIDE3.md'), 'utf8');
  const a = g.indexOf('## Step 1'), b = g.indexOf('## Step 2');
  // verbatim from GUIDE3.md except the pointer to step 2 (the grouping step), which Jev does not see
  return g.slice(a, b).trim().replace(' (see step 2)', '');
})();
export const GUIDE_LABELS = guideText;
/** the six definitions of the annotators' guide, one per option (verbatim bullets of GUIDE3.md step 1) */
export const DEF_RICH: Record<Label6, string> = (() => {
  const out = {} as Record<Label6, string>;
  for (const line of guideText.split('\n')) { const m = /^- \*\*(\w+)\*\*: (.*)$/.exec(line); if (m && (L6 as readonly string[]).includes(m[1]!)) out[m[1] as Label6] = m[2]!; }
  for (const l of L6) if (!out[l]) throw new Error(`guide has no bullet for ${l}`);
  return out;
})();
/** invented examples (none comes from a corpus) */
const EX: Record<Label6, string[]> = {
  rule: ['Water the seedlings each morning.', 'If the lamp flickers, replace the bulb.', 'Seed trays go on the left bench.'],
  prohibition: ['Never water at noon.', 'Do not stack wet trays.', 'Nobody lends the key.'],
  gate: ['Label each tray before you stack it.', 'Stay inside until the frost warning is lifted.', 'Rinse the can first, then fill it.'],
  example: ['Case: a tray left in the sun dried out by lunch.', 'For instance, a cracked pot goes to the repair shelf.', 'Last spring a late frost cost us forty plants.'],
  description: ['The glasshouse holds eleven benches.', 'The sprinkler never runs after dark.', 'Seedlings dry out fast because the trays are shallow.'],
  none: ['Glasshouse notes', 'Thank you for reading.', 'Good luck.'],
};
export const DEF_EX: Record<Label6, string> = Object.fromEntries(L6.map((l) => [l, `${DEF_RICH[l]} Examples: ${EX[l].map((e) => `"${e}"`).join(' ')}`])) as Record<Label6, string>;
const STRONGEST = ' When a unit holds more than one kind of instruction, the strongest wins: prohibition, then gate, then rule.';

// ---- windows ----
export type Win4 = { leaves: number[]; units: L3[]; state: string };
const roleOf = (file: string) => U3.find((u) => u.file === file)!.role;
const unitsOfFile = new Map(FILES3.map((f) => [f.file, U3.filter((u) => u.file === f.file)]));

export function flatWindows(target: number, cross: boolean): Win4[] {
  const lists: L3[][] = cross ? chunk(U3, target) : FILES3.flatMap((f) => chunk(unitsOfFile.get(f.file)!, target));
  return lists.map((units) => {
    const lines: string[] = ['WINDOW'];
    let lastFile = '', lastSec = '\u0000';
    for (const u of units) {
      if (u.file !== lastFile) { lines.push(`FILE ${u.file}: ${roleOf(u.file)}`); lastFile = u.file; lastSec = '\u0000'; }
      const where = u.section || '(top)';
      if (where !== lastSec) { lines.push(`## ${where}`); lastSec = where; }
      lines.push(`[${u.g}] ${u.text}`);
    }
    return { leaves: units.map((u) => u.g), units, state: lines.join('\n') };
  });
}

type Seg = { lines: string[]; leaves: number[]; joinNext: boolean };
function structSegs(file: string): Seg[] {
  const t = TREES3[file]!;
  const g = (i: number) => offsetOf[file]! + i + 1;
  const leafLine = (i: number, ind: string) => `${ind}[${g(i)}] ${t.units[i]!.text.replace(/\s*\n\s*/g, ' ')}`;
  const segs: Seg[] = [];
  const walk = (n: TNode) => {
    for (const c of n.children) {
      if (c.kind === 'section') {
        const h = c.children.find((x) => x.kind === 'leaf')!;
        segs.push({ lines: [leafLine(h.leaves[0]!, '')], leaves: [g(h.leaves[0]!)], joinNext: false });
        walk({ ...c, children: c.children.filter((x) => x !== h) } as TNode);
      } else if (c.kind === 'frontmatter') segs.push({ lines: ['FRONT MATTER', ...c.leaves.map((i) => leafLine(i, '  '))], leaves: c.leaves.map(g), joinNext: false });
      else if (c.kind === 'paragraph') segs.push({ lines: ['PARAGRAPH', ...c.leaves.map((i) => leafLine(i, '  '))], leaves: c.leaves.map(g), joinNext: false });
      else if (c.kind === 'blockquote') segs.push({ lines: ['QUOTE', ...c.leaves.map((i) => leafLine(i, '  '))], leaves: c.leaves.map(g), joinNext: false });
      else if (c.kind === 'list') segs.push({ lines: ['LIST', ...c.leaves.map((i) => leafLine(i, '  '))], leaves: c.leaves.map(g), joinNext: false });
      else if (c.kind === 'table') {
        const lines = ['TABLE'];
        for (const r of c.children) lines.push('  ROW', ...r.leaves.map((i) => leafLine(i, '    ')));
        segs.push({ lines, leaves: c.leaves.map(g), joinNext: false });
      }
    }
  };
  walk(t.root);
  // a paragraph directly followed by a list or a table is not split from it
  for (let i = 0; i + 1 < segs.length; i++) if (segs[i]!.lines[0] === 'PARAGRAPH' && (segs[i + 1]!.lines[0] === 'LIST' || segs[i + 1]!.lines[0] === 'TABLE')) segs[i]!.joinNext = true;
  return segs;
}
export function structWindows(target: number, cross: boolean): Win4[] {
  const out: Win4[] = [];
  let cur: Array<{ file: string; seg: Seg }> = [];
  const flush = () => {
    if (!cur.length) return;
    const lines: string[] = []; let lastFile = '';
    for (const { file, seg } of cur) { if (file !== lastFile) { lines.push(`FILE ${file}: ${roleOf(file)}`); lastFile = file; } lines.push(...seg.lines); }
    const leaves = cur.flatMap((c) => c.seg.leaves);
    out.push({ leaves, units: leaves.map((g) => U3.find((u) => u.g === g)!), state: ['WINDOW', ...lines].join('\n') });
    cur = [];
  };
  for (const f of FILES3) {
    const segs = structSegs(f.file);
    segs.forEach((seg, i) => {
      cur.push({ file: f.file, seg });
      const n = cur.reduce((a, x) => a + x.seg.leaves.length, 0);
      if (n >= target && !seg.joinNext) flush();
      void i;
    });
    if (!cross) flush();
  }
  flush();
  return out;
}

// ---- questions ----
export type DefsMode = 'in' | 'state' | 'guide' | 'rich' | 'ex';
const nullCriteria = Object.fromEntries(L6.map((l) => [l, null])) as Record<Label6, null>;
export function header(mode: DefsMode, wording: 1 | 2 | 3): string {
  if (mode === 'in' || mode === 'rich' || mode === 'ex') return '';
  if (mode === 'state') return ['LABELS', ...L6.map((l) => `- ${l}: ${DEF6[wording][l]}`)].join('\n') + '\n\n';
  return `LABEL GUIDE\n${GUIDE_LABELS}\n\n`;
}
export function choiceQ(g: number, mode: DefsMode, wording: 1 | 2 | 3): Question {
  if (mode === 'rich') return { type: 'choice', instructions: `Which label does unit [${g}] of the window have?${STRONGEST}`, criteria: DEF_RICH };
  if (mode === 'ex') return { type: 'choice', instructions: `Which label does unit [${g}] of the window have?${STRONGEST}`, criteria: DEF_EX };
  if (mode === 'in') return { type: 'choice', instructions: `Which label does unit [${g}] of the window have?`, criteria: DEF6[wording] };
  return { type: 'choice', instructions: mode === 'state' ? `Using the LABELS in the state, which label does unit [${g}] of the window have?` : `Following the LABEL GUIDE in the state, which label does unit [${g}] of the window have?`, criteria: nullCriteria };
}
const L1_KEYS = ['instruction', 'example', 'description', 'none'] as const;
const L1_DEF: Record<(typeof L1_KEYS)[number], string> = { instruction: 'a unit that tells the reader to do something, never to do something, or to do one act before another', example: DEF6[1].example, description: DEF6[1].description, none: DEF6[1].none };
export function l1Q(g: number, mode: DefsMode): Question {
  if (mode === 'in') return { type: 'choice', instructions: `What is unit [${g}] of the window?`, criteria: L1_DEF };
  return { type: 'choice', instructions: `${mode === 'state' ? 'Using the LABELS in the state' : 'Following the LABEL GUIDE in the state'}, is unit [${g}] of the window an instruction (a rule, a prohibition or a gate), an example, a description, or none of these?`, criteria: Object.fromEntries(L1_KEYS.map((k) => [k, null])) as Record<string, null> };
}
export function l2Q(g: number, mode: DefsMode): Question {
  const crit = { rule: DEF6[1].rule, prohibition: DEF6[1].prohibition, gate: DEF6[1].gate };
  if (mode === 'in') return { type: 'choice', instructions: `Which kind of instruction is unit [${g}] of the window?`, criteria: crit };
  return { type: 'choice', instructions: `${mode === 'state' ? 'Using the LABELS in the state' : 'Following the LABEL GUIDE in the state'}, which kind of instruction is unit [${g}] of the window: a rule, a prohibition or a gate?`, criteria: { rule: null, prohibition: null, gate: null } };
}
const noulQ = (g: number, l: Exclude<Label6, 'none'>): Question => ({ type: 'noul', instructions: { question: `Unit [${g}] of the window: is it a ${l}? A ${l} is ${DEF_V2[l]}.` } });

// ---- designs ----
export type Design4 = { id: string; desc: string; kind: 'choice' | 'noul5' | 'tree' | 'pair' | 'probe'; windows: 'flat' | 'struct' | 'local'; target: number; cross: boolean; defs: DefsMode; wording: 1 | 2 | 3 };
const D = (id: string, desc: string, kind: Design4['kind'], windows: Design4['windows'], target: number, cross: boolean, defs: DefsMode, wording: 1 | 2 | 3 = 1): Design4 => ({ id, desc, kind, windows, target, cross, defs, wording });
const INF = 100000;
export const DESIGNS4: Design4[] = [
  D('nl-flatL', 'five yes/no questions per unit, definitions in each question, whole-file flat window (the phase 1 to 3 style, larger window)', 'noul5', 'flat', INF, false, 'in'),
  D('ch-flatS-in', 'one choice question per unit, definitions in criteria, flat window of 30 units', 'choice', 'flat', 30, false, 'in'),
  D('ch-flatL-in', 'one choice question per unit, definitions in criteria, whole-file flat window', 'choice', 'flat', INF, false, 'in'),
  D('ch-flatL-st', 'one choice question per unit, definitions once in the state, whole-file flat window', 'choice', 'flat', INF, false, 'state'),
  D('ch-structS-in', 'one choice question per unit, definitions in criteria, structured window of about 30 units', 'choice', 'struct', 30, false, 'in'),
  D('ch-structL-in', 'one choice question per unit, definitions in criteria, structured whole-file window', 'choice', 'struct', INF, false, 'in'),
  D('ch-structL-st', 'one choice question per unit, definitions once in the state, structured whole-file window', 'choice', 'struct', INF, false, 'state'),
  D('ch-structL-gd', 'one choice question per unit, the label guide of the annotators once in the state, structured whole-file window', 'choice', 'struct', INF, false, 'guide'),
  D('ch-structS-gd', 'one choice question per unit, the label guide once in the state, structured window of about 30 units', 'choice', 'struct', 30, false, 'guide'),
  D('ch-structC-gd', 'one choice question per unit, the label guide once in the state, structured window across files (about 300 units per call)', 'choice', 'struct', 300, true, 'guide'),
  D('ch-structW-gd', 'one choice question per unit, the label guide once in the state, structured window with all 566 units in one call', 'choice', 'struct', 100000, true, 'guide'),
  D('ch-flatW-st', 'one choice question per unit, definitions once in the state, flat window with all 566 units in one call', 'choice', 'flat', 100000, true, 'state'),
  D('ch-flatC-st', 'one choice question per unit, definitions once in the state, flat window across files (about 300 units per call)', 'choice', 'flat', 300, true, 'state'),
  D('tr-structL-in', 'two levels: instruction or not, then the kind; definitions in criteria; structured whole-file window', 'tree', 'struct', INF, false, 'in'),
  D('tr-structL-gd', 'two levels: instruction or not, then the kind; guide in the state; structured whole-file window', 'tree', 'struct', INF, false, 'guide'),
  D('ch-structS-rich', 'one choice question per unit, the annotators\' definitions in criteria, structured window of about 30 units', 'choice', 'struct', 30, false, 'rich'),
  D('ch-structL-rich', 'one choice question per unit, the annotators\' definitions in criteria, structured whole-file window', 'choice', 'struct', INF, false, 'rich'),
  D('ch-structS-ex', 'one choice question per unit, the annotators\' definitions and three invented examples per option in criteria, structured window of about 30 units', 'choice', 'struct', 30, false, 'ex'),
  D('ch-structL-ex', 'one choice question per unit, the annotators\' definitions and three invented examples per option in criteria, structured whole-file window', 'choice', 'struct', INF, false, 'ex'),
  D('ch-local-in', 'one choice question per call: the unit\'s block with the block before and after, definitions in criteria', 'choice', 'local', 1, false, 'in'),
  D('ch-local-rich', 'one choice question per call: the unit\'s block with the block before and after, the annotators\' definitions in criteria', 'choice', 'local', 1, false, 'rich'),
  D('ch-structA-in', 'one choice question per unit, definitions in criteria, structured window across files (about 140 units per call)', 'choice', 'struct', 140, true, 'in'),
  D('pr-structS', 'twenty-four yes/no probes per unit (one property each), structured window of about 30 units', 'probe', 'struct', 30, false, 'in'),
  D('pc-structL', 'pair question (joined, separate, not an instruction) for every neighbour pair, structured whole-file window', 'pair', 'struct', INF, false, 'in'),
  D('pc-structS', 'pair question for every neighbour pair, structured window of about 30 units', 'pair', 'struct', 30, false, 'in'),
  D('ch-structL-in-w2', 'as ch-structL-in with the second wording of the definitions', 'choice', 'struct', INF, false, 'in', 2),
  D('ch-structL-in-w3', 'as ch-structL-in with the third wording of the definitions', 'choice', 'struct', INF, false, 'in', 3),
  D('ch-structL-st-w2', 'as ch-structL-st with the second wording of the definitions', 'choice', 'struct', INF, false, 'state', 2),
  D('ch-structL-st-w3', 'as ch-structL-st with the third wording of the definitions', 'choice', 'struct', INF, false, 'state', 3),
];
// ---- probes: yes/no questions about one property of a unit; a calibrated head combines them (Jev as a feature extractor) ----
export const PROBES: Array<[string, string]> = [
  ['imperative', 'Is unit [G] written as a command to the reader, in the imperative mood?'],
  ['duty', 'Does unit [G] say something the reader or the assistant must do or must make sure of, even if it is not worded as a command?'],
  ['case', 'Does unit [G] say what to do in a particular case, or when a condition holds?'],
  ['forbid', 'Does unit [G] forbid something: never, do not, no X, avoid, leave out, must not?'],
  ['limit', 'Does unit [G] allow something only in a limited case, only for some people, or only up to a limit?'],
  ['order', 'Does unit [G] say that one act must come before, after or together with another act?'],
  ['sequence', 'Is unit [G] a step in a sequence of acts (first, then, next, finally)?'],
  ['example', 'Is unit [G] an example, a sample, a case or a story of something that happened?'],
  ['quote', 'Is unit [G] a quoted sample message or sample wording?'],
  ['tool', 'Does unit [G] describe how a tool, a system or a thing behaves or what it returns?'],
  ['other', 'Does unit [G] say what someone other than the reader does, such as a volunteer, the office, a manager or a customer?'],
  ['reason', 'Does unit [G] give a reason, a background fact or an explanation?'],
  ['heading', 'Is unit [G] a heading, a title or a label for what follows?'],
  ['closing', 'Is unit [G] a greeting, a thanks, a good-luck line or a sign-off?'],
  ['fragment', 'Is unit [G] a fragment without a verb, such as a noun phrase or a short label?'],
  ['cellname', 'Is unit [G] a table cell that only names a case, a row or a value?'],
  ['continues', 'Does unit [G] need the unit before it to be understood or applied?'],
  ['leadin', 'Does unit [G] introduce what follows it, such as a list or a table?'],
  ['you', 'Does unit [G] speak to the reader as "you" or give a command?'],
  ['strong', 'Does unit [G] say that something is required or forbidden, in firm words?'],
  ['fact', 'Does unit [G] state a plain fact about the shop, the people or the world?'],
  ['soft', 'Is unit [G] only a soft suggestion or a preference rather than a firm instruction?'],
  ['whoreads', 'Is unit [G] addressed to the assistant that reads this file, rather than to someone else?'],
  ['complete', 'Does unit [G] make complete sense as a stand-alone sentence?'],
];
export const probeQ = (g: number, k: number): Question => ({ type: 'noul', instructions: PROBES[k]![1].replace('[G]', `[${g}]`) });

// ---- pair question (native choice): how does unit b relate to unit a? ----
const PAIR_CRIT = (a: number, b: number): Record<string, string> => ({
  joined: `unit [${b}] belongs to the same instruction as unit [${a}]: a condition and its action, a rule and its exception or detail, a lead-in and its list items, or the cells of one table row that together say what to do`,
  separate: `unit [${b}] is a separate instruction, apart from unit [${a}]`,
  not_instruction: `unit [${b}] is not an instruction: it is background, a reason, an example, a heading or a label`,
});
export const pairQ = (a: number, b: number): Question => ({ type: 'choice', instructions: `How does unit [${b}] of the window relate to unit [${a}]?`, criteria: PAIR_CRIT(a, b) });
export const design4 = (id: string) => { const d = DESIGNS4.find((x) => x.id === id); if (!d) throw new Error(`unknown design ${id}`); return d; };
/** one window per unit: the unit's own block with the block before and the block after, under the file line and the section heading */
export function localWindows(): Win4[] {
  const out: Win4[] = [];
  for (const f of FILES3) {
    const segs = structSegs(f.file);
    let heading: Seg | undefined;
    segs.forEach((seg, i) => {
      const isHeading = seg.lines.length === 1 && seg.lines[0]!.includes(' #');
      if (isHeading || (seg.lines.length === 1 && /^\[\d+\] #/.test(seg.lines[0]!))) heading = seg;
      const around = [segs[i - 1], seg, segs[i + 1]].filter((x): x is Seg => !!x);
      const lines: string[] = [`FILE ${f.file}: ${roleOf(f.file)}`];
      if (heading && !around.includes(heading)) lines.push(...heading.lines, '...');
      for (const a of around) lines.push(...a.lines);
      for (const g of seg.leaves) out.push({ leaves: [g], units: [U3.find((u) => u.g === g)!], state: ['WINDOW', ...lines].join('\n') });
    });
  }
  return out.sort((a, b) => a.leaves[0]! - b.leaves[0]!);
}
export const windowsOf = (d: Design4): Win4[] => (d.windows === 'flat' ? flatWindows(d.target, d.cross) : d.windows === 'local' ? localWindows() : structWindows(d.target, d.cross));

// ---- executor for typed answers ----
type Meta = { g: number; fam: string; kind: 'choice' | 'noul'; key?: string };
type Planned4 = { body: JevBody; leaves: number[]; names: Map<string, Meta> };
export type Run4 = { runId: string; design: string; pass: number; desc: string; calls: CallRec[]; probs: Record<number, Record<string, number>>; asked: number; missing: number; wallMs: number; stage?: string };

export async function executeTyped(ctx: Ctx, runId: string, planned: Planned4[], probs: Run4['probs'] = {}): Promise<{ calls: CallRec[]; probs: Run4['probs']; asked: number; missing: number; wallMs: number }> {
  const calls: CallRec[] = new Array(planned.length);
  let asked = 0, missing = 0, next = 0;
  const t0 = Date.now();
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= planned.length) return;
      const p = planned[i]!;
      let r;
      try { r = await ask(ctx.cfg, p.body, runId, ctx.cassette); } catch (e) { r = { ok: false, status: -1, ms: 0, answers: {} as Record<string, number>, typed: undefined, raw: null, error: String((e as Error).message) } as Awaited<ReturnType<typeof ask>>; }
      asked += p.names.size;
      for (const [name, m] of p.names) {
        const a = r.typed?.[name];
        if (!r.ok || !a) { missing++; continue; }
        const pr = (probs[m.g] ??= {});
        if (m.kind === 'noul') { if (typeof a.noul === 'number') pr[`${m.fam}:${m.key}`] = a.noul; else missing++; }
        else if (a.probabilities && typeof a.confidence === 'number') { for (const [o, v] of Object.entries(a.probabilities)) pr[`${m.fam}:${o}`] = v; pr[`${m.fam}:_conf`] = a.confidence; }
        else missing++;
      }
      const u = (r.raw as { usage?: { input_tokens?: number; output_tokens?: number } } | null)?.usage;
      calls[i] = { i, first: p.leaves[0] ?? 0, last: p.leaves.at(-1) ?? 0, units: p.leaves.length, nq: p.names.size, ms: r.ms, ok: r.ok, status: r.status, ...(r.error ? { error: r.error } : {}), ...(r.cached ? { cached: true } : {}), tokIn: u?.input_tokens ?? 0, tokOut: u?.output_tokens ?? 0 };
    }
  };
  await Promise.all(Array.from({ length: ctx.conc }, worker));
  return { calls, probs, asked, missing, wallMs: Date.now() - t0 };
}

export function plannedFor(d: Design4, model: string, only?: (g: number) => boolean, fam = 'ch'): Planned4[] {
  const wins = windowsOf(d);
  return wins.flatMap((w) => {
    const us = w.units.filter((u) => !only || only(u.g));
    if (!us.length) return [];
    const questions: Record<string, Question> = {}; const names = new Map<string, Meta>();
    if (d.kind === 'pair') {
      for (let i = 0; i + 1 < w.units.length; i++) {
        const A = w.units[i]!, B = w.units[i + 1]!;
        if (A.file !== B.file || (only && !only(A.g))) continue;
        const n = `p${A.g}`; questions[n] = pairQ(A.g, B.g); names.set(n, { g: A.g, fam: 'pc', kind: 'choice' });
      }
      if (!names.size) return [];
      return [{ body: { model, state: w.state, questions }, leaves: us.map((u) => u.g), names }];
    }
    if (d.kind === 'probe') for (const u of us) for (let k = 0; k < PROBES.length; k++) { const n = `u${u.g}__${PROBES[k]![0]}`; questions[n] = probeQ(u.g, k); names.set(n, { g: u.g, fam: 'pr', kind: 'noul', key: PROBES[k]![0] }); }
    else if (d.kind === 'noul5') for (const u of us) for (const l of L6.filter((x) => x !== 'none')) { const n = `u${u.g}__${l}`; questions[n] = noulQ(u.g, l as Exclude<Label6, 'none'>); names.set(n, { g: u.g, fam: 'nl', kind: 'noul', key: l }); }
    else for (const u of us) { const n = `u${u.g}`; questions[n] = d.kind === 'tree' ? (fam === 'l1' ? l1Q(u.g, d.defs) : l2Q(u.g, d.defs)) : choiceQ(u.g, d.defs, d.wording); names.set(n, { g: u.g, fam: d.kind === 'tree' ? fam : 'ch', kind: 'choice' }); }
    const head = d.kind === 'noul5' || d.kind === 'probe' ? '' : header(d.defs, d.wording);
    return [{ body: { model, state: head + w.state, questions }, leaves: us.map((u) => u.g), names }];
  });
}

export async function runDesign4(ctx: Ctx, d: Design4, pass: number): Promise<Run4> {
  const model = ctx.cfg.model;
  const tag = model === 'jev-latest' ? '' : `@${model.replace('jev-', '')}`;
  const runId = `${d.id}${tag}-r${pass}`;
  let rec: Awaited<ReturnType<typeof executeTyped>>;
  if (d.kind === 'tree') {
    const r1 = await executeTyped(ctx, `${runId}-l1`, plannedFor(d, model, undefined, 'l1'));
    // level 2 only for the units that level 1 sends towards instruction (probability 0.3 or more)
    const routed = (g: number) => (r1.probs[g]?.['l1:instruction'] ?? 0) >= 0.3;
    const r2 = await executeTyped(ctx, `${runId}-l2`, plannedFor(d, model, routed, 'l2'), r1.probs);
    rec = { calls: [...r1.calls, ...r2.calls.map((c, i) => ({ ...c, i: r1.calls.length + i }))], probs: r2.probs, asked: r1.asked + r2.asked, missing: r1.missing + r2.missing, wallMs: r1.wallMs + r2.wallMs };
  } else rec = await executeTyped(ctx, runId, plannedFor(d, model));
  const out: Run4 = { runId, design: `${d.id}${tag}`, pass, desc: `${d.desc} [model ${model}]`, ...rec };
  mkdirSync(join(dir, 'results4'), { recursive: true });
  writeFileSync(join(dir, 'results4', `${runId}.json`), JSON.stringify(out) + '\n');
  return out;
}
