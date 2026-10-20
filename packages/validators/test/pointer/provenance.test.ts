import { describe, expect, it } from 'vitest';
import { bankSummary, formatItems } from '../../src/bank';
import { runSeeds } from '../../src/ladder';
import { BLIND_PROVENANCE, blindLevels } from '../../src/ladders/pointer/bank/blind';
import { pointerBank, pointerBankLadder } from '../../src/ladders/pointer/bank/index';
import { referenceSut } from './reference/index';

const count = (label: string) => pointerBank().filter((i) => i.provenance === label).length;

describe('the provenance of the first bank', () => {
  it('labels every item, and the three labels cover the 419 items', () => {
    expect(pointerBank()).toHaveLength(419);
    expect(count('blind')).toBe(332);
    expect(count('maintainer-repaired')).toBe(70);
    expect(count('maintainer-added')).toBe(17);
  });

  it('labels the stack and label-set validation items as maintainer-added', () => {
    const added = pointerBank().filter((i) => i.provenance === 'maintainer-added');
    expect(added.every((i) => /^labels\.(stack-|set-validation-)/.test(i.id))).toBe(true);
  });

  it('keeps the lowercase-boundary item out of the blind label: its oracle was reversed after the blind commit', () => {
    const item = pointerBank().find((i) => i.id === 'cutting.sentences-lowercase-start-merges');
    expect(item?.provenance).toBe('maintainer-repaired');
  });
});

describe('the second bank beside the first', () => {
  it('registers five blind levels after the nine levels of the first bank, with prefixed families', async () => {
    const ladder = pointerBankLadder(async () => referenceSut());
    expect(ladder.levels.map((l) => l.id).slice(9)).toEqual([
      'blind-1',
      'blind-2',
      'blind-3',
      'blind-4',
      'blind-5',
    ]);
    const measure = await blindLevels(async () => referenceSut())[0]?.compute({
      seed: 1,
      hidden: false,
      root: '.',
    });
    const bank = measure?.bank ?? [];
    expect(bank.length).toBeGreaterThan(0);
    expect(bank.every((e) => e.provenance === BLIND_PROVENANCE)).toBe(true);
    expect(bank.every((e) => e.family?.startsWith('blind-') && e.id.startsWith('blind/'))).toBe(true);
  });

  it('binds the operations the reader serves and fails the others with the reason', async () => {
    const level = blindLevels(async () => referenceSut())[2];
    const measure = await level?.compute({ seed: 1, hidden: false, root: '.' });
    const bank = measure?.bank ?? [];
    const of = (family: string) => bank.filter((e) => e.family === family);
    expect(of('blind-cutting').every((e) => e.pass)).toBe(true);
    expect(of('blind-scale').every((e) => e.pass)).toBe(true);
    expect(of('blind-links').length).toBeGreaterThan(0);
    expect(of('blind-links').every((e) => !e.pass && /adapter gap/.test(e.detail ?? ''))).toBe(true);
  }, 120_000);

  it('reports the score of each label apart in the item listing', async () => {
    const own = pointerBankLadder(async () => referenceSut());
    const ladder = {
      component: 'pointer',
      levels: [own.levels[0], own.levels[1], own.levels[3], own.levels[9]].filter((l) => l !== undefined),
    };
    const report = await runSeeds(ladder, [{ seed: 1, hidden: false }], process.cwd(), { full: true });
    const text = formatItems(bankSummary(report), 'pointer');
    expect(text).toContain('Provenance blind:');
    expect(text).toContain('Provenance maintainer-repaired:');
    expect(text).toContain('Provenance maintainer-added:');
    expect(text).toContain(`Provenance ${BLIND_PROVENANCE}:`);
  }, 120_000);
});
