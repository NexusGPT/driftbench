import { describe, expect, it } from 'vitest';
import {
  atomsByUnit,
  cut,
  editCounts,
  type Ledger,
  ledgerChangeManifest,
  ledgerChanges,
  nextLedger,
  RERUN_RULE,
  rerunOf,
} from '../../src/pointer';

// Invented files: a hall with crates, keys and keepers, and a yard beside it.
const HALL = [
  '# Hall',
  '',
  '## Crates',
  '',
  '- Water the plants on the left shelf',
  '- Name the keeper of every crate',
  '- Return the keys before you leave',
  '',
  '## Doors',
  '',
  'Count the crates twice. Lock the door when the hall is empty.',
  '',
].join('\n');
const YARD = [
  '# Yard',
  '',
  'Sweep the yard each morning before the first cart comes in. Close the gate at night.',
  '',
].join('\n');

const scan = (texts: Record<string, string>, previous?: Ledger) =>
  nextLedger(
    Object.entries(texts).map(([path, text]) => ({ path, cut: cut(text) })),
    previous,
    'hall',
  ).ledger;
const before = scan({ 'hall.md': HALL, 'yard.md': YARD });
const idOf = (ledger: Ledger, quote: string, path = 'hall.md') => {
  const id = ledger.entries.find(
    (entry) => entry.status === 'live' && entry.path === path && entry.quote === quote,
  )?.id;
  if (!id) throw new Error(`no unit ${quote}`);
  return id;
};
const id = (quote: string, path?: string) => idOf(before, quote, path);
const PLANTS = 'Water the plants on the left shelf';
const KEEPER = 'Name the keeper of every crate';
const KEYS = 'Return the keys before you leave';
const COUNT = 'Count the crates twice.';
const LOCK = 'Lock the door when the hall is empty.';
const CRATES = '## Crates';
const DOORS = '## Doors';
const HALL_HEADING = '# Hall';

/** The rerun set and the advisory set of an edit, as sorted ids. */
function rerunAfter(texts: Record<string, string>) {
  const next = scan(texts, before);
  const changes = ledgerChanges(before, next);
  const rerun = rerunOf(changes, before);
  return {
    next,
    changes,
    counts: editCounts(changes),
    rerun: [...rerun.units.keys()].sort(),
    advisory: [...rerun.advisory.keys()].sort(),
    whole: rerun.whole,
    reasons: rerun.units,
  };
}
const sorted = (...ids: string[]) => [...ids].sort();

describe('the rerun set of each edit class', () => {
  it('fixes one rule per class', () => {
    expect(RERUN_RULE).toEqual({
      unchanged: 'none',
      context: 'advisory',
      moved: 'advisory',
      changed: 'unit',
      deleted: 'unit',
      new: 'section',
    });
  });

  it('unchanged: no edit reruns nothing and reports nothing', () => {
    const result = rerunAfter({ 'hall.md': HALL, 'yard.md': YARD });
    expect(result.rerun).toEqual([]);
    expect(result.advisory).toEqual([]);
    expect(result.whole).toBeNull();
    expect(result.counts.unchanged).toBe(before.entries.length);
  });

  it('unchanged: white space inside a unit is not an edit', () => {
    const result = rerunAfter({
      'hall.md': HALL.replace(KEEPER, 'Name  the keeper\tof every crate'),
      'yard.md': YARD,
    });
    expect(result.rerun).toEqual([]);
    expect(result.advisory).toEqual([]);
  });

  it('changed: the edited unit reruns, its neighbours are advisory', () => {
    const result = rerunAfter({
      'hall.md': HALL.replace(KEEPER, 'Name the keeper of every blue crate'),
      'yard.md': YARD,
    });
    expect(result.rerun).toEqual([id(KEEPER)]);
    expect(result.advisory).toEqual(sorted(id(PLANTS), id(KEYS)));
    expect(result.counts).toMatchObject({ changed: 1, context: 2 });
  });

  it('deleted: the gone unit reruns, its old neighbours are advisory', () => {
    const result = rerunAfter({ 'hall.md': HALL.replace(`- ${KEEPER}\n`, ''), 'yard.md': YARD });
    expect(result.rerun).toEqual([id(KEEPER)]);
    expect(result.advisory).toEqual(sorted(id(PLANTS), id(KEYS)));
    expect(result.changes.find((change) => change.id === id(KEEPER))?.class).toBe('deleted');
  });

  it('new: a unit no old unit follows reruns the old units of its section', () => {
    const result = rerunAfter({
      'hall.md': HALL.replace(`- ${KEYS}\n`, `- ${KEYS}\n- Dust the lamps above the crates on Fridays\n`),
      'yard.md': YARD,
    });
    expect(result.counts.new).toBe(1);
    // The units under "Hall > Crates": the three items. The heading "Crates" sits under "Hall" alone.
    expect(result.rerun).toEqual(sorted(id(PLANTS), id(KEEPER), id(KEYS)));
    // Its neighbours: the item above it and the heading below it.
    expect(result.advisory).toEqual(sorted(id(KEYS), id(DOORS)));
  });

  it('new: under a new heading, the old units of the nearest heading above rerun', () => {
    const result = rerunAfter({
      'hall.md': `${HALL}## Lamps\n\nDust the lamps above the crates on Fridays.\n`,
      'yard.md': YARD,
    });
    expect(result.counts.new).toBe(2);
    // The new heading and its sentence sit under "Hall": every old unit under "Hall" reruns, its own heading not.
    const underHall = before.entries.filter(
      (entry) => entry.path === 'hall.md' && entry.quote !== HALL_HEADING,
    );
    expect(result.rerun).toEqual(underHall.map((entry) => entry.id).sort());
  });

  it('new: a unit in a file the ledger did not hold reruns the whole suite', () => {
    const result = rerunAfter({
      'hall.md': HALL,
      'yard.md': YARD,
      'shed.md': '# Shed\n\nOil the hinges once a week.\n',
    });
    expect(result.whole).toMatch(/shed\.md, a file the ledger did not hold/);
  });

  it('context: a unit with the same text and other neighbours is advisory only', () => {
    const swapped = HALL.replace(`- ${PLANTS}\n- ${KEEPER}\n`, `- ${KEEPER}\n- ${PLANTS}\n`);
    const result = rerunAfter({ 'hall.md': swapped, 'yard.md': YARD });
    expect(result.rerun).toEqual([]);
    expect(result.advisory).toEqual(sorted(id(PLANTS), id(KEEPER), id(KEYS), id(CRATES)));
  });

  it('moved: the same text in another file is advisory only', () => {
    const sentence = 'Sweep the yard each morning before the first cart comes in.';
    const result = rerunAfter({
      'hall.md': HALL.replace(COUNT, `${sentence} ${COUNT}`),
      'yard.md': '# Yard\n\nClose the gate at night.\n',
    });
    const change = result.changes.find((each) => each.id === id(sentence, 'yard.md'));
    expect(change).toMatchObject({ class: 'moved', from: 'yard.md', path: 'hall.md' });
    expect(result.rerun).toEqual([]);
    expect(result.advisory).toEqual(
      // The moved unit, its new neighbours in the hall and its old neighbours in the yard.
      sorted(
        id(sentence, 'yard.md'),
        id(DOORS),
        id(COUNT),
        id('# Yard', 'yard.md'),
        id('Close the gate at night.', 'yard.md'),
      ),
    );
  });

  it('split: the first piece is changed, the second new, so its section reruns', () => {
    const texts = {
      'hall.md': HALL.replace(LOCK, 'Lock the door. Do it when the hall is empty.'),
      'yard.md': YARD,
    };
    const events = nextLedger(
      Object.entries(texts).map(([path, text]) => ({ path, cut: cut(text) })),
      before,
      'hall',
    ).events;
    expect(events.split).toBe(1);
    const result = rerunAfter(texts);
    expect(result.counts).toMatchObject({ changed: 1, new: 1 });
    expect(result.rerun).toEqual(sorted(id(COUNT), id(LOCK)));
  });

  it('merged: two units become one, the first changed, the second deleted, and both rerun', () => {
    const merged = HALL.replace(
      'Count the crates twice. Lock the door when the hall is empty.',
      'Count the crates twice and lock the door when the hall is empty.',
    );
    const result = rerunAfter({ 'hall.md': merged, 'yard.md': YARD });
    expect(result.rerun).toEqual(sorted(id(COUNT), id(LOCK)));
    expect(result.counts).toMatchObject({ new: 0, deleted: 1, changed: 1 });
  });

  it('ambiguous: a copied unit keeps its id on the first copy, the copy reruns its section', () => {
    const copied = HALL.replace(`- ${KEYS}\n`, `- ${KEYS}\n- ${KEEPER}\n`);
    const result = rerunAfter({ 'hall.md': copied, 'yard.md': YARD });
    expect(result.counts.new).toBe(1);
    expect(result.rerun).toEqual(sorted(id(PLANTS), id(KEEPER), id(KEYS)));
  });
});

describe('the change manifest of a rerun set', () => {
  it('names the atoms of the units that hold atoms, and the other units by id', () => {
    const next = scan(
      { 'hall.md': HALL.replace(KEEPER, 'Name the keeper of every blue crate'), 'yard.md': YARD },
      before,
    );
    const rerun = rerunOf(ledgerChanges(before, next), before);
    const byUnit = atomsByUnit([
      { id: 'instruction.hall.name-the-keeper', fields: { unit: id(KEEPER) } },
      { id: 'instruction.hall.water-the-plants', fields: { unit: id(PLANTS), condition: [id(KEEPER)] } },
    ]);
    expect(ledgerChangeManifest(rerun, { from: 'v1', to: 'v2', atomsByUnit: byUnit })).toEqual({
      from: 'v1',
      to: 'v2',
      changes: [
        { kind: 'prompt', id: 'instruction.hall.name-the-keeper', note: `unit ${id(KEEPER)}: changed` },
        { kind: 'prompt', id: 'instruction.hall.water-the-plants', note: `unit ${id(KEEPER)}: changed` },
      ],
    });
    expect(ledgerChangeManifest(rerun, { from: 'v1', to: 'v2' }).changes).toEqual([
      { kind: 'unit', id: id(KEEPER), note: 'changed' },
    ]);
  });

  it('is one global change when the whole suite reruns', () => {
    const next = scan({ 'hall.md': HALL, 'yard.md': YARD, 'shed.md': '# Shed\n\nOil the hinges.\n' }, before);
    const manifest = ledgerChangeManifest(rerunOf(ledgerChanges(before, next), before), {
      from: 'v1',
      to: 'v2',
    });
    expect(manifest.changes).toHaveLength(1);
    expect(manifest.changes[0]).toMatchObject({ kind: 'prompt', global: true });
  });
});
