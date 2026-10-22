import { Cassette, cut, nextLedger, pointerScan, singleLabelling } from '../../src/pointer';
import {
  estateFiles,
  type EstateName,
  flat,
  GOLD_ESTATE_KEY,
  GOLD_SET_NAME,
  goldLabeller,
  goldSets,
  loadGold,
} from './gold';

/**
 * The first two steps of the gold chain, as functions that return the problems they find: the ids and the labels
 * of a gold estate. Both run on the flat files of the estate, named as gold5.json names them. No model call.
 */

/** Ways the release cutter and the ledger differ from the gold: unit counts, texts and ids. */
export async function idsProblems(estate: EstateName): Promise<string[]> {
  const gold = (await loadGold()).filter((unit) => unit.estate === estate);
  const files = await estateFiles(estate);
  const problems: string[] = [];
  const names = [...new Set(gold.map((unit) => unit.file))].sort();
  const have = files.map((file) => file.path).sort();
  if (have.join(',') !== names.join(',')) problems.push(`files ${have.join(',')} vs gold ${names.join(',')}`);
  const cuts = files.map(({ path, text }) => ({ path, cut: cut(text) }));
  const { ids } = nextLedger(cuts, undefined, GOLD_ESTATE_KEY);
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
  return problems;
}

/** Ways the labels a scan with the planted labeller records differ from the gold labels of the agreed units. */
export async function labelsProblems(estate: EstateName): Promise<string[]> {
  const gold = (await loadGold()).filter((unit) => unit.estate === estate);
  const files = await estateFiles(estate);
  const log: string[] = [];
  const result = await pointerScan({
    files,
    sets: goldSets(),
    labelling: singleLabelling(goldLabeller(gold, log)),
    cassette: new Cassette(),
    mode: 'record',
    estateKey: GOLD_ESTATE_KEY,
  });
  const problems: string[] = [];
  if (log.length === 0) problems.push('the labeller was never asked');
  const live = result.ledger.entries.filter((entry) => entry.status === 'live');
  const byPlace = new Map(live.map((entry) => [`${entry.path}#${entry.index + 1}`, entry]));
  let agreed = 0;
  for (const unit of gold) {
    const place = `${unit.file}#${unit.n}`;
    const got = byPlace.get(place)?.labels[GOLD_SET_NAME]?.label;
    const have = got === 'none' ? undefined : got;
    if (!unit.agreed || unit.label === null) {
      if (have !== undefined) problems.push(`${place}: labelled ${have}, no agreed gold label`);
      continue;
    }
    agreed++;
    const want = unit.label === 'none' ? undefined : unit.label;
    if (have !== want) problems.push(`${place}: label ${have ?? 'none'} vs gold ${unit.label}`);
  }
  if (agreed === 0) problems.push('no agreed unit in the estate');
  return problems;
}
