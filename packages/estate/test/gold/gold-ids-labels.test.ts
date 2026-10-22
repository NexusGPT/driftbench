import { describe, expect, it } from 'vitest';
import { cut, nextLedger } from '../../src/pointer';
import { ESTATE_NAMES, estateFiles, type EstateName, flat, GOLD_ESTATE_KEY, loadGold } from './gold';

/**
 * Steps 1 and 2 of the gold chain: the ids and the labels of the three gold estates. No model call. The
 * ids are the ledger ids of gold5.json, minted by the same recipe; a unit the release cutter splits or
 * words differently is listed with both texts. The labels are those the planted labeller answers from the
 * gold file, read back from the ledger of a scan.
 */

const SHOWN = 12;

function report(step: string, problems: string[]): string {
  const more = problems.length > SHOWN ? ['...'] : [];
  return [`${step}: ${problems.length} problems`, ...problems.slice(0, SHOWN), ...more].join('\n');
}

describe.each(ESTATE_NAMES)('gold estate %s', (estate: EstateName) => {
  it('step 1 ids: the cut and the ledger reproduce the gold unit for unit', async () => {
    const gold = (await loadGold()).filter((unit) => unit.estate === estate);
    const files = await estateFiles(estate);
    const names = [...new Set(gold.map((unit) => unit.file))].sort();
    expect(files.map((file) => file.path).sort(), 'the files of the estate').toEqual(names);
    const cuts = files.map(({ path, text }) => ({ path, cut: cut(text) }));
    const { ids } = nextLedger(cuts, undefined, GOLD_ESTATE_KEY);
    const problems: string[] = [];
    for (const { path, cut: fileCut } of cuts) {
      const expected = gold.filter((unit) => unit.file === path).sort((a, b) => a.n - b.n);
      if (fileCut.units.length !== expected.length) {
        problems.push(`${path}: cut ${fileCut.units.length} units, gold has ${expected.length}`);
      }
      for (const want of expected) {
        const unit = fileCut.units[want.n - 1];
        if (!unit) continue;
        const text = flat(unit.text);
        if (text !== want.text) {
          const both = `${JSON.stringify(text)} vs gold ${JSON.stringify(want.text)}`;
          problems.push(`${path}#${want.n}: text ${both}`);
        }
        const id = ids.get(`${path}\0${want.n - 1}`);
        if (id !== want.id) problems.push(`${path}#${want.n}: id ${id} vs gold ${want.id}`);
      }
    }
    expect(problems, report('ids', problems)).toEqual([]);
  });
});
