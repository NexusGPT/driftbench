// Phase 2: the held-out prose set (gold2.json), question designs for each arm, and the decoders.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dir, chunk, execute, type Ctx, type GUnit, type Probs, type RunRec } from './arms';
import type { Question } from './jev';

export const L5 = ['rule', 'prohibition', 'gate', 'example', 'description'] as const;
export type Label5 = (typeof L5)[number];
export type U2 = { file: string; n: number; id: string; text: string; section: string; label: string; labelA: string; labelB: string; contested: boolean; split: 'dev' | 'test'; g: number; role: string };
const raw = JSON.parse(readFileSync(join(dir, 'gold2.json'), 'utf8')) as { units: Omit<U2, 'role'>[] };
const rolesByFile = new Map<string, string>();
for (const u of raw.units) if (u.n === 1 && u.section === '') rolesByFile.set(u.file, u.text);
export const U: U2[] = raw.units.map((u) => ({ ...u, text: u.text.replace(/\s*\n\s*/g, ' '), role: rolesByFile.get(u.file) ?? '' }));

export type Ctxmode = 'none' | 'path' | 'role';
export function window2(units: U2[], ctx: Ctxmode): string {
  const lines = ['WINDOW'];
  let last = '\u0000', lastFile = '';
  for (const u of units) {
    if (ctx === 'role' && u.file !== lastFile) { lines.push(`FILE ${u.file}: ${u.role}`); lastFile = u.file; }
    if (ctx !== 'none') {
      const where = u.section || '(top)';
      if (where !== last) { lines.push(`## ${where}`); last = where; }
    }
    lines.push(`[${u.g}] ${u.text}`);
  }
  return lines.join('\n');
}

const q = (question: string): Question => ({ type: 'noul', instructions: { question } });
export type Variant = {
  id: string; arm: string; desc: string; perWindow: number; ctx: Ctxmode;
  /** question key -> question text, for one unit */
  ask: (u: U2) => Record<string, Question>;
};

// ---- wording sets (all invented; none copied from gold2) ----
export const DEF_V2: Record<Label5, string> = {
  rule: 'a unit that tells the reader to do something, and neither forbids anything nor sets an order between two acts',
  prohibition: 'a unit that tells the reader never to do something',
  gate: 'a unit that says one act must come before another',
  example: 'a unit that shows a case and is not itself an instruction',
  description: 'a unit that states how something is and tells the reader neither to do nor to avoid anything',
};
export const baseQ = (u: U2, l: Label5) => q(`Unit [${u.g}] of the window: is it a ${l}? A ${l} is ${DEF_V2[l]}.`);

// paraphrases of the same five definitions (arm c)
const DEF_P2: Record<Label5, string> = {
  rule: 'a line that asks the reader to carry out an act, with no ban in it and no "before" or "after" ordering',
  prohibition: 'a line that bans an act: the reader must not do it',
  gate: 'a line that fixes the order of two acts: one comes first, the other after',
  example: 'a line that gives a sample, a story or a case, not an order',
  description: 'a line that only says how things are or work, and asks nothing of the reader',
};
const DEF_P3: Record<Label5, string> = {
  rule: 'a unit whose point is an act the reader should perform (not a ban, not an ordering of acts)',
  prohibition: 'a unit whose point is an act the reader must refrain from',
  gate: 'a unit whose point is that an act must wait for another act, or follow it',
  example: 'a unit that illustrates with a concrete case or sample text',
  description: 'a unit that informs the reader about facts, reasons or tools without telling them what to do',
};
export const paraQ = (k: 1 | 2 | 3) => (u: U2, l: Label5) =>
  k === 1 ? baseQ(u, l) : k === 2 ? q(`Look at line [${u.g}] in the window. Does it belong to the class "${l}"? Class "${l}": ${DEF_P2[l]}.`) : q(`Is [${u.g}] best described as ${l === 'example' ? 'an' : 'a'} ${l}? By ${l} we mean ${DEF_P3[l]}.`);

// arm a: decision rules with contrastive examples (nursery examples, not from gold2)
export const RULES: Record<Label5, { rule: string; yes: string[]; no: string[] }> = {
  rule: {
    rule: 'Yes if the unit contains an instruction to act, wherever it sits in the unit (after a dash or semicolon too), or a statement that assigns an act to the reader or staff, and it neither forbids an act nor orders two acts. No if it only says how something is, gives a reason, or describes a tool.',
    yes: ['Water the seedlings each morning.', 'Seed trays go on the left bench.', 'Cold snap → move the pots indoors.'],
    no: ['The seedlings are watered by hand.', 'Never water at noon.', 'Label each tray before you stack it.'],
  },
  prohibition: {
    rule: 'Yes if the unit forbids an act or marks an act as out of bounds (never, do not, no X, avoid, leave out), even as a short clause inside a longer unit. No if the never or not is about what a tool or a third party does.',
    yes: ['Never water at noon.', 'Frost is coming; do not leave the pots outside.', 'No radios in the glasshouse.'],
    no: ['The sprinkler never runs after dark.', 'Water the seedlings each morning.', 'Water the beds only after the sun is down.'],
  },
  gate: {
    rule: 'Yes if the unit says one act comes before or after another, or is allowed only once something is done (before, after, until, only after, first then). No if it just gives one act, or only forbids.',
    yes: ['Label each tray before you stack it.', 'Rinse the can first, then fill it.', 'Stay inside until the frost warning is lifted.'],
    no: ['Water the seedlings each morning.', 'Never stack wet trays.', 'The frost warning is lifted at noon.'],
  },
  example: {
    rule: 'Yes if the unit is framed as a case, a sample, a story of what happened or a quoted sample text, whatever it says. No if it states a fact or an instruction in its own voice.',
    yes: ['Case: a tray left in the sun dried out by lunch.', 'For instance, a cracked pot goes to the repair shelf.', 'Last spring a late frost cost us forty plants.'],
    no: ['A cracked pot goes to the repair shelf.', 'Frost can cost a whole bench of seedlings.', 'Never leave a tray in the sun.'],
  },
  description: {
    rule: 'Yes if the unit only states how something is, was or works, gives background or a reason, or says what a tool or third party does, and asks nothing of the reader. No if it contains an instruction, a ban, an ordering of acts, an example, or is only a heading, label or greeting.',
    yes: ['The glasshouse holds eleven benches.', 'The sprinkler never runs after dark.', 'Seedlings dry out fast because the trays are shallow.'],
    no: ['Water the seedlings each morning.', 'Case: a tray left in the sun dried out by lunch.', 'Glasshouse notes'],
  },
};
export const ruleQ = (u: U2, l: Label5) => {
  const r = RULES[l];
  return q(`Unit [${u.g}] of the window: is it a ${l}? ${r.rule} Yes examples: ${r.yes.map((s) => `"${s}"`).join(' ')} No examples: ${r.no.map((s) => `"${s}"`).join(' ')}`);
};

// arm b: decomposed sub-questions
export const SUBS: Record<string, string> = {
  instr: 'does it ask the reader to do something, or tell the reader what to do in some case? Count an instruction anywhere in the unit (after a dash or a semicolon too) and a passive statement of practice such as "forms go to the desk". Answer no if it only says how something is or works.',
  forbid: 'does it forbid an act or mark an act as out of bounds (never, do not, no X, avoid, leave out)? Answer no if the never or not is about what a tool or a third party does.',
  order: 'does it say that one act must come before or after another act, or may happen only once another act is done?',
  example: 'is it an example: a case, a sample, a story of what happened, or a quoted sample text?',
  tool: 'does it only describe how a thing or tool works, what a third party does, or give background or a reason, asking nothing of the reader?',
  filler: 'is it only a heading, a label, a table header, a greeting, a thanks, a sign-off or other filler that says nothing about the work?',
};
export const SUBKEYS = Object.keys(SUBS);
export const subQ = (u: U2, k: string) => q(`Unit [${u.g}] of the window: ${SUBS[k]}`);

const asker = (f: (u: U2, l: Label5) => Question, prefix = '') => (u: U2) => Object.fromEntries(L5.map((l) => [`${prefix}${l}`, f(u, l)]));
export const VARIANTS: Variant[] = [
  { id: 'base', arm: 'arm0', desc: 'phase 1 design: window of 30, path lines, five definition questions', perWindow: 30, ctx: 'path', ask: asker(baseQ) },
  { id: 'a-rules', arm: 'arm-a', desc: 'decision rules with contrastive examples in each question (window of 20)', perWindow: 20, ctx: 'path', ask: asker(ruleQ) },
  { id: 'b-decomp', arm: 'arm-b', desc: 'six decomposed yes/no questions per unit (window of 25)', perWindow: 25, ctx: 'path', ask: (u) => Object.fromEntries(SUBKEYS.map((k) => [k, subQ(u, k)])) },
  { id: 'c-para1', arm: 'arm-c', desc: 'paraphrase 1 (= base wording)', perWindow: 30, ctx: 'path', ask: asker(paraQ(1), 'p1:') },
  { id: 'c-para2', arm: 'arm-c', desc: 'paraphrase 2', perWindow: 30, ctx: 'path', ask: asker(paraQ(2), 'p2:') },
  { id: 'c-para3', arm: 'arm-c', desc: 'paraphrase 3', perWindow: 30, ctx: 'path', ask: asker(paraQ(3), 'p3:') },
  { id: 'd-none', arm: 'arm-d', desc: 'no heading lines, no file role', perWindow: 30, ctx: 'none', ask: asker(baseQ) },
  { id: 'd-role', arm: 'arm-d', desc: 'heading lines plus a file role line', perWindow: 30, ctx: 'role', ask: asker(baseQ) },
];

export type P2Run = { runId: string; variant: string; arm: string; desc: string; calls: RunRec['calls']; probs: Record<number, Record<string, number>>; asked: number; missing: number; wallMs: number };

export function windows(units: U2[], size: number): U2[][] {
  const byFile = new Map<string, U2[]>();
  for (const u of units) byFile.set(u.file, [...(byFile.get(u.file) ?? []), u]);
  return [...byFile.values()].flatMap((us) => chunk(us, size));
}

export async function runVariant(ctx: Ctx, v: Variant, run: number, subset: U2[] = U, tag = '', outName = 'results2'): Promise<P2Run> {
  const runId = `${v.id}${tag}-r${run}`;
  const planned = windows(subset, v.perWindow).map((w) => {
    const questions: Record<string, Question> = {};
    const names = new Map<string, { u: GUnit; label: string }>();
    for (const u of w) for (const [k, qq] of Object.entries(v.ask(u))) { const name = `u${u.g}__${k}`; questions[name] = qq; names.set(name, { u: u as unknown as GUnit, label: k }); }
    return { body: { model: ctx.cfg.model, state: window2(w, v.ctx), questions }, units: w as unknown as GUnit[], names };
  });
  const rec = await execute(ctx, runId, planned, v.arm, v.desc, { variant: v.id }, {} as Probs);
  const out: P2Run = { runId, variant: v.id, arm: v.arm, desc: v.desc, calls: rec.calls, probs: rec.probs, asked: rec.asked, missing: rec.missing, wallMs: rec.wallMs };
  mkdirSync(join(dir, outName), { recursive: true });
  writeFileSync(join(dir, outName, `${runId}.json`), JSON.stringify(out) + '\n');
  return out;
}
