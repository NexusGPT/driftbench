import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FORMAT_CASES } from '../../src/ladders/variables/bank/families/format';
import { VERIFY_CASES } from '../../src/ladders/variables/bank/families/verify';
import {
  breaksEveryPeriod,
  classOf,
  type FileCase,
  PERIODS,
  schedule,
} from '../../src/ladders/variables/bank/files';
import { contextFor, runItem, variablesBank } from '../../src/ladders/variables/bank/index';
import { STEMS } from '../../src/ladders/variables/bank/manifest/index';
import { stableStringify } from '../../src/ladders/variables/bank/util';
import type { VariablesImpl } from '../../src/ladders/variables/interface';

/**
 * Cheats that know the class of every answer and are given the right payload for it, and that choose the class
 * only by the position of the call or by a hash of the request. The file-format items must fail all of them
 * (the call-order and request-guess cheats of the review of the second variables bank, PR 762).
 */

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const BUILDERS = { ...FORMAT_CASES, ...VERIFY_CASES };
const SEEDS = [1, 2, 3, 7, 20, 820020691, 360920726];

const wrongPath = 'x.y';

function replyOf(c: FileCase, klass: string): unknown {
  const right = classOf(c) === klass;
  if (c.op === 'validate') {
    if (klass === 'accept') return { ok: true, store: c.store, warnings: [] };
    const code = klass.slice('reject:'.length);
    const path = c.want.kind === 'reject' ? (c.want.paths[0] as string) : wrongPath;
    return {
      ok: false,
      errors: [
        {
          code: right && c.want.kind === 'reject' && c.want.codeFamily ? 'SCHEMA_INVALID_TYPE' : code,
          path: right ? path : wrongPath,
        },
      ],
    };
  }
  if (klass === 'found') return { errors: [] };
  if (right && c.want.kind === 'issues') return { errors: c.want.issues };
  const codes = klass.slice('issues:'.length).split('+');
  return { errors: codes.map((code) => ({ code, path: wrongPath })) };
}

const keyOf = (op: string, ...args: unknown[]) => stableStringify([op, ...args]);

/** A cheat that is right whenever its class guess is right: it picks the class with `pick(callIndex, request)`. */
function cheat(
  sequence: readonly FileCase[],
  pick: (index: number, c: FileCase) => string,
): Partial<VariablesImpl> {
  const byRequest = new Map<string, FileCase>();
  for (const c of sequence)
    byRequest.set(c.op === 'validate' ? keyOf('validate', c.store) : keyOf('quotes', c.store, c.files), c);
  let calls = 0;
  const lookup = (key: string): FileCase => {
    const found = byRequest.get(key);
    if (!found) throw new Error('the cheat was asked something outside the item');
    return found;
  };
  return {
    validate(value) {
      const c = lookup(keyOf('validate', value));
      return replyOf(c, pick(calls++, c)) as ReturnType<VariablesImpl['validate']>;
    },
    quotes(store, files) {
      const c = lookup(keyOf('quotes', store, files));
      return replyOf(c, pick(calls++, c)) as ReturnType<VariablesImpl['quotes']>;
    },
  };
}

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
  const sequence = schedule(cases, seed, id);
  return { item, cases, sequence };
}

describe('the schedule of the file-format items', () => {
  it('breaks every periodic pattern of answers of periods 1 to 8, on every seed', () => {
    for (const id of items) {
      for (const seed of [...Array(20).keys()].map((i) => i + 1).concat(SEEDS)) {
        const { sequence } = setup(id, seed);
        expect(breaksEveryPeriod(sequence.map(classOf)), `${id} on seed ${seed}`).toBe(true);
        expect(sequence.length, id).toBeGreaterThanOrEqual(18);
      }
    }
  }, 120_000);

  it('asks at least eighteen different requests and has two classes of answer', () => {
    for (const id of items) {
      const { cases } = setup(id, 1);
      const requests = new Set(
        cases.map((c) => (c.op === 'validate' ? keyOf('v', c.store) : keyOf('q', c.store, c.files))),
      );
      expect(requests.size, id).toBeGreaterThanOrEqual(18);
      expect(new Set(cases.map(classOf)).size, id).toBeGreaterThanOrEqual(2);
    }
  });

  it('knows a periodic order from a certified one', () => {
    expect(breaksEveryPeriod(['a', 'b', 'a', 'b', 'a', 'b', 'a', 'b', 'a', 'b'])).toBe(false);
    expect(breaksEveryPeriod(['a', 'a', 'a', 'a'])).toBe(false);
    expect(PERIODS).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('refuses an item with one class of answer', () => {
    const one: FileCase[] = Array.from({ length: 20 }, () => ({
      op: 'validate',
      store: {},
      want: { kind: 'accept' },
    }));
    expect(() => schedule(one, 1, 'x')).toThrow();
  });
});

describe('cheats that choose the class of the answer without reading the store', () => {
  it('fail every file-format item: a repeating pattern of answers, with a global or a per-item counter, at every period and offset', async () => {
    let attempts = 0;
    for (const id of items) {
      for (const seed of [1, 2, 820020691]) {
        const { item, sequence } = setup(id, seed);
        const classes = sequence.map(classOf);
        for (const period of PERIODS) {
          for (let offset = 0; offset < period; offset += 1) {
            // The best pattern of this period for this item, found from the true answers: the strongest possible cheat.
            const pattern: string[] = [];
            for (let r = 0; r < period; r += 1) {
              const tally = new Map<string, number>();
              classes.forEach((k, i) => {
                if ((i + offset) % period === r) tally.set(k, (tally.get(k) ?? 0) + 1);
              });
              pattern.push([...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? (classes[0] as string));
            }
            const impl = cheat(sequence, (index) => pattern[(index + offset) % period] as string);
            const outcome = await runItem(item, seed, ROOT, impl);
            attempts += 1;
            expect(outcome.pass, `${id} on seed ${seed} against period ${period}, offset ${offset}`).toBe(
              false,
            );
          }
        }
      }
    }
    expect(attempts).toBeGreaterThan(5000);
  }, 300_000);

  it('fail every file-format item: a class chosen by a hash of the request', async () => {
    for (const id of items) {
      for (const seed of [1, 2, 20, 820020691, 360920726]) {
        const { item, sequence } = setup(id, seed);
        const kinds = [...new Set(sequence.map(classOf))].sort();
        for (let word = 0; word < 8; word += 1) {
          const impl = cheat(sequence, (_index, c) => {
            const digest = createHash('sha256')
              .update(stableStringify(c.op === 'validate' ? [c.op, c.store] : [c.op, c.store, c.files]))
              .digest();
            return kinds[digest.readUInt32BE(word * 4) % kinds.length] as string;
          });
          const outcome = await runItem(item, seed, ROOT, impl);
          expect(outcome.pass, `${id} on seed ${seed} against hash word ${word}`).toBe(false);
        }
      }
    }
  }, 300_000);

  it('can pass an item when it knows the class of every answer, so a failure above means the order did its work', async () => {
    for (const id of items) {
      const { item, sequence } = setup(id, 1);
      const impl = cheat(sequence, (_index, c) => classOf(c));
      expect((await runItem(item, 1, ROOT, impl)).pass, id).toBe(true);
    }
  });

  it('fail every file-format item: always accept, always refuse', async () => {
    const accept: Partial<VariablesImpl> = {
      validate: (value) => ({ ok: true, store: value, warnings: [] }),
      quotes: () => ({ errors: [] }),
    };
    const refuse: Partial<VariablesImpl> = {
      validate: () => ({ ok: false, errors: [{ code: 'SCHEMA_CUSTOM', path: '' }] }),
      quotes: () => ({
        errors: [{ code: 'VARIABLES_QUOTE_NOT_FOUND', path: 'variables.0.provenance.0.quote' }],
      }),
    };
    for (const id of items) {
      const item = bank.find((i) => i.id === id);
      if (!item) throw new Error(id);
      for (const impl of [accept, refuse]) {
        expect((await runItem(item, 1, ROOT, impl)).pass, id).toBe(false);
      }
    }
  });
});
