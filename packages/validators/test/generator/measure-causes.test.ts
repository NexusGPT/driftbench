import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bankSummary } from '../../src/bank';
import { runSeeds } from '../../src/ladder';
import { bankItems, causeOf, generatorLadder, type Verdict } from '../../src/ladders/generator';
import { authoredCauseFor, GENERATOR_CAUSE_KINDS } from '../../src/ladders/generator/cause-kinds';

const root = fileURLToPath(new URL('../../../../', import.meta.url));

describe('generator ladder cause metadata', () => {
  it('reports an authored cause for every failing item without an own-ID fallback', async () => {
    const items = bankItems();
    expect(items).toHaveLength(2175);
    for (const item of items) {
      expect(item.cause, item.id).toBeTruthy();
      expect(item.cause, item.id).not.toBe(item.id);
    }
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
      expect(entry.cause, entry.id).toBe(cause);
      expect(entry.cause, entry.id).toBeTruthy();
      expect(entry.cause, entry.id).not.toBe(entry.id);
    }
    const summary = bankSummary(report);
    const fallbackCount = items.filter((item) => expected.get(item.id) === item.id).length;
    expect(fallbackCount).toBe(0);
    expect(summary.failingWithoutCause).toBe(0);
    expect(summary.failingCauses).toBe(new Set(expected.values()).size);
  });

  it('assigns the 169 approved defaults exactly once to the 2,032 previously unauthored items', () => {
    expect(GENERATOR_CAUSE_KINDS).toHaveLength(169);
    const assignments = GENERATOR_CAUSE_KINDS.flatMap((kind) => kind.items);
    expect(assignments).toHaveLength(2032);
    expect(new Set(assignments).size).toBe(assignments.length);
    const bank = new Map(bankItems().map((item) => [item.id, item]));
    for (const kind of GENERATOR_CAUSE_KINDS) {
      expect(kind.cause.length).toBeGreaterThan(0);
      expect(kind.checks.length).toBeGreaterThan(0);
      for (const id of kind.items) {
        expect(bank.get(id)?.cause, id).toBe(kind.cause);
        expect(kind.cause, id).not.toBe(id);
      }
    }
    expect([...bank.keys()].filter((id) => !assignments.includes(id))).toHaveLength(143);
    expect(() => authoredCauseFor('unassigned-new-item')).toThrow('needs an authored cause');
  });

  it('retains class-specific causes ahead of the new generic default', () => {
    const item = bankItems().find((entry) => entry.id.startsWith('adequacy.'));
    if (!item) throw new Error('The bank must contain an adequacy item');
    const cls = item.id.slice('adequacy.'.length);
    expect(causeOf(item, { pass: false, detail: 'no block kills this class' })).toBe(`kill.${cls}`);
    expect(causeOf(item, { pass: false, detail: '' })).toBe(item.cause);
  });

  it('keeps an unauthored injected item visibly missing a cause', async () => {
    const item = bankItems()[0];
    if (!item) throw new Error('The bank must contain an item');
    const report = await runSeeds(
      generatorLadder({ items: [{ ...item, cause: undefined, check: async () => ({ pass: false, detail: '' }) }] }),
      [{ seed: 1, hidden: false }],
      root,
      { full: true },
    );
    const entries = report.seeds.flatMap((seed) => seed.rows.flatMap((row) => row.bank ?? []));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.cause).toBeUndefined();
    expect(bankSummary(report).failingWithoutCause).toBe(1);
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
