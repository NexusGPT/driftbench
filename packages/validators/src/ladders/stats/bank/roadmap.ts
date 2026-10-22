import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { exactCoverage, grid } from './analytic';
import { attempt, type BankItem, exported, fail, ok, show, type Tier } from './item';
import { cpuMs } from './scale';

/**
 * Level `roadmap`: methods the research dossiers and the parity notes name that the statistics package does not
 * have yet (docs/validators.md section 12.2: the bank is the roadmap). Each case calls the method by the name and
 * signature given, on arguments from `packages/validators/fixtures/stats/roadmap.json`, and compares the result with
 * the value scipy and numpy give (written by make_roadmap.py next to it). A method that is not exported fails every
 * case with its signature and definition, so the executor can write it from the message alone.
 */
export const ROADMAP_FIXTURES = 'packages/validators/fixtures/stats/roadmap.json';

type Method = {
  family: string;
  name: string;
  file: string;
  signature: string;
  definition: string;
  source: string;
  tol: number;
  tier: Tier;
  cases: Array<{ args: unknown[]; expect: unknown }>;
};

/** Whether the result matches the expected value: numbers within tol (relative above 1), the rest exactly. */
export function matches(got: unknown, want: unknown, tol: number, path = 'result'): string | undefined {
  if (want === 'Infinity')
    return got === Number.POSITIVE_INFINITY ? undefined : `${path}: got ${show(got)}, expected Infinity`;
  if (typeof want === 'number') {
    if (typeof got !== 'number') return `${path}: got ${show(got)}, expected the number ${want}`;
    const scale = Math.max(1, Math.abs(want));
    return Math.abs(got - want) <= tol * scale
      ? undefined
      : `${path}: got ${got}, expected ${want} (tolerance ${tol})`;
  }
  if (Array.isArray(want)) {
    if (!Array.isArray(got) || got.length !== want.length)
      return `${path}: got ${show(got)}, expected ${show(want)}`;
    for (let i = 0; i < want.length; i += 1) {
      const miss = matches(got[i], want[i], tol, `${path}[${i}]`);
      if (miss) return miss;
    }
    return undefined;
  }
  if (want && typeof want === 'object') {
    if (!got || typeof got !== 'object') return `${path}: got ${show(got)}, expected an object ${show(want)}`;
    for (const [key, value] of Object.entries(want)) {
      const miss = matches((got as Record<string, unknown>)[key], value, tol, `${path}.${key}`);
      if (miss) return miss;
    }
    return undefined;
  }
  return got === want ? undefined : `${path}: got ${show(got)}, expected ${show(want)}`;
}

/**
 * Methods without a product need (validators/stats/NEEDS.md, from packages/validators/fixtures/stats/needs.json)
 * are quarantined: their items are not in the bank and do not count toward hardness until a docs page, a
 * design section or a command needs them.
 */
export const NEEDS_FIXTURES = 'packages/validators/fixtures/stats/needs.json';

let cached: { path: string; methods: Method[]; quarantined: Method[] } | undefined;
function load(root: string): { methods: Method[]; quarantined: Method[] } {
  const path = join(root, ROADMAP_FIXTURES);
  if (cached?.path !== path) {
    const all = (JSON.parse(readFileSync(path, 'utf8')) as { methods: Method[] }).methods;
    const needs = JSON.parse(readFileSync(join(root, NEEDS_FIXTURES), 'utf8')) as {
      quarantine: Record<string, string>;
    };
    cached = {
      path,
      methods: all.filter((m) => !(m.name in needs.quarantine)),
      quarantined: all.filter((m) => m.name in needs.quarantine),
    };
  }
  return cached;
}
function methods(root: string): Method[] {
  return load(root).methods;
}

/** The quarantined methods' names: defined with their cases, kept out of the bank. */
export function quarantinedMethods(root: string): string[] {
  return load(root).quarantined.map((m) => m.name);
}

const argText = (args: unknown[]): string => args.map((a) => show(a)).join(', ');

/**
 * Whether a method gives the scipy value on at least one of its cases. The degenerate, purity, scale and
 * coverage items of a method count only when it does: a stub that throws, returns NaN or a canned object must
 * not pass them (audit finding: stubs for every roadmap name raised the bank score from 0.324 to 0.652).
 * Remembered per function, so a run checks each method once.
 */
const verdicts = new WeakMap<object, boolean>();
export function correctOnACase(m: Method, fn: (...args: never[]) => unknown): boolean {
  const known = verdicts.get(fn);
  if (known !== undefined) return known;
  const correct = m.cases.some((c) => {
    const got = attempt(() => (fn as (...args: unknown[]) => unknown)(...structuredClone(c.args)));
    return !got.error && matches(got.value, c.expect, m.tol) === undefined;
  });
  verdicts.set(fn, correct);
  return correct;
}

/** The message of a generated item whose method exists but gives no correct value yet. */
const notCorrect = (m: Method) =>
  fail(
    `the method is not correct yet: ${m.name} exists but gives the scipy value on none of its cases (roadmap.${m.name}.*), so its generated items do not count. Make the cases of roadmap.${m.name} pass first. Definition: ${m.definition}.`,
  );

/** The roadmap items: one per case of each method in the fixtures file, read from the repository root. */
export function roadmapItems(root: string): BankItem[] {
  const items: BankItem[] = [];
  for (const m of methods(root)) {
    m.cases.forEach((c, i) => {
      items.push({
        id: `roadmap.${m.name}.${i + 1}`,
        family: m.family,
        tier: m.tier,
        level: 'roadmap',
        component: m.file,
        check: ({ s }) => {
          const call = `${m.name}(${argText(c.args)})`;
          const fn = exported(s, m.name);
          if (!fn) {
            return fail(
              `packages/stats does not export ${m.name}. Add \`${m.signature}\` to ${m.file} and export it from packages/stats/src/index.ts. Definition: ${m.definition}. Source: ${m.source}. This case: ${call} must give ${show(c.expect)} (tolerance ${m.tol}).`,
            );
          }
          const got = attempt(() => (fn as (...args: unknown[]) => unknown)(...structuredClone(c.args)));
          if (got.error) {
            return fail(
              `${call} threw ${got.error.name}: ${got.error.message}; expected ${show(c.expect)}. Definition: ${m.definition}.`,
            );
          }
          const miss = matches(got.value, c.expect, m.tol);
          return miss
            ? fail(`${call} differs from the ${m.source} value. ${miss}. Definition: ${m.definition}.`)
            : ok();
        },
      });
    });
  }
  items.push(
    ...roadmapDegenerateItems(methods(root)),
    ...roadmapScaleItems(methods(root)),
    ...roadmapCoverageItems(methods(root)),
    ...roadmapPurityItems(methods(root)),
  );
  return items;
}

/** The arguments with every array emptied (top level and object fields); undefined when there is none. */
function emptied(args: unknown[]): unknown[] | undefined {
  let found = false;
  const out = args.map((a) => {
    if (Array.isArray(a)) {
      found = true;
      return [];
    }
    if (a && typeof a === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(a)) {
        if (Array.isArray(v)) {
          found = true;
          o[k] = [];
        } else o[k] = v;
      }
      return o;
    }
    return a;
  });
  return found ? out : undefined;
}

/** The arguments with the first number met (depth first) replaced by `bad`; undefined when there is none. */
function planted(args: unknown[], bad: number): unknown[] | undefined {
  let done = false;
  const walk = (v: unknown): unknown => {
    if (done) return v;
    if (typeof v === 'number') {
      done = true;
      return bad;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object')
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  const out = args.map(walk);
  return done ? out : undefined;
}

/**
 * Family `roadmap-degenerate`: the degenerate-input contract (rule 1 of the degenerate level) applied to every
 * roadmap method: no data, a NaN and an infinite value in the first number of its first case must throw a
 * RangeError, never return a number built from them.
 */
function roadmapDegenerateItems(all: Method[]): BankItem[] {
  const out: BankItem[] = [];
  for (const m of all) {
    const first = m.cases[0];
    if (!first) continue;
    const variants: Array<[string, unknown[] | undefined]> = [
      ['empty', emptied(first.args)],
      ['nan', planted(first.args, Number.NaN)],
      ['infinity', planted(first.args, Number.POSITIVE_INFINITY)],
    ];
    for (const [kind, args] of variants) {
      if (!args) continue;
      out.push({
        id: `roadmap-degenerate.${m.name}.${kind}`,
        family: 'roadmap-degenerate',
        tier: 2,
        level: 'roadmap',
        component: m.file,
        check: ({ s }) => {
          const call = `${m.name}(${argText(args)})`;
          const fn = exported(s, m.name);
          if (!fn) {
            return fail(
              `packages/stats does not export ${m.name} (signature \`${m.signature}\`, in ${m.file}); once it exists, ${call} must throw a RangeError (degenerate-input contract, rule 1: ${kind === 'empty' ? 'no data' : kind === 'nan' ? 'a NaN' : 'an infinite value'}).`,
            );
          }
          if (!correctOnACase(m, fn)) return notCorrect(m);
          const got = attempt(() => (fn as (...a: unknown[]) => unknown)(...structuredClone(args)));
          if (got.error instanceof RangeError) return ok();
          return fail(
            `${call} must throw a RangeError (degenerate-input contract, rule 1); ${got.error ? `it threw ${got.error.name}: ${got.error.message}` : `it returned ${show(got.value)}`}. Add the check to ${m.name} in ${m.file}.`,
          );
        },
      });
    }
  }
  return out;
}

/** The arguments with every flat array (of numbers, strings or booleans) grown to `size` by repetition. */
function grown(args: unknown[], size: number): unknown[] | undefined {
  let found = false;
  const flat = (v: unknown): v is unknown[] =>
    Array.isArray(v) && v.length > 0 && v.every((x) => typeof x !== 'object' || x === null);
  const grow = (v: unknown[]) => Array.from({ length: size }, (_, i) => v[i % v.length]);
  const out = args.map((a) => {
    if (flat(a)) {
      found = true;
      return grow(a);
    }
    if (a && typeof a === 'object' && !Array.isArray(a)) {
      return Object.fromEntries(
        Object.entries(a).map(([k, v]) => {
          if (flat(v)) {
            found = true;
            return [k, grow(v)];
          }
          return [k, v];
        }),
      );
    }
    return a;
  });
  return found ? out : undefined;
}

const finite = (v: unknown): boolean =>
  typeof v === 'number'
    ? Number.isFinite(v)
    : Array.isArray(v)
      ? v.every(finite)
      : v && typeof v === 'object'
        ? Object.values(v).every(finite)
        : true;

/** Rows a scaled roadmap case reaches, and the time it may take. */
export const ROADMAP_SCALE_ROWS = 100_000;
export const ROADMAP_SCALE_BUDGET_MS = 2_000;

/**
 * Family `roadmap-scale`: each roadmap method whose first case takes flat arrays, with those arrays grown to
 * 100000 values by repetition, finishes within 2 s and returns finite numbers (section 12.2, rule 4).
 */
function roadmapScaleItems(all: Method[]): BankItem[] {
  const out: BankItem[] = [];
  for (const m of all) {
    const first = m.cases[0];
    const args = first ? grown(first.args, ROADMAP_SCALE_ROWS) : undefined;
    if (!args) continue;
    out.push({
      id: `roadmap-scale.${m.name}`,
      family: 'roadmap-scale',
      tier: 4,
      level: 'roadmap',
      component: m.file,
      budgetMs: 300_000,
      check: ({ s }) => {
        const fn = exported(s, m.name);
        if (!fn) {
          return fail(
            `packages/stats does not export ${m.name} (\`${m.signature}\`, in ${m.file}); once it exists, its first case with every array grown to ${ROADMAP_SCALE_ROWS} values by repetition must finish within ${ROADMAP_SCALE_BUDGET_MS} ms with finite numbers.`,
          );
        }
        if (!correctOnACase(m, fn)) return notCorrect(m);
        const { got, ms } = cpuMs(() => (fn as (...a: unknown[]) => unknown)(...args));
        if (got.error)
          return fail(
            `${m.name} on its first case grown to ${ROADMAP_SCALE_ROWS} values threw ${got.error.name}: ${got.error.message}`,
          );
        if (!finite(got.value))
          return fail(
            `${m.name} on its first case grown to ${ROADMAP_SCALE_ROWS} values returned non-finite numbers: ${show(got.value)}`,
          );
        return ms <= ROADMAP_SCALE_BUDGET_MS
          ? ok()
          : fail(
              `${m.name} on its first case grown to ${ROADMAP_SCALE_ROWS} values took ${Math.round(ms)} ms of processor time, over ${ROADMAP_SCALE_BUDGET_MS} ms: avoid all-pairs loops and per-row copies.`,
            );
      },
    });
  }
  return out;
}

/** The rate intervals of the roadmap whose exact coverage is scored, and the sizes. */
const COVERED = ['agrestiCoull', 'jeffreys', 'wilsonContinuity', 'betaPosteriorInterval'];
const SIZES = [5, 10, 20, 50, 100, 200, 500];

/**
 * Family `roadmap-coverage`: each roadmap rate interval, at n from 5 to 500, has an exact coverage averaged over
 * p from 0.01 to 0.99 of at least 0.945 (each method averages 0.9489 or more there by scipy, section 12.2 rule 3).
 */
function roadmapCoverageItems(all: Method[]): BankItem[] {
  const out: BankItem[] = [];
  for (const name of COVERED) {
    const m = all.find((x) => x.name === name);
    if (!m) continue;
    for (const n of SIZES) {
      out.push({
        id: `roadmap-coverage.${name}.n${n}`,
        family: 'roadmap-coverage',
        tier: 4,
        level: 'roadmap',
        component: m.file,
        check: ({ s }) => {
          const fn = exported(s, name);
          if (!fn)
            return fail(
              `packages/stats does not export ${name} (\`${m.signature}\`, in ${m.file}); once it exists, its exact coverage at n ${n} averaged over p from 0.01 to 0.99 must reach 0.945. Definition: ${m.definition}.`,
            );
          if (!correctOnACase(m, fn)) return notCorrect(m);
          const got = attempt(() =>
            Array.from({ length: n + 1 }, (_, k) =>
              (fn as (k: number, n: number) => { lower: number; upper: number })(k, n),
            ),
          );
          if (got.error) return fail(`${name}(k, ${n}) threw ${got.error.name}: ${got.error.message}`);
          const ivs = got.value as Array<{ lower: number; upper: number }>;
          const mean = grid(0.01, 0.99, 197).reduce((a, p) => a + exactCoverage(ivs, n, p), 0) / 197;
          return mean >= 0.945
            ? ok()
            : fail(
                `${name}(k, ${n}) has exact coverage ${mean} averaged over p from 0.01 to 0.99; the method averages 0.9489 or more at every n from 5 to 500, bar 0.945. Definition: ${m.definition}.`,
              );
        },
      });
    }
  }
  return out;
}

/**
 * Family `roadmap-purity`: each roadmap method leaves its arguments as it found them (no in-place sort or
 * normalisation of the caller's arrays) and gives the same result twice on the same input.
 */
function roadmapPurityItems(all: Method[]): BankItem[] {
  const out: BankItem[] = [];
  for (const m of all) {
    const first = m.cases[0];
    if (!first) continue;
    out.push({
      id: `roadmap-purity.${m.name}`,
      family: 'roadmap-purity',
      purity: true,
      tier: 2,
      level: 'roadmap',
      component: m.file,
      check: ({ s }) => {
        const fn = exported(s, m.name);
        if (!fn)
          return fail(
            `packages/stats does not export ${m.name} (\`${m.signature}\`, in ${m.file}); once it exists, it must not change its arguments and must give the same result twice.`,
          );
        if (!correctOnACase(m, fn)) return notCorrect(m);
        const args = structuredClone(first.args);
        const before = JSON.stringify(args);
        const a = attempt(() => (fn as (...x: unknown[]) => unknown)(...args));
        const b = attempt(() => (fn as (...x: unknown[]) => unknown)(...args));
        if (a.error || b.error)
          return fail(`${m.name}(${argText(first.args)}) threw ${(a.error ?? b.error)?.message}`);
        if (JSON.stringify(args) !== before)
          return fail(
            `${m.name} changed its arguments from ${before} to ${JSON.stringify(args)}; work on a copy.`,
          );
        return JSON.stringify(a.value) === JSON.stringify(b.value)
          ? ok()
          : fail(`${m.name} gave ${show(a.value)} then ${show(b.value)} on the same input.`);
      },
    });
  }
  return out;
}
