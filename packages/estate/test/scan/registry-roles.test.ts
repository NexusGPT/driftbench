import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, pointer, scanEstate } from '../../src/index';
import { plantedDense } from '../pointer/support';
import { estate, NOW, structurePointer } from '../support';

/**
 * A planted labeller for the registry-roles questions: the test, not the reader, says which header cell has which
 * role and which state value is off, in the words of its own estate. Any other unit is none.
 */
function rolesPointer(table: Record<string, string>, asked: string[] = []) {
  const base = structurePointer();
  const labeler = plantedDense((window, set) => {
    if (set.set !== pointer.REGISTRY_ROLES_SET_NAME) return [];
    return window.units.map((unit) => {
      const cell = unit.text.replace(/^[-*]\s+/, '').trim();
      asked.push(cell);
      return { units: String(unit.n), label: table[cell] ?? 'none' };
    });
  });
  return { ...base, labelling: pointer.singleLabelling(labeler) };
}

const GUARD = '#!/bin/sh\nexit 0\n';
const SETTINGS = JSON.stringify({
  hooks: {
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'sh .claude/hooks/shell.sh' }] }],
  },
});
const RULES = '# Rules\n\n- **R1.** Never run a force push.\n';

/** One registry, headers in the language and the words of the test. */
const files = (table: string) => ({
  'CLAUDE.md': RULES,
  '.claude/settings.json': SETTINGS,
  '.claude/hooks/shell.sh': GUARD,
  '.claude/guards/REGISTRY.md': table,
});

const CASES: Array<[string, string[], Record<string, string>]> = [
  [
    'French',
    ['Identifiant', 'Script', 'Règles', 'Sortie'],
    {
      Identifiant: 'col-id',
      Script: 'col-guard',
      Règles: 'col-enforces',
      Sortie: 'col-verdict',
    },
  ],
  [
    'Chinese',
    ['编号', '脚本', '规则', '结论'],
    { 编号: 'col-id', 脚本: 'col-guard', 规则: 'col-enforces', 结论: 'col-verdict' },
  ],
  [
    'a paraphrase that shares no word with the usual headers',
    ['Handle', 'Runner', 'Obeys', 'Outcome'],
    { Handle: 'col-id', Runner: 'col-guard', Obeys: 'col-enforces', Outcome: 'col-verdict' },
  ],
];

const markdown = (header: string[]) =>
  `| ${header.join(' | ')} |\n|${header.map(() => '---').join('|')}|\n| K1 | shell.sh | R1 | arrêt |\n`;

describe('the columns of a registry table come from recorded labels', () => {
  it.each(CASES)('%s headers give the same row', async (_name, header, table) => {
    const root = await estate(files(markdown(header)));
    const asked: string[] = [];
    const { raw, map } = await scanEstate({
      root,
      reader: new ClaudeCodeReader(),
      now: NOW,
      pointer: rolesPointer(table, asked),
    });
    expect(raw.registry.map((row) => [row.id, row.guard, row.enforces, row.verdict])).toEqual([
      ['K1', 'shell.sh', [{ id: 'R1' }], 'arrêt'],
    ]);
    // The labeler is asked each distinct header once, never the cells of the rows.
    expect([...new Set(asked)].sort()).toEqual([...header].sort());
    // The roles are kept for the table, column by column, not by the text of a cell.
    expect(map.registryRoles?.tables).toEqual([
      {
        file: '.claude/guards/REGISTRY.md',
        index: 0,
        roles: header.map((cell) => (table[cell] ?? 'none').replace('col-', '').replace('none', '') || null),
      },
    ]);
  });

  it('records the roles per table: one header text can be a verdict in one table and a state in another', async () => {
    const two = [
      '| Id | Script | Rules | Kind |',
      '|---|---|---|---|',
      '| K1 | shell.sh | R1 | deny |',
      '',
      '| Id | Script | Rules | Kind |',
      '|---|---|---|---|',
      '| K2 | shell.sh | R1 | on |',
      '',
    ].join('\n');
    const root = await estate(files(two));
    const base = structurePointer();
    // The planted labeller answers by the table it is asked about (its header line is in the path).
    const labeler = plantedDense((window, set) => {
      if (set.set !== pointer.REGISTRY_ROLES_SET_NAME) return [];
      const first = window.path.startsWith('registry-roles/1/');
      const roles = ['col-id', 'col-guard', 'col-enforces', first ? 'col-verdict' : 'col-state'];
      return window.units.map((unit) => ({ units: String(unit.n), label: roles[unit.n - 1] ?? 'none' }));
    });
    const { raw, map } = await scanEstate({
      root,
      reader: new ClaudeCodeReader(),
      now: NOW,
      pointer: { ...base, labelling: pointer.singleLabelling(labeler) },
    });
    expect(raw.registry.map((row) => [row.id, row.verdict, row.state])).toEqual([
      ['K1', 'deny', undefined],
      ['K2', undefined, 'on'],
    ]);
    expect(map.registryRoles?.tables.map((table) => table.roles[3])).toEqual(['verdict', 'state']);
  });

  it('reads no row from a table when nothing recorded a role: no header word decides', async () => {
    for (const header of ['Id | Guard | Enforces | Verdict', 'Identifiant | Script | Règles | Sortie']) {
      const root = await estate(files(`| ${header} |\n|---|---|---|---|\n| K1 | shell.sh | R1 | deny |\n`));
      const raw = await new ClaudeCodeReader().read(root);
      expect(raw.registry, header).toEqual([]);
    }
  });

  it('reads the same row again, code only, from the roles a map kept', async () => {
    const [, header, table] = CASES[0] as (typeof CASES)[number];
    const root = await estate(files(markdown(header)));
    const { map } = await scanEstate({
      root,
      reader: new ClaudeCodeReader(),
      now: NOW,
      pointer: rolesPointer(table),
    });
    const again = await new ClaudeCodeReader({ registryRoles: map.registryRoles }).read(root);
    expect(again.registry.map((row) => row.id)).toEqual(['K1']);
  });

  it('a table with a column of ids and a description only is no registry, whatever its words', async () => {
    const root = await estate(
      files('| Identifiant | Texte | Etat |\n|---|---|---|\n| K1 | Préparer l’index. | fait |\n'),
    );
    const { raw } = await scanEstate({
      root,
      reader: new ClaudeCodeReader(),
      now: NOW,
      pointer: rolesPointer({ Identifiant: 'col-id', Texte: 'col-description', Etat: 'col-state' }),
    });
    expect(raw.registry).toEqual([]);
  });
});

describe('the off states of a catalogue come from recorded labels', () => {
  const catalogue = JSON.stringify([
    { id: 'C1', status: 'arrêté', event: 'Stop', watches: ['R1'] },
    { id: 'C2', status: 'actif', event: 'Stop', watches: ['R1'] },
  ]);

  it.each([
    ['French', 'arrêté', 'actif'],
    ['Chinese', '停用', '启用'],
  ])('%s: a check in the off state enforces nothing, the other keeps its rules', async (_name, off, on) => {
    const root = await estate({
      'CLAUDE.md': RULES,
      '.claude/settings.json': SETTINGS,
      '.claude/hooks/shell.sh': GUARD,
      '.claude/guards/catalogue.json': catalogue.replace('arrêté', off).replace('actif', on),
    });
    const { raw, map } = await scanEstate({
      root,
      reader: new ClaudeCodeReader(),
      now: NOW,
      pointer: rolesPointer({ [off]: 'state-off' }),
    });
    expect(raw.registry.map((row) => [row.id, row.enforces.length])).toEqual([
      ['C1', 0],
      ['C2', 1],
    ]);
    expect(map.registryRoles?.offStates).toEqual([off]);
  });

  it('a state no label calls off leaves the check enforcing, whatever the word is', async () => {
    const root = await estate({
      'CLAUDE.md': RULES,
      '.claude/settings.json': SETTINGS,
      '.claude/hooks/shell.sh': GUARD,
      '.claude/guards/catalogue.json': catalogue.replace('arrêté', 'off'),
    });
    const { raw } = await scanEstate({
      root,
      reader: new ClaudeCodeReader(),
      now: NOW,
      pointer: rolesPointer({}),
    });
    expect(raw.registry.map((row) => row.enforces.length)).toEqual([1, 1]);
  });
});
