import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bankSummary } from '../../src/bank';
import { runSeeds } from '../../src/ladder';
import { bankItems, causeOf, generatorLadder, type Verdict } from '../../src/ladders/generator';

const root = fileURLToPath(new URL('../../../../', import.meta.url));

describe('generator ladder cause metadata', () => {
  it('carries existing resolved causes while leaving own-ID fallbacks visibly unauthored', async () => {
    const items = bankItems();
    const failure: Verdict = { pass: false, detail: '' };
    const report = await runSeeds(
      generatorLadder({ items: items.map((item) => ({ ...item, check: async () => failure })) }),
      [{ seed: 1, hidden: false }],
      root,
      { full: true },
    );
    const entries = report.seeds.flatMap((seed) => seed.rows.flatMap((row) => row.bank ?? []));
    expect(entries).toHaveLength(items.length);
    expect(entries.every((entry) => !entry.pass)).toBe(true);
    const expected = new Map(items.map((item) => [item.id, causeOf(item, failure)]));
    for (const entry of entries) {
      const cause = expected.get(entry.id);
      expect(entry.cause, entry.id).toBe(cause === entry.id ? undefined : cause);
    }
    const summary = bankSummary(report);
    const fallbackCount = items.filter((item) => expected.get(item.id) === item.id).length;
    expect(fallbackCount).toBe(1812);
    expect(summary.failingWithoutCause).toBe(fallbackCount);
    expect(summary.failingCauses).toBe(new Set(expected.values()).size);
  });

  it('carries an existing verdict override rather than replacing it with the item cause', async () => {
    const items = bankItems();
    const authored = items.find((item) => item.cause);
    if (!authored?.cause) throw new Error('The existing bank must supply an authored cause');
    const item = items.find((entry) => entry.id !== authored.id);
    if (!item) throw new Error('The bank must have another item');
    const failure: Verdict = { pass: false, detail: '', cause: authored.cause };
    const report = await runSeeds(
      generatorLadder({ items: [{ ...item, check: async () => failure }] }),
      [{ seed: 1, hidden: false }],
      root,
      { full: true },
    );
    const entries = report.seeds.flatMap((seed) => seed.rows.flatMap((row) => row.bank ?? []));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.cause).toBe(authored.cause);
    expect(bankSummary(report).failingWithoutCause).toBe(0);
  });
});
