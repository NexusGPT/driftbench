import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { attempt, type BankItem, exported, fail, ok, show, type Tier } from './item';

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

let cached: { path: string; methods: Method[] } | undefined;
function methods(root: string): Method[] {
  const path = join(root, ROADMAP_FIXTURES);
  if (cached?.path !== path) {
    cached = { path, methods: (JSON.parse(readFileSync(path, 'utf8')) as { methods: Method[] }).methods };
  }
  return cached.methods;
}

const argText = (args: unknown[]): string => args.map((a) => show(a)).join(', ');

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
  return items;
}
