import { expect, it } from 'vitest';
import { buildPlan } from '../../src/index';
import { approvedFixture as committedFixture, edited } from './support';

/** The fixture map with no section on any atom, so each test lays out its own sections. */
async function approvedFixture() {
  return edited(await committedFixture(), (copy) => {
    for (const atom of copy.atoms) {
      const { section: _section, ...rest } = atom.fields ?? {};
      atom.fields = rest;
    }
  });
}

/** The first file of the fixture that holds at least `count` instruction atoms, with those atoms. */
async function crowd(count: number) {
  const map = await approvedFixture();
  const byFile = new Map<string, string[]>();
  for (const atom of map.atoms.filter((one) => one.approved && one.kind === 'instruction')) {
    byFile.set(atom.provenance.file, [...(byFile.get(atom.provenance.file) ?? []), atom.id]);
  }
  const found = [...byFile.values()].find((ids) => ids.length >= count);
  if (!found) throw new Error(`the fixture holds no file with ${count} instruction atoms`);
  return { map, ids: found.slice(0, count) };
}

const firstRow = (plan: ReturnType<typeof buildPlan>['plan'], atom: string) =>
  plan.rows.find((row) => row.atomIds[0] === atom && row.id.startsWith('obligation.'));

it('puts the atoms that read the same section of one file in one plan row', async () => {
  const { map, ids } = await crowd(3);
  const [head, second, third] = ids as [string, string, string];
  const before = buildPlan(map).plan;
  const marked = edited(map, (copy) => {
    for (const atom of copy.atoms.filter((candidate) => ids.includes(candidate.id))) {
      atom.fields = { ...atom.fields, section: ['Duties', 'Safety'] };
    }
  });
  const after = buildPlan(marked).plan;
  const row = firstRow(after, head);
  expect(row?.atomIds).toEqual([...(firstRow(before, head)?.atomIds ?? []), second, third]);
  // Only the first atom of the section carries the group; the rows of the others keep their own atoms.
  for (const id of [second, third]) {
    expect(firstRow(after, id)?.atomIds).toEqual(firstRow(before, id)?.atomIds);
  }
  expect(after.rows.map((candidate) => candidate.id)).toEqual(before.rows.map((candidate) => candidate.id));
});

it('keeps atoms of different sections, and atoms that name no section, in rows of their own', async () => {
  const { map, ids } = await crowd(3);
  const [head, second, third] = ids as [string, string, string];
  const before = buildPlan(map).plan;
  const marked = edited(map, (copy) => {
    const section = new Map([
      [head, ['Duties', 'Safety']],
      [second, ['Duties', 'Billing']],
    ]);
    for (const atom of copy.atoms) {
      const path = section.get(atom.id);
      if (path) atom.fields = { ...atom.fields, section: path };
    }
  });
  const after = buildPlan(marked).plan;
  for (const id of [head, second, third]) {
    expect(firstRow(after, id)?.atomIds).toEqual(firstRow(before, id)?.atomIds);
  }
});

it('never groups atoms of one section path that sit in two files', async () => {
  const map = await approvedFixture();
  const files = new Map<string, string>();
  for (const atom of map.atoms.filter((one) => one.approved && one.kind === 'instruction')) {
    if (!files.has(atom.provenance.file)) files.set(atom.provenance.file, atom.id);
  }
  const pair = [...files.values()].slice(0, 2);
  if (pair.length < 2) throw new Error('the fixture holds instruction atoms in fewer than two files');
  const before = buildPlan(map).plan;
  const marked = edited(map, (copy) => {
    for (const atom of copy.atoms.filter((candidate) => pair.includes(candidate.id))) {
      atom.fields = { ...atom.fields, section: ['Duties'] };
    }
  });
  const after = buildPlan(marked).plan;
  for (const id of pair) expect(firstRow(after, id)?.atomIds).toEqual(firstRow(before, id)?.atomIds);
});

it('ignores an empty section path and a section path that is not a list of headings', async () => {
  const { map, ids } = await crowd(2);
  const before = buildPlan(map).plan;
  for (const section of [[], 'Duties', [1, 2]]) {
    const marked = edited(map, (copy) => {
      for (const atom of copy.atoms.filter((candidate) => ids.includes(candidate.id))) {
        atom.fields = { ...atom.fields, section };
      }
    });
    const after = buildPlan(marked).plan;
    for (const id of ids) expect(firstRow(after, id)?.atomIds).toEqual(firstRow(before, id)?.atomIds);
  }
});

it('groups a gate with the instructions of its section on the first row of the first atom', async () => {
  const map = await approvedFixture();
  const gate = map.atoms.find((atom) => atom.approved && atom.kind === 'gate');
  if (!gate) throw new Error('the fixture holds no approved gate');
  const mate = map.atoms.find(
    (atom) =>
      atom.approved &&
      atom.kind === 'instruction' &&
      atom.provenance.file === gate.provenance.file &&
      atom.id !== gate.id,
  );
  if (!mate) throw new Error('the fixture holds no instruction in the file of its gate');
  const order = map.atoms.map((atom) => atom.id);
  const [head, other] = order.indexOf(gate.id) < order.indexOf(mate.id) ? [gate, mate] : [mate, gate];
  const type = head.kind === 'gate' ? 'ordered_pair' : 'obligation';
  const rowOf = (plan: ReturnType<typeof buildPlan>['plan']) =>
    plan.rows.find((row) => row.atomIds[0] === head.id && row.id.startsWith(`${type}.`));
  const before = buildPlan(map).plan;
  const marked = edited(map, (copy) => {
    for (const atom of copy.atoms.filter((candidate) => [gate.id, mate.id].includes(candidate.id))) {
      atom.fields = { ...atom.fields, section: ['Duties'] };
    }
  });
  const after = buildPlan(marked).plan;
  expect(rowOf(after)?.atomIds).toEqual([...(rowOf(before)?.atomIds ?? []), other.id]);
});
