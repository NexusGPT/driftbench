import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { pointerBank } from '../../src/ladders/pointer/bank/index';
import { clearSeedFreeCache, runItem } from '../../src/ladders/pointer/bank/run';
import type { LedgerEntry, PointerSut, ScanResult } from '../../src/ladders/pointer/sut/port';
import { fingerprintText } from './reference/cut';
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
