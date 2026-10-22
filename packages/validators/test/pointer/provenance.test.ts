import { describe, expect, it } from 'vitest';
import { bankSummary, formatItems } from '../../src/bank';
import { runSeeds } from '../../src/ladder';
import { BLIND_PROVENANCE, blindLevels } from '../../src/ladders/pointer/bank/blind';
import { pointerBank, pointerBankLadder } from '../../src/ladders/pointer/bank/index';
import { bankLadder } from '../../src/ladders/pointer/bank/ladder';
import { referenceSut } from './reference/index';

const count = (label: string) => pointerBank().filter((i) => i.provenance === label).length;

describe('the provenance of the first bank', () => {
  it('labels every item, and the labels cover the 419 items', () => {
    expect(pointerBank()).toHaveLength(419);
    expect(count('blind') + count('maintainer-repaired') + count('maintainer-added')).toBe(419);
  });

  it('labels the stack and label-set validation items as maintainer-added', () => {
    const added = pointerBank().filter((i) => i.provenance === 'maintainer-added');
    expect(added.every((i) => /^labels\.(stack-|set-validation-)/.test(i.id))).toBe(true);
  });
});

describe('the first bank claims no blind item', () => {
  it('labels no item of this bank blind', () => {
    expect(pointerBank().filter((i) => i.provenance === 'blind')).toEqual([]);
  });

  it('labels the 402 original items maintainer-repaired and the 17 later ones maintainer-added', () => {
    expect(count('maintainer-repaired')).toBe(402);
    expect(count('maintainer-added')).toBe(17);
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

  it('binds the operations the reader serves and fails a missing call with the reason', async () => {
    const level = blindLevels(async () => referenceSut())[2];
    const measure = await level?.compute({ seed: 1, hidden: false, root: '.' });
    const bank = measure?.bank ?? [];
    const of = (family: string) => bank.filter((e) => e.family === family);
    expect(of('blind-cutting').length).toBeGreaterThan(0);
    expect(of('blind-cutting').every((e) => e.pass)).toBe(true);
    expect(of('blind-scale').length).toBeGreaterThan(0);
    expect(of('blind-scale').every((e) => e.pass)).toBe(true);
    expect(of('blind-links').length).toBeGreaterThan(0);
    // Layer C is built: the reader's link functions answer, so no link item fails for a missing call.
    expect(of('blind-links').every((e) => e.pass || !/adapter gap/.test(e.detail ?? ''))).toBe(true);
  }, 120_000);

  it('reports the score of each label apart in the item listing', async () => {
    // The listing names a label when an item of it ran. One item of the first label and the items of the second
    // run here, not the 94 items of the labels level (56 s on a CI runner): the test is about the listing.
    const items = pointerBank();
    const added = items.filter((item) => item.provenance === 'maintainer-added');
    const repaired = items.filter((item) => item.provenance === 'maintainer-repaired').slice(0, 1);
    const own = bankLadder([...repaired, ...added], async () => referenceSut());
    const blind = pointerBankLadder(async () => referenceSut()).levels[9];
    const ladder = {
      component: 'pointer',
      levels: [
        ...own.levels.filter((level) => !level.metric.includes('(0)')),
        ...(blind === undefined ? [] : [blind]),
      ],
    };
    const report = await runSeeds(ladder, [{ seed: 1, hidden: false }], process.cwd(), { full: true });
    const text = formatItems(bankSummary(report), 'pointer');
    expect(text).toContain('Provenance maintainer-repaired:');
    expect(text).toContain('Provenance maintainer-added:');
    expect(text).toContain(`Provenance ${BLIND_PROVENANCE}:`);
  }, 120_000);
});
