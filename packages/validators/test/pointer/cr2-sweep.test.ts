import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { pointerBank } from '../../src/ladders/pointer/bank/index';
import { clearSeedFreeCache, runItem } from '../../src/ladders/pointer/bank/run';
import type { LedgerEntry, PointerSut, ScanResult } from '../../src/ladders/pointer/sut/port';
import { cutText, fingerprintText } from './reference/cut';
import { referenceSut } from './reference/index';

/**
 * Red-first proof for the prose sweep review (PR 1136, codex run 39692060526): `ids.fp-case` and
 * `ids.fp-emphasis` must reject a reader whose fingerprint folds case (or strips `*`) on one word position,
 * on every seed, as the items did before the sweep. Each mutant is the reference reader with its fingerprints
 * recomputed from the fingerprint text with that one change; the items stay green on the reference.
 */

const ref = referenceSut();
const bank = pointerBank();
const item = (id: string) => {
  const found = bank.find((x) => x.id === id);
  if (!found) throw new Error(`no item ${id}`);
  return found;
};

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

type LedgerFile = { entries: LedgerEntry[]; [key: string]: unknown };

/** The result with its ledger rewritten: the raw text and the view change together. */
function rewrite(result: ScanResult, change: (entries: LedgerEntry[]) => LedgerEntry[]): ScanResult {
  if (!result.ledger) return result;
  const file = JSON.parse(result.ledger.raw) as LedgerFile;
  const entries = change(file.entries);
  return { ...result, ledger: { raw: JSON.stringify({ ...file, entries }), entries } };
}

type Mode = 'case' | 'emphasis';
const fold = (mode: Mode, word: string): string =>
  mode === 'case' ? word.toLowerCase() : word.split('*').join('');

/**
 * The reference reader with a fingerprint that loses case (or `*`) on the word at `position` of the
 * fingerprint text (its words as the reader cuts them at single spaces), or on every word (`all`).
 */
function mutant(mode: Mode, position: number | 'all'): PointerSut {
  return {
    ...ref,
    name: `fp-${mode}-${position}`,
    async scan(request) {
      const result = await ref.scan(request);
      return rewrite(result, (entries) =>
        entries.map((entry) => {
          const words = fingerprintText(entry.quote).split(' ');
          const changed = words.map((w, i) => (position === 'all' || i === position ? fold(mode, w) : w));
          return { ...entry, fp: createHash('sha256').update(changed.join(' ')).digest('hex') };
        }),
      );
    },
  };
}

async function verdicts(id: string, sut: PointerSut): Promise<{ red: number[]; green: number[] }> {
  const red: number[] = [];
  const green: number[] = [];
  for (const seed of SEEDS) {
    clearSeedFreeCache();
    const out = await runItem(item(id), seed, sut);
    (out.pass ? green : red).push(seed);
  }
  return { red, green };
}

for (const mode of ['case', 'emphasis'] as const) {
  const id = `ids.fp-${mode}`;
  describe(`${id} rejects a fingerprint that loses ${mode} on one word, on every seed`, () => {
    it('is green on the reference on seeds 1 to 20', async () => {
      const { red } = await verdicts(id, ref);
      expect(red, `${id} red on the reference`).toEqual([]);
    }, 300_000);

    it('is red on seeds 1 to 20 when the fourth word loses it (the review mutant)', async () => {
      const { green } = await verdicts(id, mutant(mode, 3));
      expect(green, `${id} accepted the fourth-word ${mode} mutant on these seeds`).toEqual([]);
    }, 300_000);

    it('is red on seeds 1 to 20 for each other word position past the start, and for every word', async () => {
      for (const position of [1, 2, 4, 5, 'all'] as const) {
        const { green } = await verdicts(id, mutant(mode, position));
        expect(green, `${id} accepted the ${mode} mutant at ${position} on these seeds`).toEqual([]);
      }
    }, 600_000);
  });
}

/**
 * The refusal of a too deeply nested file is checked by its code, not by its text (the guard has no allowance
 * for a message pattern). The reference reader's error carries `code: 'nesting-too-deep'`; an item that
 * checks the code rejects a reader whose refusal has the right words and no code, and accepts one whose
 * refusal has the code and other words.
 */
const REFERENCE_MODULE = fileURLToPath(new URL('./reference/index.ts', import.meta.url));
const MESSAGE_ONLY = fileURLToPath(new URL('./reference/deep-message-only.ts', import.meta.url));
const CODE_ONLY = fileURLToPath(new URL('./reference/deep-code-only.ts', import.meta.url));

async function withChild(module: string, id: string): Promise<{ pass: boolean; detail: string }> {
  const before = process.env.DRIFTBENCH_POINTER_SUT;
  try {
    process.env.DRIFTBENCH_POINTER_SUT = module;
    clearSeedFreeCache();
    return await runItem(item(id), 1, ref);
  } finally {
    clearSeedFreeCache();
    if (before === undefined) delete process.env.DRIFTBENCH_POINTER_SUT;
    else process.env.DRIFTBENCH_POINTER_SUT = before;
  }
}

describe('the refusal of a too deeply nested file is checked by its code', () => {
  it('the reference reader throws an error with the code nesting-too-deep', () => {
    let thrown: unknown;
    try {
      cutText(`${'> '.repeat(600)}Some text here.\n`);
    } catch (cause) {
      thrown = cause;
    }
    expect((thrown as { code?: string } | undefined)?.code).toBe('nesting-too-deep');
  });

  for (const id of ['adversarial.deep-nested-quotes', 'adversarial.deep-nested-lists']) {
    it(`${id} is green when the refusal carries the code`, async () => {
      const out = await withChild(REFERENCE_MODULE, id);
      expect(out.pass, out.detail).toBe(true);
    }, 120_000);

    it(`${id} is green when the refusal carries the code and other words`, async () => {
      const out = await withChild(CODE_ONLY, id);
      expect(out.pass, out.detail).toBe(true);
    }, 120_000);

    it(`${id} is red when the refusal has the right words and no code`, async () => {
      const out = await withChild(MESSAGE_ONLY, id);
      expect(out.pass, `${id} accepted a refusal without the code`).toBe(false);
      expect(out.detail).toMatch(/nesting-too-deep/);
    }, 120_000);
  }
});
