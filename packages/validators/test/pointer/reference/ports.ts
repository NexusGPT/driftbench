import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type CassetteRow,
  canonical,
  hash,
  JEV_WINDOW_UNITS,
  keyOf,
  NONE_DEFINITION,
  readableFor,
  windowCap,
  wireFor,
} from '../../../src/ladders/pointer/kit/fixture';
import type { LabelAnswer, LabelEntry, ModelArm, Transport } from '../../../src/ladders/pointer/sut/port';
import { canonicalCompact, sha256 } from './hash';
import type { ParsedSet } from './labelset';
import { SYSTEM_TEXT, userText, type WindowPlan } from './window';

/** The answer checks of docs/estate-pointer-reader.md section 3 "Validation of an answer". */
export function validateAnswer(
  answer: LabelAnswer,
  plan: WindowPlan,
  set: ParsedSet,
): { ok: true; labels: Map<number, { label: string; target?: number }> } | { ok: false; reason: string } {
  let entries: LabelEntry[];
  if ('raw' in answer) {
    try {
      const parsed = JSON.parse(answer.raw) as { labels?: LabelEntry[] };
      if (!parsed || !Array.isArray(parsed.labels))
        return { ok: false, reason: 'the answer is not the agreed JSON' };
      entries = parsed.labels;
    } catch {
      return { ok: false, reason: 'the answer is not JSON' };
    }
  } else {
    if (!Array.isArray(answer.labels)) return { ok: false, reason: 'the answer has no labels list' };
    entries = answer.labels;
  }
  const max = plan.units.length;
  const names = new Set(set.labels.map((l) => l.name));
  const labels = new Map<number, { label: string; target?: number }>();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || typeof entry.label !== 'string') {
      return { ok: false, reason: 'an entry has no label name' };
    }
    if (entry.label !== 'none' && !names.has(entry.label)) {
      return { ok: false, reason: `the label ${JSON.stringify(entry.label)} is not in the set ${set.set}` };
    }
    const def = set.labels.find((l) => l.name === entry.label);
    let from: number;
    let to: number;
    if (typeof entry.units === 'number') {
      if (!Number.isInteger(entry.units))
        return { ok: false, reason: `the unit ${entry.units} is not a whole number` };
      from = to = entry.units;
    } else if (typeof entry.units === 'string') {
      const m = /^(\d+)(?:-(\d+))?$/.exec(entry.units);
      if (!m)
        return { ok: false, reason: `the units ${JSON.stringify(entry.units)} are not a number or a range` };
      from = Number(m[1]);
      to = m[2] === undefined ? from : Number(m[2]);
    } else {
      return { ok: false, reason: 'an entry has no units' };
    }
    if (from < 1 || from > max) return { ok: false, reason: `the unit ${from} is not in the window` };
    if (to < from) return { ok: false, reason: `the range ${from}-${to} runs backwards` };
    if (to > max) return { ok: false, reason: `the range ${from}-${to} leaves the window` };
    for (let n = from; n <= to; n += 1) {
      const unit = plan.units[n - 1];
      if (unit?.mode !== 'label') {
        return { ok: false, reason: `the unit ${n} is ${unit?.mode ?? 'missing'} and cannot be labelled` };
      }
      if (labels.has(n)) return { ok: false, reason: `the unit ${n} is named twice` };
    }
    const wantsTarget = def?.target === 'required';
    if (wantsTarget) {
      if (
        typeof entry.target !== 'number' ||
        !Number.isInteger(entry.target) ||
        entry.target < 1 ||
        entry.target > max
      ) {
        return { ok: false, reason: `the label ${entry.label} needs a target in the window` };
      }
    } else if (entry.target !== undefined) {
      return { ok: false, reason: `the label ${entry.label} takes no target` };
    }
    for (let n = from; n <= to; n += 1) {
      labels.set(
        n,
        wantsTarget ? { label: entry.label, target: entry.target as number } : { label: entry.label },
      );
    }
  }
  return { ok: true, labels };
}

/* ---------- cassette ---------- */

export type CassetteEntry = {
  key: string;
  readable?: Record<string, string>;
  file: string;
  window: string;
  promptVersion: string;
  schemaVersion: string;
  setName: string;
  setHash: string;
  labeler: string;
  cutDigest: string;
  part: { system: string; user: string; output: string };
  model: string;
  stop_reason: string;
  usage: Record<string, unknown>;
  answer: { labels?: LabelEntry[]; probabilities?: Record<string, number> };
};

export class CassetteError extends Error {}

export class Cassette {
  readonly entries = new Map<string, CassetteEntry>();
  constructor(
    text: string | undefined,
    readonly mode: 'record' | 'replay',
  ) {
    for (const line of (text ?? '').split('\n')) {
      if (line.trim() === '') continue;
      try {
        const entry = JSON.parse(line) as CassetteEntry;
        if (entry && typeof entry.key === 'string') this.entries.set(entry.key, entry);
      } catch {
        throw new CassetteError('the cassette holds a line that is not JSON');
      }
    }
  }

  dump(): string {
    return (
      [...this.entries.values()].map((e) => canonicalCompact(e)).join('\n') +
      (this.entries.size > 0 ? '\n' : '')
    );
  }

  /** The recorded entry nearest a request, for a miss message. */
  nearest(file: string, window: string, labeler: string): CassetteEntry | undefined {
    const all = [...this.entries.values()];
    return (
      all.find((e) => e.file === file && e.window === window && e.labeler === labeler) ??
      all.find((e) => e.file === file && e.labeler === labeler) ??
      all.find((e) => e.labeler === labeler) ??
      all[0]
    );
  }
}

function differing(want: CassetteEntry, have: CassetteEntry): string[] {
  const out: string[] = [];
  if (want.file !== have.file) out.push('file');
  if (want.window !== have.window) out.push('window');
  if (want.labeler !== have.labeler) out.push('labeler');
  if (want.setName !== have.setName) out.push('setName');
  if (want.setHash !== have.setHash) out.push('setHash');
  if (want.cutDigest !== have.cutDigest) out.push('cutDigest');
  if (want.promptVersion !== have.promptVersion) out.push('promptVersion');
  if (want.schemaVersion !== have.schemaVersion) out.push('schemaVersion');
  if (want.part.system !== have.part.system) out.push('part.system');
  if (want.part.user !== have.part.user) out.push('part.user');
  if (want.part.output !== have.part.output) out.push('part.output');
  return out;
}

/* ---------- model ports ---------- */

export type ModelCtx = {
  arm: ModelArm;
  transport: Transport;
  cassette: Cassette;
  /** A system 2 labeler behind the system 1 arm: the arm is the first member of a stack. */
  second?: boolean;
  marginCut?: number;
  passAt?: number;
  failAt?: number;
  /** A planted fault of this reference, named by the tests that show the bank sees it; absent for the honest reader. */
  fault?: string;
  /** `yesno` is the earlier system 1 protocol, kept so the bank can be shown to reject it. */
  protocol?: 'choice' | 'yesno';
  cutDigestOf(file: string): string;
  warnings: string[];
  keyHeader: string;
};

/** The probability of every option of a choice, by unit number within the window. */
export type Opinions = Map<number, Record<string, number>>;

export type ModelResult =
  | { kind: 'answer'; answer: LabelAnswer; key: string; opinions?: Opinions }
  | { kind: 'refused'; reason: string }
  | { kind: 'error'; message: string };

const HAIKU_URL = 'https://api.haiku.invalid/v1/messages';
const JEV_URL = 'https://jev.invalid/v1/systemone';
export const DEFAULT_MARGIN_CUT = 0.65;
export const DEFAULT_PASS_AT = 0.9;
export const DEFAULT_FAIL_AT = 0.1;

/** The model key from `~/.nexus-secrets`, read by path and never printed or recorded. */
export function readKey(): string {
  const home = process.env.HOME ?? '';
  for (const name of ['anthropic.key', 'haiku.key', 'jev.key', 'api.key']) {
    try {
      return readFileSync(join(home, '.nexus-secrets', name), 'utf8').trim();
    } catch {
      /* try the next name */
    }
  }
  return '';
}

function receipt(ctx: ModelCtx, entry: CassetteEntry, model: string): void {
  const earlier = [...ctx.cassette.entries.values()].find(
    (e) => e.labeler === entry.labeler && e.model !== model,
  );
  if (earlier)
    ctx.warnings.push(`the returned model ${model} differs from the recorded model ${earlier.model}`);
}

async function haiku(plan: WindowPlan, set: ParsedSet, ctx: ModelCtx): Promise<ModelResult> {
  const system = SYSTEM_TEXT;
  const user = userText(set, plan);
  const output = { type: 'json_schema', labels: { enum: [...set.labels.map((l) => l.name), 'none'] } };
  const request = {
    model: 'claude-haiku-5-5',
    max_tokens: 4096,
    system,
    messages: [{ role: 'user', content: user }],
    output,
  };
  const key = sha256(canonicalCompact(request));
  const want = {
    key,
    file: plan.file,
    window: plan.id,
    promptVersion: 'p1',
    schemaVersion: 's1',
    setName: set.set,
    setHash: set.hash,
    labeler: 'haiku',
    cutDigest: ctx.cutDigestOf(plan.file),
    part: { system: sha256(system), user: sha256(user), output: sha256(canonicalCompact(output)) },
  };
  const hit = ctx.cassette.entries.get(key);
  if (hit) {
    if (hit.cutDigest !== want.cutDigest) return cutDigestError(plan.id);
    return { kind: 'answer', answer: { labels: hit.answer.labels ?? [] }, key };
  }
  if (ctx.cassette.mode === 'replay') return missError(ctx, want);
  const response = await ctx.transport({
    url: HAIKU_URL,
    headers: { 'content-type': 'application/json', 'x-api-key': ctx.keyHeader },
    body: JSON.stringify(request),
  });
  if (response.status !== 200)
    return { kind: 'error', message: `the model answered HTTP ${response.status}` };
  let data: {
    content?: Array<{ type?: string; text?: string }>;
    stop_reason?: string;
    model?: string;
    usage?: Record<string, unknown>;
  };
  try {
    data = JSON.parse(response.body);
  } catch {
    return { kind: 'refused', reason: 'the response is not JSON' };
  }
  if (data.stop_reason === 'max_tokens')
    return { kind: 'refused', reason: 'the answer stopped at max_tokens' };
  if (data.stop_reason === 'refusal') return { kind: 'refused', reason: 'the model refused' };
  const block = (data.content ?? []).find((b) => b.type === 'text');
  if (!block || typeof block.text !== 'string')
    return { kind: 'refused', reason: 'the response holds no text block' };
  let parsed: { window?: string; set?: string; labels?: LabelEntry[] };
  try {
    parsed = JSON.parse(block.text);
  } catch {
    return { kind: 'refused', reason: 'the answer is not the agreed JSON' };
  }
  if (parsed.window !== plan.id)
    return { kind: 'refused', reason: `the answer is for another window (${String(parsed.window)})` };
  if (parsed.set !== set.set)
    return { kind: 'refused', reason: `the answer is for another set (${String(parsed.set)})` };
  if (!Array.isArray(parsed.labels)) return { kind: 'refused', reason: 'the answer has no labels list' };
  const checked = validateAnswer({ labels: parsed.labels }, plan, set);
  if (!checked.ok) return { kind: 'refused', reason: checked.reason };
  const entry: CassetteEntry = {
    ...want,
    model: String(data.model ?? ''),
    stop_reason: String(data.stop_reason ?? ''),
    usage: data.usage ?? {},
    answer: { labels: parsed.labels },
  };
  receipt(ctx, entry, entry.model);
  ctx.cassette.entries.set(key, entry);
  return { kind: 'answer', answer: { labels: parsed.labels }, key };
}

function missError(
  ctx: ModelCtx,
  want: Omit<CassetteEntry, 'model' | 'stop_reason' | 'usage' | 'answer'>,
): ModelResult {
  const near = ctx.cassette.nearest(want.file, want.window, want.labeler);
  if (!near) {
    return {
      kind: 'error',
      message: `cassette miss for ${want.window} (${want.labeler}): the cassette holds no entry; differs in file, window`,
    };
  }
  const fields = differing({ ...near } as CassetteEntry, { ...want } as unknown as CassetteEntry);
  return {
    kind: 'error',
    message: `cassette miss for ${want.window} (${want.labeler}): the nearest entry is ${near.window}; it differs in ${fields.length > 0 ? fields.join(', ') : 'the request'}`,
  };
}

function cutDigestError(window: string): ModelResult {
  return {
    kind: 'error',
    message: `cassette miss for ${window}: cutDigest differs from the recording; the cutter ran under Node ${process.versions.node} with ICU ${process.versions.icu}, so the cut may differ between environments`,
  };
}

/** The earlier system 1 protocol: one yes or no question per unit and label. Kept only as a planted wrong product. */
async function jevYesNo(plan: WindowPlan, set: ParsedSet, ctx: ModelCtx): Promise<ModelResult> {
  const unitState = ctx.arm === 'jev-unit';
  const threshold = unitState ? 0.7 : 0.4;
  const JEV_CAP = 250;
  const askable = set.labels.filter((l) => l.target !== 'required');
  const label = plan.units.filter((u) => u.mode === 'label');
  const chunkSize = unitState ? 1 : Math.max(1, Math.floor(JEV_CAP / Math.max(1, askable.length)));
  const decided: LabelEntry[] = [];
  let lastKey = '';
  const run = async (units: typeof label): Promise<ModelResult | undefined> => {
    const sub: WindowPlan = { ...plan, units: units.map((u) => ({ ...u })) };
    const state = userText(set, sub);
    const questions: Record<string, unknown> = {};
    for (const u of units) {
      for (const l of askable) {
        questions[`u${u.n}__${l.name}`] = {
          type: 'noul',
          instructions: {
            question: `Line ${u.n}: does the label ${l.name} apply? ${l.description}`,
            focus: 'Answer for this line only.',
          },
        };
      }
    }
    const request = { model: 'jev-fake', state, questions };
    const key = sha256(canonicalCompact({ ...request, arm: ctx.arm }));
    const want = {
      key,
      file: plan.file,
      window: plan.id,
      promptVersion: 'p1',
      schemaVersion: 's1',
      setName: set.set,
      setHash: set.hash,
      labeler: ctx.arm,
      cutDigest: ctx.cutDigestOf(plan.file),
      part: {
        system: sha256(''),
        user: sha256(state),
        output: sha256(canonicalCompact(Object.keys(questions))),
      },
    };
    lastKey = key;
    let probabilities: Record<string, number>;
    const hit = ctx.cassette.entries.get(key);
    if (hit) {
      if (hit.cutDigest !== want.cutDigest) return cutDigestError(plan.id);
      probabilities = hit.answer.probabilities ?? {};
    } else if (ctx.cassette.mode === 'replay') {
      return missError(ctx, want);
    } else {
      const response = await ctx.transport({
        url: JEV_URL,
        headers: { 'content-type': 'application/json', 'api-key': ctx.keyHeader },
        body: JSON.stringify(request),
      });
      if (response.status === 400 && /max_tokens_exceeded/.test(response.body)) {
        if (units.length <= 1) return { kind: 'error', message: 'the endpoint refused a single unit' };
        const half = Math.ceil(units.length / 2);
        const first = await run(units.slice(0, half));
        if (first) return first;
        return run(units.slice(half));
      }
      if (response.status !== 200)
        return { kind: 'error', message: `the endpoint answered HTTP ${response.status}` };
      let data: { model?: string; answers?: Record<string, { noul?: number }> };
      try {
        data = JSON.parse(response.body);
      } catch {
        return { kind: 'refused', reason: 'the response is not JSON' };
      }
      probabilities = {};
      for (const k of Object.keys(questions)) {
        const p = data.answers?.[k]?.noul;
        if (typeof p !== 'number' || p < 0 || p > 1)
          return { kind: 'refused', reason: `no probability for ${k}` };
        probabilities[k] = p;
      }
      const entry: CassetteEntry = {
        ...want,
        model: String(data.model ?? ''),
        stop_reason: 'end_turn',
        usage: {},
        answer: { probabilities },
      };
      receipt(ctx, entry, entry.model);
      ctx.cassette.entries.set(key, entry);
    }
    for (const u of units) {
      let best: { name: string; p: number } | undefined;
      for (const l of askable) {
        const p = probabilities[`u${u.n}__${l.name}`];
        if (typeof p === 'number' && (!best || p > best.p)) best = { name: l.name, p };
      }
      decided.push({ units: String(u.n), label: best && best.p > threshold ? best.name : 'none' });
    }
    return undefined;
  };
  for (let i = 0; i < label.length; i += chunkSize) {
    const problem = await run(label.slice(i, i + chunkSize));
    if (problem) return problem;
  }
  return { kind: 'answer', answer: { labels: decided }, key: lastKey };
}

/* ---------- the choice protocol ---------- */

const askedLabels = (set: { labels: ParsedSet['labels'] }) => set.labels.filter((l) => l.target !== 'required');

/** Why a probability vector is no vector: a missing option, a figure outside 0 to 1, a sum off one by over 0.01. */
export function vectorProblem(vector: Record<string, unknown>, options: string[]): string | undefined {
  for (const option of options) {
    const p = vector[option];
    if (typeof p !== 'number' || Number.isNaN(p)) return `no probability for ${option}`;
    if (p < 0 || p > 1) return `the probability of ${option} is outside 0 to 1`;
  }
  const total = options.reduce((sum, option) => sum + (vector[option] as number), 0);
  return Math.abs(total - 1) > 0.01 ? `the probabilities sum to ${total}` : undefined;
}

/** The option with the highest probability; the first of equals wins. */
function topOption(vector: Record<string, number>, options: string[], fault?: string): string {
  if (fault === 'first-above') {
    const first = options.find((o) => o !== 'none' && (vector[o] ?? 0) >= 0.3);
    if (first !== undefined) return first;
  }
  const pool = fault === 'ignore-none' ? options.filter((o) => o !== 'none') : options;
  let best = pool[0] as string;
  for (const option of pool) if ((vector[option] ?? 0) > (vector[best] ?? 0)) best = option;
  return best;
}

/** What the stack settings say about a choice: the label system 1 decides alone, or undefined when system 2 decides. */
export function sureLabel(vector: Record<string, number>, ctx: ModelCtx): string | undefined {
  const ranked = Object.entries(vector).sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  if (!top) return undefined;
  const settings = ctx.fault === 'settings-ignored';
  const bounds = !settings && ctx.fault !== 'bounds-ignored' && (ctx.passAt !== undefined || ctx.failAt !== undefined);
  if (bounds) {
    if (top[1] >= (ctx.passAt ?? DEFAULT_PASS_AT)) return top[0];
    if (top[1] < (ctx.failAt ?? DEFAULT_FAIL_AT)) return 'none';
    return undefined;
  }
  const configured = settings ? undefined : ctx.marginCut;
  const cut = ctx.fault === 'margin-ignored' ? 0 : (configured ?? DEFAULT_MARGIN_CUT);
  const margin = top[1] - (ranked[1]?.[1] ?? 0);
  return margin >= cut ? top[0] : undefined;
}

function windowUnits(ctx: ModelCtx): number {
  if (ctx.arm === 'jev-unit') return ctx.fault === 'unit-state-batches' ? 5 : 1;
  return ctx.fault === 'cap-too-big' ? 250 : JEV_WINDOW_UNITS;
}

async function jevChoice(plan: WindowPlan, set: ParsedSet, ctx: ModelCtx): Promise<ModelResult> {
  const asked = askedLabels(set);
  const options = [...asked.map((l) => l.name), 'none'];
  const label = plan.units.filter((u) => u.mode === 'label');
  const opinions: Opinions = new Map();
  const decided: LabelEntry[] = [];
  let lastKey = '';
  const run = async (units: typeof label): Promise<ModelResult | undefined> => {
    const sub: WindowPlan = { ...plan, units: units.map((u) => ({ ...u })) };
    const state = userText(set, sub);
    const criteria = Object.fromEntries([
      ...asked.map((l) => [l.name, l.description]),
      ...(ctx.fault === 'drop-none-option' ? [] : [['none', NONE_DEFINITION]]),
    ]);
    const questions: Record<string, unknown> = {};
    for (const u of units)
      questions[`u${u.n}`] = {
        type: 'choice',
        instructions: `Which label does unit [${u.n}] of the numbered text have?`,
        criteria,
      };
    const request = { model: 'jev-fake', state, questions };
    const key = sha256(canonicalCompact({ ...request, arm: ctx.arm }));
    const want = {
      key,
      file: plan.file,
      window: plan.id,
      promptVersion: 'p1',
      schemaVersion: 's1',
      setName: set.set,
      setHash: set.hash,
      labeler: ctx.arm,
      cutDigest: ctx.cutDigestOf(plan.file),
      part: {
        system: sha256(''),
        user: sha256(state),
        output: sha256(canonicalCompact(Object.keys(questions))),
      },
    };
    lastKey = key;
    let probabilities: Record<string, number>;
    let used: Record<string, number> | undefined;
    const hit = ctx.cassette.entries.get(key);
    if (hit) {
      if (hit.cutDigest !== want.cutDigest) return cutDigestError(plan.id);
      probabilities = hit.answer.probabilities ?? {};
    } else if (ctx.cassette.mode === 'replay') {
      return missError(ctx, want);
    } else {
      const response = await ctx.transport({
        url: JEV_URL,
        headers: { 'content-type': 'application/json', 'api-key': ctx.keyHeader },
        body: JSON.stringify(request),
      });
      if (response.status === 400 && /max_tokens_exceeded/.test(response.body)) {
        if (units.length <= 1) return { kind: 'error', message: 'the endpoint refused a single unit' };
        if (ctx.fault === 'no-halving') return { kind: 'error', message: 'the endpoint refused the window' };
        const half = Math.ceil(units.length / 2);
        const first = await run(units.slice(0, half));
        if (first) return first;
        return run(units.slice(half));
      }
      if (response.status !== 200)
        return { kind: 'error', message: `the endpoint answered HTTP ${response.status}` };
      let data: { model?: string; answers?: Record<string, { probabilities?: Record<string, unknown> }> };
      try {
        data = JSON.parse(response.body);
      } catch {
        return { kind: 'refused', reason: 'the response is not JSON' };
      }
      if (!data.answers || typeof data.answers !== 'object')
        return { kind: 'error', message: 'bad_response: the answer holds no answers object' };
      probabilities = {};
      used = {};
      for (const u of units) {
        const given = data.answers[`u${u.n}`]?.probabilities ?? {};
        const top = vectorProblem(given, options) ? undefined : topOption(given as Record<string, number>, options);
        for (const option of options) {
          const p = given[option];
          if (typeof p !== 'number') continue;
          used[`u${u.n}__${option}`] = p;
          if (ctx.fault === 'probabilities-dropped' && option !== top) continue;
          probabilities[`u${u.n}__${option}`] = p;
        }
      }
      const entry: CassetteEntry = {
        ...want,
        model: String(data.model ?? ''),
        stop_reason: 'end_turn',
        usage: {},
        answer: { probabilities },
      };
      receipt(ctx, entry, entry.model);
      ctx.cassette.entries.set(key, entry);
    }
    for (const u of units) {
      const given: Record<string, unknown> = Object.fromEntries(
        options.map((o) => [o, (used ?? probabilities)[`u${u.n}__${o}`]]),
      );
      const problem = vectorProblem(given, options);
      if (problem) return { kind: 'refused', reason: `unit ${u.n}: ${problem}` };
      const vector = given as Record<string, number>;
      opinions.set(u.n, vector);
      decided.push({ units: String(u.n), label: topOption(vector, options, ctx.fault) });
    }
    return undefined;
  };
  const size = windowUnits(ctx);
  for (let i = 0; i < label.length; i += size) {
    const problem = await run(label.slice(i, i + size));
    if (problem) return problem;
  }
  return { kind: 'answer', answer: { labels: decided }, key: lastKey, opinions };
}

/** A stack: system 1 decides a unit alone when its settings say it is sure, system 2 (three agreeing runs) the rest. */
export async function askStack(plan: WindowPlan, set: ParsedSet, ctx: ModelCtx): Promise<ModelResult> {
  const first = await askModel(plan, set, ctx);
  if (first.kind !== 'answer') return first;
  const labels: LabelEntry[] = [];
  const pending: number[] = [];
  for (const u of plan.units.filter((unit) => unit.mode === 'label')) {
    const vector = first.opinions?.get(u.n);
    const sure = vector ? sureLabel(vector, ctx) : undefined;
    if (sure === undefined) pending.push(u.n);
    else labels.push({ units: String(u.n), label: sure });
  }
  if (pending.length > 0) {
    const votes: Array<Map<number, { label: string; target?: number }>> = [];
    for (let run = 0; run < 3; run += 1) {
      const vote = await askModel(plan, set, { ...ctx, arm: 'haiku', second: false });
      if (vote.kind !== 'answer') return vote;
      const checked = validateAnswer(vote.answer, plan, set);
      if (!checked.ok) return { kind: 'refused', reason: checked.reason };
      votes.push(checked.labels);
    }
    for (const n of pending) {
      const given = votes.map((m) => m.get(n));
      const agreed = given[0];
      if (!agreed || given.some((g) => g?.label !== agreed.label))
        return { kind: 'refused', reason: `system 2 did not agree on unit ${n}` };
      labels.push({
        units: String(n),
        label: agreed.label,
        ...(agreed.target !== undefined ? { target: agreed.target } : {}),
      });
    }
  }
  labels.sort((a, b) => Number(a.units) - Number(b.units));
  return { kind: 'answer', answer: { labels }, key: first.key };
}

/** One call of a model port for a window and a set. */
export function askModel(plan: WindowPlan, set: ParsedSet, ctx: ModelCtx): Promise<ModelResult> {
  if ([...ctx.cassette.entries.values()].some((e) => e.readable)) return fixtureReplay(plan, set, ctx);
  if (ctx.arm === 'haiku') return haiku(plan, set, ctx);
  return ctx.protocol === 'yesno' ? jevYesNo(plan, set, ctx) : jevChoice(plan, set, ctx);
}

/** Supports the public reader wire format as well as this reference's legacy record format. */
async function fixtureReplay(plan: WindowPlan, parsed: ParsedSet, ctx: ModelCtx): Promise<ModelResult> {
  if (ctx.protocol === 'yesno' && ctx.arm !== 'haiku')
    return {
      kind: 'error',
      message: `cassette miss for ${plan.id}: the yes or no questions of ${ctx.arm} are not in the cassette`,
    };
  const { hash: _setHash, ...set } = parsed;
  const units = plan.units.filter((u) => u.mode !== 'opaque' && u.mode !== 'read');
  const cap = windowCap(ctx.arm);
  const labels: LabelEntry[] = [];
  const opinions: Opinions = new Map();
  let lastKey = '';
  for (let offset = 0; offset < units.length; offset += cap) {
    const selected = units.slice(offset, offset + cap),
      window = `${plan.file}#${Math.floor(offset / cap) + 1}`;
    const wire = wireFor(
      ctx.arm,
      set,
      window,
      selected.map((u, i) => ({ n: i + 1, text: u.text })),
      selected[0]?.path ?? [],
    );
    const want = readableFor(wire, {
      path: plan.file,
      window,
      promptVersion: 'p1',
      schemaVersion: 's1',
      set: set.set,
      setHash: hash(canonical(set)).slice(0, 16),
      model: String(wire.body.model),
      cutDigest: ctx.cutDigestOf(plan.file),
    });
    const key =
      ctx.fault === 'settings-in-key' && ctx.marginCut !== undefined
        ? hash(canonical({ wire, readable: want, marginCut: ctx.marginCut }))
        : keyOf(wire, want);
    lastKey = key;
    const rows = [...ctx.cassette.entries.values()] as unknown as CassetteRow[];
    let hit = rows.find((row) => row.key === key);
    if (!hit && ctx.cassette.mode === 'record') {
      const response = await ctx.transport({
        url: 'https://fixture.invalid',
        headers: {},
        body: JSON.stringify(wire.body),
      });
      if (response.status !== 200) return { kind: 'error', message: `HTTP ${response.status}` };
      const body = JSON.parse(response.body) as {
        model: string;
        content?: Array<{ type: string; text: string }>;
        answers?: Record<string, { probabilities?: Record<string, number> }>;
      };
      const recordedLabels =
        ctx.arm === 'haiku'
          ? JSON.parse(body.content?.find((b) => b.type === 'text')?.text ?? '{}').labels
          : undefined;
      const prior = rows.find((row) => row.answer.returnedModel !== body.model);
      if (prior) ctx.warnings.push(`returned model ${body.model} differs from ${prior.answer.returnedModel}`);
      hit = {
        key,
        readable: want,
        answer: {
          ...(recordedLabels
            ? { labels: recordedLabels }
            : {
                probabilities: Object.fromEntries(
                  Object.entries(body.answers ?? {}).flatMap(([unit, answer]) =>
                    Object.entries(answer.probabilities ?? {}).map(([option, p]) => [`${unit}__${option}`, p]),
                  ),
                ),
              }),
          returnedModel: body.model,
          stopReason: 'end_turn',
          usage: { input: 10, output: 10 },
        },
      };
      ctx.cassette.entries.set(key, hit as unknown as CassetteEntry);
    }
    const near =
      hit ??
      rows.find(
        (row) =>
          row.readable.path === plan.file && row.readable.window === window && row.readable.set === set.set,
      ) ??
      rows[0];
    const differs = near
      ? [...new Set([...Object.keys(want), ...Object.keys(near.readable)])].filter(
          (k) => want[k] !== near.readable[k],
        )
      : [];
    if (!hit || differs.length) {
      const fields = differs.length ? differs.join(', ') : 'file, window';
      return Promise.resolve({
        kind: 'error',
        message: `cassette miss for ${window}: nearest entry ${near?.readable.window ?? 'none'} differs in ${fields}${differs.includes('cutDigest') ? `; Node ${process.versions.node}, ICU ${process.versions.icu}` : ''}`,
      });
    }
    if (ctx.arm === 'haiku') {
      for (const label of hit.answer.labels ?? [])
        labels.push({ ...label, units: String(Number(label.units) + offset) });
    } else {
      const options = [...askedLabels(set).map((l) => l.name), 'none'];
      for (const [index, unit] of selected.entries()) {
        const given: Record<string, unknown> = Object.fromEntries(
          options.map((o) => [o, hit.answer.probabilities?.[`u${index + 1}__${o}`]]),
        );
        const problem = vectorProblem(given, options);
        if (problem) return { kind: 'refused', reason: `unit ${unit.n}: ${problem}` };
        const vector = given as Record<string, number>;
        opinions.set(unit.n, vector);
        labels.push({ units: String(unit.n), label: topOption(vector, options, ctx.fault) });
      }
    }
  }
  return Promise.resolve({ kind: 'answer', answer: { labels }, key: lastKey, opinions });
}
