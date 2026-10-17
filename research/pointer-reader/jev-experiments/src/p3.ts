// Phase 3: the span corpus (gold3.json), its trees, the windows that show structure to Jev, and the question designs for
// span arms: g (top-down: "is this block one instruction?") and h (bottom-up: "do these two units belong together?").
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dir, execute, type Ctx, type GUnit, type Probs, type RunRec } from './arms';
import type { Question } from './jev';
import type { U2 } from './p2';
import { buildTree, type TNode, type Tree } from './tree';

export type L3 = U2 & { group: string | null };
export type Rule3 = { id: string; file: string; kind: string; leafG: number[]; multi: boolean; aligned: string | null; contested: boolean };
const raw = JSON.parse(readFileSync(join(dir, 'gold3.json'), 'utf8')) as { files: Array<{ file: string; offset: number; leaves: number; split: 'dev' | 'test' }>; units: Array<Omit<L3, 'role'>>; rules: Rule3[] };
export const FILES3 = raw.files;
export const RULES3 = raw.rules;
export const TREES3: Record<string, Tree> = Object.fromEntries(raw.files.map((f) => [f.file, buildTree(readFileSync(join(dir, 'prose3', f.file), 'utf8'), f.file, 'phase3-repair-cafe')]));
const roleOf = (file: string) => { const t = TREES3[file]!; const fm = t.units.filter((u) => u.container === 'front_matter_value'); return fm.at(-1)?.text ?? ''; };
export const U3: L3[] = raw.units.map((u) => ({ ...u, text: u.text.replace(/\s*\n\s*/g, ' '), role: roleOf(u.file) }));
export const byG3 = new Map(U3.map((u) => [u.g, u]));
export const offsetOf = Object.fromEntries(raw.files.map((f) => [f.file, f.offset]));

// ---- candidates and windows ----
export type CandKind = 'paragraph' | 'list' | 'row' | 'group' | 'quote';
export type Cand = { cid: number; kind: CandKind; disp: string; desc: string; file: string; leaves: number[] /* global g */; parts: number[] /* cids of members for a group */ };
type Seg = { lines: string[]; leaves: number[]; cands: Cand[]; groupId?: number };
export type SWin = { file: string; leaves: number[]; cands: Cand[]; state: string };
const gOf = (file: string, i: number) => offsetOf[file]! + i + 1;
let cidCounter = 0;
const CANDS: Cand[] = [];
const newCand = (kind: CandKind, file: string, leaves: number[], parts: number[] = []): Cand => {
  const cid = ++cidCounter;
  const prefix = { paragraph: 'P', list: 'L', row: 'R', group: 'G', quote: 'Q' }[kind];
  const c: Cand = { cid, kind, disp: `${prefix}${cid}`, desc: '', file, leaves, parts };
  CANDS.push(c);
  return c;
};

function segmentsOf(file: string): Seg[] {
  const t = TREES3[file]!;
  const segs: Seg[] = [];
  const g = (i: number) => gOf(file, i);
  const text = (i: number) => t.units[i]!.text.replace(/\s*\n\s*/g, ' ');
  const leafLine = (i: number, ind: string) => `${ind}[${g(i)}] ${text(i)}`;
  const groupOfPara = new Map<TNode, TNode>(); // paragraph -> its lead-in group
  for (const gr of t.groups) groupOfPara.set(gr.children[0]!, gr);
  const walk = (n: TNode) => {
    for (const c of n.children) {
      if (c.kind === 'section') { const h = c.children.find((x) => x.kind === 'leaf')!; segs.push({ lines: [leafLine(h.leaves[0]!, '')], leaves: [g(h.leaves[0]!)], cands: [] }); walk({ ...c, children: c.children.filter((x) => x !== h) } as TNode); }
      else if (c.kind === 'frontmatter') segs.push({ lines: ['FRONT MATTER', ...c.leaves.map((i) => leafLine(i, '  '))], leaves: c.leaves.map(g), cands: [] });
      else if (c.kind === 'paragraph' || c.kind === 'blockquote') {
        const cand = newCand(c.kind === 'paragraph' ? 'paragraph' : 'quote', file, c.leaves.map(g));
        cand.desc = `${c.kind === 'paragraph' ? 'paragraph' : 'quote'} [${cand.disp}]`;
        segs.push({ lines: [`[${cand.disp}] ${c.kind === 'paragraph' ? 'PARAGRAPH' : 'QUOTE'}`, ...c.leaves.map((i) => leafLine(i, '  '))], leaves: c.leaves.map(g), cands: [cand] });
      } else if (c.kind === 'list') {
        const cand = newCand('list', file, c.leaves.map(g));
        cand.desc = `list [${cand.disp}]`;
        segs.push({ lines: [`[${cand.disp}] LIST`, ...c.leaves.map((i) => leafLine(i, '  '))], leaves: c.leaves.map(g), cands: [cand] });
      } else if (c.kind === 'table') {
        const tcid = ++cidCounter; const tdisp = `T${tcid}`;
        const lines = [`[${tdisp}] TABLE`]; const cands: Cand[] = [];
        for (const r of c.children) { const rc = newCand('row', file, r.leaves.map(g)); rc.desc = `table row [${rc.disp}]`; cands.push(rc); lines.push(`  [${rc.disp}] ROW`, ...r.leaves.map((i) => leafLine(i, '    '))); }
        segs.push({ lines, leaves: c.leaves.map(g), cands });
      }
    }
  };
  walk(t.root);
  // lead-in groups: the paragraph segment and the next segment become one non-splittable unit with a group candidate
  let gid = 0;
  for (let i = 0; i + 1 < segs.length; i++) {
    const a = segs[i]!, b = segs[i + 1]!;
    const pa = a.cands[0];
    if (pa && pa.kind === 'paragraph' && b.lines[0]!.match(/^\[(L|T)\d+\] (LIST|TABLE)$/) && !a.groupId) {
      const kindB = b.lines[0]!.includes('TABLE') ? 'table' : 'list';
      const dispB = b.lines[0]!.match(/^\[([LT]\d+)\]/)![1]!;
      const gc = newCand('group', file, [...a.leaves, ...b.leaves], [pa.cid, ...(b.cands[0] && kindB === 'list' ? [b.cands[0].cid] : [])]);
      gc.desc = `paragraph [${pa.disp}] together with the ${kindB} [${dispB}]`;
      a.cands.push(gc); a.groupId = b.groupId = ++gid;
    }
  }
  return segs;
}
export const SWINS: SWin[] = (() => {
  const out: SWin[] = [];
  for (const f of raw.files) {
    const segs = segmentsOf(f.file);
    let cur: Seg[] = [];
    const first = (leaves: number[]) => U3.find((u) => u.g === leaves[0])!;
    const make = (ss: Seg[]): SWin => {
      const leaves = ss.flatMap((s) => s.leaves);
      return { file: f.file, leaves, cands: ss.flatMap((s) => s.cands), state: [`FILE ${f.file}: ${first(leaves).role}`, ...ss.flatMap((s) => s.lines)].join('\n') };
    };
    const wins: Seg[][] = [];
    const flush = () => { if (cur.length) wins.push(cur); cur = []; };
    segs.forEach((s, i) => {
      cur.push(s);
      const n = cur.reduce((a, x) => a + x.leaves.length, 0);
      const next = segs[i + 1];
      const sameGroup = s.groupId !== undefined && next?.groupId === s.groupId;
      if (n >= 24 && !sameGroup) flush();
    });
    flush();
    // a short tail joins the window before it, so that every window holds at least two units to pair
    if (wins.length > 1 && wins.at(-1)!.reduce((a, x) => a + x.leaves.length, 0) < 6) { const tail = wins.pop()!; wins[wins.length - 1] = [...wins.at(-1)!, ...tail]; }
    for (const w of wins) out.push(make(w));
  }
  return out;
})();
export const CANDS3 = CANDS;
export const candByCid = new Map(CANDS.map((c) => [c.cid, c]));
const pseudo = (g: number): GUnit => ({ file: '', n: 0, id: '', container: '', text: '', label: '', section: '', g });

// ---- questions ----
const q = (question: string): Question => ({ type: 'noul', instructions: { question } });
export const ONE_Q = (desc: string) => q(`Is the whole ${desc} ONE single instruction (what to do, what never to do, or in which order)? Answer yes only if everything in it belongs to that one instruction, so that no part of it could be followed or dropped alone. Answer no if it holds two or more separate instructions, if it holds background, a reason or an example next to the instruction, or if it holds no instruction.`);
export const FORBID_Q = (desc: string) => q(`Does the ${desc} forbid an act or mark an act as out of bounds (never, do not, no X, avoid, leave out)? Answer no if the never or not is about what a tool or a third party does.`);
export const ORDER_Q = (desc: string) => q(`Does the ${desc} say that one act must come before or after another act, or may happen only once another act is done?`);
export const SAME_Q = (a: number, b: number) => q(`Do units [${a}] and [${b}] of the window belong to the same instruction, so that one of them cannot be followed alone without the other (a condition and its action, a rule and its exception, a lead-in and its list items, the cells of one table row)? Answer no if the second starts a new instruction, or if either one is only background, a reason or an example.`);

export type P3Run = { runId: string; variant: string; arm: string; desc: string; calls: RunRec['calls']; probs: Record<number, Record<string, number>>; asked: number; missing: number; wallMs: number };
const save3 = (rec: P3Run) => { mkdirSync(join(dir, 'results3'), { recursive: true }); writeFileSync(join(dir, 'results3', `${rec.runId}.json`), JSON.stringify(rec) + '\n'); };

/** Arm g, block level: one question set per candidate (one, forbid, order). probs[1_000_000 + cid][key]. */
export async function runCands(ctx: Ctx, run: number, subset?: Set<string>): Promise<P3Run> {
  const runId = `g-cand-r${run}${subset ? '-' + [...subset].join('') : ''}`;
  const planned = SWINS.filter((w) => !subset || subset.has(FILES3.find((f) => f.file === w.file)!.split)).map((w) => {
    const questions: Record<string, Question> = {}; const names = new Map<string, { u: GUnit; label: string }>();
    for (const c of w.cands) for (const [k, mk] of [['one', ONE_Q], ['forbid', FORBID_Q], ['order', ORDER_Q]] as const) { const name = `c${c.cid}__${k}`; questions[name] = mk(c.desc); names.set(name, { u: pseudo(1_000_000 + c.cid), label: k }); }
    return { body: { model: ctx.cfg.model, state: w.state, questions }, units: w.leaves.map((g) => pseudo(g)), names };
  });
  const rec = await execute(ctx, runId, planned, 'arm-g', 'top-down: is this block one instruction', {}, {} as Probs);
  const out: P3Run = { runId, variant: 'g-cand', arm: 'arm-g', desc: rec.variant, calls: rec.calls, probs: rec.probs, asked: rec.asked, missing: rec.missing, wallMs: rec.wallMs };
  save3(out); return out;
}
/** Arm h, pair level: one question per adjacent pair of leaves in a window. probs[2_000_000 + g_left]['same']. */
export async function runPairs(ctx: Ctx, run: number, subset?: Set<string>): Promise<P3Run> {
  const runId = `h-pair-r${run}${subset ? '-' + [...subset].join('') : ''}`;
  const planned = SWINS.filter((w) => !subset || subset.has(FILES3.find((f) => f.file === w.file)!.split)).map((w) => {
    const questions: Record<string, Question> = {}; const names = new Map<string, { u: GUnit; label: string }>();
    for (let i = 0; i + 1 < w.leaves.length; i++) { const a = w.leaves[i]!, b = w.leaves[i + 1]!; const name = `l${a}__same`; questions[name] = SAME_Q(a, b); names.set(name, { u: pseudo(2_000_000 + a), label: 'same' }); }
    return { body: { model: ctx.cfg.model, state: w.state, questions }, units: w.leaves.map((g) => pseudo(g)), names };
  });
  const rec = await execute(ctx, runId, planned, 'arm-h', 'bottom-up: do two neighbours belong together', {}, {} as Probs);
  const out: P3Run = { runId, variant: 'h-pair', arm: 'arm-h', desc: rec.variant, calls: rec.calls, probs: rec.probs, asked: rec.asked, missing: rec.missing, wallMs: rec.wallMs };
  save3(out); return out;
}

// ---- phase 3b: other wordings of the block question and of the pair question (chosen on the dev files only) ----
const rng = (c: Cand) => `${c.leaves[0]}] to [${c.leaves.at(-1)}`;
export const G_VARIANTS: Record<string, (c: Cand) => Question> = {
  one2: (c) => q(`Does the ${c.desc} contain exactly one instruction (what to do, what never to do, or in which order), and no second separate instruction? Background, a reason or an example next to the instruction does not count as an instruction, but then the answer is still no, because the ${c.kind} holds more than the instruction.`),
  one3: (c) => q(`Could the whole ${c.desc} be written as ONE item of a checklist for the reader, losing nothing and adding nothing? Answer no if it holds several items, background or examples, or if it holds nothing to do.`),
  hasinstr: (c) => q(`Does the ${c.desc} contain at least one instruction: something the reader must do, must never do, or must do in a given order?`),
  multi: (c) => q(`Does the ${c.desc} contain two or more separate instructions, each of which a reader could follow without the others?`),
  allinstr: (c) => q(`Is every unit of the ${c.desc} part of an instruction? Answer no if any unit in it is only background, a reason, an example, a label or a heading.`),
  range: (c) => q(`Do units [${rng(c)}] of the window, taken together, make ONE single instruction (what to do, what never to do, or in which order)? Answer yes only if everything in them belongs to that one instruction, so that no part of it could be followed or dropped alone. Answer no if they hold two or more separate instructions, background, a reason or an example next to the instruction, or no instruction.`),
};
export const H_VARIANTS: Record<string, (a: number, b: number) => Question> = {
  cont: (a, b) => q(`Does unit [${b}] of the window continue the instruction that unit [${a}] begins (a condition and its action, a rule and its exception, a lead-in and its item), rather than start a new instruction or give background?`),
  newstart: (a, b) => q(`Does a new, separate instruction start at unit [${b}] of the window, apart from whatever unit [${a}] says?`),
  needs: (a, b) => q(`Would a reader need unit [${b}] of the window in order to apply unit [${a}] correctly?`),
  needsrev: (a, b) => q(`Would a reader need unit [${a}] of the window in order to understand and apply unit [${b}] correctly?`),
};
export async function runGVariants(ctx: Ctx, run: number): Promise<P3Run> {
  const runId = `g-var-r${run}`;
  const planned = SWINS.map((w) => {
    const questions: Record<string, Question> = {}; const names = new Map<string, { u: GUnit; label: string }>();
    for (const c of w.cands) for (const [k, mk] of Object.entries(G_VARIANTS)) { const name = `c${c.cid}__${k}`; questions[name] = mk(c); names.set(name, { u: pseudo(1_000_000 + c.cid), label: k }); }
    return { body: { model: ctx.cfg.model, state: w.state, questions }, units: w.leaves.map((g) => pseudo(g)), names };
  });
  const rec = await execute(ctx, runId, planned, 'arm-g', 'block question wordings', {}, {} as Probs);
  const out: P3Run = { runId, variant: 'g-var', arm: 'arm-g', desc: rec.variant, calls: rec.calls, probs: rec.probs, asked: rec.asked, missing: rec.missing, wallMs: rec.wallMs };
  save3(out); return out;
}
export async function runHVariants(ctx: Ctx, run: number): Promise<P3Run> {
  const runId = `h-var-r${run}`;
  const planned = SWINS.map((w) => {
    const questions: Record<string, Question> = {}; const names = new Map<string, { u: GUnit; label: string }>();
    for (let i = 0; i + 1 < w.leaves.length; i++) { const a = w.leaves[i]!, b = w.leaves[i + 1]!; for (const [k, mk] of Object.entries(H_VARIANTS)) { const name = `l${a}__${k}`; questions[name] = mk(a, b); names.set(name, { u: pseudo(2_000_000 + a), label: k }); } }
    return { body: { model: ctx.cfg.model, state: w.state, questions }, units: w.leaves.map((g) => pseudo(g)), names };
  });
  const rec = await execute(ctx, runId, planned, 'arm-h', 'pair question wordings', {}, {} as Probs);
  const out: P3Run = { runId, variant: 'h-var', arm: 'arm-h', desc: rec.variant, calls: rec.calls, probs: rec.probs, asked: rec.asked, missing: rec.missing, wallMs: rec.wallMs };
  save3(out); return out;
}
