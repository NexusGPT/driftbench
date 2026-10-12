import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

const SETTINGS = JSON.stringify({
  hooks: {
    PreToolUse: [
      {
        matcher: 'Bash',
        hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR"/.claude/hooks/shell.py' }],
      },
    ],
  },
});
const RULES = '# Rules\n\n- **R1.** Never delete a file under the archive folder.\n';

describe('forms the reader reads (executor pilot)', () => {
  it('reads a catalogue of checks: entries under hooks, the guard as a hook path, the rules under rules', async () => {
    const root = await estate({
      'CLAUDE.md': RULES,
      '.claude/settings.json': SETTINGS,
      '.claude/hooks/shell.py': 'import sys\nsys.exit(0)\n',
      '.claude/hooks/catalogue.json': JSON.stringify(
        { hooks: [{ id: 'C1', hook: '.claude/hooks/shell.py', rules: ['R1'] }] },
        null,
        2,
      ),
    });
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.registry.map((row) => [row.id, row.guard, row.enforces])).toEqual([
      ['C1', 'shell.py', [{ id: 'R1' }]],
    ]);
  });
});

describe('named paths (executor pilot)', () => {
  it('names the file of a path with an anchor, a query or a link title, and no web address', async () => {
    const { namedPaths } = await import('../../src/scan/code');
    expect(namedPaths('See [the guide](references/guide.md#limits "Guide").')).toEqual([
      'references/guide.md',
    ]);
    expect(namedPaths('Open `references/guide.md?raw`.')).toEqual(['references/guide.md']);
    expect(namedPaths('The guide is at `https://example.com/guide.md`.')).toEqual([]);
  });
});

describe('hazard words (executor pilot)', () => {
  it('reads compaction from the noun and the participle, not from the adjective compact', async () => {
    const { HAZARDS } = await import('../../src/scan/code');
    const compaction = HAZARDS.find((hazard) => hazard.id === 'compaction');
    expect(compaction?.pattern.test('Recover after a compaction of the context.')).toBe(true);
    expect(compaction?.pattern.test('Once the context is compacted, re-read the notes.')).toBe(true);
    expect(compaction?.pattern.test('Keep the report in a compact table.')).toBe(false);
  });
});

/** A port that answers every chunk with no prose atom: the tests below read code atoms only. */
const silent = {
  family: 'test',
  model: 'by hand',
  async complete(request: { user: string }) {
    const chunk = /CHUNK: (\S+)/.exec(request.user)?.[1] ?? '';
    return JSON.stringify({ chunk, atoms: [] });
  },
};

/** The atoms of one skill whose body is the given lines. */
async function skillAtoms(body: string[], extra: Record<string, string> = {}) {
  const root = await estate({
    'CLAUDE.md': '# Rules\n',
    '.claude/skills/tally/SKILL.md': [
      '---',
      'name: tally',
      'description: Tally tickets.',
      '---',
      '',
      ...body,
      '',
    ].join('\n'),
    ...extra,
  });
  const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), port: silent, now: NOW });
  return map.atoms;
}

describe('gates (executor pilot)', () => {
  it('drops the markup around the act and the file of a gate', async () => {
    const atoms = await skillAtoms(['**Before editing a ticket**: read `references/rules.md`.'], {
      '.claude/skills/tally/references/rules.md': '# Rules\n',
    });
    const gate = atoms.find((atom) => atom.kind === 'gate');
    expect(gate?.fields?.trigger).toBe('editing a ticket');
    expect(gate?.fields?.first).toBe('references/rules.md');
  });
});
