import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type CassetteRow,
  RUNS,
  readableFor,
  requestKey,
  WINDOW_CAP,
  windowMeta,
  wireFor,
} from '../../../src/ladders/pointer/kit/fixture';
import type {
  LabelAnswer,
  LabelEntry,
  ModelArm,
  ScanArm,
  Transport,
} from '../../../src/ladders/pointer/sut/port';
import { referenceBugsD } from './bugs-d';
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
  /** Which of the independent runs of the same request this is (the system 2 labeler asks three). */
  run?: string;
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
      [...this.entries.values()]
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((e) => canonicalCompact(e))
        .join('\n') + (this.entries.size > 0 ? '\n' : '')
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
  arm: ScanArm;
  transport: Transport;
  cassette: Cassette;
  threshold?: number;
  cutDigestOf(file: string): string;
  warnings: string[];
  /** Units whose choice answer is refused (its probabilities are no vector), with the reason. */
  refusals?: string[];
  keyHeader: string;
  /** The key of the `haiku` arm, read when a request of that arm leaves (the item may watch the read). */
  haikuKey?: () => string;
  /** The `http` arm: the address of the user labeler. */
  url?: string;
  /** A stack reads the vector of each unit of a choice answer: undefined when the vector is refused. */
  onVector?: (n: number, vector: Record<string, number> | undefined) => void;
};

export type ModelResult =
  | { kind: 'answer'; answer: LabelAnswer; key: string }
  | { kind: 'refused'; reason: string }
  | { kind: 'error'; message: string };

const HAIKU_URL = 'https://api.haiku.invalid/v1/messages';
const JEV_URL = 'https://jev.invalid/v1/systemone';
const DECISIONS_URL = 'https://openai.invalid/v1/decisions';
/** Units in one choice request of the window state (design, section 3); the unit state asks one unit. */
export const JEV_WINDOW_UNITS = 30;
/** Yes or no questions in one decisions request; a window holds as many units as fit. */
export const DECISIONS_CAP = 100;
/** The probability of yes a decisions unit needs by default (window state), when the caller sets none. */
export const DECISIONS_THRESHOLD = 0.4;
/** How far the probabilities of one choice answer may sit from a sum of 1. */
export const VECTOR_TOLERANCE = 0.01;
/** What the `none` option of a choice question says. */
const NONE_OPTION = 'None of the other labels applies to this unit.';

/**
 * Planted bugs for the tests of the choice and decisions items (test/pointer/cr2-jev.test.ts). Empty in every
 * other run: the reference follows the design.
 */
export const referenceBugs = new Set<
  | 'threshold-over-labels'
  | 'normalise'
  | 'no-none-option'
  | 'window-60'
  | 'no-halving'
  | 'unit-state-window'
  | 'drop-none-probability'
  | 'decisions-threshold-0.5'
  | 'ignores-caller-threshold'
  | 'threshold-in-key'
>();

/**
 * The label a choice answer decides: the option with the highest probability, `none` among the options, the
 * first in set order on a tie. Undefined, with a refusal, when the probabilities are no vector: they are
 * never normalised.
 */
function choiceDecision(
  vector: Record<string, number>,
  names: readonly string[],
  ctx: ModelCtx,
  where: string,
): string | undefined {
  const values = names.map((name) => vector[name]);
  if (values.some((p) => typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1)) {
    ctx.refusals?.push(`${where}: an option has no probability`);
    return undefined;
  }
  const total = (values as number[]).reduce((sum, p) => sum + p, 0);
  if (Math.abs(total - 1) > VECTOR_TOLERANCE + 1e-9 && !referenceBugs.has('normalise')) {
    ctx.refusals?.push(`${where}: the probabilities are no vector (they sum to ${Number(total.toFixed(4))})`);
    return undefined;
  }
  if (referenceBugs.has('threshold-over-labels')) {
    // The planted bug: the yes or no rule on a choice answer, the highest label at a threshold, else none.
    const threshold = ctx.threshold ?? (ctx.arm === 'jev-unit' ? 0.7 : 0.4);
    let top: { name: string; p: number } | undefined;
    for (const name of names) {
      const p = vector[name] as number;
      if (name !== 'none' && (!top || p > top.p)) top = { name, p };
    }
    return top && top.p >= threshold ? top.name : 'none';
  }
  let best: { name: string; p: number } | undefined;
  for (const name of names) {
    const p = vector[name] as number;
    if (!best || p > best.p) best = { name, p };
  }
  return best?.name;
}

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

export async function haiku(
  plan: WindowPlan,
  set: ParsedSet,
  ctx: ModelCtx,
  run = 1,
): Promise<ModelResult> {
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
  const key = sha256(canonicalCompact({ ...request, run }));
  const want = {
    key,
    run: String(run),
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
    headers: {
      'content-type': 'application/json',
      'x-api-key': ctx.haikuKey ? ctx.haikuKey() : ctx.keyHeader,
    },
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

/**
 * The system 1 choice labeler (design, section 3): one choice question per unit keyed `u<n>`, the labels
 * of the set and `none` as options, answered with a probability vector keyed `u<n>__<option>`. The window
 * state asks up to 30 units per request, the unit state one unit per request. A request refused as too large
 * is halved.
 */
async function jev(plan: WindowPlan, set: ParsedSet, ctx: ModelCtx): Promise<ModelResult> {
  const unitState = ctx.arm === 'jev-unit' && !referenceBugs.has('unit-state-window');
  const askable = set.labels.filter((l) => l.target !== 'required');
  const names = [...askable.map((l) => l.name), 'none'];
  const label = plan.units.filter((u) => u.mode === 'label');
  const chunkSize = unitState ? 1 : referenceBugs.has('window-60') ? 60 : JEV_WINDOW_UNITS;
  const criteria: Record<string, string> = Object.fromEntries(askable.map((l) => [l.name, l.description]));
  if (!referenceBugs.has('no-none-option')) criteria.none = NONE_OPTION;
  const decided: LabelEntry[] = [];
  let lastKey = '';
  const run = async (units: typeof label): Promise<ModelResult | undefined> => {
    const sub: WindowPlan = { ...plan, units: units.map((u) => ({ ...u })) };
    const state = userText(set, sub);
    const questions: Record<string, unknown> = {};
    for (const u of units) {
      questions[`u${u.n}`] = {
        type: 'choice',
        instructions: `Which label does unit [${u.n}] of the numbered text have?`,
        criteria,
      };
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
        output: sha256(canonicalCompact(questions)),
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
        if (referenceBugs.has('no-halving'))
          return { kind: 'error', message: 'the endpoint refused the window' };
        if (units.length <= 1) return { kind: 'error', message: 'the endpoint refused a single unit' };
        const half = referenceBugsD.has('replay-halve-floor')
          ? Math.floor(units.length / 2)
          : Math.ceil(units.length / 2);
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
      probabilities = {};
      for (const k of Object.keys(questions)) {
        for (const name of names) {
          const p = data.answers?.[k]?.probabilities?.[name];
          if (typeof p !== 'number' || p < 0 || p > 1)
            return { kind: 'refused', reason: `no probability for ${k}__${name}` };
          probabilities[`${k}__${name}`] = p;
        }
      }
      const recorded = referenceBugs.has('drop-none-probability')
        ? Object.fromEntries(Object.entries(probabilities).filter(([k]) => !k.endsWith('__none')))
        : probabilities;
      const entry: CassetteEntry = {
        ...want,
        model: String(data.model ?? ''),
        stop_reason: 'end_turn',
        usage: {},
        answer: { probabilities: recorded },
      };
      receipt(ctx, entry, entry.model);
      ctx.cassette.entries.set(key, entry);
    }
    for (const u of units) {
      const vector = Object.fromEntries(
        names.map((name) => [name, probabilities[`u${u.n}__${name}`] as number]),
      );
      const got = choiceDecision(vector, names, ctx, `${plan.id}: unit [${u.n}]`);
      ctx.onVector?.(u.n, got === undefined ? undefined : vector);
      if (got !== undefined) decided.push({ units: String(u.n), label: got });
    }
    return undefined;
  };
  for (let i = 0; i < label.length; i += chunkSize) {
    const problem = await run(label.slice(i, i + chunkSize));
    if (problem) return problem;
  }
  return { kind: 'answer', answer: { labels: decided }, key: lastKey };
}

/**
 * The yes or no system 1 labeler `openai-decisions` (design, section 3): one predicate per unit and label,
 * named `u<n>__<label>`, answered with a probability of yes each. A unit takes the label with the highest
 * probability at or above the threshold (0.4 for a window unless the caller sets one), else `none`. The
 * probabilities are recorded, so the threshold is a setting of the replay, outside the key.
 */
async function decisions(plan: WindowPlan, set: ParsedSet, ctx: ModelCtx): Promise<ModelResult> {
  const askable = set.labels.filter((l) => l.target !== 'required');
  const label = plan.units.filter((u) => u.mode === 'label');
  const chunkSize = Math.max(1, Math.floor(DECISIONS_CAP / Math.max(1, askable.length)));
  const fallback = referenceBugs.has('decisions-threshold-0.5') ? 0.5 : DECISIONS_THRESHOLD;
  const threshold =
    ctx.threshold === undefined || referenceBugs.has('ignores-caller-threshold') ? fallback : ctx.threshold;
  const decided: LabelEntry[] = [];
  let lastKey = '';
  for (let i = 0; i < label.length; i += chunkSize) {
    const units = label.slice(i, i + chunkSize);
    const input = userText(set, { ...plan, units: units.map((u) => ({ ...u })) });
    const questions = units.flatMap((u) =>
      askable.map((l) => ({
        type: 'predicate',
        name: `u${u.n}__${l.name}`,
        instructions: `Does the label ${l.name} apply to unit [${u.n}]? ${l.description}`,
      })),
    );
    const request = { model: 'decisions-fake-1', input, questions };
    const keyed = referenceBugs.has('threshold-in-key') ? { ...request, threshold } : request;
    const key = sha256(canonicalCompact({ ...keyed, arm: ctx.arm }));
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
        user: sha256(input),
        output: sha256(canonicalCompact(questions.map((q) => q.name))),
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
        url: DECISIONS_URL,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${ctx.keyHeader}` },
        body: JSON.stringify(request),
      });
      if (response.status !== 200)
        return { kind: 'error', message: `the endpoint answered HTTP ${response.status}` };
      let data: { model?: string; answers?: Array<{ name?: unknown; probability?: unknown }> };
      try {
        data = JSON.parse(response.body);
      } catch {
        return { kind: 'refused', reason: 'the response is not JSON' };
      }
      const given = new Map((data.answers ?? []).map((a) => [a.name, a.probability]));
      probabilities = {};
      for (const q of questions) {
        const p = given.get(q.name);
        if (typeof p !== 'number' || p < 0 || p > 1)
          return { kind: 'refused', reason: `no probability for ${q.name}` };
        probabilities[q.name] = p;
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
        if (typeof p === 'number' && p >= threshold && (!best || p > best.p)) best = { name: l.name, p };
      }
      decided.push({ units: String(u.n), label: best ? best.name : 'none' });
    }
  }
  return { kind: 'answer', answer: { labels: decided }, key: lastKey };
}

/** The id of an HTTP user labeler (design, section 3): a hash of its address, which hides any secret in it. */
export function httpLabelerId(url: string): string {
  return referenceBugsD.has('w-user-http-id-constant') ? 'http:x' : `http:${sha256(url).slice(0, 12)}`;
}

/**
 * The `http` arm: a system 2 user labeler. The request is `{ set, window, prompt }`, the answer `{ labels }`;
 * the id of the labeler is in the key, so another address misses.
 */
async function userHttp(plan: WindowPlan, set: ParsedSet, ctx: ModelCtx): Promise<ModelResult> {
  const id = httpLabelerId(ctx.url ?? '');
  const prompt = { system: SYSTEM_TEXT, user: userText(set, plan) };
  const body = {
    set: {
      name: set.set,
      description: set.description,
      labels: set.labels.map((l) => ({ name: l.name, description: l.description })),
    },
    window: { id: plan.id, path: plan.file, headingPath: plan.path },
    prompt,
  };
  const key = sha256(canonicalCompact({ body, labeler: id }));
  const want = {
    key,
    file: plan.file,
    window: plan.id,
    promptVersion: 'p1',
    schemaVersion: 's1',
    setName: set.set,
    setHash: set.hash,
    labeler: id,
    cutDigest: ctx.cutDigestOf(plan.file),
    part: { system: sha256(prompt.system), user: sha256(prompt.user), output: sha256('') },
  };
  const hit = ctx.cassette.entries.get(key);
  if (hit) return { kind: 'answer', answer: { labels: hit.answer.labels ?? [] }, key };
  if (ctx.cassette.mode === 'replay') return missError(ctx, want);
  const response = await ctx.transport({
    url: ctx.url ?? '',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (response.status !== 200)
    return { kind: 'error', message: `the labeler endpoint answered HTTP ${response.status}` };
  let data: { model?: string; labels?: LabelEntry[] };
  try {
    data = JSON.parse(response.body);
  } catch {
    return { kind: 'refused', reason: 'the response is not JSON' };
  }
  if (!Array.isArray(data.labels)) return { kind: 'refused', reason: 'the answer has no labels list' };
  const checked = validateAnswer({ labels: data.labels }, plan, set);
  if (!checked.ok) return { kind: 'refused', reason: checked.reason };
  ctx.cassette.entries.set(key, {
    ...want,
    model: String(data.model ?? ''),
    stop_reason: 'answered',
    usage: {},
    answer: { labels: data.labels },
  });
  return { kind: 'answer', answer: { labels: data.labels }, key };
}

/** One call of a model port for a window and a set. */
export function askModel(plan: WindowPlan, set: ParsedSet, ctx: ModelCtx): Promise<ModelResult> {
  if (ctx.arm === 'openai-decisions') return decisions(plan, set, ctx);
  if (ctx.arm === 'http') return userHttp(plan, set, ctx);
  if ([...ctx.cassette.entries.values()].some((e) => e.readable)) return fixtureReplay(plan, set, ctx);
  return ctx.arm === 'haiku' ? haikuRuns(plan, set, ctx) : jev(plan, set, ctx);
}

/**
 * The system 2 labeler asks every window once per independent run (design, "The default stack"). A run whose
 * answer is refused is asked once more; the first run's answer is the window's answer.
 */
async function haikuRuns(plan: WindowPlan, set: ParsedSet, ctx: ModelCtx): Promise<ModelResult> {
  let first: ModelResult | undefined;
  for (let run = 1; run <= RUNS.haiku; run += 1) {
    let result = await haiku(plan, set, ctx, run);
    if (result.kind === 'refused') result = await haiku(plan, set, ctx, run);
    if (result.kind !== 'answer') return result;
    first ??= result;
  }
  return first as ModelResult;
}

/**
 * Supports the public reader wire format as well as this reference's legacy record format. A window is asked once
 * per run (three runs for the system 2 labeler); the key hashes the wire with its readable fields, and a hit whose
 * readable fields differ from the request is refused with the names of the fields that differ.
 */
async function fixtureReplay(plan: WindowPlan, parsed: ParsedSet, ctx: ModelCtx): Promise<ModelResult> {
  const { hash: _setHash, ...set } = parsed;
  const units = plan.units.filter((u) => u.mode !== 'opaque' && u.mode !== 'read');
  // askModel sends the decisions arm elsewhere: a fixture is recorded on the three arms of the fixtures only.
  const arm = ctx.arm as ModelArm;
  const cap = WINDOW_CAP[arm];
  const labels: LabelEntry[] = [];
  let lastKey = '';
  for (let offset = 0; offset < units.length; offset += cap) {
    const selected = units.slice(offset, offset + cap),
      window = `${plan.file}#${Math.floor(offset / cap) + 1}`;
    const wire = wireFor(
      arm,
      set,
      window,
      selected.map((u, i) => ({ n: i + 1, text: u.text })),
      selected[0]?.path ?? [],
    );
    let first: CassetteRow | undefined;
    for (let run = 1; run <= RUNS[arm]; run++) {
      const want = readableFor(
        wire,
        windowMeta(arm, {
          path: plan.file,
          window,
          set,
          wire,
          cutDigest: ctx.cutDigestOf(plan.file),
          run,
        }),
      );
      const key = requestKey(wire, want);
      lastKey = key;
      const rows = [...ctx.cassette.entries.values()] as unknown as CassetteRow[];
      let hit = rows.find((row) => row.key === key);
      if (!hit && ctx.cassette.mode === 'record') {
        const response = await ctx.transport({
          url: 'https://fixture.invalid',
          headers: arm === 'haiku' && ctx.haikuKey ? { 'x-api-key': ctx.haikuKey() } : {},
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
        if (prior)
          ctx.warnings.push(`returned model ${body.model} differs from ${prior.answer.returnedModel}`);
        hit = {
          key,
          readable: want,
          answer: {
            ...(recordedLabels
              ? { labels: recordedLabels }
              : {
                  probabilities: Object.fromEntries(
                    Object.entries(body.answers ?? {}).flatMap(([question, answer]) =>
                      Object.entries(answer.probabilities ?? {}).map(([option, p]) => [
                        `${question}__${option}`,
                        p,
                      ]),
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
      const differing = (row: CassetteRow): string[] =>
        [...new Set([...Object.keys(want), ...Object.keys(row.readable)])]
          .filter((k) => want[k] !== row.readable[k])
          .sort();
      // The nearest entry of a miss: of the same file, window, set and labeler, the one that differs least.
      const anyLabeler = referenceBugsD.has('cassette-nearest-any-labeler');
      const farthest = referenceBugsD.has('replay-miss-names-farthest');
      const candidates = rows
        .filter(
          (row) =>
            row.readable.path === plan.file &&
            row.readable.window === window &&
            row.readable.set === set.set &&
            (anyLabeler || row.readable.labeler === wire.labeler),
        )
        .sort((a, b) =>
          farthest
            ? differing(b).length - differing(a).length
            : differing(a).length - differing(b).length,
        );
      const near = hit ?? candidates[0];
      if (!near)
        return {
          kind: 'error',
          message: `cassette miss for ${window}: the cassette holds no entry of the labeler ${wire.labeler} for the same file, window and set`,
        };
      const differs = differing(near);
      if (!hit || differs.length) {
        const fields = differs.length ? differs.join(', ') : 'file, window';
        return Promise.resolve({
          kind: 'error',
          message: `cassette miss for ${window}: nearest entry ${near.readable.window} differs in ${fields}${differs.includes('cutDigest') ? `; Node ${process.versions.node}, ICU ${process.versions.icu}` : ''}`,
        });
      }
      first ??= hit;
    }
    if (!first) return { kind: 'error', message: `cassette miss for ${window}: no run` };
    if (ctx.arm === 'haiku') {
      for (const label of first.answer.labels ?? [])
        labels.push({ ...label, units: String(Number(label.units) + offset) });
    } else {
      // A choice answer: the highest option, `none` included; a vector that does not sum to 1 is refused.
      const names = [...set.labels.filter((l) => l.target !== 'required').map((l) => l.name), 'none'];
      for (const [index, unit] of selected.entries()) {
        const vector = Object.fromEntries(
          names.map((name) => [name, first?.answer.probabilities?.[`u${index + 1}__${name}`] as number]),
        );
        const got = choiceDecision(vector, names, ctx, `${window}: unit [${index + 1}]`);
        if (got !== undefined) labels.push({ units: String(unit.n), label: got });
      }
    }
  }
  return Promise.resolve({ kind: 'answer', answer: { labels }, key: lastKey });
}
