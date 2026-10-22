import { rm } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { buildPlan, ClaudeCodeReader, planJourneys, scanEstate } from '../../src/index';
import { approvedAll, estate, NOW, structurePointer } from '../support';

const files = {
  'CLAUDE.md': '# Harbour office\n',
  '.claude/skills/berths/SKILL.md': [
    '---',
    'name: berths',
    'description: Assigns ships to berths for the harbour office.',
    '---',
    '# Berths',
    'Read references/tide-limits.md when assigning a deep-draught ship.',
    'Read references/samples/berth-plan-001.md for a finished plan.',
    'Read references/blank-form.md for the empty form.',
    '',
  ].join('\n'),
  '.claude/skills/berths/references/tide-limits.md': '# Tide limits\nDraught limits per tide.\n',
  '.claude/skills/berths/references/samples/berth-plan-001.md': '# Sample plan\nA finished plan.\n',
  '.claude/skills/berths/references/blank-form.md': '# Form\nShip: {{ship}}\nBerth: {{berth}}\n',
};

async function scanned(documents?: Array<{ path: string; role: string }>) {
  const root = await estate(files);
  try {
    const { map } = await scanEstate({
      root,
      reader: new ClaudeCodeReader(),
      now: NOW,
      pointer: structurePointer(),
    });
    const approved = approvedAll(map);
    return documents ? { ...approved, documents: documents as never } : approved;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const roles = [
  { path: '.claude/skills/berths/references/samples/berth-plan-001.md', role: 'example' },
  { path: '.claude/skills/berths/references/blank-form.md', role: 'template' },
  { path: '.claude/skills/berths/references/tide-limits.md', role: 'normative' },
];

it('gives a read test to a reference whose target the map records as an example or a template, and no journey', async () => {
  const map = await scanned(roles);
  const references = map.atoms.filter((atom) => atom.kind === 'reference');
  expect(references).toHaveLength(3);
  const { plan, details } = buildPlan(map);
  // An order to read a file is a duty of the agent, whatever role the file plays.
  for (const atom of references) {
    expect(
      plan.rows.some((row) => row.testType === 'read_when' && row.atomIds[0] === atom.id),
      atom.id,
    ).toBe(true);
  }
  expect(plan.rows.filter((row) => row.testType === 'read_when')).toHaveLength(3);
  // The document is a place to look, not a step of a path: no journey leads to it.
  const navigation = references.filter((atom) => atom.fields?.path !== roles[2]?.path);
  expect(navigation).toHaveLength(2);
  for (const atom of navigation)
    expect(plan.rows.some((row) => row.testType === 'journey' && row.atomIds.includes(atom.id))).toBe(false);
  expect(
    details.notes.some((note) => /2 references to documents.*navigation only.*get a read test/.test(note)),
  ).toBe(true);
}, 30_000);

it('keeps every reference test when the map records no document roles, guessing nothing from names', async () => {
  // A fresh scan records the roles it finds, so the map is given none, as an older map would have it.
  const map = await scanned([]);
  const { plan, details } = buildPlan(map);
  expect(plan.rows.filter((row) => row.testType === 'read_when')).toHaveLength(3);
  expect(details.notes.some((note) => /navigation only/.test(note))).toBe(false);
}, 30_000);

it('keeps a prerequisite to read a template: only a read-when reference is a place to look', async () => {
  const root = await estate({
    ...files,
    '.claude/skills/berths/SKILL.md': [
      '---',
      'name: berths',
      'description: Assigns ships to berths for the harbour office.',
      '---',
      '# Berths',
      'Before assigning a berth: Read references/blank-form.md.',
      '',
    ].join('\n'),
  });
  try {
    const { map } = await scanEstate({
      root,
      reader: new ClaudeCodeReader(),
      now: NOW,
      pointer: structurePointer([
        { contains: 'Before assigning a berth', act: 'assigning a berth', tool: 'Edit' },
      ]),
    });
    const withRoles = { ...approvedAll(map), documents: roles as never };
    const gate = withRoles.atoms.find((atom) => atom.kind === 'gate');
    expect(gate).toBeDefined();
    const { plan } = buildPlan(withRoles);
    expect(plan.rows.some((row) => row.testType === 'ordered_pair' && row.atomIds[0] === gate?.id)).toBe(
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

it('walks no journey into a document outside the estate, and still tests the read itself', async () => {
  const root = await estate({
    'CLAUDE.md': '# Harbour office\n',
    '.claude/skills/berths/SKILL.md': [
      '---',
      'name: berths',
      'description: Assigns ships to berths for the harbour office.',
      '---',
      '# Berths',
      'Read references/tide-limits.md when assigning a deep-draught ship.',
      '',
    ].join('\n'),
    '.claude/skills/berths/references/tide-limits.md': '# Tide limits\nDraught limits per tide.\n',
  });
  try {
    const { map } = await scanEstate({
      root,
      reader: new ClaudeCodeReader(),
      now: NOW,
      pointer: structurePointer(),
    });
    const reference = map.atoms.find((atom) => atom.kind === 'reference');
    expect(reference).toBeDefined();
    const external = {
      ...map,
      atoms: map.atoms.map((atom) =>
        atom.id === reference?.id ? { ...atom, fields: { ...atom.fields, external: true } } : atom,
      ),
    };
    const inside = planJourneys(approvedAll(map));
    const outside = planJourneys(approvedAll(external));
    expect(inside.edges.some((edge) => edge.to === reference?.id)).toBe(true);
    expect(outside.edges.some((edge) => edge.to === reference?.id)).toBe(false);
    expect(outside.journeys.flatMap((journey) => journey.atomIds)).not.toContain(reference?.id);
    expect(buildPlan(approvedAll(external)).plan.rows.some((row) => row.testType === 'read_when')).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
