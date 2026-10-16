import { rm } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { buildPlan, ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

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
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    return documents ? { ...map, documents: documents as never } : map;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const roles = [
  { path: '.claude/skills/berths/references/samples/berth-plan-001.md', role: 'example' },
  { path: '.claude/skills/berths/references/blank-form.md', role: 'template' },
  { path: '.claude/skills/berths/references/tide-limits.md', role: 'normative' },
];

it('gives no test to a reference whose target the map records as an example or a template', async () => {
  const map = await scanned(roles);
  const references = map.atoms.filter((atom) => atom.kind === 'reference');
  expect(references).toHaveLength(3);
  const { plan, details } = buildPlan(map);
  const tested = new Set(plan.rows.flatMap((row) => row.atomIds));
  const live = references.filter((atom) => atom.fields?.path === roles[2]?.path);
  const navigation = references.filter((atom) => atom.fields?.path !== roles[2]?.path);
  expect(live).toHaveLength(1);
  expect(navigation).toHaveLength(2);
  for (const atom of live) {
    expect(plan.rows.some((row) => row.testType === 'read_when' && row.atomIds[0] === atom.id)).toBe(true);
  }
  for (const atom of navigation) expect(tested.has(atom.id)).toBe(false);
  expect(plan.rows.filter((row) => row.testType === 'read_when')).toHaveLength(1);
  expect(details.notes.some((note) => /2 references to documents.*navigation only/.test(note))).toBe(true);
}, 30_000);

it('keeps every reference test when the map records no document roles, guessing nothing from names', async () => {
  const map = await scanned();
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
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    const withRoles = { ...map, documents: roles as never };
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
