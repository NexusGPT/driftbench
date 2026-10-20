import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { runItem } from '../../src/ladders/stats/bank/index';
import { newcapGroups, newcapItems } from '../../src/ladders/stats/bank/newcaps';
import type { StatsImpl } from '../../src/ladders/stats/reference';
import { ROOT, real } from './support';

// The new capabilities do not exist in the product, so their items are measured on a stand-in that answers
// every fixture case exactly: the documented value for a value case, a RangeError for a domain case. The
// stand-in holds no method, only the answers the fixtures already hold, so it puts no solution in the
// repository. NEWCAPS_REFERENCE=<path of a statistics index.ts> measures a real implementation instead.
// NEWCAPS_GROUP=bayes,design restricts the run to those groups.
const only = process.env.NEWCAPS_GROUP?.split(',');
const reference = process.env.NEWCAPS_REFERENCE;

type Fn = (...args: unknown[]) => unknown;
const NONFINITE: Record<string, number> = {
  NaN: Number.NaN,
  Infinity: Number.POSITIVE_INFINITY,
  '-Infinity': Number.NEGATIVE_INFINITY,
};
const revive = (v: unknown): unknown =>
  typeof v === 'string' && v in NONFINITE
    ? NONFINITE[v]
    : Array.isArray(v)
      ? v.map(revive)
      : v !== null && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, revive(x)]))
        : v;
/** A key for an argument list, with NaN and the infinities kept apart. */
const key = (args: unknown[]): string =>
  JSON.stringify(args, (_, v) => (typeof v === 'number' && !Number.isFinite(v) ? `#${v}` : v));

const entries = newcapGroups(ROOT)
  .filter((g) => only === undefined || only.includes(g.group))
  .flatMap((g) => g.functions);

function replay(entry: (typeof entries)[number]): Fn {
  const answers = new Map(entry.values.map((c) => [key(revive(c.args) as unknown[]), revive(c.expected)]));
  const refused = new Set(entry.domain.map((c) => key(revive(c.args) as unknown[])));
  return (...args: unknown[]) => {
    const k = key(args);
    if (refused.has(k)) throw new RangeError(`${entry.fn}: refused input`);
    if (!answers.has(k)) throw new Error(`${entry.fn}: no fixture case for ${k}`);
    return structuredClone(answers.get(k));
  };
}

/** The other values a function returns that are not numbers (a decision label), to swap one for another. */
function swapOf(entry: (typeof entries)[number]): (value: unknown) => unknown {
  const labels = [...new Set(entry.values.map((c) => c.expected).filter((v) => typeof v === 'string'))];
  return (value) => labels[(labels.indexOf(value as string) + 1) % labels.length];
}

/** A literal relative error of 0.2 percent on every number; a returned label becomes another label. */
function nudge(value: unknown, swap: (value: unknown) => unknown, changed: () => void): unknown {
  if (typeof value === 'number') {
    const result = value * 1.002;
    if (!Object.is(result, value)) changed();
    return result;
  }
  if (typeof value === 'string') {
    const result = swap(value);
    if (result !== undefined && result !== value) {
      changed();
      return result;
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((entry) => nudge(entry, swap, changed));
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, entry]) => [k, nudge(entry, swap, changed)]));
  return value;
}

let impl: Record<string, Fn> = {};
beforeAll(async () => {
  const loaded = reference
    ? ((await import(pathToFileURL(reference).href)) as Record<string, unknown>)
    : Object.fromEntries(entries.map((entry) => [entry.fn, replay(entry)]));
  impl = Object.fromEntries(
    entries.flatMap((entry) =>
      typeof loaded[entry.fn] === 'function' ? [[entry.fn, loaded[entry.fn] as Fn] as const] : [],
    ),
  );
});

describe('every new capability has items that reject a 0.2 percent nudge and a throw', () => {
  it.each(entries.map((entry) => [entry.fn, entry] as const))('%s', async (name, entry) => {
    const original = impl[name];
    expect(original, `${name} is not implemented by the reference`).toBeDefined();
    const items = newcapItems(ROOT).filter((item) => item.id.startsWith(`newcap.${name}.`));
    expect(items.map((item) => item.id).sort()).toEqual([`newcap.${name}.domain`, `newcap.${name}.values`]);
    const values = items.find((item) => item.id.endsWith('.values'));
    const domain = items.find((item) => item.id.endsWith('.domain'));
    const run = async (item: typeof values, f: Fn) =>
      (await runItem(item as NonNullable<typeof values>, 1, ROOT, { ...real, [name]: f } as StatsImpl)).pass;

    expect(await run(values, original as Fn), `${name}: the values item passes the reference`).toBe(true);
    expect(await run(domain, original as Fn), `${name}: the domain item passes the reference`).toBe(true);

    let changed = false;
    const swap = swapOf(entry);
    const nudged: Fn = (...args) =>
      nudge((original as Fn)(...args), swap, () => {
        changed = true;
      });
    expect(await run(values, nudged), `${name}: the values item accepts a changed 0.2% output`).toBe(false);
    expect(changed, `${name}: the nudge changed no output`).toBe(true);

    const thrower: Fn = () => {
      throw new Error('planted throw');
    };
    expect(await run(values, thrower), `${name}: the values item accepts a throw`).toBe(false);
    expect(await run(domain, thrower), `${name}: the domain item accepts a throw`).toBe(false);
    const refuser: Fn = () => {
      throw new RangeError('planted refusal');
    };
    expect(
      await run(domain, refuser),
      `${name}: the domain item accepts a function refusing everything`,
    ).toBe(false);
  });
});
