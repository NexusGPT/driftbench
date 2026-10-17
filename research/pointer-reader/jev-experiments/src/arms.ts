import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ask, type Config, type JevBody, type Question, loadCassette } from './jev';

export const dir = new URL('..', import.meta.url).pathname;
export const LABELS = ['rule', 'prohibition', 'gate', 'example', 'description'] as const;
export type Label = (typeof LABELS)[number];
export const DESC: Record<Label, string> = {
  rule: 'a unit that tells the reader what to do',
  prohibition: 'a unit that tells the reader what never to do',
  gate: 'a unit that sets an order, one act before another',
  example: 'a unit that shows a case and is not itself an instruction',
  description: 'a unit that states how something is, with no instruction',
};

/** Second wording: the five definitions exclude each other. */
export const DESC2: Record<Label, string> = {
  rule: 'a unit that tells the reader to do something, and neither forbids anything nor sets an order between two acts',
  prohibition: 'a unit that tells the reader never to do something',
  gate: 'a unit that says one act must come before another',
  example: 'a unit that shows a case and is not itself an instruction',
  description: 'a unit that states how something is and tells the reader neither to do nor to avoid anything',
};
export type Defs = 'v1' | 'v2';

export type GUnit = { file: string; n: number; id: string; container: string; text: string; label: string; section: string; g: number };
export type Block = { id: string; name: string; description: string; units: string[] };
const goldFile = JSON.parse(readFileSync(join(dir, 'gold.json'), 'utf8')) as { units: Omit<GUnit, 'g'>[]; blocks: Block[] };
/** `g` is the number shown to Jev: 1..N over the whole estate in file order. */
export const UNITS: GUnit[] = goldFile.units.map((u, i) => ({ ...u, g: i + 1 }));
export const BLOCKS: Block[] = goldFile.blocks;
export const byId = new Map(UNITS.map((u) => [u.id, u]));

export type Form = 'bracket' | 'bare' | 'tag' | 'ledger' | 'quote';
const refOf = (u: GUnit, form: Form) => (form === 'bare' ? String(u.g) : form === 'tag' ? `<s${u.g}>` : form === 'ledger' ? u.id : `[${u.g}]`);
const keyOf = (u: GUnit, form: Form) => (form === 'ledger' ? u.id : String(u.g));

export function renderWindow(units: GUnit[], form: Form, head = 'WINDOW'): string {
  const lines = [head];
  let last = '';
  for (const u of units) {
    const where = `${u.file}${u.section ? ' > ' + u.section : ''}`;
    if (where !== last) { lines.push(`## ${where}`); last = where; }
    const stateForm: Form = form === 'quote' ? 'bracket' : form;
    lines.push(form === 'bare' || form === 'ledger' ? `${refOf(u, stateForm)}\t${u.text}` : `${refOf(u, stateForm)} ${u.text}`);
  }
  return lines.join('\n');
}

const q = (question: string): Question => ({ type: 'noul', instructions: { question } });
export function labelQuestion(u: GUnit, label: Label, form: Form, defs: Defs = 'v1'): Question {
  const tail = `A ${label} is ${(defs === 'v2' ? DESC2 : DESC)[label]}.`;
  return form === 'quote'
    ? q(`Is the unit "${u.text}" a ${label}? ${tail}`)
    : q(`Unit ${refOf(u, form)} of the window: is it a ${label}? ${tail}`);
}
export const qName = (u: GUnit, form: Form, label: string) => `u${keyOf(u, form)}__${label}`;

export const INSTR_Q = 'an instruction: it tells the reader to do something, never to do something, or to do one act before another';

export type CallRec = { i: number; first: number; last: number; units: number; nq: number; ms: number; ok: boolean; status: number; error?: string; cached?: boolean; tokIn?: number; tokOut?: number };
export type Probs = Record<number, Record<string, number>>;
export type RunRec = { runId: string; arm: string; variant: string; cfg: Record<string, unknown>; calls: CallRec[]; probs: Probs; asked: number; missing: number; wallMs: number };

export type Ctx = { cfg: Config; cassette: ReturnType<typeof loadCassette>; conc: number };

export function chunk<T>(a: T[], k: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += k) out.push(a.slice(i, i + k));
  return out;
}

type Planned = { body: JevBody; units: GUnit[]; names: Map<string, { u: GUnit; label: string }>; };

export async function execute(ctx: Ctx, runId: string, planned: Planned[], arm: string, variant: string, cfgInfo: Record<string, unknown>, probs: Probs = {}): Promise<RunRec> {
  const calls: CallRec[] = new Array(planned.length);
  let asked = 0, missing = 0;
  const t0 = Date.now();
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= planned.length) return;
      const p = planned[i]!;
      let r;
      try {
        r = await ask(ctx.cfg, p.body, runId, ctx.cassette);
      } catch (e) {
        r = { ok: false, status: -1, ms: 0, answers: {} as Record<string, number>, raw: null, error: String((e as Error).message) };
      }
      const nq = p.names.size;
      asked += nq;
      for (const [name, { u, label }] of p.names) {
        const v = r.answers[name];
        if (r.ok && typeof v === 'number' && v >= 0 && v <= 1) (probs[u.g] ??= {})[label] = v;
        else missing++;
      }
      calls[i] = { i, first: p.units[0]!.g, last: p.units.at(-1)!.g, units: p.units.length, nq, ms: r.ms, ok: r.ok, status: r.status, ...(r.error ? { error: r.error } : {}), ...(r.cached ? { cached: true } : {}), tokIn: (r.raw as { usage?: { input_tokens?: number } } | null)?.usage?.input_tokens ?? 0, tokOut: (r.raw as { usage?: { output_tokens?: number } } | null)?.usage?.output_tokens ?? 0 };
    }
  };
  await Promise.all(Array.from({ length: ctx.conc }, worker));
  return { runId, arm, variant, cfg: cfgInfo, calls, probs, asked, missing, wallMs: Date.now() - t0 };
}

export function save(rec: RunRec) {
  const d = join(dir, 'results');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, `${rec.runId}.json`), JSON.stringify(rec) + '\n');
}

/** Flat labelling: every unit gets one question per label. */
export function planFlat(units: GUnit[], perCall: number, form: Form, model: string, labels: readonly Label[] = LABELS, mode: 'window' | 'single' = 'window', defs: Defs = 'v2'): Planned[] {
  const groups = mode === 'single' ? units.map((u) => [u]) : chunk(units, perCall);
  return groups.map((g) => {
    const questions: Record<string, Question> = {};
    const names = new Map<string, { u: GUnit; label: string }>();
    for (const u of g) for (const l of labels) { const n = qName(u, form, l); questions[n] = labelQuestion(u, l, form, defs); names.set(n, { u, label: l }); }
    return { body: { model, state: renderWindow(g, form, mode === 'single' ? 'UNIT' : 'WINDOW'), questions }, units: g, names };
  });
}

/** Predicts a label from probabilities: the highest above the threshold, else none. */
export const PRIORITY = ['gate', 'prohibition', 'rule', 'example', 'description'] as const;
export type Decode = 'argmax' | 'priority';
export function predict(p: Record<string, number> | undefined, t: number, labels: readonly string[] = LABELS, decode: Decode = 'argmax'): string {
  if (decode === 'priority') {
    for (const l of PRIORITY) if (labels.includes(l) && (p?.[l] ?? -1) >= t) return l;
    return 'none';
  }
  let best = 'none', bp = -1;
  for (const l of labels) { const v = p?.[l]; if (v !== undefined && v > bp) { bp = v; best = l; } }
  return bp >= t ? best : 'none';
}
