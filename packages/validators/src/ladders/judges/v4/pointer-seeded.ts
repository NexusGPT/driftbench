import { createHash } from 'node:crypto';
import type { PointerImpl } from './pointer';

/**
 * Cases drawn from the seed, with the expected values computed here by short independent references (sha256 from
 * node:crypto, sorted-key JSON written below, the documented rules). The fixtures of `pointer.json` are fixed
 * and visible to anyone who reads the repository; a module that stores their answers passes them and fails
 * these, because the seed changes the inputs (docs/validators.md section 12.7, the cheater check). Every
 * word is fictional.
 */

type Json = any;
export type Rng = () => number;

/** mulberry32, the generator of the statistics package, so a seed gives the same draw on every machine. */
export function rngOf(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const int = (r: Rng, lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));
const pick = <T>(r: Rng, xs: readonly T[]): T => xs[int(r, 0, xs.length - 1)] as T;
const WORDS = [
  'plum',
  'harbour',
  'lantern',
  'ferry',
  'quarry',
  'meadow',
  'copper',
  'willow',
  'ember',
  'tide',
  'moss',
  'anvil',
  'cedar',
  'dune',
];
const word = (r: Rng): string => `${pick(r, WORDS)}-${int(r, 10, 99)}`;
const sentence = (r: Rng): string => `${pick(r, WORDS)} ${pick(r, WORDS)} ${pick(r, WORDS)} ${int(r, 1, 99)}`;

const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
export function canonicalRef(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalRef).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value as object).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalRef((value as Json)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
const hash16 = (value: unknown): string => sha(canonicalRef(value)).slice(0, 16);

const show = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    x !== null && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : x,
  );
const guard = <T>(label: string, fn: () => T): { ok: true; value: T } | { ok: false; error: string } => {
  try {
    return { ok: true, value: fn() };
  } catch (cause) {
    return {
      ok: false,
      error: `${label} threw ${cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)}`,
    };
  }
};

// ---------------------------------------------------------------------------------------------- units
function expandRef(text: string): number[] | null {
  const m = /^([0-9]+)(?:-([0-9]+))?$/.exec(text.trim());
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2] ?? m[1]);
  if (b < a || b - a > 10_000) return null;
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

export function seededUnits(impl: PointerImpl, r: Rng): string[] {
  const misses: string[] = [];
  for (let i = 0; i < 40; i += 1) {
    const a = int(r, 0, 400);
    const b = a + int(r, -3, 30);
    const pad = (s: string) => `${' \t\n'.slice(0, int(r, 0, 2))}${s}${' \t'.slice(0, int(r, 0, 1))}`;
    const text = pick(r, [
      () => pad(String(a)),
      () => pad(`${a}-${b}`),
      () => `${a}-${a + 10_000 + int(r, 0, 2)}`,
      () => `${pick(r, ['x', '-', '', '+', 'u'])}${a}`,
      () => `${a}${pick(r, ['-', ',', '.', ' ', 'a'])}`,
      () => `${a} - ${b}`,
    ])();
    const got = guard(`expandUnits(${show(text)})`, () => impl.expandUnits(text));
    if (!got.ok) misses.push(got.error);
    else if (show(got.value ?? null) !== show(expandRef(text)))
      misses.push(
        `expandUnits(${show(text)}) gave ${show(got.value ?? null)}, expected ${show(expandRef(text))}`,
      );
  }
  return misses;
}

// ------------------------------------------------------------------------------------------------ sets
type LabelSetJson = { set: string; description: string; labels: Json[] };
function randomSet(r: Rng, target = false): LabelSetJson {
  const labels: Json[] = [];
  const n = int(r, 1, 4);
  for (let i = 0; i < n; i += 1) {
    const l: Json = { name: `${pick(r, WORDS)}-${i}${int(r, 0, 9)}`, description: sentence(r) };
    if (r() < 0.4) l.examples = [sentence(r), sentence(r)].slice(0, int(r, 1, 2));
    if (target && n > 1 && i === n - 1) {
      l.target = 'required';
      l.condition = true;
    }
    labels.push(l);
  }
  return { set: `set-${word(r)}`, description: sentence(r), labels };
}

export function seededSetHash(impl: PointerImpl, r: Rng): string[] {
  const misses: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    const s = randomSet(r, r() < 0.3);
    const got = guard('setHash', () => impl.setHash(s as never));
    if (!got.ok) {
      misses.push(got.error);
      continue;
    }
    if (got.value !== hash16(s)) misses.push(`setHash of ${s.set} gave ${got.value}, expected ${hash16(s)}`);
    const reversedKeys = JSON.parse(JSON.stringify(s), (_k, v) => v);
    const flipped = Object.fromEntries(Object.entries(reversedKeys).reverse());
    if (impl.setHash(flipped as never) !== got.value)
      misses.push(`setHash of ${s.set} changed with the order of its keys`);
    const edited = structuredClone(s);
    const at = int(r, 0, edited.labels.length - 1);
    edited.labels[at].description += ' more';
    if (impl.setHash(edited as never) === got.value)
      misses.push(`setHash of ${s.set} did not change when a description changed`);
    if (s.labels.length > 1) {
      const swapped = structuredClone(s);
      swapped.labels.reverse();
      if (impl.setHash(swapped as never) === got.value)
        misses.push(`setHash of ${s.set} did not change when the labels changed order`);
    }
  }
  return misses;
}

// --------------------------------------------------------------------------------------------- recording
export function seededRecording(impl: PointerImpl, r: Rng): string[] {
  const misses: string[] = [];
  const value = (depth = 0): Json =>
    depth > 1 || r() < 0.4
      ? pick(r, [sentence(r), int(r, 0, 99), r() < 0.5, null])
      : r() < 0.5
        ? [value(depth + 1), value(depth + 1)]
        : { [word(r)]: value(depth + 1), [word(r)]: value(depth + 1) };
  for (let i = 0; i < 6; i += 1) {
    const wire = { labeler: word(r), body: { [word(r)]: value(), [word(r)]: value(), [word(r)]: value() } };
    const meta = {
      path: `${word(r)}.md`,
      window: `${word(r)}#${int(r, 1, 9)}`,
      promptVersion: 'p1',
      schemaVersion: 's1',
      set: word(r),
      setHash: hash16(randomSet(r)),
      model: word(r),
      cutDigest: sha(sentence(r)).slice(0, 12),
      cls: pick(r, ['system1', 'system2']),
      run: String(int(r, 1, 3)),
    };
    const parts = Object.fromEntries(
      Object.entries(wire.body).map(([k, v]) => [`part.${k}`, sha(canonicalRef(v)).slice(0, 12)]),
    );
    const readable = { ...meta, labeler: wire.labeler, ...parts };
    const got = guard('readableOf', () => impl.readableOf(wire as never, meta as never));
    if (!got.ok) {
      misses.push(got.error);
      continue;
    }
    if (show(Object.entries(got.value).sort()) !== show(Object.entries(readable).sort()))
      misses.push(`readableOf gave ${show(got.value)}, expected ${show(readable)}`);
    const key = guard('requestKey', () => impl.requestKey(wire as never, readable as never));
    const want = sha(canonicalRef({ wire, readable }));
    if (!key.ok) misses.push(key.error);
    else if (key.value !== want) misses.push(`requestKey gave ${key.value}, expected ${want}`);
    for (const field of Object.keys(meta)) {
      const other = guard('requestKey', () =>
        impl.requestKey(wire as never, { ...readable, [field]: `${(readable as Json)[field]}x` } as never),
      );
      if (other.ok && key.ok && other.value === key.value)
        misses.push(`requestKey did not change when ${field} of the readable fields changed`);
    }
  }
  return misses;
}

// ------------------------------------------------------------------------------------------- the answer
type Win = {
  id: string;
  path: string;
  headingPath: string[];
  units: Array<{ n: number; text: string; index: number }>;
};
function randomWindow(r: Rng): Win {
  const k = int(r, 3, 9);
  const off = int(r, 0, 60);
  return {
    id: `${word(r)}#${int(r, 1, 5)}`,
    path: `${word(r)}.md`,
    headingPath: [word(r)],
    units: Array.from({ length: k }, (_, i) => ({ n: i + 1, text: sentence(r), index: i + off })),
  };
}

type Entry = { units: string; label: string; target?: unknown };
type AnswerRef = { accepted: Record<string, Json>; covered: number[]; refusals: string[][] };
function answerRef(set: LabelSetJson, win: Win, answer: Entry[]): AnswerRef {
  const allowed = new Map(set.labels.map((l) => [l.name as string, l]));
  const inWin = new Set(win.units.map((u) => u.n));
  const accepted: Record<string, Json> = {};
  const covered = new Set<number>();
  const refusals: string[][] = [];
  for (const e of answer) {
    const label = allowed.get(e.label);
    if (e.label !== 'none' && !label) {
      refusals.push([e.label]);
      continue;
    }
    const nums = expandRef(e.units);
    if (!nums) {
      refusals.push([e.units]);
      continue;
    }
    const out = nums.find((n) => !inWin.has(n));
    if (out !== undefined) {
      refusals.push([e.units, String(out)]);
      continue;
    }
    const twice = nums.find((n) => covered.has(n));
    if (twice !== undefined) {
      refusals.push([e.units, String(twice)]);
      continue;
    }
    const t = e.target;
    if (t !== undefined && (typeof t !== 'number' || !Number.isInteger(t))) {
      refusals.push([JSON.stringify(t)]);
      continue;
    }
    if (e.label === 'none' && t !== undefined) {
      refusals.push(['none']);
      continue;
    }
    if (label?.target === 'required' && (t === undefined || !inWin.has(t as number))) {
      refusals.push([e.label]);
      continue;
    }
    if (label && label.target !== 'required' && t !== undefined) {
      refusals.push([e.label]);
      continue;
    }
    for (const n of nums) {
      covered.add(n);
      if (e.label !== 'none')
        accepted[String(n)] = { label: e.label, ...(t !== undefined ? { target: t } : {}) };
    }
  }
  return { accepted, covered: [...covered].sort((a, b) => a - b), refusals };
}

/** An answer with one known defect: the kind of refusal each defect must cause. */
export type Defect =
  | 'none'
  | 'unknown-label'
  | 'bad-units'
  | 'outside-window'
  | 'named-twice'
  | 'bad-target'
  | 'none-target'
  | 'missing-target'
  | 'extra-target';
export const DEFECTS: readonly Defect[] = [
  'none',
  'unknown-label',
  'bad-units',
  'outside-window',
  'named-twice',
  'bad-target',
  'none-target',
  'missing-target',
  'extra-target',
];

function answerCase(
  r: Rng,
  defect: Defect,
): { set: LabelSetJson; win: Win; answer: Entry[]; counts: boolean } {
  const set = randomSet(r, true);
  const win = randomWindow(r);
  const plain = set.labels.filter((l) => l.target !== 'required');
  const needs = set.labels.find((l) => l.target === 'required');
  const k = win.units.length;
  const answer: Entry[] = [
    { units: String(1), label: pick(r, plain.length ? plain : [{ name: 'none' }]).name },
  ];
  if (needs) answer.push({ units: '2', label: needs.name, target: int(r, 1, k) });
  if (k > 4)
    answer.push({ units: `4-${Math.min(k, 5)}`, label: pick(r, ['none', ...plain.map((l) => l.name)]) });
  const free = k + 1;
  switch (defect) {
    case 'unknown-label':
      answer.push({ units: String(k), label: `${word(r)}-unknown` });
      break;
    case 'bad-units':
      answer.push({ units: pick(r, ['x', '3-', 'a-b', `${k}.5`]), label: plain[0]?.name ?? 'none' });
      break;
    case 'outside-window':
      answer.push({ units: `${k}-${k + int(r, 1, 3)}`, label: plain[0]?.name ?? 'none' });
      break;
    case 'named-twice':
      answer.push({ units: '1', label: plain[0]?.name ?? 'none' });
      break;
    case 'bad-target':
      if (needs) answer.push({ units: String(k), label: needs.name, target: pick(r, [1.5, '2']) });
      else answer.push({ units: String(k), label: 'none', target: 1.5 });
      break;
    case 'none-target':
      answer.push({ units: String(k), label: 'none', target: 1 });
      break;
    case 'missing-target':
      if (needs) answer.push({ units: String(k), label: needs.name });
      else answer.push({ units: String(k), label: 'none', target: 2 });
      break;
    case 'extra-target':
      answer.push({ units: String(k), label: plain[0]?.name ?? 'none', target: 1 });
      break;
    default:
      void free;
  }
  return { set, win, answer, counts: true };
}

export function seededAnswer(
  impl: PointerImpl,
  r: Rng,
  defects: readonly Defect[],
  label = 'checkAnswer',
): string[] {
  const misses: string[] = [];
  for (const defect of defects) {
    for (let i = 0; i < 3; i += 1) {
      const c = answerCase(r, defect);
      const want = answerRef(c.set, c.win, c.answer);
      const got = guard(`${label} (${defect})`, () =>
        impl.checkAnswer(c.set as never, c.win as never, structuredClone(c.answer) as never),
      );
      if (!got.ok) {
        misses.push(got.error);
        continue;
      }
      const accepted = Object.fromEntries(
        [...got.value.accepted.entries()].sort((x, y) => x[0] - y[0]).map(([n, v]) => [String(n), v]),
      );
      const covered = [...got.value.covered].sort((x, y) => x - y);
      if (show(accepted) !== show(want.accepted))
        misses.push(`${label} (${defect}): accepted ${show(accepted)}, expected ${show(want.accepted)}`);
      if (show(covered) !== show(want.covered))
        misses.push(`${label} (${defect}): covered ${show(covered)}, expected ${show(want.covered)}`);
      if (got.value.refusals.length !== want.refusals.length)
        misses.push(
          `${label} (${defect}): ${got.value.refusals.length} refusals, expected ${want.refusals.length}`,
        );
      else
        got.value.refusals.forEach((m: string, j: number) => {
          if (!(want.refusals[j] as string[]).some((part) => m.includes(part)))
            misses.push(
              `${label} (${defect}): the refusal "${m}" must name ${(want.refusals[j] as string[]).map(show).join(' or ')}`,
            );
        });
    }
  }
  return misses;
}

// ------------------------------------------------------------------------------------------ label files
function fileText(sets: LabelSetJson[]): string {
  const lines = ['labels:'];
  for (const s of sets) {
    lines.push(`  - set: ${s.set}`, `    description: ${JSON.stringify(s.description)}`, '    labels:');
    for (const l of s.labels) {
      lines.push(`      - name: ${l.name}`, `        description: ${JSON.stringify(l.description)}`);
      if (l.examples) lines.push(`        examples: ${JSON.stringify(l.examples)}`);
      if (l.target) lines.push('        target: required');
      if (l.condition) lines.push('        condition: true');
      if (l.atom) lines.push('        atom: { kind: rule }');
    }
  }
  return `${lines.join('\n')}\n`;
}

export type FileRule = 'valid' | 'names' | 'duplicates' | 'conditions' | 'shape' | 'yaml';
export function seededLabelFile(impl: PointerImpl, r: Rng, rule: FileRule): string[] {
  const misses: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    const sets = [randomSet(r, r() < 0.5), { ...randomSet(r), set: `other-${word(r)}` }];
    const text = fileText(sets);
    const base = guard('parseLabelSets', () => impl.parseLabelSets(text));
    if (!base.ok) {
      misses.push(base.error);
      continue;
    }
    if (!base.value.ok) {
      misses.push(`a valid file was refused: "${base.value.message}"`);
      continue;
    }
    if (
      base.value.sets.length !== 2 ||
      show(base.value.sets.map((s) => s.labels.length)) !== show(sets.map((s) => s.labels.length))
    )
      misses.push(`a valid file of ${sets.length} sets was read as ${base.value.sets.length}`);
    if (rule === 'valid') continue;
    const bad = (mutate: (s: LabelSetJson[]) => string, mention: string, what: string) => {
      const copy = structuredClone(sets);
      const t = mutate(copy);
      const got = guard('parseLabelSets', () => impl.parseLabelSets(t));
      if (!got.ok) misses.push(got.error);
      else if (got.value.ok) misses.push(`${what}: accepted`);
      else if (!got.value.message.toLowerCase().includes(mention.toLowerCase()))
        misses.push(`${what}: refused with "${got.value.message}", which does not mention "${mention}"`);
    };
    const first = sets[0] as LabelSetJson;
    const lab = first.labels[0] as Json;
    if (rule === 'names') {
      bad(
        (s) => {
          (s[0] as LabelSetJson).labels[0].name = 'none';
          return fileText(s);
        },
        'none',
        'the reserved name none',
      );
      bad(
        (s) => {
          (s[0] as LabelSetJson).labels[0].name = lab.name.toUpperCase();
          return fileText(s);
        },
        'name',
        'an upper case name',
      );
      bad(
        (s) => {
          (s[0] as LabelSetJson).labels[0].name = `${word(r)}_x`;
          return fileText(s);
        },
        'name',
        'an underscore in a name',
      );
    }
    if (rule === 'duplicates') {
      bad(
        (s) => {
          (s[0] as LabelSetJson).labels.push(structuredClone(lab));
          return fileText(s);
        },
        lab.name,
        'a duplicate label',
      );
      bad(
        (s) => {
          (s[1] as LabelSetJson).set = first.set;
          return fileText(s);
        },
        first.set,
        'a duplicate set',
      );
    }
    if (rule === 'conditions') {
      bad(
        (s) => {
          const l = (s[0] as LabelSetJson).labels[0];
          delete l.target;
          l.condition = true;
          return fileText(s);
        },
        lab.name,
        'a condition without target',
      );
      bad(
        (s) => {
          const l = (s[0] as LabelSetJson).labels[0];
          l.target = 'required';
          l.condition = true;
          l.atom = { kind: 'rule' };
          return fileText(s);
        },
        lab.name,
        'a condition with an atom',
      );
    }
    if (rule === 'shape') {
      bad(
        (s) => {
          (s[0] as LabelSetJson).labels[0].examples = ['a', 'b', 'c', 'd'];
          return fileText(s);
        },
        'examples',
        'four examples',
      );
      bad(
        (s) => {
          (s[0] as LabelSetJson).labels[0].description = '';
          return fileText(s);
        },
        'description',
        'an empty description',
      );
      bad(
        (s) => {
          (s[0] as LabelSetJson).labels = [];
          return fileText(s);
        },
        'labels',
        'a set without labels',
      );
    }
    if (rule === 'yaml') {
      bad(() => 'labels: [unclosed\n', '', 'text that is not YAML');
      bad(
        (s) =>
          fileText(s).replace(
            `        description: ${JSON.stringify(lab.description)}\n`,
            `        description: ${JSON.stringify(lab.description)}\n        description: again\n`,
          ),
        '',
        'a duplicate key',
      );
      bad(() => '', '', 'an empty file');
    }
  }
  return misses;
}

// ------------------------------------------------------------------------------------ yes or no, choice
const labelsOf = (names: string[]) => names.map((name) => ({ name, description: `The ${name} label.` }));
const answerOf = (probabilities: Record<string, unknown>) => ({
  probabilities,
  returnedModel: 'planted',
  stopReason: 'answered',
  usage: { input: 1, output: 1 },
});

export function seededYesNo(impl: PointerImpl, r: Rng, part: 'threshold' | 'unanswered' | 'asked'): string[] {
  const misses: string[] = [];
  for (let i = 0; i < 8; i += 1) {
    const names = Array.from({ length: int(r, 1, 4) }, (_, k) => `${pick(r, WORDS)}-${k}`);
    const win = randomWindow(r);
    const threshold = pick(r, [0.2, 0.4, 0.5, 0.7]);
    const probs: Record<string, unknown> = {};
    for (const u of win.units)
      for (const n of names) {
        const skip = part === 'unanswered' && r() < 0.15;
        if (!skip)
          probs[`u${u.n}__${n}`] = part === 'unanswered' && r() < 0.05 ? 'yes' : Math.round(r() * 20) / 20;
      }
    const want: Record<string, string> = {};
    for (const u of win.units) {
      let best: [string, number] | undefined;
      let answered = 0;
      for (const n of names) {
        const p = probs[`u${u.n}__${n}`];
        if (typeof p !== 'number') continue;
        answered += 1;
        if (p >= threshold && (!best || p > best[1])) best = [n, p];
      }
      if (answered === names.length) want[String(u.index)] = best ? best[0] : 'none';
    }
    const got = guard('yesNoOpinions', () =>
      impl.yesNoOpinions(answerOf(probs) as never, win as never, labelsOf(names) as never, threshold),
    );
    if (!got.ok) {
      misses.push(got.error);
      continue;
    }
    const have = Object.fromEntries([...got.value.byUnit.entries()].map(([k, o]) => [String(k), o.label]));
    if (show(have) !== show(want))
      misses.push(`yesNoOpinions at ${threshold}: ${show(have)}, expected ${show(want)}`);
  }
  if (part === 'asked') {
    for (let i = 0; i < 6; i += 1) {
      const set = randomSet(r, true);
      const plain = set.labels.filter((l) => l.target !== 'required').map((l) => l.name);
      const got = guard('askedLabels', () => impl.askedLabels(set as never, true).map((l) => l.name));
      if (plain.length === 0) {
        if (got.ok)
          misses.push(
            `askedLabels gave ${show(got.value)} for a set with only target labels, expected a refusal`,
          );
      } else if (!got.ok || show(got.value) !== show(plain))
        misses.push(`askedLabels gave ${got.ok ? show(got.value) : got.error}, expected ${show(plain)}`);
      const alone = guard('askedLabels', () => impl.askedLabels(set as never, false).map((l) => l.name));
      const hasTarget = set.labels.some((l) => l.target === 'required');
      if (hasTarget && alone.ok)
        misses.push('askedLabels accepted a set with a target label for a yes or no model alone');
      if (!hasTarget && (!alone.ok || show(alone.value) !== show(plain)))
        misses.push(
          `askedLabels (alone) gave ${alone.ok ? show(alone.value) : alone.error}, expected ${show(plain)}`,
        );
    }
  }
  return misses;
}

const isVectorRef = (p: Record<string, number>): boolean => {
  const v = Object.values(p);
  return (
    v.length > 0 &&
    v.every((x) => Number.isFinite(x) && x >= 0 && x <= 1) &&
    Math.abs(v.reduce((s, x) => s + x, 0) - 1) <= 0.01 + 1e-9
  );
};
function vector(r: Rng, names: string[]): Record<string, number> {
  const raw = names.map(() => r() ** 2 + 0.01);
  const total = raw.reduce((s, x) => s + x, 0);
  const out: Record<string, number> = {};
  names.forEach((n, i) => {
    out[n] = Math.round(((raw[i] as number) / total) * 100) / 100;
  });
  return out;
}

export function seededChoice(impl: PointerImpl, r: Rng): string[] {
  const misses: string[] = [];
  for (let i = 0; i < 8; i += 1) {
    const names = Array.from({ length: int(r, 1, 4) }, (_, k) => `${pick(r, WORDS)}-${k}`);
    const all = [...names, 'none'];
    const win = randomWindow(r);
    const probs: Record<string, unknown> = {};
    const want: Record<string, string> = {};
    let refusals = 0;
    for (const u of win.units) {
      const v = vector(r, all);
      const roll = r();
      if (roll < 0.15) v[pick(r, all)] = 0.9 + (v[all[0] as string] ?? 0);
      const missing = roll > 0.85 ? pick(r, all) : undefined;
      for (const n of all) if (n !== missing) probs[`u${u.n}__${n}`] = v[n];
      if (missing) continue;
      if (!isVectorRef(v)) {
        refusals += 1;
        continue;
      }
      let best = all[0] as string;
      for (const n of all) if ((v[n] as number) > (v[best] as number)) best = n;
      want[String(u.index)] = best;
    }
    const got = guard('choiceOpinions', () =>
      impl.choiceOpinions(answerOf(probs) as never, win as never, labelsOf(names) as never),
    );
    if (!got.ok) {
      misses.push(got.error);
      continue;
    }
    const have = Object.fromEntries([...got.value.byUnit.entries()].map(([k, o]) => [String(k), o.label]));
    if (show(have) !== show(want)) misses.push(`choiceOpinions: ${show(have)}, expected ${show(want)}`);
    if (got.value.refusals.length !== refusals)
      misses.push(`choiceOpinions: ${got.value.refusals.length} refusals, expected ${refusals}`);
  }
  for (let i = 0; i < 12; i += 1) {
    const names = [...Array.from({ length: int(r, 1, 4) }, (_, k) => `${pick(r, WORDS)}-${k}`), 'none'];
    const v = vector(r, names);
    if (r() < 0.3) v[names[0] as string] = 0.97;
    const sorted = Object.entries(v).sort((a, b) => b[1] - a[1]);
    const want =
      isVectorRef(v) && names.includes('none')
        ? {
            label: (sorted[0] as [string, number])[0],
            margin:
              (sorted[0] as [string, number])[1] - ((sorted[1] as [string, number] | undefined)?.[1] ?? 0),
          }
        : undefined;
    const got = guard('margin', () => impl.margin(v));
    if (!got.ok) misses.push(got.error);
    else if (!want) {
      if (got.value !== undefined) misses.push(`margin(${show(v)}) gave ${show(got.value)}, expected none`);
    } else if (
      !got.value ||
      got.value.label !== want.label ||
      Math.abs(got.value.margin - want.margin) > 1e-9
    )
      misses.push(`margin(${show(v)}) gave ${show(got.value)}, expected ${show(want)}`);
  }
  return misses;
}

// ------------------------------------------------------------------------------------------------ stack
export type Rule =
  | { rule: 'cascade'; passAt: number; failAt: number }
  | { rule: 'margin'; marginCut: number };
type Op = { label: string; probabilities: Record<string, number>; target?: number; source?: string };
type Src = { source?: string };
const srcs = (...ops: Array<Src | undefined>): string[] => ops.flatMap((o) => (o?.source ? [o.source] : []));
export function decideRef(
  first: (Op & Src) | undefined,
  second: ({ label: string } & Src) | undefined,
  askedNames: Set<string>,
  rule: Rule,
  /** How many labels the set holds: more than system 1 is asked means some only system 2 can give. */
  labelCount: number = askedNames.size,
) {
  if (!first && !second) return undefined;
  if (!first)
    return {
      label: (second as { label: string }).label,
      by: 'system2',
      fallback: true,
      sources: srcs(second),
    };
  if (second && second.label !== 'none' && !askedNames.has(second.label))
    return { label: second.label, by: 'system2', sources: srcs(first, second) };
  let sure: string | undefined;
  if (rule.rule === 'cascade') {
    let top: [string, number] | undefined;
    for (const [n, p] of Object.entries(first.probabilities)) if (!top || p > top[1]) top = [n, p];
    if (top && top[1] >= rule.passAt) sure = top[0];
    else if (!top || top[1] < rule.failAt) sure = 'none';
  } else if ('none' in first.probabilities && isVectorRef(first.probabilities)) {
    const s = Object.entries(first.probabilities).sort((a, b) => b[1] - a[1]);
    if ((s[0] as [string, number])[1] - ((s[1] as [string, number] | undefined)?.[1] ?? 0) >= rule.marginCut)
      sure = (s[0] as [string, number])[0];
  }
  // docs/estate.md "Two classes of labeler": system 1 is offered only the labels it can answer, so its none means none
  // of those; with no system-2 opinion and labels only system 2 can give, that none decides nothing.
  if (sure === 'none' && !second && askedNames.size < labelCount) return undefined;
  if (sure !== undefined)
    return {
      label: sure,
      by: 'system1',
      sources: srcs(first, second),
      ...(second ? {} : { fallback: true }),
    };
  return second ? { label: second.label, by: 'system2', sources: srcs(first, second) } : undefined;
}

function plantedLabeler(cls: 'system1' | 'system2') {
  return {
    id: cls === 'system1' ? 'planted-p' : 'planted',
    cls,
    family: 'planted',
    model: `${cls}-model`,
    settings: {},
    maxUnits: (_s: unknown, w: number) => w,
    render: () => ({ labeler: 'planted', body: {} }),
    opinions: () => ({ byUnit: new Map(), refusals: [] }),
  } as never;
}

export function seededStack(
  impl: PointerImpl,
  r: Rng,
  part:
    | 'cascade-sure'
    | 'cascade-unsure'
    | 'cascade-fallback'
    | 'targets'
    | 'margin'
    | 'margin-no-vector'
    | 'single',
): string[] {
  const misses: string[] = [];
  for (let i = 0; i < 24; i += 1) {
    const set = randomSet(r, true);
    const asked = new Set(set.labels.filter((l) => l.target !== 'required').map((l) => l.name));
    const names = [...asked, 'none'];
    const passAt = pick(r, [0.7, 0.8, 0.9]);
    const failAt = pick(r, [0.1, 0.2, 0.3]);
    const marginCut = pick(r, [0.3, 0.5, 0.65]);
    const rule: Rule = part.startsWith('margin')
      ? { rule: 'margin', marginCut }
      : { rule: 'cascade', passAt, failAt };
    let probabilities = vector(r, names);
    if (part === 'cascade-sure' || part === 'margin') {
      const top = pick(r, names);
      probabilities = Object.fromEntries(
        names.map((n) => [n, n === top ? 0.93 : 0.07 / Math.max(1, names.length - 1)]),
      );
    }
    if (part === 'margin-no-vector' && r() < 0.6)
      probabilities =
        r() < 0.5
          ? Object.fromEntries(names.map((n) => [n, 0.9]))
          : (({ none: _drop, ...rest }) => rest)(probabilities);
    const allLabels = [...set.labels.map((l) => l.name as string), 'none'];
    const first: Op | undefined =
      part === 'cascade-fallback' && r() < 0.3
        ? undefined
        : {
            label: Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'none',
            probabilities,
            source: `k${int(r, 10, 99)}`,
          };
    const secondLabel = part === 'targets' ? pick(r, allLabels) : pick(r, names);
    const second =
      part === 'cascade-fallback' && r() < 0.4
        ? undefined
        : {
            label: secondLabel,
            source: `m${int(r, 10, 99)}`,
            ...(secondLabel !== 'none' && !asked.has(secondLabel) ? { target: 1 } : {}),
          };
    const want = decideRef(first, second, asked, rule, set.labels.length);
    const a = plantedLabeler('system1');
    const b = plantedLabeler('system2');
    const labelling = guard('stackedLabelling', () =>
      rule.rule === 'margin'
        ? impl.stackedLabelling(a, b, { passAt: 0.9, failAt: 0.1, marginCut: rule.marginCut })
        : impl.stackedLabelling(a, b, { passAt: rule.passAt, failAt: rule.failAt }),
    );
    if (!labelling.ok) {
      misses.push(labelling.error);
      continue;
    }
    const got = guard('decide', () =>
      labelling.value.decide([first as never, second as never], set as never),
    );
    if (!got.ok) {
      misses.push(got.error);
      continue;
    }
    const d = got.value;
    const have = d
      ? { label: d.label, by: d.by, sources: d.sources, ...(d.fallback ? { fallback: true } : {}) }
      : undefined;
    if (show(have) !== show(want))
      misses.push(
        `decide (${show(rule)}) on ${show(first?.probabilities)} and system 2 ${show(second?.label)}: ${show(have)}, expected ${show(want)}`,
      );
  }
  return misses;
}

export function seededLabellingHash(impl: PointerImpl, r: Rng): string[] {
  const misses: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    const m = (cls: 'system1' | 'system2') => ({
      id: word(r),
      cls,
      model: word(r),
      settings: r() < 0.5 ? { threshold: pick(r, [0.3, 0.5]) } : {},
      runs: int(r, 1, 3),
    });
    const m1 = m('system1');
    const m2 = m('system2');
    const build = (x: Json, y: Json, rule: Rule) => {
      const lab = (mm: Json) =>
        ({
          id: mm.id,
          cls: mm.cls,
          family: 'planted',
          model: mm.model,
          settings: mm.settings,
          ...(mm.runs !== 1 ? { runs: mm.runs } : {}),
          maxUnits: (_s: unknown, w: number) => w,
          render: () => ({ labeler: 'planted', body: {} }),
          opinions: () => ({ byUnit: new Map(), refusals: [] }),
        }) as never;
      return rule.rule === 'margin'
        ? impl.stackedLabelling(lab(x), lab(y), { passAt: 0.9, failAt: 0.1, marginCut: rule.marginCut })
        : impl.stackedLabelling(lab(x), lab(y), { passAt: rule.passAt, failAt: rule.failAt });
    };
    const desc = (mm: Json) => ({
      id: mm.id,
      cls: mm.cls,
      model: mm.model,
      settings: mm.settings,
      runs: mm.runs,
      // docs/estate.md "Two classes of labeler": a member with several runs becomes one opinion by majority vote.
      ...(Number(mm.runs) > 1 ? { vote: 'majority' } : {}),
    });
    const rules: Rule[] = [
      { rule: 'cascade', passAt: pick(r, [0.8, 0.9]), failAt: pick(r, [0.1, 0.2]) },
      { rule: 'margin', marginCut: pick(r, [0.4, 0.65]) },
    ];
    const hashes: string[] = [];
    for (const rule of rules) {
      const want = hash16({
        members: [desc(m1), desc(m2)],
        ...(rule.rule === 'margin'
          ? { marginCut: rule.marginCut, rule: 'margin' }
          : { passAt: rule.passAt, failAt: rule.failAt, rule: 'cascade' }),
      });
      const got = guard('labelling hash', () => build(m1, m2, rule).hash);
      if (!got.ok) misses.push(got.error);
      else {
        hashes.push(got.value);
        if (got.value !== want)
          misses.push(`the hash of a ${rule.rule} labelling gave ${got.value}, expected ${want}`);
        for (const [what, other] of [
          ['model', build(m1, { ...m2, model: `${m2.model}x` }, rule)],
          ['id', build({ ...m1, id: `${m1.id}x` }, m2, rule)],
          ['runs', build(m1, { ...m2, runs: m2.runs + 1 }, rule)],
          ['member order', build(m2, m1, rule)],
        ] as const)
          if (other.hash === got.value)
            misses.push(`the hash of a ${rule.rule} labelling did not change with the ${what}`);
      }
    }
  }
  return misses;
}

// ----------------------------------------------------------------------------------------------- gold set
export function seededGold(impl: PointerImpl, r: Rng): string[] {
  const set = randomSet(r, false);
  const names = set.labels.map((l) => l.name as string);
  const all = [...names, 'none'];
  const passAt = 0.9;
  const failAt = 0.1;
  const units = Array.from({ length: 14 }, () => {
    const gold = pick(r, all);
    const sure = r() < 0.5;
    const probabilities = sure
      ? Object.fromEntries(all.map((n) => [n, n === gold ? 0.94 : 0.06 / (all.length - 1 || 1)]))
      : vector(r, all);
    return { gold, probabilities, second: r() < 0.7 ? gold : pick(r, all) };
  });
  const a = plantedLabeler('system1');
  const b = plantedLabeler('system2');
  const labelling = guard('stackedLabelling', () => impl.stackedLabelling(a, b, { passAt, failAt }));
  if (!labelling.ok) return [labelling.error];
  const asked = new Set(names);
  const misses: string[] = [];
  const have: string[] = [];
  const want: string[] = [];
  units.forEach((u, i) => {
    const first = {
      label: Object.entries(u.probabilities).sort((x, y) => y[1] - x[1])[0]?.[0] ?? 'none',
      probabilities: u.probabilities,
    };
    const ref = decideRef(first, { label: u.second }, asked, { rule: 'cascade', passAt, failAt }, set.labels.length);
    want.push(ref?.label ?? 'abstain');
    const got = guard('decide', () =>
      labelling.value.decide([first as never, { label: u.second } as never], set as never),
    );
    if (!got.ok) misses.push(got.error);
    have.push(got.ok ? (got.value?.label ?? 'abstain') : 'error');
    void i;
  });
  if (show(have) !== show(want)) misses.push(`the stack labelled ${show(have)}, expected ${show(want)}`);
  const kappa = (labels: string[]) => {
    const n = units.length;
    let agree = 0;
    const g = new Map<string, number>();
    const p = new Map<string, number>();
    units.forEach((u, i) => {
      if (labels[i] === u.gold) agree += 1;
      g.set(u.gold, (g.get(u.gold) ?? 0) + 1);
      p.set(labels[i] as string, (p.get(labels[i] as string) ?? 0) + 1);
    });
    let pe = 0;
    for (const [k, c] of g) pe += (c * (p.get(k) ?? 0)) / (n * n);
    return pe === 1 ? 1 : (agree / n - pe) / (1 - pe);
  };
  if (Math.abs(kappa(have) - kappa(want)) > 1e-9)
    misses.push(`kappa against the gold labels ${kappa(have)}, expected ${kappa(want)}`);
  return misses;
}

// ------------------------------------------------------------------------------------------ a lone labeller
export function seededSingle(impl: PointerImpl, r: Rng): string[] {
  const misses: string[] = [];
  for (let i = 0; i < 12; i += 1) {
    const cls = pick(r, ['system1', 'system2'] as const);
    const opinion =
      r() < 0.2
        ? undefined
        : { label: pick(r, [word(r), 'none']), ...(r() < 0.4 ? { target: int(r, 0, 40) } : {}) };
    const labelling = guard('singleLabelling', () => impl.singleLabelling(plantedLabeler(cls)));
    if (!labelling.ok) {
      misses.push(labelling.error);
      continue;
    }
    const got = guard('decide', () => labelling.value.decide([opinion as never], randomSet(r) as never));
    if (!got.ok) {
      misses.push(got.error);
      continue;
    }
    const want = opinion
      ? { label: opinion.label, by: cls, ...(opinion.target !== undefined ? { target: opinion.target } : {}) }
      : undefined;
    const have = got.value
      ? {
          label: got.value.label,
          by: got.value.by,
          ...(got.value.target !== undefined ? { target: got.value.target } : {}),
        }
      : undefined;
    if (show(have) !== show(want))
      misses.push(
        `a lone ${cls} labeller decided ${show(have)} for ${show(opinion)}, expected ${show(want)}`,
      );
  }
  return misses;
}
