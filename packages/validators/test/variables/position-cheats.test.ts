import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FORMAT_CASES } from '../../src/ladders/variables/bank/families/format';
import { VERIFY_CASES } from '../../src/ladders/variables/bank/families/verify';
import { classOf, type FileCase, schedule } from '../../src/ladders/variables/bank/files';
import { contextFor, runItem, variablesBank } from '../../src/ladders/variables/bank/index';
import { STEMS } from '../../src/ladders/variables/bank/manifest/index';
import type { VariablesImpl } from '../../src/ladders/variables/interface';
import { cheat } from './file-cheats';

/**
 * The cheater seat of the r4 audit (validators/variables/audit.md, cheats 3 and 4) found two ways to read an answer off
 * a file-format request without reading the store:
 *
 *  - the number an agent name ended with was the position of the request in the item's list of cases, so answers
 *    recorded on two seeds were replayed on a third by that number;
 *  - the failure message of an item named the position of the first wrong call and the direction of the wanted answer,
 *    so a search could try one answer per call and keep what the message accepted.
 *
 * These tests play both cheats against every file-format item. They fail until the suffix of the agent name is drawn
 * from a permutation of the seed, and until an item runs every call and fails once, with no position and no direction.
 */

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const BUILDERS = { ...FORMAT_CASES, ...VERIFY_CASES };
const bank = variablesBank();
const items = STEMS.filter((s) => s.id in BUILDERS).flatMap((s) =>
  s.variants.map(([key]) => `${s.id}.${key}`),
);

function setup(id: string, seed: number) {
  const item = bank.find((i) => i.id === id);
  if (!item) throw new Error(`no item ${id}`);
  const ctx = contextFor(item, seed, ROOT, {});
  const cases = (BUILDERS as Record<string, (variant: string, c: typeof ctx) => FileCase[]>)[item.stem]?.(
    id.slice(item.stem.length + 1),
    ctx,
  ) as FileCase[];
  return { item, cases, sequence: schedule(cases, seed, id) };
}

/** The number the agent name of a request ends with, with the call it asks: what the cheater recorded answers by. */
function suffixKey(c: FileCase): string | undefined {
  const agent = (c.store as { agent?: unknown } | null)?.agent;
  const match = typeof agent === 'string' ? /_(\d+)$/.exec(agent) : null;
  return match ? `${c.op}|${match[1]}` : undefined;
}

/** The class that most often went with a key in the cases of the seeds it learned from. */
function learn(id: string, seeds: readonly number[]): Map<string, string> {
  const tally = new Map<string, Map<string, number>>();
  for (const seed of seeds) {
    for (const c of setup(id, seed).cases) {
      const key = suffixKey(c);
      if (key === undefined) continue;
      const classes = tally.get(key) ?? new Map<string, number>();
      classes.set(classOf(c), (classes.get(classOf(c)) ?? 0) + 1);
      tally.set(key, classes);
    }
  }
  return new Map([...tally].map(([key, classes]) => [key, [...classes].sort((a, b) => b[1] - a[1])[0]?.[0] as string]));
}

describe('a replay keyed on the number an agent name ends with (cheat 3)', () => {
  it('fails every file-format item on seeds it did not learn from', async () => {
    for (const id of items) {
      const table = learn(id, [1, 2]);
      for (const seed of [3, 7, 20, 820020691]) {
        const { item, sequence } = setup(id, seed);
        const fallback = classOf(sequence[0] as FileCase);
        const impl = cheat(sequence, (_index, c) => table.get(suffixKey(c) ?? '') ?? fallback);
        expect((await runItem(item, seed, ROOT, impl)).pass, `${id} on seed ${seed}`).toBe(false);
      }
    }
  }, 300_000);

  it('passes an item when the table is learned on the same seed, so a failure above is the names changing', async () => {
    for (const id of items) {
      const table = learn(id, [1]);
      const { item, sequence } = setup(id, 1);
      const fallback = classOf(sequence[0] as FileCase);
      const impl = cheat(sequence, (_index, c) => table.get(suffixKey(c) ?? '') ?? fallback);
      expect((await runItem(item, 1, ROOT, impl)).pass, id).toBe(true);
    }
  }, 120_000);

  it('gives every request an agent of its own, and the suffixes are not the same order on every seed', () => {
    for (const id of items) {
      const orders = new Set<string>();
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const suffixes = setup(id, seed)
          .cases.map(suffixKey)
          .filter((key): key is string => key !== undefined);
        expect(new Set(suffixes).size, `${id} on seed ${seed}`).toBe(suffixes.length);
        orders.add(suffixes.join(','));
      }
      expect(orders.size, `${id}: the same suffix order on every seed`).toBeGreaterThan(1);
    }
  });
});

describe('the failure of a file-format item (cheat 4)', () => {
  const accept: Partial<VariablesImpl> = {
    validate: (value) => ({ ok: true, store: value, warnings: [] }),
    quotes: () => ({ errors: [] }),
  };
  const refuse: Partial<VariablesImpl> = {
    validate: () => ({ ok: false, errors: [{ code: 'SCHEMA_CUSTOM', path: '' }] }),
    quotes: () => ({ errors: [{ code: 'VARIABLES_QUOTE_NOT_FOUND', path: 'variables.0.provenance.0.quote' }] }),
  };

  it('names no position of a call and no direction of the wanted answer', async () => {
    for (const id of items) {
      const item = bank.find((i) => i.id === id);
      if (!item) throw new Error(id);
      for (const seed of [1, 820020691]) {
        for (const impl of [accept, refuse]) {
          const outcome = await runItem(item, seed, ROOT, impl);
          expect(outcome.pass, `${id} on seed ${seed}`).toBe(false);
          expect(outcome.detail, `${id} names a call`).not.toMatch(/\bcall\s*#?\d+/i);
          expect(outcome.detail, `${id} names a direction`).not.toMatch(
            /\b(?:was accepted|refuses|refused|accepts|refusal)\b/i,
          );
        }
      }
    }
  }, 120_000);

  it('gives a search nothing to climb on: the position of the first wrong call is not in the message', async () => {
    // The cheater's search: one answer class per call, run the item, read `call k` out of the failure, change the
    // answer of call k, run again. With the position in the message it finds every answer of an item; without it the
    // search never learns which call to change.
    let solved = 0;
    for (const id of items) {
      const { item, sequence } = setup(id, 1);
      const kinds = [...new Set(sequence.map(classOf))].sort();
      const choice = sequence.map(() => kinds[0] as string);
      const tried = sequence.map(() => 0);
      for (let round = 0; round < sequence.length * kinds.length + 2; round += 1) {
        const outcome = await runItem(
          item,
          1,
          ROOT,
          cheat(sequence, (index) => choice[index] as string),
        );
        if (outcome.pass) {
          solved += 1;
          break;
        }
        const call = /\bcall\s*#?(\d+)/i.exec(outcome.detail);
        if (!call) break;
        const at = Number(call[1]) - 1;
        tried[at] = (tried[at] ?? 0) + 1;
        choice[at] = kinds[(tried[at] as number) % kinds.length] as string;
      }
    }
    expect(solved, 'file-format items a search through the failure messages solved').toBe(0);
  }, 300_000);
});
