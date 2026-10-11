import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stringify as stringifyYaml } from 'yaml';
import {
  type FidelityTurn,
  fidelity,
  ksCritical,
  ksStatistic,
  loadTurns,
  totalVariation,
} from '../../src/intake';
import { scratch } from './support';

const counts = (record: Record<string, number>) => new Map(Object.entries(record));
const turn = (text: string, cell: Record<string, string> = {}): FidelityTurn => ({ text, cell });

describe('totalVariation', () => {
  it('is 0 for the same distribution, 1 for disjoint ones, and half the L1 distance between', () => {
    expect(totalVariation(counts({ a: 2, b: 2 }), counts({ a: 5, b: 5 }))).toBe(0);
    expect(totalVariation(counts({ a: 1 }), counts({ b: 3 }))).toBe(1);
    expect(totalVariation(counts({ a: 1, b: 1 }), counts({ a: 1 }))).toBe(0.5);
    expect(totalVariation(counts({ a: 1, b: 1, c: 2 }), counts({ a: 2, b: 1, c: 1 }))).toBeCloseTo(0.25, 12);
    expect(() => totalVariation(counts({}), counts({ a: 1 }))).toThrow(RangeError);
  });
});

describe('ksStatistic', () => {
  it('is the largest gap between the empirical distribution functions, ties advancing both samples', () => {
    expect(ksStatistic([1, 2, 3], [1, 2, 3])).toBe(0);
    expect(ksStatistic([1, 2], [3, 4])).toBe(1);
    // By hand: after 1, 0.25 against 0; after 2, 0.75 against 0.25; after 3, 1 against 0.75. The same value
    // as scipy.stats.ks_2samp([1, 2, 2, 3], [2, 3, 3, 4]).statistic.
    expect(ksStatistic([1, 2, 2, 3], [2, 3, 3, 4])).toBe(0.5);
    // A 0/1 variable: the statistic is the difference of the two rates.
    expect(ksStatistic([1, 1, 0, 0], [1, 0, 0, 0, 0])).toBeCloseTo(0.5 - 0.2, 12);
  });

  it('gives the asymptotic 5 percent critical value 1.358 sqrt((n + m) / nm)', () => {
    expect(ksCritical(100, 100)).toBeCloseTo(0.19205, 5);
    expect(ksCritical(40, 10)).toBeCloseTo(1.358 * Math.sqrt(50 / 400), 12);
  });
});

describe('fidelity', () => {
  const reference = [
    turn('I want more data on my plan', { flow: 'upgrade', lang: 'en' }),
    turn('Do you have fibre at my address?', { flow: 'new-home', lang: 'en' }),
    turn('can I keep my number', { flow: 'porting', lang: 'en' }),
    turn('CONFIRM', { flow: 'upgrade', lang: 'en' }),
  ];

  it('scores a candidate equal to the reference as the same distribution, and every turn a copy', () => {
    const result = fidelity(reference, reference);
    expect(result.cells.tv).toBe(0);
    expect(result.length.ks).toBe(0);
    expect(result.questions.ks).toBe(0);
    expect(result.vocabulary.jaccard).toBe(1);
    expect(result.duplicates.copyRate).toBe(1);
    expect(result.dimensions).toEqual(['flow', 'lang']);
    expect(result.n).toEqual({ reference: 4, candidate: 4 });
  });

  it('measures a candidate that never leaves one cell and never asks', () => {
    const candidate = [
      turn('more data please, my current plan runs out', { flow: 'upgrade', lang: 'en' }),
      turn('give me a bigger data bundle', { flow: 'upgrade', lang: 'en' }),
    ];
    const result = fidelity(reference, candidate);
    expect(result.cells.tv).toBeCloseTo(0.5, 12);
    expect(result.cells.worst[0]).toEqual({ key: 'flow=upgrade lang=en', reference: 0.5, candidate: 1 });
    expect(result.questions.rateReference).toBe(0.25);
    expect(result.questions.rateCandidate).toBe(0);
    expect(result.questions.ks).toBe(0.25);
    expect(result.duplicates.copyRate).toBe(0);
    expect(result.cells.unseen).toBe(0);
  });

  it('compares on the dimensions every turn carries, or on the ones given', () => {
    const candidate = [turn('more data', { flow: 'upgrade' })];
    expect(fidelity(reference, candidate).dimensions).toEqual(['flow']);
    expect(fidelity(reference, candidate, { dimensions: [] }).cells.tv).toBe(0);
    expect(fidelity(reference, [turn('hi')]).dimensions).toEqual([]);
  });

  it('counts near-duplicates inside each set against the threshold', () => {
    const candidate = [turn('more data please'), turn('More  data please'), turn('fibre at 3 Orchard Way')];
    const result = fidelity(reference, candidate, { dimensions: [] });
    expect(result.duplicates.candidateRate).toBeCloseTo(2 / 3, 12);
    expect(result.duplicates.referenceRate).toBe(0);
  });
});

describe('loadTurns', () => {
  async function set(approvedFlags: boolean[], tamper = false) {
    const dir = await scratch('fidelity');
    const turns = approvedFlags.map((_, index) => ({
      id: `t-${index + 1}`,
      cell: { flow: 'upgrade' },
      text: `message ${index + 1}`,
      origin: 'model',
      source: 'tone',
    }));
    await writeFile(join(dir, 'reference.yaml'), stringifyYaml({ version: 1, produced_by: {}, turns }));
    await writeFile(
      join(dir, 'approval.yaml'),
      stringifyYaml({
        reference: 'reference.yaml',
        turns: turns.map((entry, index) => ({
          id: entry.id,
          cell: 'flow=upgrade',
          origin: 'model',
          text: tamper && index === 0 ? 'edited after approval' : entry.text,
          approved: approvedFlags[index],
        })),
      }),
    );
    return dir;
  }

  it('reads only the approved turns of a reference set, from the folder or the file', async () => {
    const dir = await set([true, false, true]);
    const loaded = await loadTurns(dir);
    expect(loaded).toMatchObject({ ok: true, kind: 'reference-set', unapproved: 1 });
    expect(loaded.ok && loaded.turns.map((entry) => entry.text)).toEqual(['message 1', 'message 3']);
    expect(await loadTurns(join(dir, 'reference.yaml'), { includeUnapproved: true })).toMatchObject({
      ok: true,
      unapproved: 0,
    });
  });

  it('refuses a set whose approval file is missing or no longer matches the set', async () => {
    expect(await loadTurns(await set([true], true))).toMatchObject({
      ok: false,
      message: 'turn t-1 differs between reference.yaml and approval.yaml',
    });
    const dir = await scratch('fidelity');
    await writeFile(join(dir, 'reference.yaml'), stringifyYaml({ produced_by: {}, turns: [] }));
    expect(await loadTurns(dir)).toMatchObject({ ok: false });
  });

  it('reads JSON Lines, a YAML list and the reference-turns file of intake logs', async () => {
    const dir = await scratch('fidelity');
    await writeFile(join(dir, 'turns.jsonl'), '{"text": "a", "cell": {"flow": "x"}}\n\n{"text": "b"}\n');
    expect(await loadTurns(join(dir, 'turns.jsonl'))).toMatchObject({
      ok: true,
      turns: [
        { text: 'a', cell: { flow: 'x' } },
        { text: 'b', cell: {} },
      ],
    });
    await writeFile(join(dir, 'turns.yaml'), '- text: a\n- text: b\n');
    expect(await loadTurns(join(dir, 'turns.yaml'))).toMatchObject({ ok: true, kind: 'turns' });
    await mkdir(join(dir, 'private'));
    await writeFile(
      join(dir, 'private', 'reference-turns.jsonl'),
      '{"id": "c#0", "text": "a", "cell": {}, "origin": "logs"}\n',
    );
    expect(await loadTurns(join(dir, 'private'))).toMatchObject({ ok: true, turns: [{ id: 'c#0' }] });
    expect(await loadTurns(join(dir, 'nothing'))).toMatchObject({ ok: false });
    await writeFile(join(dir, 'bad.jsonl'), 'oops\n');
    expect(await loadTurns(join(dir, 'bad.jsonl'))).toMatchObject({
      ok: false,
      message: 'line 1: not a JSON object',
    });
  });
});
