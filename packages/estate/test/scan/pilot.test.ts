import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { HAND_ROLES, NOW, estate, readRaw, structurePointer } from '../support';

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
    const raw = await readRaw(root);
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

describe('code fences (executor pilot)', () => {
  it('sends no unit of a fenced example to a labeller, so no reference comes from it', async () => {
    const root = await estate({
      '.claude/skills/tally/SKILL.md': [
        '---',
        'name: tally',
        'description: Tally the rows.',
        '---',
        'Always tally twice.',
        '',
        '```text',
        'Before editing a file: read `references/example.md`.',
        '```',
        '',
      ].join('\n'),
      '.claude/skills/tally/references/example.md': '# Example\n',
    });
    const { map } = await scanEstate({
      root,
      reader: new ClaudeCodeReader(),
      registryRoles: HAND_ROLES,
      now: NOW,
      pointer: structurePointer(),
    });
    expect(map.atoms.filter((atom) => ['gate', 'reference', 'hazard'].includes(atom.kind))).toEqual([]);
  });
});

describe('registry columns (executor pilot)', () => {
  it('reads the rules of a guard from a Gates, Covers, Enforced rules or Rule ids column, and from bold headers', async () => {
    for (const header of ['Gates', 'Covers', 'Enforced rules', 'Rule ids', '**Enforces**']) {
      const root = await estate({
        'CLAUDE.md': RULES,
        '.claude/settings.json': SETTINGS,
        '.claude/hooks/shell.py': 'import sys\nsys.exit(0)\n',
        '.claude/hooks/CHECK-REGISTRY.md': `| **Guard** | ${header} |\n|---|---|\n| shell.py | R1 |\n`,
      });
      const raw = await readRaw(root);
      expect(
        raw.registry.map((row) => [row.guard, row.enforces]),
        header,
      ).toEqual([['shell.py', [{ id: 'R1' }]]]);
    }
  });
});

describe('dispatchers (executor pilot)', () => {
  it('finds the script a dispatcher runs from a bare target name', async () => {
    const { scriptOf } = await import('../../src/scan/claude-code');
    const paths = new Set(['.claude/hooks/lib/run.py', '.claude/hooks/block-push.py']);
    expect(
      scriptOf(
        'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/lib/run.py block-push',
        paths,
        new Map([['.claude/hooks/lib/run.py', 'import sys, runpy\nrunpy.run_path(sys.argv[1])\n']]),
      ),
    ).toEqual({
      script: '.claude/hooks/block-push.py',
      anchored: true,
      dispatcher: '.claude/hooks/lib/run.py',
    });
  });
});

describe('YAML data files (executor pilot)', () => {
  it('reads a YAML registry and a YAML step list', async () => {
    const root = await estate({
      'CLAUDE.md': RULES,
      '.claude/settings.json': SETTINGS,
      '.claude/hooks/shell.py': 'import sys\nsys.exit(0)\n',
      '.claude/hooks/registry.yaml': 'checks:\n  - id: G1\n    guard: shell.py\n    enforces: [R1]\n',
      '.claude/steps.yaml': 'steps:\n  - id: plan\n    next: [do]\n  - id: do\n    next: []\n',
    });
    const raw = await readRaw(root);
    expect(raw.registry.map((row) => [row.id, row.guard, row.enforces])).toEqual([
      ['G1', 'shell.py', [{ id: 'R1' }]],
    ]);
    expect(raw.steps.map((step) => [step.id, step.at.startLine, step.next])).toEqual([
      ['plan', 2, ['do']],
      ['do', 4, []],
    ]);
  });
});

describe('command wrappers (executor pilot)', () => {
  it('finds the script behind exec, timeout with its limit and uv run', async () => {
    const { scriptOf } = await import('../../src/scan/claude-code');
    for (const command of [
      'exec python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/shell.py',
      'timeout 5 python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/shell.py',
      'uv run "$CLAUDE_PROJECT_DIR"/.claude/hooks/shell.py',
    ]) {
      expect(scriptOf(command), command).toEqual({ script: '.claude/hooks/shell.py', anchored: true });
    }
  });
});

describe('empty files (executor iteration 11)', () => {
  it('survives an empty skill definition and an empty standing file: noted, no atom', async () => {
    const root = await estate({
      'CLAUDE.md': '',
      '.claude/skills/menu-plan/SKILL.md': '',
      '.claude/skills/menu-plan/references/guide.md': '# Guide\n\nAbout menus.\n',
    });
    const raw = await readRaw(root);
    expect(raw.notes.map((note) => note.file)).toEqual(
      expect.arrayContaining(['CLAUDE.md', '.claude/skills/menu-plan/SKILL.md']),
    );
    const scan = await scanEstate({
      root,
      reader: new ClaudeCodeReader(),
      registryRoles: HAND_ROLES,
      now: NOW,
    });
    const files = scan.map.atoms.map((atom) => atom.provenance.file);
    expect(files).not.toContain('CLAUDE.md');
    expect(files).not.toContain('.claude/skills/menu-plan/SKILL.md');
  });
});

describe('byte order mark (executor iteration 12)', () => {
  it('reads settings that start with a byte order mark', async () => {
    const root = await estate({
      '.claude/settings.json': '﻿{\n  "model": "sonnet"\n}\n',
    });
    const scan = await scanEstate({
      root,
      reader: new ClaudeCodeReader(),
      registryRoles: HAND_ROLES,
      now: NOW,
    });
    const setting = scan.map.atoms.find((atom) => atom.kind === 'setting');
    expect(setting?.provenance.startLine).toBe(2);
  });
});
