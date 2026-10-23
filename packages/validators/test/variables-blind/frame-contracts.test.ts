import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { variablesBank } from '../../src/ladders/variables/bank/index';
import { runIsolated } from '../../src/ladders/variables/bank/isolate';
import { IMPL_SOURCES_ENV } from '../../src/ladders/variables/bank/run-child';
import { IMPL_ENV } from '../../src/ladders/variables/impl';
import { findRoot } from '../../src/root';

/**
 * The contracts the items set in the bank's own process, kept when the implementation runs apart (docs/validators.md
 * section 12.9; review of PR 1403, codex run 39870167091, whose products these are). Each product is the honest
 * adapter with one fault: it reads Math.random, crypto or the clock while the item has made them unusable; it writes
 * an input the item froze, putting the same value back; it returns the same cached store on every build; it answers
 * right only when a validator's own variable is set. Each must fail the items that reject it in the bank's own
 * process, and the honest adapter must pass them.
 */

vi.setConfig({ testTimeout: 1_200_000, hookTimeout: 1_200_000 });

const ROOT = findRoot(process.cwd());
const ADAPTER = join(ROOT, 'packages/validators/src/ladders/variables/adapter.ts');
const bank = variablesBank();
const ofStem = (...stems: string[]) =>
  bank.filter((item) => stems.includes(item.stem)).map((item) => item.id);
const AMBIENT = 'determinism.no-ambient-randomness';
// Each ambient fault fails the variants that make its source unusable, and the variant that makes all three so.
const MODES: Record<string, string[]> = {
  math: [`${AMBIENT}.math-random-throws`, `${AMBIENT}.all-three`],
  crypto: [`${AMBIENT}.crypto-throws`, `${AMBIENT}.all-three`],
  clock: [`${AMBIENT}.clock-frozen-differently`],
  'frozen-plan': [
    ...ofStem('determinism.inputs-not-written'),
    ...bank.filter((item) => item.id.endsWith('.frozen-inputs-are-accepted')).map((item) => item.id),
  ],
  'frozen-build': ofStem('values.input-not-mutated'),
  'aliased-build': ofStem('values.fresh-objects'),
  // Codex, run 39875360028: the cache only where no permission model runs (run C), and a cached array behind a getter.
  'aliased-unconfined': ofStem('values.fresh-objects'),
  'aliased-getter': ofStem('values.fresh-objects'),
  'framed-env': ['blind.weights.interval.five-of-ten', 'blind.weights.interval.three-of-seven'],
  // Codex's sweep (run 39875900785): object identity the caller sees in its own process. Plan rows that are the
  // caller's seed objects; one cached plan; a typed array, and an array held by a Map's own property, shared by every
  // store.
  'seed-row-alias': ofStem('seeds.pure-copy'),
  'plan-cache': bank.filter((item) => item.id.endsWith('.two-plans-share-no-object')).map((item) => item.id),
  'view-alias': ['values.fresh-objects.two-builds-independent'],
  'map-own-alias': ['values.fresh-objects.two-builds-independent'],
  // A plan cached by the identity of its store or options object: the same object, edited in place, must be read
  // again (the store edited in place and planned again; codex's class 3).
  'identity-cache': [
    'determinism.json-round-trip.store',
    'determinism.json-round-trip.options',
    ...bank
      .filter((item) => item.id.endsWith('.a-reused-store-edited-in-place-is-read-again'))
      .map((item) => item.id),
  ],
  // sonnet-review-c-2: a global name added during a call; the same name added at load is the product's own setting.
  'call-global': ['blind.weights.interval.five-of-ten', 'blind.weights.interval.three-of-seven'],
};
// Products that must pass every item of the list, as the honest adapter does.
const PASSING: Record<string, string[]> = {
  'load-global': ['blind.weights.interval.five-of-ten', 'blind.weights.interval.three-of-seven'],
};

mkdirSync(join(ROOT, 'node_modules', '.cache'), { recursive: true });
const folder = mkdtempSync(join(ROOT, 'node_modules', '.cache', 'variables-contracts-'));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

/** The adapter with the fault of `mode` ('control': none), as a module of its own. */
function product(mode: string): string {
  const path = join(folder, `${mode}.mts`);
  writeFileSync(
    path,
    `import { variablesImpl as base } from ${JSON.stringify(ADAPTER)};
const mode = ${JSON.stringify(mode)};
const cache = new Map();
const byStore = new WeakMap();
const byOptions = new WeakMap();
const sharedView = new Uint8Array([17]);
const sharedOwn = [17];
if (mode === 'load-global') globalThis.zzLoadName = 1;
export const variablesImpl = {
  ...base,
  plan(store, options) {
    if (mode === 'math') Math.random();
    if (mode === 'crypto') globalThis.crypto.randomUUID();
    if (mode === 'clock' && Date.now() < 1100000000000) throw new Error('planning depends on the current date');
    if (mode === 'frozen-plan') {
      store.variables = store.variables;
      options.seed = options.seed;
      if (options.seeds?.length) options.seeds[0] = options.seeds[0];
    }
    if (mode === 'plan-cache') {
      const key = JSON.stringify([store, options]);
      if (!cache.has(key)) cache.set(key, base.plan(store, options));
      return cache.get(key);
    }
    if (mode === 'identity-cache') {
      const hit = byStore.get(store) ?? byOptions.get(options);
      if (hit) return hit;
      const made = base.plan(store, options);
      byStore.set(store, made);
      byOptions.set(options, made);
      return made;
    }
    const made = base.plan(store, options);
    if (mode === 'seed-row-alias')
      for (let i = 0; i < (options.seeds?.length ?? 0); i += 1) made.rows[i].values = options.seeds[i];
    return made;
  },
  buildStore(sources) {
    if (mode === 'frozen-build') sources.estate = sources.estate;
    if (mode === 'view-alias') return { ...base.buildStore(sources), extra: sharedView };
    if (mode === 'map-own-alias') {
      const extra = new Map();
      extra.shared = sharedOwn;
      return { ...base.buildStore(sources), extra };
    }
    const key = JSON.stringify(sources);
    if (mode === 'aliased-getter') {
      const store = base.buildStore(sources);
      if (!cache.has(key)) cache.set(key, store.variables);
      const variables = cache.get(key);
      return Object.defineProperty({ ...store }, 'variables', { get: () => variables, enumerable: true });
    }
    const memo = mode === 'aliased-build' || (mode === 'aliased-unconfined' && !process.permission);
    if (!memo) return base.buildStore(sources);
    if (!cache.has(key)) cache.set(key, base.buildStore(sources));
    return cache.get(key);
  },
  weightInterval(count, total) {
    if (mode === 'framed-env' && process.env.DRIFTBENCH_VARIABLES_FRAMED !== '1') return [0, 1];
    if (mode === 'call-global') globalThis.zzCallName = 1;
    return base.weightInterval(count, total);
  },
};
`,
  );
  return path;
}

/** The outcome of each named item on seed 1, through the runner, with the product of `mode`. */
async function outcomes(mode: string, ids: readonly string[]) {
  const items = bank.filter((item) => ids.includes(item.id));
  expect(items.map((item) => item.id).sort()).toEqual([...ids].sort());
  const before = { ...process.env };
  process.env[IMPL_ENV] = product(mode);
  process.env[IMPL_SOURCES_ENV] = join(ROOT, 'packages/validators/src/ladders/variables');
  try {
    const run = await runIsolated(items, 1, ROOT, undefined, 1);
    return ids.map((id) => ({ id, pass: run.get(id)?.pass === true, detail: run.get(id)?.detail ?? '' }));
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key];
    Object.assign(process.env, before);
  }
}

describe('the contracts of the items, with the implementation under the frame', () => {
  it('the honest adapter passes every item below', async () => {
    const all = [...new Set(Object.values(MODES).flat())];
    const got = await outcomes('control', all);
    expect(got.filter((each) => !each.pass)).toEqual([]);
  });

  it.each(Object.keys(PASSING))(
    'the %s product passes every item, as the honest adapter does',
    async (mode) => {
      const got = await outcomes(mode, PASSING[mode] as string[]);
      expect(got.filter((each) => !each.pass)).toEqual([]);
    },
  );

  it.each(Object.keys(MODES))('the %s product fails every item that rejects it', async (mode) => {
    const ids = MODES[mode] as string[];
    expect(ids.length).toBeGreaterThan(0);
    const got = await outcomes(mode, ids);
    expect(got.filter((each) => each.pass)).toEqual([]);
    // It fails on its fault, never on a child that could not run it.
    for (const each of got)
      expect(each.detail, each.id).not.toMatch(/child process (died|ended)|does not load/);
  });
});
